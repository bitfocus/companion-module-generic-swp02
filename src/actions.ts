import type { CompanionActionDefinitions } from '@companion-module/base'
import type SwP02Instance from './main.js'
import { connect, connectOnGo, go, type GoMode } from './api/index.js'
import { destinationOption, goModeOption, isGoMode, isInRange, sourceOption } from './options.js'

/**
 * Action ids. The values are the ids saved against every button using the action, so they must never change — they
 * predate this enum and are camelCase for that reason.
 */
export enum ActionId {
	Connect = 'connect',
	Interrogate = 'interrogate',
	ConnectOnGo = 'connectOnGo',
	Go = 'goSetClear',
}

type DestinationOptions = { dst: number }
type CrosspointOptions = DestinationOptions & { src: number }

export type ActionSchema = {
	[ActionId.Connect]: { options: CrosspointOptions }
	[ActionId.Interrogate]: { options: DestinationOptions }
	[ActionId.ConnectOnGo]: { options: CrosspointOptions }
	[ActionId.Go]: { options: { mode: GoMode } }
}

function checkDestination(self: SwP02Instance, dst: number, action: string): void {
	if (!isInRange(dst, self.destinationCount)) {
		throw new Error(`Destination ${dst} is not 1 to ${self.destinationCount}, ${action} not sent`)
	}
}

function checkSource(self: SwP02Instance, src: number, action: string): void {
	if (!isInRange(src, self.sourceCount)) {
		throw new Error(`Source ${src} is not 1 to ${self.sourceCount}, ${action} not sent`)
	}
}

export function UpdateActions(self: SwP02Instance): void {
	const dstOption = destinationOption(self.destinationCount)
	const srcOption = sourceOption(self.sourceCount)

	const actions: CompanionActionDefinitions<ActionSchema> = {
		[ActionId.Connect]: {
			name: 'Connect',
			description: 'Connect a crosspoint',
			options: [dstOption, srcOption],
			callback: async ({ options }, context) => {
				checkDestination(self, options.dst, 'Connect')
				checkSource(self, options.src, 'Connect')
				await self.send(connect(options.dst, options.src), context.signal)
			},
			// So that learn has the crosspoint to hand
			optionsToMonitorForSubscribe: ['dst'],
			subscribe: ({ options }) => {
				if (isInRange(options.dst, self.destinationCount)) self.requestCrosspoint(options.dst)
			},
			learn: async ({ options }, context) => {
				const src = await self.learnSource(options.dst, context.signal)
				return src === undefined ? undefined : { src }
			},
		},
		[ActionId.Interrogate]: {
			name: 'Interrogate',
			description: 'Interrogate a destination',
			options: [dstOption],
			callback: async ({ options }, context) => {
				checkDestination(self, options.dst, 'Interrogate')
				await self.interrogate(options.dst, context.signal)
			},
			optionsToMonitorForSubscribe: ['dst'],
			subscribe: ({ options }) => {
				if (isInRange(options.dst, self.destinationCount)) self.requestCrosspoint(options.dst)
			},
		},
		[ActionId.ConnectOnGo]: {
			name: 'Connect on Go',
			description: 'Prepare a crosspoint',
			options: [dstOption, srcOption],
			callback: async ({ options }, context) => {
				checkDestination(self, options.dst, 'Connect on Go')
				checkSource(self, options.src, 'Connect on Go')
				await self.send(connectOnGo(options.dst, options.src), context.signal)
			},
		},
		[ActionId.Go]: {
			name: 'Go',
			description: 'Set or clear prepared crosspoints',
			options: [goModeOption],
			callback: async ({ options }, context) => {
				if (!isGoMode(options.mode)) throw new Error(`Go mode ${String(options.mode)} is not Set or Clear, Go not sent`)
				await self.send(go(options.mode), context.signal)
			},
		},
	}

	self.setActionDefinitions(actions)
}
