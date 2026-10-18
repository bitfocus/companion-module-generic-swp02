import { describe, expect, it } from 'vitest'
import type {
	CompanionMigrationAction,
	CompanionMigrationFeedback,
	CompanionStaticUpgradeProps,
	CompanionUpgradeContext,
} from '@companion-module/base'
import {
	UpgradeScripts,
	numericActionOptionsApi2,
	numericFeedbackOptionsApi2,
	upgradePortToNumber,
} from '../upgrades.js'
import { ActionId } from '../actions.js'
import { FeedbackId } from '../feedbacks.js'
import type { ModuleConfig } from '../config.js'
import { actionDefinitions, fakeInstance, feedbackDefinitions } from './fixtures.js'

/**
 * Upgrade scripts are order-sensitive: a stored upgrade index records how far a configuration has been migrated,
 * so scripts may only ever be appended. Pin the index rather than taking the last entry, so appending a script
 * can't silently retarget this suite.
 */
const API2_SCRIPT_INDEX = 0
const EXPECTED_SCRIPT_COUNT = 1

// Options reach upgrade scripts already wrapped as ExpressionOrValue — Companion does that before running them
const v = (value: unknown) => ({ isExpression: false, value })

function action(actionId: string, options: Record<string, unknown>): CompanionMigrationAction {
	return {
		id: `action-${actionId}`,
		controlId: 'bank-1',
		actionId,
		options: options as CompanionMigrationAction['options'],
	}
}

function feedback(feedbackId: string, options: Record<string, unknown>): CompanionMigrationFeedback {
	return {
		id: `feedback-${feedbackId}`,
		controlId: 'bank-1',
		feedbackId,
		options: options as CompanionMigrationFeedback['options'],
	}
}

const config = (port: unknown): ModuleConfig =>
	({ host: '10.0.0.1', port, interrogate: true, waitOnAck: true, src: 128, dst: 128 }) as ModuleConfig

function run(
	actions: CompanionMigrationAction[],
	feedbacks: CompanionMigrationFeedback[] = [],
	savedConfig: ModuleConfig | null = null,
) {
	return UpgradeScripts[API2_SCRIPT_INDEX]({} as CompanionUpgradeContext<ModuleConfig>, {
		config: savedConfig,
		secrets: null,
		actions,
		feedbacks,
	} satisfies CompanionStaticUpgradeProps<ModuleConfig, undefined>)
}

describe('API 2.x upgrade script', () => {
	it('sits at the index this suite targets', () => {
		// Appending a script is fine — bump EXPECTED_SCRIPT_COUNT. Never insert, reorder or remove one.
		expect(UpgradeScripts).toHaveLength(EXPECTED_SCRIPT_COUNT)
	})

	it('converts custom destination and source strings from the old dropdowns to numbers', () => {
		const existing = action(ActionId.Connect, { dst: v('3'), src: v('12') })
		const result = run([existing])

		expect(result.updatedActions).toEqual([existing])
		expect(existing.options.dst).toEqual({ isExpression: false, value: 3 })
		expect(existing.options.src).toEqual({ isExpression: false, value: 12 })
	})

	it('turns a variable into an expression', () => {
		const existing = action(ActionId.Interrogate, { dst: v('$(internal:custom_dst)') })
		run([existing])

		expect(existing.options.dst).toEqual({ isExpression: true, value: '$(internal:custom_dst)' })
	})

	it('wraps mixed text and variables in parseVariables', () => {
		const existing = action(ActionId.ConnectOnGo, { dst: v(1), src: v('1$(internal:x)') })
		run([existing])

		expect(existing.options.src).toEqual({ isExpression: true, value: 'parseVariables("1$(internal:x)")' })
	})

	it('does not report actions it had nothing to convert', () => {
		const choiceIds = action(ActionId.Connect, { dst: v(4), src: v(2) })
		const goAction = action(ActionId.Go, { mode: v(0) })
		const alreadyExpression = action(ActionId.Interrogate, { dst: { isExpression: true, value: '1 + 1' } })
		const missingOption = action(ActionId.Connect, {})
		const result = run([choiceIds, goAction, alreadyExpression, missingOption])

		expect(result.updatedActions).toEqual([])
		expect(alreadyExpression.options.dst).toEqual({ isExpression: true, value: '1 + 1' })
	})

	it('converts the crosspoint feedback', () => {
		const existing = feedback(FeedbackId.Crosspoint, { dst: v('$(internal:d)'), src: v('5') })
		const result = run([], [existing])

		expect(result.updatedFeedbacks).toEqual([existing])
		expect(existing.options).toEqual({
			dst: { isExpression: true, value: '$(internal:d)' },
			src: { isExpression: false, value: 5 },
		})
	})

	it('makes the port a number', () => {
		expect(run([], [], config('2000')).updatedConfig?.port).toBe(2000)
		expect(run([], [], config(' 4000 ')).updatedConfig?.port).toBe(4000)
		expect(run([], [], null).updatedConfig).toBeNull()
	})
})

describe('upgradePortToNumber', () => {
	it('leaves a port that is a number already', () => {
		expect(upgradePortToNumber(config(2000))).toBeNull()
	})

	it.each(['', 'abc', '0', '70000', '20.5'])('replaces %j, which is no port, with the default', (port) => {
		expect(upgradePortToNumber(config(port))?.port).toBe(2000)
	})

	it('keeps everything else in the config', () => {
		expect(upgradePortToNumber(config('2001'))).toEqual({ ...config(2001) })
	})
})

type DefinitionLike = { options: { id: string; type: string; choices?: { id: unknown }[] }[] } | false | undefined

describe('upgrade maps match the current definitions', () => {
	const actionDefs: Record<string, DefinitionLike> = actionDefinitions(fakeInstance())
	const feedbackDefs: Record<string, DefinitionLike> = feedbackDefinitions(fakeInstance())

	// The script stores numbers, so each converted option must still hold a number: a number field, or a dropdown
	// whose choice ids are numbers
	const numericOptionIds = (def: DefinitionLike) =>
		def
			? def.options
					.filter(
						(o) =>
							o.type === 'number' ||
							(o.type === 'dropdown' && o.choices !== undefined && o.choices.every((c) => typeof c.id === 'number')),
					)
					.map((o) => o.id)
			: []

	it('defines every action and feedback id in the enums', () => {
		expect(Object.keys(actionDefs).sort()).toEqual(Object.values(ActionId).sort())
		expect(Object.keys(feedbackDefs).sort()).toEqual(Object.values(FeedbackId).sort())
	})

	it('keeps the ids saved on buttons', () => {
		expect(Object.values(ActionId).sort()).toEqual(['connect', 'connectOnGo', 'goSetClear', 'interrogate'])
		expect(Object.values(FeedbackId)).toEqual(['checkCrosspoint'])
	})

	it.each(Object.entries(numericActionOptionsApi2))('action %s: converted options hold numbers', (id, keys) => {
		expect(numericOptionIds(actionDefs[id])).toEqual(expect.arrayContaining(keys))
	})

	it.each(Object.entries(numericFeedbackOptionsApi2))('feedback %s: converted options hold numbers', (id, keys) => {
		expect(numericOptionIds(feedbackDefs[id])).toEqual(expect.arrayContaining(keys))
	})
})
