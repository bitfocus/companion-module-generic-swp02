import { combineRgb, type CompanionFeedbackDefinitions } from '@companion-module/base'
import type SwP02Instance from './main.js'
import { destinationOption, isInRange, sourceOption } from './options.js'

/**
 * Feedback ids. The values are the ids saved against every button using the feedback, so they must never change — they
 * predate this enum and are camelCase for that reason.
 */
export enum FeedbackId {
	Crosspoint = 'checkCrosspoint',
}

export type FeedbackSchema = {
	[FeedbackId.Crosspoint]: { type: 'boolean'; options: { dst: number; src: number } }
}

export function UpdateFeedbacks(self: SwP02Instance): void {
	const feedbacks: CompanionFeedbackDefinitions<FeedbackSchema> = {
		[FeedbackId.Crosspoint]: {
			name: 'Crosspoint',
			description: 'True when the source is routed to the destination',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(255, 0, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [destinationOption(self.destinationCount), sourceOption(self.sourceCount)],
			callback: ({ options }) => {
				if (!isInRange(options.dst, self.destinationCount)) return false
				// API 2.x has no feedback subscribe hook. A feedback being checked is one in use, so it asks for its
				// destination here. That happens once a connection, however often the callback runs
				self.requestCrosspoint(options.dst)
				return self.crosspoints.get(options.dst) === options.src
			},
			learn: async ({ options }, context) => {
				const src = await self.learnSource(options.dst, context.signal)
				return src === undefined ? undefined : { src }
			},
		},
	}

	self.setFeedbackDefinitions(feedbacks)
}
