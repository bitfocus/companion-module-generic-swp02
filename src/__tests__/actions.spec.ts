import { describe, expect, it } from 'vitest'
import { ActionId } from '../actions.js'
import { connect, connectOnGo, go, GoMode } from '../api/index.js'
import { actionDefinitions, fakeInstance, learnAction, runAction, subscribeAction } from './fixtures.js'

describe('action callbacks', () => {
	it('Connect sends the crosspoint, passing on the action signal', async () => {
		const fake = fakeInstance()
		const signal = new AbortController().signal
		await runAction(actionDefinitions(fake), ActionId.Connect, { dst: 5, src: 3 }, signal)
		expect(fake.send).toHaveBeenCalledExactlyOnceWith(connect(5, 3), signal)
	})

	it('Connect on Go prepares the crosspoint', async () => {
		const fake = fakeInstance()
		const signal = new AbortController().signal
		await runAction(actionDefinitions(fake), ActionId.ConnectOnGo, { dst: 8, src: 16 }, signal)
		expect(fake.send).toHaveBeenCalledExactlyOnceWith(connectOnGo(8, 16), signal)
	})

	it('Interrogate asks for the destination', async () => {
		const fake = fakeInstance()
		const signal = new AbortController().signal
		await runAction(actionDefinitions(fake), ActionId.Interrogate, { dst: 2 }, signal)
		expect(fake.interrogate).toHaveBeenCalledExactlyOnceWith(2, signal)
	})

	it('Go sets or clears', async () => {
		const fake = fakeInstance()
		const defs = actionDefinitions(fake)
		await runAction(defs, ActionId.Go, { mode: GoMode.Set })
		await runAction(defs, ActionId.Go, { mode: GoMode.Clear })
		expect(fake.send.mock.calls.map(([message]) => message)).toEqual([go(GoMode.Set), go(GoMode.Clear)])
	})

	// Value mode is not validated by Companion, and a saved value can outlast a reduced count
	it.each([
		[ActionId.Connect, { dst: 9, src: 1 }, /Destination 9 is not 1 to 8/],
		[ActionId.Connect, { dst: 1, src: 17 }, /Source 17 is not 1 to 16/],
		[ActionId.Connect, { dst: 0, src: 1 }, /Destination 0/],
		[ActionId.Connect, { dst: 1.5, src: 1 }, /Destination 1.5/],
		[ActionId.Connect, { dst: '3', src: 1 }, /Destination 3/],
		[ActionId.ConnectOnGo, { dst: 1, src: -1 }, /Source -1/],
		[ActionId.Interrogate, { dst: 100 }, /Destination 100/],
		[ActionId.Go, { mode: 2 }, /Go mode 2/],
	])('%s refuses %o and sends nothing', async (actionId, options, error) => {
		const fake = fakeInstance()
		await expect(runAction(actionDefinitions(fake), actionId, options)).rejects.toThrow(error)
		expect(fake.send).not.toHaveBeenCalled()
		expect(fake.interrogate).not.toHaveBeenCalled()
	})
})

describe('action learn and subscribe', () => {
	it('Connect learns only the source, from the router', async () => {
		const fake = fakeInstance()
		fake.learnSource.mockResolvedValue(7)
		const signal = new AbortController().signal
		await expect(learnAction(actionDefinitions(fake), ActionId.Connect, { dst: 4, src: 1 }, signal)).resolves.toEqual({
			src: 7,
		})
		expect(fake.learnSource).toHaveBeenCalledExactlyOnceWith(4, signal)
	})

	it('Connect learns nothing when the source is not known', async () => {
		const fake = fakeInstance()
		await expect(learnAction(actionDefinitions(fake), ActionId.Connect, { dst: 4, src: 1 })).resolves.toBeUndefined()
	})

	it.each([ActionId.Connect, ActionId.Interrogate])('%s asks for its destination when subscribed', async (actionId) => {
		const fake = fakeInstance()
		const defs = actionDefinitions(fake)
		await subscribeAction(defs, actionId, { dst: 3, src: 1 })
		await subscribeAction(defs, actionId, { dst: 99, src: 1 })
		expect(fake.requestCrosspoint).toHaveBeenCalledExactlyOnceWith(3)
	})
})

describe('action options', () => {
	it('take destinations and sources from the configured counts, as expressions only', () => {
		const defs = actionDefinitions(fakeInstance({ sources: 32, destinations: 12 }))
		const connectDef = defs[ActionId.Connect]
		if (!connectDef) throw new Error('Connect is not defined')
		const [dst, src] = connectDef.options
		expect(dst).toMatchObject({
			type: 'dropdown',
			id: 'dst',
			default: 1,
			expressionDescription: 'Should return a destination number, 1 to 12',
		})
		expect(src).toMatchObject({
			type: 'dropdown',
			id: 'src',
			default: 1,
			expressionDescription: 'Should return a source number, 1 to 32',
		})
		for (const option of [dst, src]) {
			expect(option).not.toHaveProperty('allowCustom')
			expect(option).not.toHaveProperty('allowInvalidValues')
			expect(option).not.toHaveProperty('disableAutoExpression')
		}
		expect(dst.type === 'dropdown' && dst.choices.map((c) => c.id)).toEqual([...Array(12).keys()].map((i) => i + 1))
		expect(src.type === 'dropdown' && src.choices.at(-1)).toEqual({ id: 32, label: 'Source 32' })
	})

	it('describe the Go modes as numbers for expressions', () => {
		const goDef = actionDefinitions(fakeInstance())[ActionId.Go]
		if (!goDef) throw new Error('Go is not defined')
		expect(goDef.options[0]).toMatchObject({
			default: GoMode.Set,
			expressionDescription: 'Should return 0 to set the prepared crosspoints, or 1 to clear them',
		})
	})
})
