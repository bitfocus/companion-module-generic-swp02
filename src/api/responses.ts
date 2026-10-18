import type { LogLevel } from '@companion-module/base'
import { Command, ExtendedCommand, GoDoneResult, IdleControllerStatus, SOM } from './consts.js'
import { checksum, fromWire, hex, type Crosspoint } from './messages.js'

/** A TALLY or CONNECTED message: the router reporting the source on a destination */
export interface CrosspointResponse extends Crosspoint {
	type: 'crosspoint'
	command: Command.Tally | Command.Connected
}

/** The answer to the keepalive */
export interface DatabaseChecksumResponse {
	type: 'databaseChecksum'
	data: number[]
}

/** A message the module only reports in the log */
export interface LogResponse {
	type: 'log'
	level: LogLevel
	message: string
}

export type Response = CrosspointResponse | DatabaseChecksumResponse | LogResponse

interface ResponseDecoder {
	/**
	 * Bytes after SOM: the command, its data and the checksum. Left out where it varies or is not known, and the message
	 * is then taken to end at the next SOM.
	 */
	length?: number
	/** Gets the data bytes, between the command and the checksum, of a message whose checksum and length are good */
	decode: (data: Uint8Array, command: number) => Response
}

const COMMANDS = Object.values(Command).filter((value): value is Command => typeof value === 'number')

/** The command's name from the spec, for logs, or its number if it is not one */
export function commandName(command: number): string {
	return command in Command ? Command[command] : `0x${command.toString(16).padStart(2, '0')}`
}

function log(level: LogLevel, message: string): LogResponse {
	return { type: 'log', level, message }
}

function crosspoint(command: Command.Tally | Command.Connected): ResponseDecoder {
	return { length: 5, decode: (data) => ({ type: 'crosspoint', command, ...fromWire(data[0], data[1], data[2]) }) }
}

/** A message a router could send but this module has no use for */
const unhandled: ResponseDecoder = {
	decode: (data, command) => log('debug', `${commandName(command)} not handled: ${hex(data)}`),
}

/** A message a controller sends to a router, so not one a router should send back */
function unexpected(length: number): ResponseDecoder {
	return {
		length,
		decode: (data, command) => log('warn', `Router unexpectedly sent ${commandName(command)}: ${hex(data)}`),
	}
}

/** A message for routers over 1024 x 1024, which need the extended commands this module does not send */
function unsupported(length: number): ResponseDecoder {
	return {
		length,
		decode: (data, command) =>
			log('warn', `Router sent ${commandName(command)}, but extended commands are not supported: ${hex(data)}`),
	}
}

/** A message worth reporting as it arrived */
function info(length: number): ResponseDecoder {
	return { length, decode: (data, command) => log('info', `${commandName(command)}: ${hex(data)}`) }
}

const GO_DONE_RESULTS = new Map<number, string>([
	[GoDoneResult.Set, 'prepared crosspoints set'],
	[GoDoneResult.Clear, 'prepared crosspoints cleared'],
	[GoDoneResult.None, 'no crosspoints were prepared'],
])

function goDone(result: number): LogResponse {
	const text = GO_DONE_RESULTS.get(result)
	return text ? log('info', `Go done: ${text}`) : log('warn', `Go done with an unexpected result: ${result}`)
}

const IDLE_CONTROLLER_STATUSES = new Map<number, { level: LogLevel; text: string }>([
	[IdleControllerStatus.Ok, { level: 'info', text: 'idle controller OK' }],
	[IdleControllerStatus.Faulty, { level: 'warn', text: 'idle controller missing or faulty' }],
	[IdleControllerStatus.Unknown, { level: 'warn', text: 'idle controller status unknown' }],
])

function dualControllerStatus(data: Uint8Array): LogResponse {
	const controller = data[0] & 0x01 ? 'Slave' : 'Master'
	const active = data[0] & 0x02 ? 'active' : 'inactive'
	const idle = IDLE_CONTROLLER_STATUSES.get(data[1]) ?? {
		level: 'warn',
		text: `unexpected idle controller status ${data[1]}`,
	}
	return log(idle.level, `Dual controller status: ${controller} is ${active}, ${idle.text}`)
}

/**
 * How each command is read, keyed by command byte. Every command in the spec has an entry, so one missing from it is
 * not SW-P-02 at all. Lengths are those the 1.x module checked against.
 */
export const DECODERS: ReadonlyMap<number, ResponseDecoder> = new Map<number, ResponseDecoder>([
	...COMMANDS.map((command): [number, ResponseDecoder] => [command, unhandled]),

	// What the module acts on
	[Command.Tally, crosspoint(Command.Tally)],
	[Command.Connected, crosspoint(Command.Connected)],
	[Command.DatabaseChecksum, { decode: (data) => ({ type: 'databaseChecksum', data: [...data] }) }],

	// Acknowledgements, and status the module asks for on connecting
	[
		Command.ConnectOnGoAck,
		{
			length: 5,
			decode: (data) => {
				const { destination, source } = fromWire(data[0], data[1], data[2])
				return log('info', `Connect on go acknowledged: destination ${destination}, source ${source}`)
			},
		},
	],
	[Command.GoDoneAck, { length: 3, decode: (data) => goDone(data[0]) }],
	[Command.DualControllerStatusResponse, { length: 4, decode: dualControllerStatus }],
	[Command.StatusResponse1, info(4)],
	[Command.StatusResponse2, info(3)],
	[Command.StatusResponse3, info(5)],
	[Command.RouterConfigurationResponse1, info(10)],
	[Command.RouterConfigurationResponse2, info(16)],
	[Command.ExtendedConnectOnGoAck, info(6)],
	[Command.CannotExecute, { decode: (data) => log('warn', `Router could not execute a command: ${hex(data)}`) }],
	[
		Command.ExtendedCommandSet,
		{
			decode: (data, command) =>
				data[0] in ExtendedCommand
					? unhandled.decode(data, command)
					: log('warn', `Unknown extended command: ${hex(data)}`),
		},
	],

	// Sent by a controller, not a router
	[Command.Interrogate, unexpected(4)],
	[Command.Connect, unexpected(5)],
	[Command.ConnectOnGo, unexpected(5)],
	[Command.Go, unexpected(3)],
	[Command.StatusRequest, unexpected(3)],
	[Command.DualControllerStatusRequest, unexpected(2)],
	[Command.RouterConfigurationRequest, unexpected(2)],
	[Command.ExtendedInterrogate, unexpected(4)],
	[Command.ExtendedConnect, unexpected(6)],
	[Command.ExtendedConnectOnGo, unexpected(6)],

	// Routers over 1024 x 1024
	[Command.ExtendedTally, unsupported(7)],
	[Command.ExtendedConnected, unsupported(7)],
])

/**
 * Checks and decodes one message
 * @param frame the bytes after SOM: the command, its data and the checksum
 */
export function decodeFrame(frame: Uint8Array): Response {
	if (frame.length < 2) return log('warn', `Message too short to read: ${hex(frame)}`)
	// Every byte after SOM is 7 bit. The checksum is modulo 128, so it can't see a corrupted bit 7: that byte would pass
	// it, and a destination or source would come out 128 too high
	if (frame.some((byte) => byte > 0x7f)) return log('warn', `Message has a byte that is not 7 bit: ${hex(frame)}`)
	const expected = checksum(frame.subarray(0, -1))
	const received = frame[frame.length - 1]
	if (expected !== received) {
		return log('warn', `Invalid checksum, expected ${expected} received ${received}: ${hex(frame)}`)
	}
	const command = frame[0]
	const decoder = DECODERS.get(command)
	if (decoder === undefined) return log('warn', `Unexpected message from router: ${hex(frame)}`)
	if (decoder.length !== undefined && frame.length !== decoder.length) {
		return log(
			'warn',
			`${commandName(command)} should be ${decoder.length} bytes, received ${frame.length}: ${hex(frame)}`,
		)
	}
	return decoder.decode(frame.subarray(1, -1), command)
}

/**
 * Bounds the buffer when no SOM arrives to end a message. Nothing this module reads is anywhere near as long.
 */
export const MAX_FRAME_LENGTH = 256

/**
 * Splits the byte stream from the router into messages. TCP delivers it in arbitrary chunks, so a message can arrive
 * in pieces, or several in one chunk.
 *
 * A message is complete once it has its command's length, or, where that is not known, once the next SOM arrives or the
 * caller calls {@link flushUnterminated} after the line has gone quiet. A SOM before a message reaches its length means
 * it was cut short: it is returned as it is, for {@link decodeFrame} to reject, and reading carries on from that SOM.
 */
export class FrameReader {
	#buffer: Buffer = Buffer.alloc(0)

	/**
	 * True while the buffer holds the start of a message of unknown length. Without a SOM after it, only a quiet line
	 * shows it has ended: a router sends a message whole, so it doesn't stall partway through one.
	 */
	get hasUnterminated(): boolean {
		return this.#buffer.length > 1 && DECODERS.get(this.#buffer[1])?.length === undefined
	}

	/** Takes the message of unknown length waiting for a SOM to end it, if there is one */
	flushUnterminated(): Buffer | undefined {
		if (!this.hasUnterminated) return undefined
		const frame = this.#buffer.subarray(1)
		this.#buffer = Buffer.alloc(0)
		return frame
	}

	/**
	 * Adds a chunk from the socket
	 * @returns the messages completed by it, each the bytes after SOM, and the count of stray bytes thrown away
	 */
	push(chunk: Uint8Array): { frames: Buffer[]; discarded: number } {
		let buffer = this.#buffer.length > 0 ? Buffer.concat([this.#buffer, chunk]) : Buffer.from(chunk)
		const frames: Buffer[] = []
		let discarded = 0

		for (;;) {
			const start = buffer.indexOf(SOM)
			if (start === -1) {
				discarded += buffer.length
				buffer = Buffer.alloc(0)
				break
			}
			if (start > 0) {
				discarded += start
				buffer = buffer.subarray(start)
			}

			const next = buffer.indexOf(SOM, 1)
			const length = buffer.length > 1 ? DECODERS.get(buffer[1])?.length : undefined
			if (length !== undefined && buffer.length > length && (next === -1 || next > length)) {
				frames.push(buffer.subarray(1, length + 1))
				buffer = buffer.subarray(length + 1)
				continue
			}
			if (next !== -1) {
				if (next > 1) frames.push(buffer.subarray(1, next))
				else discarded += 1 // two SOMs in a row
				buffer = buffer.subarray(next)
				continue
			}
			if (buffer.length > MAX_FRAME_LENGTH) {
				discarded += buffer.length
				buffer = Buffer.alloc(0)
			}
			break
		}

		// A copy, so the remainder doesn't hold on to the whole of the chunk it came from
		this.#buffer = Buffer.from(buffer)
		return { frames, discarded }
	}

	/** Drops a partial message, so one from a closed connection can't be joined to the start of the next */
	reset(): void {
		this.#buffer = Buffer.alloc(0)
	}
}
