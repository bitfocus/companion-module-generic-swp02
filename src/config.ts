import { Regex, type SomeCompanionConfigField } from '@companion-module/base'
import { MAX_ADDRESS } from './api/index.js'

export const DEFAULT_PORT = 2000

export type ModuleConfig = {
	host: string
	port: number
	/** Interrogate every destination on connecting */
	interrogate: boolean
	/** Wait for a reply to each message before sending the next */
	waitOnAck: boolean
	/** Source count */
	src: number
	/** Destination count */
	dst: number
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'textinput',
			id: 'host',
			label: 'Hostname / IP',
			width: 12,
			regex: Regex.HOSTNAME,
		},
		{
			type: 'number',
			id: 'port',
			label: 'Port',
			width: 4,
			min: 1,
			max: 65535,
			default: DEFAULT_PORT,
			tooltip: `Default TCP:${DEFAULT_PORT}`,
		},
		{
			type: 'checkbox',
			id: 'interrogate',
			label: 'Interrogate on connect',
			width: 2,
			default: true,
			tooltip: 'Interrogate all destinations on connect',
		},
		{
			type: 'checkbox',
			id: 'waitOnAck',
			label: 'Wait for ACK',
			width: 2,
			default: true,
			tooltip: 'Wait for a reply from the router, for up to a second, before sending the next message',
		},
		{
			type: 'number',
			id: 'src',
			label: 'Source Count',
			width: 4,
			default: 128,
			min: 1,
			max: MAX_ADDRESS,
			range: true,
			step: 1,
		},
		{
			type: 'number',
			id: 'dst',
			label: 'Destination Count',
			width: 4,
			default: 128,
			min: 1,
			max: MAX_ADDRESS,
			range: true,
			step: 1,
		},
	]
}

/**
 * A count from the config, made a whole number from 1 to {@link MAX_ADDRESS}. A saved config isn't checked against its
 * field's min and max, and a count drives loops over every destination.
 */
export function clampCount(count: unknown): number {
	const value = Math.floor(Number(count))
	return Number.isNaN(value) ? 1 : Math.min(Math.max(value, 1), MAX_ADDRESS)
}

/** The port from the config, or undefined if it is not one TCP can use */
export function validPort(port: unknown): number | undefined {
	const value = Number(port)
	return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : undefined
}
