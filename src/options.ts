import type { CompanionInputFieldDropdown, DropdownChoice } from '@companion-module/base'
import { GoMode } from './api/index.js'

/**
 * Before API 2.x these were dropdowns allowing custom values, which is how variables got in. Expression mode replaces
 * that, and UpgradeScripts[0] converts the custom values saved.
 *
 * In expression mode Companion skips the action or feedback when the result is not one of the choices, so the
 * description gives the range. Value mode is not checked, so the callbacks check again: a value saved against a larger
 * count than the config now has would otherwise reach the router.
 */
function addressOption<TKey extends string>(
	id: TKey,
	label: 'Source' | 'Destination',
	count: number,
): CompanionInputFieldDropdown<TKey, number> {
	const choices: DropdownChoice<number>[] = Array.from({ length: count }, (_, i) => ({
		id: i + 1,
		label: `${label} ${i + 1}`,
	}))
	return {
		id,
		type: 'dropdown',
		label,
		choices,
		default: choices[0].id,
		expressionDescription: `Should return a ${label.toLowerCase()} number, 1 to ${count}`,
	}
}

/** @param count the configured destination count */
export function destinationOption(count: number): CompanionInputFieldDropdown<'dst', number> {
	return addressOption('dst', 'Destination', count)
}

/** @param count the configured source count */
export function sourceOption(count: number): CompanionInputFieldDropdown<'src', number> {
	return addressOption('src', 'Source', count)
}

export const GO_MODE_CHOICES = [
	{ id: GoMode.Set, label: 'Set' },
	{ id: GoMode.Clear, label: 'Clear' },
] as const satisfies DropdownChoice<GoMode>[]

export const goModeOption: CompanionInputFieldDropdown<'mode', GoMode> = {
	id: 'mode',
	type: 'dropdown',
	label: 'Mode',
	choices: GO_MODE_CHOICES,
	default: GO_MODE_CHOICES[0].id,
	expressionDescription: `Should return ${GoMode.Set} to set the prepared crosspoints, or ${GoMode.Clear} to clear them`,
}

export function isGoMode(value: unknown): value is GoMode {
	return GO_MODE_CHOICES.some((choice) => choice.id === value)
}

/** True for a whole number from 1 to the count */
export function isInRange(value: unknown, count: number): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= count
}
