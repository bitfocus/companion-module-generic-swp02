import { EventEmitter } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import { InstanceStatus, TCPHelper, type LogLevel } from '@companion-module/base'
import PQueue from 'p-queue'
import {
	ACK_TIMEOUT_MS,
	FRAME_IDLE_MS,
	KEEPALIVE_INTERVAL_MS,
	MESSAGE_GAP_MS,
	Priority,
	RECONNECT_INTERVAL_MS,
} from './consts.js'
import {
	databaseChecksumRequest,
	dualControllerStatusRequest,
	endsMerging,
	hex,
	mergeKey,
	routerConfigurationRequest,
} from './messages.js'
import { decodeFrame, FrameReader, type CrosspointResponse, type Response } from './responses.js'
import { errorMessage, unhandledOption } from '../util.js'

export interface RouterTiming {
	/** Least time from sending one message to sending the next */
	messageGap: number
	/** Longest wait for a reply before sending the next message anyway, when waiting for ACK */
	ackTimeout: number
	keepaliveInterval: number
	reconnectInterval: number
	/** How long the line must be quiet to end a message of unknown length that no SOM has followed */
	frameIdle: number
}

export const DEFAULT_TIMING: RouterTiming = {
	messageGap: MESSAGE_GAP_MS,
	ackTimeout: ACK_TIMEOUT_MS,
	keepaliveInterval: KEEPALIVE_INTERVAL_MS,
	reconnectInterval: RECONNECT_INTERVAL_MS,
	frameIdle: FRAME_IDLE_MS,
}

/**
 * A router that has answered a keepalive on this connection and then sends nothing for this many keepalive intervals is
 * taken to have gone, and the connection is reopened. A pulled cable or a power cut leaves the socket open: TCPHelper
 * enables TCP keepalive at the OS default, which on most systems takes two hours to notice.
 *
 * Only a router known to answer is watched. One that never answers the keepalive would otherwise be reconnected every
 * minute while idle.
 */
export const WATCHDOG_INTERVALS = 1.5

export interface RouterOptions {
	host: string
	port: number
	/** Hold each message until the router replies, or {@link RouterTiming.ackTimeout} passes */
	waitForAck: boolean
	log: (level: LogLevel, message: string) => void
	/** Defaults to {@link DEFAULT_TIMING}. Tests shorten it */
	timing?: Partial<RouterTiming>
}

export interface RouterEvents {
	/** A connection has opened. Fires again on every reconnection */
	connected: []
	/** The open connection has closed or failed. TCPHelper keeps trying to reopen it */
	disconnected: []
	/** A TALLY or CONNECTED message */
	crosspoint: [response: CrosspointResponse]
	status: [status: InstanceStatus, message: string | null]
}

/** One send of a message that has been merged with others, or may yet be */
interface Sender {
	readonly message: Buffer
	readonly resolve: () => void
	readonly reject: (reason: unknown) => void
}

/** A message with a {@link mergeKey}, queued once for every send merged with it */
interface WaitingMessage {
	readonly key: string
	/** The queue's id for the job, to change its priority by */
	readonly id: string
	priority: Priority
	/** In the order sent. The newest one's bytes are the ones that go */
	readonly senders: Sender[]
	/** Aborted once every sender has been, which drops the job */
	readonly controller: AbortController
	/** Set once the queue has started the job, after which its priority can't be changed */
	started: boolean
}

/** Resolves true if the promise settles within the time, false if not */
async function settlesWithin(promise: Promise<void>, ms: number): Promise<boolean> {
	let timer: NodeJS.Timeout | undefined
	const timeout = new Promise<false>((resolve) => {
		timer = setTimeout(() => resolve(false), ms)
	})
	try {
		return await Promise.race([promise.then(() => true), timeout])
	} finally {
		clearTimeout(timer)
	}
}

/**
 * The TCP connection to a SW-P-02 router: framing, pacing, keepalive and reconnection. Knows nothing of Companion
 * beyond reporting a status for it.
 */
export class RouterConnection extends EventEmitter<RouterEvents> {
	readonly #options: RouterOptions
	readonly #timing: RouterTiming
	readonly #queue = new PQueue({ concurrency: 1 })
	readonly #reader = new FrameReader()
	/** Messages not yet sent that later ones may be merged with, by {@link mergeKey} */
	readonly #waiting = new Map<string, WaitingMessage>()
	/** Makes each waiting message's queue id unique. The queue's own are '1', '2' and so on, so these must not be */
	#waitingCount = 0
	#socket: TCPHelper | undefined
	/** Exists while a connection is open, and is aborted as it closes, which drops everything queued for it */
	#session: AbortController | undefined
	/** Settles once the router may be sent the next message */
	#lineClear: Promise<void> = Promise.resolve()
	/** Ends the wait for a reply to the last message sent */
	#replied: (() => void) | undefined
	#keepaliveTimer: NodeJS.Timeout | undefined
	#frameIdleTimer: NodeJS.Timeout | undefined
	#lastReceived = 0
	#answersKeepalive = false
	/** Set by the first failure of an outage, so retries against a router that is off don't flood the log */
	#outageLogged = false
	#lastStatus: { status: InstanceStatus; message: string | null } | undefined
	#destroyed = false

	constructor(options: RouterOptions) {
		super()
		this.#options = options
		this.#timing = { ...DEFAULT_TIMING, ...options.timing }
	}

	get isConnected(): boolean {
		return this.#session !== undefined
	}

	/** Opens the connection, replacing any already open. After that, TCPHelper reconnects by itself */
	connect(): void {
		if (this.#destroyed) throw new Error('Router connection has been destroyed')
		this.#closeSocket()
		const { host, port } = this.#options
		this.#status(InstanceStatus.Connecting, `Connecting to ${host}:${port}`)
		const socket = new TCPHelper(host, port, { reconnect: true, reconnect_interval: this.#timing.reconnectInterval })
		this.#socket = socket
		socket.on('connect', () => this.#open())
		socket.on('data', (chunk) => this.#receive(chunk))
		socket.on('end', () => {
			this.#close()
			this.#status(InstanceStatus.Disconnected, 'Connection closed by router')
			this.#logOutage('warn', `Connection closed by ${host}:${port}`)
		})
		socket.on('error', (err) => {
			this.#close()
			this.#status(InstanceStatus.ConnectionFailure, err.message)
			this.#logOutage('error', `Network error: ${err.message}`)
		})
	}

	/** Closes the connection for good. Anything still queued is rejected */
	destroy(): void {
		this.#destroyed = true
		this.removeAllListeners()
		this.#closeSocket()
	}

	/**
	 * Queues a message for the router. An INTERROGATE or CONNECT is merged with one for the same destination still
	 * waiting, if there is one: see {@link mergeKey}
	 * @param signal an action's context.signal. A message whose signal aborts before its turn is never sent. A merged
	 * message goes unless every send merged into it aborts
	 * @returns once the message is written to the socket, or the one it was merged with is
	 * @throws if there is no connection, or it closes or the signal aborts before the message is sent
	 */
	async send(message: Buffer, priority: Priority = Priority.Background, signal?: AbortSignal): Promise<void> {
		const session = this.#session
		if (session === undefined) throw new Error('Not connected to router')
		if (endsMerging(message)) this.#waiting.clear()
		const key = mergeKey(message)
		if (key !== undefined) {
			await this.#sendMerged(key, message, priority, session, signal)
			return
		}
		// p-queue listens on the combined signal from the moment the job is queued, which makes it pass an abort on
		// eagerly. Only reading .aborted could miss one: AbortSignal.any holds its sources weakly
		const combined = signal ? AbortSignal.any([session.signal, signal]) : session.signal
		await this.#queue.add(async ({ signal: jobSignal }) => this.#transmit(() => message, jobSignal), {
			priority,
			signal: combined,
		})
	}

	/**
	 * Waits for the router to report the source on a destination, as the TALLY answering an interrogate does
	 * @returns the source, or undefined if none is reported within the timeout
	 */
	async waitForCrosspoint(destination: number, timeout: number, signal?: AbortSignal): Promise<number | undefined> {
		signal?.throwIfAborted()
		return new Promise<number | undefined>((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(timer)
				this.off('crosspoint', onCrosspoint)
				signal?.removeEventListener('abort', onAbort)
			}
			const onCrosspoint = (response: CrosspointResponse) => {
				if (response.destination !== destination) return
				cleanup()
				resolve(response.source)
			}
			const onAbort = () => {
				cleanup()
				const reason: unknown = signal?.reason
				reject(reason instanceof Error ? reason : new Error(`Aborted: ${String(reason)}`))
			}
			const timer = setTimeout(() => {
				cleanup()
				resolve(undefined)
			}, timeout)
			this.on('crosspoint', onCrosspoint)
			signal?.addEventListener('abort', onAbort, { once: true })
		})
	}

	/**
	 * Sends a message with a {@link mergeKey}, merged with the one waiting for the same key if there is one. That keeps
	 * its place in the queue, and moves up to this one's priority if that is higher
	 */
	async #sendMerged(
		key: string,
		message: Buffer,
		priority: Priority,
		session: AbortController,
		signal: AbortSignal | undefined,
	): Promise<void> {
		signal?.throwIfAborted()
		const { promise, resolve, reject } = Promise.withResolvers<void>()
		const sender: Sender = { message, resolve, reject }
		let waiting = this.#waiting.get(key)
		const merged = waiting !== undefined
		if (waiting === undefined) {
			waiting = {
				key,
				id: `${key} #${++this.#waitingCount}`,
				priority,
				senders: [],
				controller: new AbortController(),
				started: false,
			}
			this.#waiting.set(key, waiting)
		} else {
			this.#options.log('debug', `Merged ${hex(message)} with the ${key} already waiting`)
			if (priority > waiting.priority && !waiting.started) {
				this.#queue.setPriority(waiting.id, priority)
				waiting.priority = priority
			}
		}
		waiting.senders.push(sender)
		if (signal) {
			const entry = waiting
			const onAbort = () => this.#abandon(entry, sender, signal.reason)
			signal.addEventListener('abort', onAbort, { once: true })
			const stopListening = () => signal.removeEventListener('abort', onAbort)
			promise.then(stopListening, stopListening)
		}
		if (!merged) this.#queueWaiting(waiting, session)
		await promise
	}

	#queueWaiting(waiting: WaitingMessage, session: AbortController): void {
		// As in send, p-queue listens on the combined signal from the moment the job is queued
		const signal = AbortSignal.any([session.signal, waiting.controller.signal])
		this.#queue
			.add(
				async ({ signal: jobSignal }) => {
					waiting.started = true
					await this.#transmit(() => this.#take(waiting), jobSignal)
				},
				{ id: waiting.id, priority: waiting.priority, signal },
			)
			.then(
				() => {
					for (const sender of this.#finish(waiting)) sender.resolve()
				},
				(err: unknown) => {
					for (const sender of this.#finish(waiting)) sender.reject(err)
				},
			)
	}

	/** The bytes to send for a waiting message, taken just before they go, after which nothing more is merged with it */
	#take(waiting: WaitingMessage): Buffer {
		this.#forget(waiting)
		const newest = waiting.senders.at(-1)
		// The job's signal aborts with the last sender, so this can't happen
		if (newest === undefined) throw new Error('Every send of the message has been aborted')
		return newest.message
	}

	/** Drops a sender whose signal has aborted. The message is still sent for any others, or dropped if there are none */
	#abandon(waiting: WaitingMessage, sender: Sender, reason: unknown): void {
		const index = waiting.senders.indexOf(sender)
		if (index === -1) return
		waiting.senders.splice(index, 1)
		sender.reject(reason)
		if (waiting.senders.length > 0) return
		this.#forget(waiting)
		waiting.controller.abort(reason)
	}

	/** Once a waiting message's job has settled: the senders still to be told how it went */
	#finish(waiting: WaitingMessage): Sender[] {
		this.#forget(waiting)
		return waiting.senders.splice(0)
	}

	#forget(waiting: WaitingMessage): void {
		if (this.#waiting.get(waiting.key) === waiting) this.#waiting.delete(waiting.key)
	}

	/**
	 * @param take gives the bytes to send. It is called only once the line is clear, so a message that something was
	 * merged with while it waited goes as it now stands
	 */
	async #transmit(take: () => Buffer, signal: AbortSignal | undefined): Promise<void> {
		// The wait is here, at the start of a job, rather than at the end of the one before. p-queue starts the next job as
		// soon as a running job's signal aborts, and the router must still get its gap and its chance to reply
		await this.#lineClear
		signal?.throwIfAborted()
		const socket = this.#socket
		if (!socket?.isConnected) throw new Error('Not connected to router')
		const message = take()
		this.#holdLine()
		this.#options.log('debug', `Sending ${hex(message)}`)
		try {
			if (!(await socket.sendAsync(message))) throw new Error('Not connected to router')
		} catch (err) {
			// No reply is coming to a message that never went
			this.#releaseLine()
			throw err
		}
	}

	/** Called just before a message goes, so a reply can't arrive before anything is waiting for it */
	#holdLine(): void {
		const replied = new Promise<void>((resolve) => {
			this.#replied = resolve
		})
		const waits: Promise<unknown>[] = [sleep(this.#timing.messageGap)]
		if (this.#options.waitForAck) {
			waits.push(
				settlesWithin(replied, this.#timing.ackTimeout).then((didReply) => {
					if (!didReply) this.#options.log('debug', `No reply within ${this.#timing.ackTimeout} ms, sending on`)
				}),
			)
		}
		this.#lineClear = Promise.all(waits).then(() => undefined)
	}

	#releaseLine(): void {
		this.#replied?.()
		this.#replied = undefined
	}

	#open(): void {
		this.#close()
		const { host, port } = this.#options
		this.#session = new AbortController()
		this.#reader.reset()
		this.#lineClear = Promise.resolve()
		this.#lastReceived = Date.now()
		this.#answersKeepalive = false
		this.#outageLogged = false
		this.#options.log('info', `Connected to ${host}:${port}`)
		this.#status(InstanceStatus.Ok, 'Connected')
		// The queries a Probel general switcher makes on connecting
		this.#sendInBackground(databaseChecksumRequest())
		this.#sendInBackground(dualControllerStatusRequest())
		this.#sendInBackground(routerConfigurationRequest())
		this.#scheduleKeepalive()
		this.emit('connected')
	}

	/** Ends the session, if one is open: everything queued for it is rejected, and its timers stopped */
	#close(): void {
		const session = this.#session
		if (session === undefined) return
		this.#session = undefined
		clearTimeout(this.#keepaliveTimer)
		this.#keepaliveTimer = undefined
		clearTimeout(this.#frameIdleTimer)
		this.#frameIdleTimer = undefined
		session.abort(new Error('Connection to router closed'))
		this.#releaseLine()
		this.#lineClear = Promise.resolve()
		this.#reader.reset()
		this.emit('disconnected')
	}

	#closeSocket(): void {
		this.#close()
		// TCPHelper's destroy removes its listeners first, so the old socket can't report anything once replaced
		this.#socket?.destroy()
		this.#socket = undefined
	}

	#receive(chunk: Buffer): void {
		this.#lastReceived = Date.now()
		// SW-P-02 has no ACK of its own. A reply, or any message at all, shows the router is ready for the next one
		this.#releaseLine()
		clearTimeout(this.#frameIdleTimer)
		const { frames, discarded } = this.#reader.push(chunk)
		if (discarded > 0) this.#options.log('debug', `Discarded ${discarded} bytes outside a message`)
		for (const frame of frames) this.#handleFrame(frame)
		if (this.#reader.hasUnterminated) {
			this.#frameIdleTimer = setTimeout(() => {
				const frame = this.#reader.flushUnterminated()
				if (frame) this.#handleFrame(frame)
			}, this.#timing.frameIdle)
		}
	}

	#handleFrame(frame: Buffer): void {
		try {
			this.#handle(decodeFrame(frame))
		} catch (err) {
			// This runs in the socket's data listener, where a throw would end the module's process
			this.#options.log('error', `Could not handle message ${hex(frame)}: ${errorMessage(err)}`)
		}
	}

	#handle(response: Response): void {
		switch (response.type) {
			case 'crosspoint':
				this.emit('crosspoint', response)
				break
			case 'databaseChecksum':
				this.#answersKeepalive = true
				this.#options.log('debug', `Database checksum: ${hex(response.data)}`)
				break
			case 'log':
				this.#options.log(response.level, response.message)
				break
			default:
				unhandledOption(response, undefined)
		}
	}

	#scheduleKeepalive(): void {
		clearTimeout(this.#keepaliveTimer)
		this.#keepaliveTimer = setTimeout(() => this.#keepalive(), this.#timing.keepaliveInterval)
	}

	#keepalive(): void {
		this.#keepaliveTimer = undefined
		const silence = Date.now() - this.#lastReceived
		if (this.#answersKeepalive && silence > this.#timing.keepaliveInterval * WATCHDOG_INTERVALS) {
			this.#options.log('warn', `Nothing received from router for ${silence} ms, reconnecting`)
			this.connect()
			return
		}
		this.#sendInBackground(databaseChecksumRequest())
		this.#scheduleKeepalive()
	}

	/** For messages nothing waits on. Their only failure is the connection closing, which is reported already */
	#sendInBackground(message: Buffer): void {
		this.send(message).catch((err) => this.#options.log('debug', `Not sent ${hex(message)}: ${errorMessage(err)}`))
	}

	#status(status: InstanceStatus, message: string | null): void {
		if (this.#lastStatus?.status === status && this.#lastStatus.message === message) return
		this.#lastStatus = { status, message }
		this.emit('status', status, message)
	}

	#logOutage(level: LogLevel, message: string): void {
		this.#options.log(this.#outageLogged ? 'debug' : level, message)
		this.#outageLogged = true
	}
}
