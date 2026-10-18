import { createServer, type Server, type Socket } from 'node:net'
import { checksum, Command, SOM } from '../api/index.js'

/** A message as a router would send it: SOM, command, data and checksum */
export function routerMessage(command: number, ...data: number[]): Buffer {
	const body = [command, ...data]
	return Buffer.from([SOM, ...body, checksum(body)])
}

/** The wire form of a crosspoint, written out here rather than taken from the module under test */
function crosspointBytes(destination: number, source: number): number[] {
	const dst = destination - 1
	const src = source - 1
	return [((dst >> 7) << 4) | (src >> 7), dst & 0x7f, src & 0x7f]
}

function readCrosspoint(bytes: number[]): { destination: number; source: number } {
	return {
		destination: ((bytes[2] >> 4) << 7) + bytes[3] + 1,
		source: ((bytes[2] & 0x07) << 7) + bytes[4] + 1,
	}
}

/** Lengths after SOM of the messages a controller sends. Kept apart from the module's own tables on purpose */
const CONTROLLER_MESSAGE_LENGTHS = new Map<number, number>([
	[Command.DatabaseChecksum, 3],
	[Command.Interrogate, 4],
	[Command.Connect, 5],
	[Command.ConnectOnGo, 5],
	[Command.Go, 3],
	[Command.DualControllerStatusRequest, 2],
	[Command.RouterConfigurationRequest, 2],
])

function isCommand(byte: number): byte is Command {
	return byte in Command
}

export interface ReceivedMessage {
	/** performance.now() on arrival */
	at: number
	/** Which connection it came on, counting from 1 */
	connection: number
	command: Command
	/** The whole message, SOM included */
	bytes: number[]
}

/**
 * A SW-P-02 router on a loopback TCP port, for the module to connect to. It answers as the spec describes: TALLY to an
 * interrogate, CONNECTED on every connection to a connect, and so on.
 */
export class FakeRouter {
	readonly received: ReceivedMessage[] = []
	/** performance.now() of each reply sent */
	readonly replies: number[] = []
	readonly crosspoints = new Map<number, number>()
	port = 0
	/** Connections accepted so far */
	connections = 0
	/** Delay before each reply */
	replyDelay = 0
	/** Off, the socket stays open but nothing is answered, as when the router dies or a cable is pulled mid-path */
	answering = true
	/** Whether the keepalive (DATABASE CHECKSUM request) is answered */
	answersKeepalive = true
	readonly #server: Server
	readonly #sockets = new Set<Socket>()
	readonly #buffers = new Map<Socket, number[]>()
	readonly #timers = new Set<NodeJS.Timeout>()
	#prepared: { destination: number; source: number }[] = []

	constructor() {
		this.#server = createServer((socket) => {
			this.connections++
			const connection = this.connections
			this.#sockets.add(socket)
			this.#buffers.set(socket, [])
			socket.on('data', (chunk: Buffer) => this.#onData(socket, connection, chunk))
			socket.on('close', () => {
				this.#sockets.delete(socket)
				this.#buffers.delete(socket)
			})
			socket.on('error', () => {})
		})
	}

	async listen(): Promise<void> {
		await new Promise<void>((resolve) => this.#server.listen(0, '127.0.0.1', resolve))
		const address = this.#server.address()
		if (!address || typeof address === 'string') throw new Error('fake router did not get a port')
		this.port = address.port
	}

	async close(): Promise<void> {
		for (const timer of this.#timers) clearTimeout(timer)
		this.dropConnections()
		await new Promise<void>((resolve) => this.#server.close(() => resolve()))
	}

	get openConnections(): number {
		return this.#sockets.size
	}

	/** Closes every connection from the router's end */
	dropConnections(): void {
		for (const socket of this.#sockets) socket.destroy()
	}

	/** Writes to every connection, as a router sends CONNECTED on all its ports */
	broadcast(bytes: Uint8Array): void {
		for (const socket of this.#sockets) socket.write(bytes)
	}

	/** The command byte of every message received, optionally only those on one connection */
	commands(connection?: number): Command[] {
		return this.received.filter((m) => connection === undefined || m.connection === connection).map((m) => m.command)
	}

	/** The destinations interrogated, in order */
	interrogated(): number[] {
		return this.received
			.filter((m) => m.command === Command.Interrogate)
			.map((m) => ((m.bytes[2] >> 4) << 7) + m.bytes[3] + 1)
	}

	/** The crosspoints asked for by CONNECT, in order */
	routed(): { destination: number; source: number }[] {
		return this.received.filter((m) => m.command === Command.Connect).map((m) => readCrosspoint(m.bytes))
	}

	#onData(socket: Socket, connection: number, chunk: Buffer): void {
		const buffer = this.#buffers.get(socket)
		if (!buffer) return
		buffer.push(...chunk)
		for (;;) {
			const start = buffer.indexOf(SOM)
			if (start === -1) {
				buffer.length = 0
				return
			}
			buffer.splice(0, start)
			if (buffer.length < 2) return
			const command = buffer[1]
			const length = CONTROLLER_MESSAGE_LENGTHS.get(command)
			if (length === undefined || !isCommand(command)) {
				buffer.splice(0, 1)
				continue
			}
			if (buffer.length < length + 1) return
			const bytes = buffer.splice(0, length + 1)
			this.received.push({ at: performance.now(), connection, command, bytes })
			this.#answer(socket, command, bytes)
		}
	}

	#answer(socket: Socket, command: Command, bytes: number[]): void {
		if (!this.answering) return
		const reply = (message: Buffer, everyone = false) => {
			const send = () => {
				this.replies.push(performance.now())
				if (everyone) this.broadcast(message)
				else if (!socket.destroyed) socket.write(message)
			}
			if (this.replyDelay === 0) {
				send()
				return
			}
			const timer = setTimeout(() => {
				this.#timers.delete(timer)
				send()
			}, this.replyDelay)
			this.#timers.add(timer)
		}

		switch (command) {
			case Command.Interrogate: {
				// Only the destination: an interrogate has no source byte, so bytes[4] is its checksum
				const { destination } = readCrosspoint(bytes)
				const source = this.crosspoints.get(destination) ?? 1
				reply(routerMessage(Command.Tally, ...crosspointBytes(destination, source)))
				break
			}
			case Command.Connect: {
				const { destination, source } = readCrosspoint(bytes)
				this.crosspoints.set(destination, source)
				reply(routerMessage(Command.Connected, ...crosspointBytes(destination, source)), true)
				break
			}
			case Command.ConnectOnGo: {
				const crosspoint = readCrosspoint(bytes)
				this.#prepared.push(crosspoint)
				reply(routerMessage(Command.ConnectOnGoAck, ...crosspointBytes(crosspoint.destination, crosspoint.source)))
				break
			}
			case Command.Go: {
				const prepared = this.#prepared
				this.#prepared = []
				if (bytes[2] === 0x00) {
					for (const { destination, source } of prepared) {
						this.crosspoints.set(destination, source)
						reply(routerMessage(Command.Connected, ...crosspointBytes(destination, source)), true)
					}
				}
				reply(routerMessage(Command.GoDoneAck, prepared.length === 0 ? 0x02 : bytes[2]))
				break
			}
			case Command.DatabaseChecksum:
				if (this.answersKeepalive) reply(routerMessage(Command.DatabaseChecksum, 0x12, 0x34))
				break
			case Command.DualControllerStatusRequest:
				reply(routerMessage(Command.DualControllerStatusResponse, 0x00, 0x00))
				break
			case Command.RouterConfigurationRequest:
				// The content is made up: the module only logs it. The length is what it checks
				reply(routerMessage(Command.RouterConfigurationResponse1, 0x01, 0x00, 0x7f, 0x00, 0x7f, 0x00, 0x00, 0x00))
				break
		}
	}
}

/** A port nothing is listening on */
export async function closedPort(): Promise<number> {
	const router = new FakeRouter()
	await router.listen()
	const { port } = router
	await router.close()
	return port
}
