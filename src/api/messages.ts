import { Command, DATABASE_CHECKSUM_REQUEST, GoMode, MAX_ADDRESS, SOM } from './consts.js'

/** A source or destination number as it goes on the wire: zero based, split into DIV 128 and MOD 128 */
export interface WireAddress {
	div: number
	mod: number
}

/**
 * The 7 bit two's complement of the sum of the command and data bytes, so that everything after SOM, the checksum
 * included, sums to a multiple of 128.
 */
export function checksum(bytes: Iterable<number>): number {
	let sum = 0
	for (const byte of bytes) sum += byte
	return (128 - (sum % 128)) % 128
}

/** True for a whole number from 1 to {@link MAX_ADDRESS}, the range the standard commands can address */
export function isAddress(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_ADDRESS
}

/**
 * Splits a source or destination number, counted from 1 as users see it, into its wire form
 * @throws RangeError for anything {@link isAddress} rejects. A message with a bad address is never sent.
 */
export function toWireAddress(address: number): WireAddress {
	if (!isAddress(address)) throw new RangeError(`${address} is not a source or destination from 1 to ${MAX_ADDRESS}`)
	const zeroBased = address - 1
	return { div: zeroBased >> 7, mod: zeroBased & 0x7f }
}

/**
 * Joins a multiplier byte and the two MOD 128 bytes that follow it back into the numbers users see. Destination DIV 128
 * is bits 4-6 and source DIV 128 bits 0-2. Bits 3 and 7 are not part of either, so are masked off.
 */
export function fromWire(multiplier: number, destinationMod: number, sourceMod: number): Crosspoint {
	return {
		destination: (((multiplier >> 4) & 0x07) << 7) + destinationMod + 1,
		source: ((multiplier & 0x07) << 7) + sourceMod + 1,
	}
}

export interface Crosspoint {
	destination: number
	source: number
}

function message(command: Command, ...data: number[]): Buffer {
	const body = [command, ...data]
	return Buffer.from([SOM, ...body, checksum(body)])
}

function crosspointMessage(command: Command, destination: number, source: number): Buffer {
	const dst = toWireAddress(destination)
	const src = toWireAddress(source)
	return message(command, (dst.div << 4) | src.div, dst.mod, src.mod)
}

/** INTERROGATE (3.2.3): asks for the source routed to a destination. The router answers with TALLY */
export function interrogate(destination: number): Buffer {
	const dst = toWireAddress(destination)
	return message(Command.Interrogate, dst.div << 4, dst.mod)
}

/** CONNECT (3.2.4): routes a source to a destination. The router answers with CONNECTED, on all its ports */
export function connect(destination: number, source: number): Buffer {
	return crosspointMessage(Command.Connect, destination, source)
}

/** CONNECT ON GO (3.2.7): prepares a crosspoint, to be made by the next {@link go} */
export function connectOnGo(destination: number, source: number): Buffer {
	return crosspointMessage(Command.ConnectOnGo, destination, source)
}

/** GO (3.2.8): makes or clears every crosspoint prepared by {@link connectOnGo} */
export function go(mode: GoMode): Buffer {
	return message(Command.Go, mode)
}

/** DATABASE CHECKSUM request. Also serves as the keepalive */
export function databaseChecksumRequest(): Buffer {
	return message(Command.DatabaseChecksum, DATABASE_CHECKSUM_REQUEST)
}

export function dualControllerStatusRequest(): Buffer {
	return message(Command.DualControllerStatusRequest)
}

export function routerConfigurationRequest(): Buffer {
	return message(Command.RouterConfigurationRequest)
}

/** Bytes as space separated hex, for logs */
export function hex(bytes: Uint8Array | readonly number[]): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ')
}
