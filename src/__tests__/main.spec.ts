import { setTimeout as sleep } from 'node:timers/promises'
import { InstanceStatus, type CompanionFeedbackDefinitions } from '@companion-module/base'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SwP02Instance from '../main.js'
import type { ModuleConfig } from '../config.js'
import { Command, connect } from '../api/index.js'
import { FeedbackId, type FeedbackSchema } from '../feedbacks.js'
import { ActionId } from '../actions.js'
import { FakeRouter, routerMessage } from './fakeRouter.js'
import { checkFeedback } from './fixtures.js'

/** What InstanceBase needs from the host, with everything it forwards to Companion mocked */
function createContext() {
	return {
		id: 'test-instance',
		_isInstanceContext: true as const,
		label: 'test',
		upgradeScripts: [],
		saveConfig: vi.fn(),
		updateStatus: vi.fn(),
		oscSend: vi.fn(),
		recordAction: vi.fn(),
		setActionDefinitions: vi.fn(),
		subscribeActions: vi.fn(),
		unsubscribeActions: vi.fn(),
		setFeedbackDefinitions: vi.fn(),
		unsubscribeFeedbacks: vi.fn(),
		checkFeedbacks: vi.fn(),
		checkAllFeedbacks: vi.fn(),
		checkFeedbacksById: vi.fn(),
		setPresetDefinitions: vi.fn(),
		setCompositeElementDefinitions: vi.fn(),
		setVariableDefinitions: vi.fn(),
		setVariableValues: vi.fn(),
		getVariableValue: vi.fn(),
		sharedUdpSocketHandlers: new Map(),
		sharedUdpSocketJoin: vi.fn(),
		sharedUdpSocketLeave: vi.fn(),
		sharedUdpSocketSend: vi.fn(),
	}
}

let fake: FakeRouter
const instances: SwP02Instance[] = []

beforeEach(async () => {
	fake = new FakeRouter()
	await fake.listen()
})

afterEach(async () => {
	for (const instance of instances.splice(0)) await instance.destroy()
	await fake.close()
})

function createInstance() {
	const context = createContext()
	const instance = new SwP02Instance(context)
	const log = vi.spyOn(instance, 'log').mockImplementation(() => {})
	instances.push(instance)
	return { instance, context, log }
}

function config(overrides: Partial<ModuleConfig> = {}): ModuleConfig {
	return { host: '127.0.0.1', port: fake.port, interrogate: true, waitOnAck: true, src: 16, dst: 8, ...overrides }
}

const allVariableValues = (context: ReturnType<typeof createContext>) =>
	Object.assign({}, ...context.setVariableValues.mock.calls.map(([values]) => values as object)) as Record<
		string,
		unknown
	>

/** The feedback definitions last given to Companion, for their callbacks to be run against the real instance */
const definedFeedbacks = (context: ReturnType<typeof createContext>) =>
	context.setFeedbackDefinitions.mock.calls.at(-1)?.[0] as CompanionFeedbackDefinitions<FeedbackSchema>

/** Waits for the connection, and for the interrogation on connecting to finish */
async function started(overrides: Partial<ModuleConfig> = {}) {
	const created = createInstance()
	const cfg = config(overrides)
	await created.instance.init(cfg)
	await vi.waitFor(() => expect(created.context.updateStatus).toHaveBeenCalledWith(InstanceStatus.Ok, 'Connected'))
	if (cfg.interrogate) await vi.waitFor(() => expect(fake.interrogated()).toHaveLength(cfg.dst), { timeout: 3000 })
	await sleep(50)
	return created
}

describe('starting', () => {
	it('defines a variable per destination, each unknown until the router says', async () => {
		const { instance, context } = createInstance()
		await instance.init(config({ host: '' }))
		expect(Object.keys(context.setVariableDefinitions.mock.calls[0][0])).toEqual([
			'dst1',
			'dst2',
			'dst3',
			'dst4',
			'dst5',
			'dst6',
			'dst7',
			'dst8',
		])
		expect(context.setVariableValues).toHaveBeenCalledWith(
			Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((d) => [`dst${d}`, 'unknown'])),
		)
	})

	it('interrogates every destination on connecting, and fills in the variables and the feedbacks', async () => {
		fake.crosspoints.set(3, 7)
		const { instance, context } = createInstance()
		await instance.init(config())
		// As Companion runs the callbacks of the feedbacks on its buttons once the module has started
		checkFeedback(definedFeedbacks(context), FeedbackId.Crosspoint, { dst: 3, src: 7 }, 'on-3')
		await vi.waitFor(() => expect(instance.crosspoints.size).toBe(8), { timeout: 3000 })
		await sleep(50)
		expect(fake.interrogated()).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
		expect(instance.crosspoints.get(3)).toBe(7)
		expect(allVariableValues(context)).toMatchObject({ dst1: 1, dst3: 7, dst8: 1 })
		expect(context.checkFeedbacksById).toHaveBeenCalledExactlyOnceWith(['on-3'])
	})

	it('with interrogation off, asks only for what is in use, once a connection', async () => {
		const { instance, context } = await started({ interrogate: false })
		expect(context.subscribeActions).toHaveBeenCalled()
		expect(context.checkAllFeedbacks).toHaveBeenCalled()
		expect(fake.interrogated()).toEqual([])
		// As the feedback callbacks and action subscribe hooks do
		instance.requestCrosspoint(3)
		instance.requestCrosspoint(3)
		instance.requestCrosspoint(5)
		await vi.waitFor(() => expect(instance.crosspoints.size).toBe(2))
		instance.requestCrosspoint(3)
		await sleep(50)
		expect(fake.interrogated()).toEqual([3, 5])
	})

	it('asks again for every destination after reconnecting', async () => {
		const { instance } = await started({ interrogate: false })
		instance.requestCrosspoint(3)
		await vi.waitFor(() => expect(fake.interrogated()).toEqual([3]))
		fake.dropConnections()
		await vi.waitFor(() => expect(fake.connections).toBe(2), { timeout: 4000 })
		await vi.waitFor(async () => expect(instance.send(connect(1, 1))).resolves.toBeUndefined())
		instance.requestCrosspoint(3)
		await vi.waitFor(() => expect(fake.interrogated()).toEqual([3, 3]))
	})

	it('drops interrogates still queued when the connection closes, without leaving them pending', async () => {
		const { instance, log } = await started({ interrogate: false })
		fake.answering = false
		instance.requestCrosspoint(3) // sent, then holds the line waiting for a reply
		instance.requestCrosspoint(4) // queued behind it
		await vi.waitFor(() => expect(fake.interrogated()).toEqual([3]))
		fake.dropConnections()
		await vi.waitFor(() =>
			expect(log).toHaveBeenCalledWith('debug', expect.stringMatching(/Interrogate destination 4 not sent/)),
		)
		expect(fake.interrogated()).toEqual([3])
	})

	it('reports a missing host or an unusable port as bad config, without connecting', async () => {
		const { instance, context } = createInstance()
		await instance.init(config({ host: '  ' }))
		expect(context.updateStatus).toHaveBeenLastCalledWith(InstanceStatus.BadConfig, 'No host')
		await instance.configUpdated(config({ port: 0 }))
		expect(context.updateStatus).toHaveBeenLastCalledWith(InstanceStatus.BadConfig, 'Invalid port 0')
		await sleep(50)
		expect(fake.connections).toBe(0)
		await expect(instance.send(connect(1, 1))).rejects.toThrow('Not connected')
	})

	it('keeps the counts within what the commands can address', async () => {
		const { instance } = createInstance()
		await instance.init(config({ host: '', src: 5000, dst: 0 }))
		expect(instance.sourceCount).toBe(1024)
		expect(instance.destinationCount).toBe(1)
	})
})

describe('crosspoint changes', () => {
	it('update the variable, and the feedbacks on that destination, when the router reports one, and only when it changes', async () => {
		const { instance, context } = await started()
		const defs = definedFeedbacks(context)
		// Both destinations were interrogated on connecting, so neither feedback asks again
		checkFeedback(defs, FeedbackId.Crosspoint, { dst: 2, src: 5 }, 'on-2')
		checkFeedback(defs, FeedbackId.Crosspoint, { dst: 3, src: 5 }, 'on-3')
		context.setVariableValues.mockClear()
		context.checkFeedbacks.mockClear()
		context.checkFeedbacksById.mockClear()
		fake.broadcast(routerMessage(Command.Connected, 0x00, 1, 4)) // destination 2, source 5
		fake.broadcast(routerMessage(Command.Connected, 0x00, 3, 5)) // destination 4, source 6, which no feedback is on
		await vi.waitFor(() => expect(instance.crosspoints.get(4)).toBe(6))
		expect(context.setVariableValues.mock.calls).toEqual([[{ dst2: 5 }], [{ dst4: 6 }]])
		expect(context.checkFeedbacksById).toHaveBeenCalledExactlyOnceWith(['on-2'])
		fake.broadcast(routerMessage(Command.Tally, 0x00, 1, 4))
		await sleep(50)
		expect(context.setVariableValues).toHaveBeenCalledTimes(2)
		expect(context.checkFeedbacksById).toHaveBeenCalledTimes(1)
		expect(context.checkFeedbacks).not.toHaveBeenCalled()
	})

	it('ignore a destination beyond the configured count', async () => {
		const { instance, context } = await started()
		context.setVariableValues.mockClear()
		fake.broadcast(routerMessage(Command.Connected, 0x00, 99, 0)) // destination 100
		await sleep(50)
		expect(instance.crosspoints.has(100)).toBe(false)
		expect(context.setVariableValues).not.toHaveBeenCalled()
	})

	it('are recorded as connect actions while recording, within the source count', async () => {
		const { instance, context } = await started()
		instance.handleStartStopRecordActions(true)
		fake.broadcast(routerMessage(Command.Connected, 0x00, 1, 4)) // destination 2, source 5
		fake.broadcast(routerMessage(Command.Connected, 0x00, 2, 99)) // destination 3, source 100
		await vi.waitFor(() => expect(instance.crosspoints.get(3)).toBe(100))
		expect(context.recordAction).toHaveBeenCalledExactlyOnceWith(
			{ actionId: ActionId.Connect, options: { dst: 2, src: 5 } },
			'connect 2',
		)
		instance.handleStartStopRecordActions(false)
		fake.broadcast(routerMessage(Command.Connected, 0x00, 3, 1))
		await vi.waitFor(() => expect(instance.crosspoints.get(4)).toBe(2))
		expect(context.recordAction).toHaveBeenCalledTimes(1)
	})
})

describe('sending', () => {
	it('sends an action ahead of the interrogation in progress', async () => {
		const { instance } = createInstance()
		await instance.init(config({ dst: 64 }))
		await vi.waitFor(() => expect(fake.interrogated().length).toBeGreaterThan(2))
		await instance.send(connect(10, 3))
		await vi.waitFor(() => expect(fake.interrogated()).toHaveLength(64), { timeout: 5000 })
		const commands = fake.commands()
		expect(commands.indexOf(Command.Connect)).toBeLessThan(commands.lastIndexOf(Command.Interrogate) - 50)
	})

	it('sends an interrogate of a destination still waiting to be interrogated once, ahead of the rest', async () => {
		const { instance } = createInstance()
		await instance.init(config({ dst: 64 }))
		await vi.waitFor(() => expect(fake.interrogated().length).toBeGreaterThan(2))
		await instance.interrogate(60)
		await vi.waitFor(() => expect(fake.interrogated()).toHaveLength(64), { timeout: 5000 })
		await sleep(100)
		const interrogated = fake.interrogated()
		expect(interrogated.filter((d) => d === 60)).toHaveLength(1)
		expect(interrogated.indexOf(60)).toBeLessThan(10)
	})

	it('passes on the abort signal', async () => {
		const { instance } = await started()
		await expect(instance.send(connect(1, 2), AbortSignal.abort())).rejects.toThrow()
		await sleep(50)
		expect(fake.commands()).not.toContain(Command.Connect)
	})
})

describe('learnSource', () => {
	it('answers from what the router has reported, without asking again', async () => {
		const { instance } = await started()
		fake.received.length = 0
		await expect(instance.learnSource(1, new AbortController().signal)).resolves.toBe(1)
		expect(fake.received).toEqual([])
	})

	it('interrogates a destination not yet reported, and waits for the answer', async () => {
		fake.crosspoints.set(4, 9)
		const { instance } = await started({ interrogate: false })
		await expect(instance.learnSource(4, new AbortController().signal)).resolves.toBe(9)
		expect(fake.interrogated()).toEqual([4])
	})

	it('learns nothing for a source beyond the configured count, or a destination outside it', async () => {
		fake.crosspoints.set(4, 100)
		const { instance, log } = await started({ interrogate: false })
		await expect(instance.learnSource(4, new AbortController().signal)).resolves.toBeUndefined()
		expect(log).toHaveBeenCalledWith('warn', expect.stringMatching(/Source 100 on destination 4 is beyond/))
		await expect(instance.learnSource(9, new AbortController().signal)).resolves.toBeUndefined()
	})

	it('stops when the learn is cancelled', async () => {
		fake.answering = false
		const { instance } = await started({ interrogate: false })
		const controller = new AbortController()
		const learning = instance.learnSource(4, controller.signal)
		controller.abort()
		await expect(learning).rejects.toThrow()
	})
})

describe('config changes and teardown', () => {
	it('replace the connection, and rebuild the definitions for the new counts', async () => {
		const { instance, context } = await started()
		await instance.configUpdated(config({ dst: 4, interrogate: false }))
		await vi.waitFor(() => expect(fake.connections).toBe(2))
		await vi.waitFor(() => expect(fake.openConnections).toBe(1))
		expect(instance.crosspoints.size).toBe(0)
		expect(Object.keys(context.setVariableDefinitions.mock.calls.at(-1)?.[0] ?? {})).toEqual([
			'dst1',
			'dst2',
			'dst3',
			'dst4',
		])
	})

	// Reports recheck only the feedbacks on their own destination, and one beyond a lowered count is never reported again
	it('recheck every crosspoint feedback, so none keeps the state it had', async () => {
		const { instance, context } = await started()
		expect(checkFeedback(definedFeedbacks(context), FeedbackId.Crosspoint, { dst: 6, src: 1 }, 'on-6')).toBe(true)
		const rechecked: boolean[] = []
		// As Companion would, running the callback of every crosspoint feedback
		context.checkFeedbacks.mockImplementation(() => {
			rechecked.push(checkFeedback(definedFeedbacks(context), FeedbackId.Crosspoint, { dst: 6, src: 1 }, 'on-6'))
		})
		await instance.configUpdated(config({ dst: 4 }))
		await vi.waitFor(() => expect(fake.interrogated()).toHaveLength(8 + 4), { timeout: 3000 })
		await sleep(50)
		expect(rechecked).toEqual([false])
	})

	it('destroy closes the connection for good', async () => {
		const { instance, context } = await started()
		await instance.destroy()
		await vi.waitFor(() => expect(fake.openConnections).toBe(0))
		expect(context.updateStatus).toHaveBeenLastCalledWith(InstanceStatus.Disconnected, null)
		await expect(instance.send(connect(1, 1))).rejects.toThrow('Not connected')
	})
})
