import type { CompanionVariableDefinitions } from '@companion-module/base'
import type SwP02Instance from './main.js'

/** The value of a destination's variable until the router reports its source */
export const UNKNOWN_SOURCE = 'unknown'

export type DestinationVariableId = `dst${number}`

/** One variable for each destination, holding the source routed to it */
export type VariablesSchema = Record<DestinationVariableId, number | typeof UNKNOWN_SOURCE>

export function destinationVariableId(destination: number): DestinationVariableId {
	return `dst${destination}`
}

export function UpdateVariableDefinitions(self: SwP02Instance): void {
	const definitions: CompanionVariableDefinitions<VariablesSchema> = {}
	for (let destination = 1; destination <= self.destinationCount; destination++) {
		definitions[destinationVariableId(destination)] = { name: `Destination ${destination}` }
	}
	self.setVariableDefinitions(definitions)
}

export function UpdateVariableValues(self: SwP02Instance): void {
	const values: VariablesSchema = {}
	for (let destination = 1; destination <= self.destinationCount; destination++) {
		values[destinationVariableId(destination)] = self.crosspoints.get(destination) ?? UNKNOWN_SOURCE
	}
	self.setVariableValues(values)
}
