import { describe, expect, it } from 'vitest'
import { clampCount, DEFAULT_PORT, GetConfigFields, validPort, type ModuleConfig } from '../config.js'

describe('config fields', () => {
	it('keep the ids saved in existing configs, one for each config key', () => {
		const ids = GetConfigFields().map((field) => field.id)
		const keys: (keyof ModuleConfig)[] = ['host', 'port', 'interrogate', 'waitOnAck', 'src', 'dst']
		expect(ids).toEqual(keys)
	})

	it('make the port a number field defaulting to 2000', () => {
		expect(GetConfigFields().find((field) => field.id === 'port')).toMatchObject({
			type: 'number',
			default: DEFAULT_PORT,
			min: 1,
			max: 65535,
		})
		expect(DEFAULT_PORT).toBe(2000)
	})

	it('limit the counts to what the standard commands can address', () => {
		for (const id of ['src', 'dst']) {
			expect(GetConfigFields().find((field) => field.id === id)).toMatchObject({ type: 'number', min: 1, max: 1024 })
		}
	})
})

describe('clampCount', () => {
	it.each([
		[128, 128],
		[1024, 1024],
		[5000, 1024],
		[0, 1],
		[-3, 1],
		[3.7, 3],
		['64', 64],
		[Number.NaN, 1],
		[undefined, 1],
		['many', 1],
	])('%j becomes %i', (count, expected) => {
		expect(clampCount(count)).toBe(expected)
	})
})

describe('validPort', () => {
	it('accepts a whole number from 1 to 65535, as a number or text', () => {
		expect(validPort(2000)).toBe(2000)
		expect(validPort('8910')).toBe(8910)
		expect(validPort(65535)).toBe(65535)
	})

	it.each([0, 65536, 20.5, '', 'abc', undefined, null])('rejects %j', (port) => {
		expect(validPort(port)).toBeUndefined()
	})
})
