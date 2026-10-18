import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import { InstanceStatus, type LogLevel } from '@companion-module/base'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	Command,
	interrogate,
	Priority,
	RouterConnection,
	type CrosspointResponse,
	type RouterTiming,
} from '../api/index.js'
import { closedPort, FakeRouter, routerMessage } from './fakeRouter.js'

let fake: FakeRouter
const routers: RouterConnection[] = []

beforeEach(async () => {
	fake = new FakeRouter()
	await fake.listen()
})

afterEach(async () => {
	for (const router of routers.splice(0)) router.destroy()
	await fake.close()
})

function createRouter(options: { waitForAck?: boolean; timing?: Partial<RouterTiming>; port?: number } = {}) {
	const log = vi.fn<(level: LogLevel, message: string) => void>()
	const router = new RouterConnection({
		host: '127.0.0.1',
		port: options.port ?? fake.port,
		waitForAck: options.waitForAck ?? true,
		log,
		timing: options.timing,
	})
	const statuses: [InstanceStatus, string | null][] = []
	router.on('status', (status, message) => statuses.push([status, message]))
	routers.push(router)
	// The fake answers all three queries made on connecting, less the keepalive if told not to
	const answered = fake.answersKeepalive ? 3 : 2
	return { router, log, statuses, answered }
}

/** Connects, and waits for the queries sent on connecting to go and be answered, so tests start from a quiet line */
async function connected(options: Parameters<typeof createRouter>[0] = {}) {
	const created = createRouter(options)
	const opened = once(created.router, 'connected')
	created.router.connect()
	await opened
	await vi.waitFor(() => expect(fake.replies).toHaveLength(created.answered))
	await sleep(60)
	fake.received.length = 0
	fake.replies.length = 0
	created.log.mockClear()
	return created
}

const logged = (log: ReturnType<typeof createRouter>['log'], level: LogLevel, pattern: RegExp) =>
	log.mock.calls.filter(([l, message]) => l === level && pattern.test(message))

describe('connecting', () => {
	it('sends the queries a general switcher makes on connecting, in order', async () => {
		const { router, statuses } = createRouter()
		const opened = once(router, 'connected')
		router.connect()
		await opened
		await vi.waitFor(() => expect(fake.received).toHaveLength(3))
		expect(fake.commands()).toEqual([
			Command.DatabaseChecksum,
			Command.DualControllerStatusRequest,
			Command.RouterConfigurationRequest,
		])
		expect(statuses).toEqual([
			[InstanceStatus.Connecting, `Connecting to 127.0.0.1:${fake.port}`],
			[InstanceStatus.Ok, 'Connected'],
		])
		expect(router.isConnected).toBe(true)
	})

	it('rejects a send while not connected', async () => {
		const { router } = createRouter()
		await expect(router.send(interrogate(1))).rejects.toThrow('Not connected to router')
	})

	it('logs a refused connection once, then at debug while it retries', async () => {
		const { router, log, statuses } = createRouter({ port: await closedPort(), timing: { reconnectInterval: 30 } })
		router.connect()
		await vi.waitFor(() => expect(logged(log, 'debug', /Network error/).length).toBeGreaterThanOrEqual(2))
		expect(logged(log, 'error', /Network error/)).toHaveLength(1)
		expect(statuses.at(-1)?.[0]).toBe(InstanceStatus.ConnectionFailure)
	})
})

describe('pacing', () => {
	it('leaves at least the message gap between messages', async () => {
		const { router } = await connected({ waitForAck: false })
		fake.answering = false
		await Promise.all([1, 2, 3, 4, 5].map(async (d) => router.send(interrogate(d))))
		await vi.waitFor(() => expect(fake.received).toHaveLength(5))
		const gaps = fake.received.slice(1).map((m, i) => m.at - fake.received[i].at)
		// 20 ms, less a little for timer and loopback jitter at the receiving end
		for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(15)
	})

	it('waits for the reply to each message before sending the next', async () => {
		const { router } = await connected()
		fake.replyDelay = 80
		await Promise.all([1, 2, 3].map(async (d) => router.send(interrogate(d))))
		await vi.waitFor(() => expect(fake.received).toHaveLength(3))
		await vi.waitFor(() => expect(fake.replies).toHaveLength(3))
		// Each message arrives only after the reply to the one before was sent
		for (let i = 1; i < 3; i++) expect(fake.received[i].at).toBeGreaterThanOrEqual(fake.replies[i - 1])
	})

	it('sends on after the ack timeout when the router never replies', async () => {
		const { router, log } = await connected({ timing: { ackTimeout: 150 } })
		fake.answering = false
		await Promise.all([router.send(interrogate(1)), router.send(interrogate(2))])
		await vi.waitFor(() => expect(fake.received).toHaveLength(2))
		const gap = fake.received[1].at - fake.received[0].at
		expect(gap).toBeGreaterThanOrEqual(140)
		expect(gap).toBeLessThan(1000)
		expect(logged(log, 'debug', /No reply within 150 ms/)).toHaveLength(1)
	})

	it('does not wait for replies with wait for ACK off', async () => {
		const { router } = await connected({ waitForAck: false, timing: { ackTimeout: 500 } })
		fake.answering = false
		await Promise.all([router.send(interrogate(1)), router.send(interrogate(2))])
		await vi.waitFor(() => expect(fake.received).toHaveLength(2))
		expect(fake.received[1].at - fake.received[0].at).toBeLessThan(200)
	})

	it('sends an action ahead of background messages already queued', async () => {
		const { router } = await connected({ waitForAck: false })
		fake.answering = false
		const background = [1, 2, 3, 4, 5].map(async (d) => router.send(interrogate(d), Priority.Background))
		const action = router.send(interrogate(100), Priority.Action)
		await Promise.all([...background, action])
		await vi.waitFor(() => expect(fake.received).toHaveLength(6))
		// The first background message was already on its way when the action was queued
		expect(fake.interrogated()).toEqual([1, 100, 2, 3, 4, 5])
	})
})

describe('aborting', () => {
	it('drops a queued message whose signal aborts, and rejects its promise', async () => {
		const { router } = await connected({ timing: { ackTimeout: 200 } })
		fake.answering = false
		const first = router.send(interrogate(1))
		const controller = new AbortController()
		const dropped = router.send(interrogate(2), Priority.Action, controller.signal)
		const after = router.send(interrogate(3))
		controller.abort()
		await expect(dropped).rejects.toThrow()
		await Promise.all([first, after])
		await vi.waitFor(() => expect(fake.received).toHaveLength(2))
		expect(fake.interrogated()).toEqual([1, 3])
	})

	it('keeps the line held when the message waiting on it is aborted', async () => {
		// p-queue frees a job's slot as soon as its signal aborts, even mid-run. Were the wait for a reply inside the job
		// that sent the message, aborting the next one would let the one after it out early
		const { router } = await connected({ timing: { ackTimeout: 300 } })
		fake.answering = false
		await router.send(interrogate(1))
		const controller = new AbortController()
		const waiting = router.send(interrogate(2), Priority.Action, controller.signal)
		const next = router.send(interrogate(3))
		await sleep(50)
		controller.abort()
		await expect(waiting).rejects.toThrow()
		await next
		await vi.waitFor(() => expect(fake.received).toHaveLength(2))
		expect(fake.interrogated()).toEqual([1, 3])
		expect(fake.received[1].at - fake.received[0].at).toBeGreaterThanOrEqual(280)
	})

	it('never sends a message whose signal was aborted already', async () => {
		const { router } = await connected()
		await expect(router.send(interrogate(1), Priority.Action, AbortSignal.abort())).rejects.toThrow()
		await sleep(50)
		expect(fake.received).toHaveLength(0)
	})
})

describe('losing the connection', () => {
	it('rejects everything queued when the router closes the connection, rather than leaving it hanging', async () => {
		const { router, statuses } = await connected({ timing: { ackTimeout: 5000, reconnectInterval: 5000 } })
		fake.answering = false
		const sends = [1, 2, 3].map(async (d) => router.send(interrogate(d)))
		const closed = once(router, 'disconnected')
		await vi.waitFor(() => expect(fake.received).toHaveLength(1))
		fake.dropConnections()
		await closed
		const results = await Promise.allSettled(sends)
		expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'rejected'])
		expect(router.isConnected).toBe(false)
		expect(statuses.at(-1)).toEqual([InstanceStatus.Disconnected, 'Connection closed by router'])
	})

	it('reconnects by itself, and keeps a single keepalive running', async () => {
		const { router } = await connected({ timing: { keepaliveInterval: 100, reconnectInterval: 50 } })
		const reopened = once(router, 'connected')
		fake.dropConnections()
		await reopened
		// The client can see its connection open before the server has counted it
		await vi.waitFor(() => expect(fake.connections).toBe(2))
		await sleep(530)
		// The query on connecting and about five keepalives. A second timer left over from the first connection would
		// double that, and the first connection gets nothing more once closed
		const keepalives = fake.commands(2).filter((c) => c === Command.DatabaseChecksum).length
		expect(keepalives).toBeGreaterThanOrEqual(4)
		expect(keepalives).toBeLessThanOrEqual(8)
		expect(fake.received.filter((m) => m.connection === 1 && m.at > performance.now() - 500)).toEqual([])
	})

	it('reconnects when a router that has answered the keepalive goes silent', async () => {
		const { router, log } = await connected({ timing: { keepaliveInterval: 100, reconnectInterval: 50 } })
		const disconnected = vi.fn()
		router.on('disconnected', disconnected)
		fake.answering = false
		await vi.waitFor(() => expect(fake.connections).toBe(2), { timeout: 2000 })
		expect(disconnected).toHaveBeenCalled()
		expect(logged(log, 'warn', /Nothing received from router/)).toHaveLength(1)
	})

	it('does not reconnect a quiet router that never answers the keepalive', async () => {
		fake.answersKeepalive = false
		await connected({ timing: { keepaliveInterval: 100, ackTimeout: 50 } })
		await sleep(600)
		expect(fake.connections).toBe(1)
		expect(fake.commands().filter((c) => c === Command.DatabaseChecksum).length).toBeGreaterThanOrEqual(4)
	})

	it('stops for good when destroyed', async () => {
		const { router } = await connected({ timing: { ackTimeout: 5000, reconnectInterval: 30 } })
		fake.answering = false
		const sends = [1, 2].map(async (d) => router.send(interrogate(d)))
		await vi.waitFor(() => expect(fake.received).toHaveLength(1))
		router.destroy()
		const results = await Promise.allSettled(sends)
		expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected'])
		await vi.waitFor(() => expect(fake.openConnections).toBe(0))
		await sleep(150)
		expect(fake.connections).toBe(1)
		expect(() => router.connect()).toThrow()
	})
})

describe('receiving', () => {
	it('reports TALLY and CONNECTED, however the bytes are split', async () => {
		const { router } = await connected()
		const crosspoints: CrosspointResponse[] = []
		router.on('crosspoint', (response) => crosspoints.push(response))
		const stream = Buffer.concat([
			routerMessage(Command.Connected, 0x17, 71, 103),
			routerMessage(Command.Tally, 0x00, 4, 2),
		])
		for (const byte of stream) {
			fake.broadcast(Buffer.from([byte]))
			await sleep(2)
		}
		await vi.waitFor(() => expect(crosspoints).toHaveLength(2))
		expect(crosspoints).toEqual([
			{ type: 'crosspoint', command: Command.Connected, destination: 200, source: 1000 },
			{ type: 'crosspoint', command: Command.Tally, destination: 5, source: 3 },
		])
	})

	it('reads a message of unknown length once the line goes quiet, without waiting for another', async () => {
		const { log } = await connected()
		fake.broadcast(routerMessage(Command.CannotExecute, 0x02))
		await vi.waitFor(() => expect(logged(log, 'warn', /could not execute a command: 02/)).toHaveLength(1), {
			timeout: 500,
		})
	})

	it('survives a listener that throws', async () => {
		const { router, log } = await connected()
		const crosspoints: number[] = []
		router.on('crosspoint', ({ destination }) => {
			if (destination === 1) throw new Error('listener failed')
			crosspoints.push(destination)
		})
		fake.broadcast(Buffer.concat([routerMessage(Command.Tally, 0, 0, 0), routerMessage(Command.Tally, 0, 1, 0)]))
		await vi.waitFor(() => expect(crosspoints).toEqual([2]))
		expect(logged(log, 'error', /listener failed/)).toHaveLength(1)
		expect(router.isConnected).toBe(true)
	})

	it('logs what the router reports', async () => {
		const { log } = await connected()
		fake.broadcast(routerMessage(Command.GoDoneAck, 0x00))
		await vi.waitFor(() => expect(logged(log, 'info', /Go done: prepared crosspoints set/)).toHaveLength(1))
	})
})

describe('waitForCrosspoint', () => {
	it('resolves with the source the router reports for the destination', async () => {
		const { router } = await connected()
		fake.crosspoints.set(5, 3)
		const reply = router.waitForCrosspoint(5, 1000)
		await router.send(interrogate(5))
		await expect(reply).resolves.toBe(3)
	})

	it('ignores other destinations, and resolves undefined on timeout', async () => {
		const { router } = await connected()
		const reply = router.waitForCrosspoint(5, 100)
		await router.send(interrogate(6))
		await expect(reply).resolves.toBeUndefined()
	})

	it('rejects when its signal aborts', async () => {
		const { router } = await connected()
		const controller = new AbortController()
		const reply = router.waitForCrosspoint(5, 5000, controller.signal)
		controller.abort()
		await expect(reply).rejects.toThrow()
		await expect(router.waitForCrosspoint(5, 5000, AbortSignal.abort())).rejects.toThrow()
	})
})
