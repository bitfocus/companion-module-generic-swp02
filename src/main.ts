import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { clampCount, GetConfigFields, validPort, type ModuleConfig } from './config.js'
import { UpgradeScripts } from './upgrades.js'
import { ActionId, UpdateActions, type ActionSchema } from './actions.js'
import { FeedbackId, UpdateFeedbacks, type FeedbackSchema } from './feedbacks.js'
import {
	destinationVariableId,
	UpdateVariableDefinitions,
	UpdateVariableValues,
	type VariablesSchema,
} from './variables.js'
import { Command, interrogate, Priority, RouterConnection, type CrosspointResponse } from './api/index.js'
import { isInRange } from './options.js'
import { errorMessage } from './util.js'

/** How long a learn waits for the router to answer an interrogate. Companion gives a learn 5 s in all */
export const LEARN_WAIT_MS = 3000

export type ModuleTypes = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionSchema
	feedbacks: FeedbackSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

export default class SwP02Instance extends InstanceBase<ModuleTypes> {
	config!: ModuleConfig // Setup in init()
	/** The source on each destination, as the router last reported it. A destination it hasn't reported is absent */
	readonly crosspoints = new Map<number, number>()
	isRecordingActions = false
	/** Destinations interrogated on the current connection, so each is asked for once however many feedbacks use it */
	readonly #interrogated = new Set<number>()
	#router: RouterConnection | undefined

	constructor(internal: unknown) {
		super(internal)
	}

	get sourceCount(): number {
		return clampCount(this.config.src)
	}

	get destinationCount(): number {
		return clampCount(this.config.dst)
	}

	async init(config: ModuleConfig): Promise<void> {
		await this.configUpdated(config)
	}

	// When module gets deleted
	async destroy(): Promise<void> {
		this.log('debug', `destroy ${this.id}`)
		this.#closeRouter()
		this.updateStatus(InstanceStatus.Disconnected)
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		this.#closeRouter()
		// The counts, or the router itself, may have changed
		this.crosspoints.clear()
		this.updateActions()
		this.updateFeedbacks()
		this.updateVariableDefinitions()
		UpdateVariableValues(this)
		this.#openRouter()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	handleStartStopRecordActions(isRecording: boolean): void {
		this.isRecordingActions = isRecording
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	/**
	 * Queues a message for the router, ahead of any interrogation in progress
	 * @param signal an action's context.signal, so a message the user no longer wants is dropped before it is sent
	 */
	async send(message: Buffer, signal?: AbortSignal): Promise<void> {
		if (this.#router === undefined) throw new Error('Not connected to router')
		await this.#router.send(message, Priority.Action, signal)
	}

	async interrogate(destination: number, signal?: AbortSignal): Promise<void> {
		this.#interrogated.add(destination)
		await this.send(interrogate(destination), signal)
	}

	/**
	 * Interrogates a destination in the background, unless it has been already on this connection. For feedbacks and
	 * actions to call as often as they like.
	 */
	requestCrosspoint(destination: number): void {
		const router = this.#router
		if (this.#interrogated.has(destination) || !router?.isConnected) return
		this.#interrogated.add(destination)
		router.send(interrogate(destination), Priority.Background).catch((err) => {
			this.#interrogated.delete(destination)
			this.log('debug', `Interrogate destination ${destination} not sent: ${errorMessage(err)}`)
		})
	}

	/**
	 * The source on a destination, for a learn. Asks the router if it has not reported one yet
	 * @returns undefined for a destination or source outside the configured counts, or if the router doesn't say
	 */
	async learnSource(destination: number, signal: AbortSignal): Promise<number | undefined> {
		if (!isInRange(destination, this.destinationCount)) return undefined
		let source = this.crosspoints.get(destination)
		const router = this.#router
		if (source === undefined && router?.isConnected) {
			;[source] = await Promise.all([
				router.waitForCrosspoint(destination, LEARN_WAIT_MS, signal),
				this.interrogate(destination, signal),
			])
		}
		if (source === undefined) return undefined
		if (!isInRange(source, this.sourceCount)) {
			this.log('warn', `Source ${source} on destination ${destination} is beyond the source count, not learnt`)
			return undefined
		}
		return source
	}

	#openRouter(): void {
		const host = this.config.host?.trim()
		const port = validPort(this.config.port)
		if (!host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No host')
			return
		}
		if (port === undefined) {
			this.updateStatus(InstanceStatus.BadConfig, `Invalid port ${String(this.config.port)}`)
			return
		}
		const router = new RouterConnection({
			host,
			port,
			waitForAck: this.config.waitOnAck,
			log: (level, message) => this.log(level, message),
		})
		router.on('status', (status, message) => this.updateStatus(status, message))
		router.on('connected', () => this.#onConnected())
		router.on('crosspoint', (response) => this.#onCrosspoint(response))
		this.#router = router
		router.connect()
	}

	#closeRouter(): void {
		this.#router?.destroy()
		this.#router = undefined
		this.#interrogated.clear()
	}

	#onConnected(): void {
		// Crosspoints may have changed while disconnected, so every one is asked for again
		this.#interrogated.clear()
		if (this.config.interrogate) {
			for (let destination = 1; destination <= this.destinationCount; destination++) {
				this.requestCrosspoint(destination)
			}
		} else {
			// Only the destinations in use, which the feedback callbacks and action subscribe hooks each ask for
			this.subscribeActions()
			this.checkAllFeedbacks()
		}
	}

	#onCrosspoint({ command, destination, source }: CrosspointResponse): void {
		if (!isInRange(destination, this.destinationCount)) {
			this.log('debug', `Destination ${destination} is beyond the destination count, ignored`)
			return
		}
		if (command === Command.Connected) {
			this.log('info', `Connected: destination ${destination}, source ${source}`)
		} else {
			this.log('debug', `Tally: destination ${destination}, source ${source}`)
		}
		// A CONNECTED, which the router sends on all its ports, means there is no need to interrogate this destination
		this.#interrogated.add(destination)
		const previous = this.crosspoints.get(destination)
		this.crosspoints.set(destination, source)
		if (previous !== source) {
			this.setVariableValues({ [destinationVariableId(destination)]: source })
			this.checkFeedbacks(FeedbackId.Crosspoint)
		}
		if (this.isRecordingActions && isInRange(source, this.sourceCount)) {
			this.recordAction(
				{ actionId: ActionId.Connect, options: { dst: destination, src: source } },
				`connect ${destination}`,
			)
		}
	}
}
