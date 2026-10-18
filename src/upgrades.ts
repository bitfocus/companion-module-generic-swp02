import {
	FixupNumericOrVariablesValueToExpressions,
	type CompanionMigrationAction,
	type CompanionMigrationFeedback,
	type CompanionStaticUpgradeProps,
	type CompanionStaticUpgradeResult,
	type CompanionStaticUpgradeScript,
	type CompanionUpgradeContext,
} from '@companion-module/base'
import { DEFAULT_PORT, validPort, type ModuleConfig } from './config.js'
import { ActionId } from './actions.js'
import { FeedbackId } from './feedbacks.js'

/**
 * Options that were dropdowns allowing custom values before the API 2.x migration, so could hold a number typed as a
 * string, or a variable, beside the numeric choice ids. They hold a number since. Frozen history for UpgradeScripts[0]:
 * do not edit to track later changes, add a new script instead.
 */
export const numericActionOptionsApi2: Partial<Record<ActionId, string[]>> = {
	[ActionId.Connect]: ['dst', 'src'],
	[ActionId.Interrogate]: ['dst'],
	[ActionId.ConnectOnGo]: ['dst', 'src'],
}

/** As {@link numericActionOptionsApi2}, for feedbacks */
export const numericFeedbackOptionsApi2: Partial<Record<FeedbackId, string[]>> = {
	[FeedbackId.Crosspoint]: ['dst', 'src'],
}

/**
 * Converts the listed options in place. Returns whether anything changed — the helper always hands back a fresh
 * object, so compare contents rather than identity, or every untouched action would be reported as updated.
 */
function fixupNumericOptions(item: CompanionMigrationAction | CompanionMigrationFeedback, keys?: string[]): boolean {
	if (!keys) return false
	let changed = false
	for (const key of keys) {
		const current = item.options[key]
		const fixed = FixupNumericOrVariablesValueToExpressions(current)
		if (fixed?.isExpression !== current?.isExpression || fixed?.value !== current?.value) {
			item.options[key] = fixed
			changed = true
		}
	}
	return changed
}

/**
 * The port was a textinput before API 2.x, so a saved config holds a string, or the number default if never edited.
 * One that is not a usable port becomes the default.
 * @returns the config with the port a number, or null if it was one already
 */
export function upgradePortToNumber(config: ModuleConfig | null): ModuleConfig | null {
	if (config === null) return null
	const port: unknown = config.port
	if (typeof port === 'number') return null
	return { ...config, port: validPort(port) ?? DEFAULT_PORT }
}

export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig>[] = [
	/*
	 * Place your upgrade scripts here
	 * Remember that once it has been added it cannot be removed!
	 */

	// 0: API 2.x — destination and source options became numbers, and the port a number field.
	// "3" becomes 3, "$(local:dst)" becomes an expression, anything else is wrapped in parseVariables().
	function (
		_context: CompanionUpgradeContext<ModuleConfig>,
		props: CompanionStaticUpgradeProps<ModuleConfig, undefined>,
	): CompanionStaticUpgradeResult<ModuleConfig, undefined> {
		return {
			updatedConfig: upgradePortToNumber(props.config),
			updatedActions: props.actions.filter((action) =>
				fixupNumericOptions(action, numericActionOptionsApi2[action.actionId as ActionId]),
			),
			updatedFeedbacks: props.feedbacks.filter((feedback) =>
				fixupNumericOptions(feedback, numericFeedbackOptionsApi2[feedback.feedbackId as FeedbackId]),
			),
		}
	},
]
