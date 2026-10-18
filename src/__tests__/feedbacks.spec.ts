import { describe, expect, it } from 'vitest'
import { FeedbackId } from '../feedbacks.js'
import { checkFeedback, fakeInstance, feedbackDefinitions, learnFeedback } from './fixtures.js'

describe('Crosspoint feedback', () => {
	it('is true only for the source on the destination', () => {
		const fake = fakeInstance()
		fake.self.crosspoints.set(2, 5)
		const defs = feedbackDefinitions(fake)
		expect(checkFeedback(defs, FeedbackId.Crosspoint, { dst: 2, src: 5 })).toBe(true)
		expect(checkFeedback(defs, FeedbackId.Crosspoint, { dst: 2, src: 6 })).toBe(false)
		expect(checkFeedback(defs, FeedbackId.Crosspoint, { dst: 3, src: 5 })).toBe(false)
	})

	it('asks for its destination whenever it is checked, which the instance does once a connection', () => {
		const fake = fakeInstance()
		const defs = feedbackDefinitions(fake)
		checkFeedback(defs, FeedbackId.Crosspoint, { dst: 4, src: 1 })
		expect(fake.requestCrosspoint).toHaveBeenCalledExactlyOnceWith(4)
	})

	it.each([{ dst: 9 }, { dst: 0 }, { dst: 2.5 }, { dst: '2' }])(
		'is false for destination %o, without asking the router',
		(options) => {
			const fake = fakeInstance()
			fake.self.crosspoints.set(2, 1)
			expect(checkFeedback(feedbackDefinitions(fake), FeedbackId.Crosspoint, { ...options, src: 1 })).toBe(false)
			expect(fake.requestCrosspoint).not.toHaveBeenCalled()
		},
	)

	it('learns only the source', async () => {
		const fake = fakeInstance()
		fake.learnSource.mockResolvedValue(3)
		const signal = new AbortController().signal
		await expect(
			learnFeedback(feedbackDefinitions(fake), FeedbackId.Crosspoint, { dst: 6, src: 1 }, signal),
		).resolves.toEqual({ src: 3 })
		expect(fake.learnSource).toHaveBeenCalledExactlyOnceWith(6, signal)
	})

	it('describes the ranges for expressions', () => {
		const def = feedbackDefinitions(fakeInstance({ sources: 64, destinations: 32 }))[FeedbackId.Crosspoint]
		if (!def) throw new Error('Crosspoint is not defined')
		expect(def.options.map((o) => o.expressionDescription)).toEqual([
			'Should return a destination number, 1 to 32',
			'Should return a source number, 1 to 64',
		])
	})
})
