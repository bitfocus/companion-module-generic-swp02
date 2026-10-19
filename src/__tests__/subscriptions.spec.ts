import { describe, expect, it } from 'vitest'
import { FeedbackSubscriptions } from '../subscriptions.js'

describe('FeedbackSubscriptions', () => {
	it('gives the feedbacks reading a number, each once, and none for a number nothing reads', () => {
		const subscriptions = new FeedbackSubscriptions()
		subscriptions.subscribe('a', 3)
		subscriptions.subscribe('b', 3)
		subscriptions.subscribe('a', 3)
		subscriptions.subscribe('c', 4)
		expect(subscriptions.feedbacksFor(3)).toEqual(['a', 'b'])
		expect(subscriptions.feedbacksFor(4)).toEqual(['c'])
		expect(subscriptions.feedbacksFor(5)).toEqual([])
	})

	// Companion runs the callback again with the new options, and calls no unsubscribe
	it('moves a feedback that subscribes to another number off the one it had', () => {
		const subscriptions = new FeedbackSubscriptions()
		subscriptions.subscribe('a', 3)
		subscriptions.subscribe('b', 3)
		subscriptions.subscribe('a', 4)
		expect(subscriptions.feedbacksFor(3)).toEqual(['b'])
		expect(subscriptions.feedbacksFor(4)).toEqual(['a'])
	})

	it('forgets a feedback once unsubscribed, and ignores one it does not know', () => {
		const subscriptions = new FeedbackSubscriptions()
		subscriptions.subscribe('a', 3)
		subscriptions.unsubscribe('a')
		subscriptions.unsubscribe('b')
		expect(subscriptions.feedbacksFor(3)).toEqual([])
		subscriptions.subscribe('a', 3)
		expect(subscriptions.feedbacksFor(3)).toEqual(['a'])
	})
})
