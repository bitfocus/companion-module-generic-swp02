import { describe, expect, it } from 'vitest'
import {
	checksum,
	Command,
	DECODERS,
	decodeFrame,
	FrameReader,
	MAX_FRAME_LENGTH,
	SOM,
	type Response,
} from '../api/index.js'
import { routerMessage } from './fakeRouter.js'

/**
 * The messages here are built by hand to the encoding in the spec, as the module's own messages are. There is no capture
 * from a router to compare against.
 */

/** The bytes after SOM, as FrameReader hands them to decodeFrame */
const body = (message: Buffer) => message.subarray(1)

const tally = routerMessage(Command.Tally, 0x17, 71, 103) // destination 200, source 1000
const connected = routerMessage(Command.Connected, 0x00, 4, 2) // destination 5, source 3

describe('decodeFrame', () => {
	it('reads TALLY and CONNECTED as crosspoints', () => {
		expect(decodeFrame(body(tally))).toEqual({
			type: 'crosspoint',
			command: Command.Tally,
			destination: 200,
			source: 1000,
		})
		expect(decodeFrame(body(connected))).toEqual({
			type: 'crosspoint',
			command: Command.Connected,
			destination: 5,
			source: 3,
		})
	})

	it('rejects a bad checksum', () => {
		const bad = Buffer.from(body(tally))
		bad[bad.length - 1] ^= 0x01
		expect(decodeFrame(bad)).toMatchObject({ type: 'log', level: 'warn', message: /Invalid checksum/ })
	})

	it('rejects a message of the wrong length, even with a good checksum', () => {
		const short = body(routerMessage(Command.Tally, 0x00, 4))
		expect(decodeFrame(short)).toMatchObject({ type: 'log', level: 'warn', message: /Tally should be 5 bytes/ })
	})

	it('rejects a message too short to have a checksum', () => {
		expect(decodeFrame(Buffer.from([Command.Tally]))).toMatchObject({ type: 'log', level: 'warn' })
	})

	it('reads CONNECT ON GO ACK, which 1.2.4 always rejected as the wrong length', () => {
		// 1.2.4 compared its length against msgLength.interrconnectOnGoAckogate, which is undefined
		expect(decodeFrame(body(routerMessage(Command.ConnectOnGoAck, 0x17, 71, 103)))).toEqual({
			type: 'log',
			level: 'info',
			message: 'Connect on go acknowledged: destination 200, source 1000',
		})
	})

	it.each([
		[0x00, 'info', 'Go done: prepared crosspoints set'],
		[0x01, 'info', 'Go done: prepared crosspoints cleared'],
		[0x02, 'info', 'Go done: no crosspoints were prepared'],
		[0x05, 'warn', 'Go done with an unexpected result: 5'],
	])('reads GO DONE ACK %i', (result, level, message) => {
		expect(decodeFrame(body(routerMessage(Command.GoDoneAck, result)))).toEqual({ type: 'log', level, message })
	})

	it.each([
		[0x00, 0x00, 'info', 'Master is inactive, idle controller OK'],
		[0x03, 0x00, 'info', 'Slave is active, idle controller OK'],
		[0x02, 0x01, 'warn', 'Master is active, idle controller missing or faulty'],
		[0x01, 0x02, 'warn', 'Slave is inactive, idle controller status unknown'],
		[0x00, 0x09, 'warn', 'Master is inactive, unexpected idle controller status 9'],
	])('reads DUAL CONTROLLER STATUS %i %i', (byte1, byte2, level, message) => {
		expect(decodeFrame(body(routerMessage(Command.DualControllerStatusResponse, byte1, byte2)))).toEqual({
			type: 'log',
			level,
			message: `Dual controller status: ${message}`,
		})
	})

	it('reads the answer to the keepalive', () => {
		expect(decodeFrame(body(routerMessage(Command.DatabaseChecksum, 0x12, 0x34)))).toEqual({
			type: 'databaseChecksum',
			data: [0x12, 0x34],
		})
	})

	it('warns of a controller message sent back, and of extended crosspoints it cannot handle', () => {
		expect(decodeFrame(body(routerMessage(Command.Connect, 0, 0, 0)))).toMatchObject({
			level: 'warn',
			message: /unexpectedly sent Connect/,
		})
		expect(decodeFrame(body(routerMessage(Command.ExtendedTally, 0, 0, 0, 0, 0)))).toMatchObject({
			level: 'warn',
			message: /extended commands are not supported/,
		})
	})

	it('logs a known command it has no use for at debug, and an unknown one as a warning', () => {
		expect(decodeFrame(body(routerMessage(Command.SourceLockStatusResponse, 1, 2)))).toMatchObject({
			level: 'debug',
		})
		expect(decodeFrame(body(routerMessage(0x14, 1, 2)))).toMatchObject({
			level: 'warn',
			message: /Unexpected message/,
		})
		expect(decodeFrame(body(routerMessage(Command.ExtendedCommandSet, 0x02, 0x10)))).toMatchObject({ level: 'debug' })
		expect(decodeFrame(body(routerMessage(Command.ExtendedCommandSet, 0x55)))).toMatchObject({
			level: 'warn',
			message: /Unknown extended command/,
		})
	})
})

describe('DECODERS', () => {
	it('has an entry for every command in the spec, and nothing else', () => {
		const commands = Object.values(Command).filter((value) => typeof value === 'number')
		expect([...DECODERS.keys()].sort((a, b) => a - b)).toEqual(commands.sort((a, b) => a - b))
	})

	it('only expects lengths a message can have', () => {
		for (const [command, { length }] of DECODERS) {
			if (length !== undefined) expect(length, `command ${command}`).toBeGreaterThanOrEqual(2)
		}
	})
})

describe('corrupted messages', () => {
	const messages = [
		routerMessage(Command.Tally, 0x17, 71, 103), // destination 200, source 1000
		routerMessage(Command.Connected, 0x00, 4, 2), // destination 5, source 3
		routerMessage(Command.Tally, 0x70, 127, 0), // destination 1024, source 1
	]
	const originals = messages.map((message) => decodeFrame(body(message)))

	/** Everything a stream decodes to, flushing at the end as the quiet line would */
	function decodeStream(stream: Buffer): Response[] {
		const reader = new FrameReader()
		const responses = reader.push(stream).frames.map(decodeFrame)
		const last = reader.flushUnterminated()
		return last ? [...responses, decodeFrame(last)] : responses
	}

	it('drop the damaged message, and only that, for any single byte replaced by any other', () => {
		const stream = Buffer.concat(messages)
		const failures: string[] = []
		let position = 0
		messages.forEach((message, damaged) => {
			const expected = originals.filter((_, i) => i !== damaged)
			for (let offset = 0; offset < message.length; offset++, position++) {
				for (let value = 0; value < 256; value++) {
					if (value === stream[position]) continue
					const corrupted = Buffer.from(stream)
					corrupted[position] = value
					const crosspoints = decodeStream(corrupted).filter((r) => r.type === 'crosspoint')
					if (JSON.stringify(crosspoints) !== JSON.stringify(expected)) {
						failures.push(`byte ${position} 0x${stream[position].toString(16)} -> 0x${value.toString(16)}`)
					}
				}
			}
		})
		expect(failures.slice(0, 10), `${failures.length} corruptions let a wrong crosspoint through`).toEqual([])
	})

	it('reject a byte with bit 7 set, which the 7 bit checksum cannot see', () => {
		// Adding 128 to a byte leaves the sum the same modulo 128, so this passes the checksum
		const corrupted = Buffer.from(body(messages[1]))
		corrupted[2] += 0x80 // destination MOD 128: 4 becomes 132
		expect(checksum(corrupted.subarray(0, -1))).toBe(corrupted[corrupted.length - 1])
		expect(decodeFrame(corrupted)).toMatchObject({ type: 'log', level: 'warn', message: /not 7 bit/ })
	})
})

function readAll(reader: FrameReader, ...chunks: Uint8Array[]): Response[] {
	return chunks.flatMap((chunk) => reader.push(chunk).frames.map(decodeFrame))
}

describe('FrameReader', () => {
	it('reads a message delivered whole', () => {
		expect(readAll(new FrameReader(), tally)).toMatchObject([{ destination: 200, source: 1000 }])
	})

	it('reads a message delivered a byte at a time, completing on its last byte', () => {
		const reader = new FrameReader()
		const results = [...tally].map((byte) => reader.push(Buffer.from([byte])).frames.length)
		expect(results).toEqual([0, 0, 0, 0, 0, 1])
	})

	it('reads several messages from one chunk', () => {
		const chunk = Buffer.concat([tally, connected, tally])
		expect(readAll(new FrameReader(), chunk)).toMatchObject([
			{ destination: 200 },
			{ destination: 5 },
			{ destination: 200 },
		])
	})

	it('reads messages split across chunks at any point', () => {
		const stream = Buffer.concat([connected, tally, connected])
		for (let cut = 1; cut < stream.length; cut++) {
			const responses = readAll(new FrameReader(), stream.subarray(0, cut), stream.subarray(cut))
			expect(responses.map((r) => r.type)).toEqual(['crosspoint', 'crosspoint', 'crosspoint'])
		}
	})

	it('throws away stray bytes before a SOM, and counts them', () => {
		const reader = new FrameReader()
		const { frames, discarded } = reader.push(Buffer.concat([Buffer.from([0x01, 0x02, 0x03]), tally]))
		expect(discarded).toBe(3)
		expect(frames.map(decodeFrame)).toMatchObject([{ destination: 200 }])
	})

	it('hands over a message cut short by the next SOM, then carries on from that SOM', () => {
		const truncated = tally.subarray(0, 3)
		const responses = readAll(new FrameReader(), Buffer.concat([truncated, connected]))
		expect(responses).toMatchObject([
			{ type: 'log', level: 'warn' },
			{ type: 'crosspoint', destination: 5 },
		])
	})

	it('ends a message of unknown length at the next SOM', () => {
		const checksumReply = routerMessage(Command.DatabaseChecksum, 0x12, 0x34)
		const reader = new FrameReader()
		expect(reader.push(checksumReply).frames).toEqual([])
		expect(reader.hasUnterminated).toBe(true)
		expect(readAll(reader, connected)).toMatchObject([
			{ type: 'databaseChecksum', data: [0x12, 0x34] },
			{ type: 'crosspoint', destination: 5 },
		])
	})

	it('hands over a message of unknown length on flush, when no SOM follows', () => {
		const reader = new FrameReader()
		reader.push(routerMessage(Command.DatabaseChecksum, 0x12, 0x34))
		const frame = reader.flushUnterminated()
		expect(frame && decodeFrame(frame)).toEqual({ type: 'databaseChecksum', data: [0x12, 0x34] })
		expect(reader.hasUnterminated).toBe(false)
		expect(reader.flushUnterminated()).toBeUndefined()
	})

	it('never flushes a message of known length, which waits for the rest of its bytes', () => {
		const reader = new FrameReader()
		reader.push(tally.subarray(0, 4))
		expect(reader.hasUnterminated).toBe(false)
		expect(reader.flushUnterminated()).toBeUndefined()
		expect(readAll(reader, tally.subarray(4))).toMatchObject([{ destination: 200 }])
	})

	it('skips a doubled SOM', () => {
		const responses = readAll(new FrameReader(), Buffer.concat([Buffer.from([SOM]), tally]))
		expect(responses).toMatchObject([{ destination: 200 }])
	})

	it('drops a message that never ends rather than buffering without limit', () => {
		const reader = new FrameReader()
		const endless = Buffer.alloc(MAX_FRAME_LENGTH + 10, 0x01)
		endless[0] = SOM
		endless[1] = Command.DatabaseChecksum
		const { discarded } = reader.push(endless)
		expect(discarded).toBe(endless.length)
		expect(readAll(reader, tally)).toMatchObject([{ destination: 200 }])
	})

	it('forgets a partial message on reset', () => {
		const reader = new FrameReader()
		reader.push(tally.subarray(0, 3))
		reader.reset()
		expect(readAll(reader, tally.subarray(3), connected)).toMatchObject([{ destination: 5 }])
	})

	it('builds the test messages with a valid checksum', () => {
		expect(checksum(tally.subarray(1))).toBe(0)
	})
})
