import { vi } from 'vitest'
import type {
	CompanionActionCallbackContext,
	CompanionActionContext,
	CompanionActionDefinitions,
	CompanionActionEvent,
	CompanionActionInfo,
	CompanionFeedbackBooleanEvent,
	CompanionFeedbackCallbackContext,
	CompanionFeedbackContext,
	CompanionFeedbackDefinitions,
	CompanionFeedbackInfo,
	CompanionLearnCallbackContext,
	CompanionOptionValues,
} from '@companion-module/base'
import type SwP02Instance from '../main.js'
import { UpdateActions, type ActionId, type ActionSchema } from '../actions.js'
import { UpdateFeedbacks, type FeedbackId, type FeedbackSchema } from '../feedbacks.js'
import { FeedbackSubscriptions } from '../subscriptions.js'

function createMocks() {
	return {
		send: vi.fn<SwP02Instance['send']>(async () => {}),
		interrogate: vi.fn<SwP02Instance['interrogate']>(async () => {}),
		requestCrosspoint: vi.fn<SwP02Instance['requestCrosspoint']>(),
		learnSource: vi.fn<SwP02Instance['learnSource']>(async () => undefined),
		setActionDefinitions: vi.fn<(defs: CompanionActionDefinitions<ActionSchema>) => void>(),
		setFeedbackDefinitions: vi.fn<(defs: CompanionFeedbackDefinitions<FeedbackSchema>) => void>(),
	}
}

export type FakeInstance = { self: SwP02Instance } & ReturnType<typeof createMocks>

/**
 * A plain object standing in for the instance, for the definitions to be built from. The crosspoint state and the
 * feedback subscriptions are real; everything that would reach Companion or the router is a mock.
 */
export function fakeInstance({ sources = 16, destinations = 8 } = {}): FakeInstance {
	const mocks = createMocks()
	const self = {
		sourceCount: sources,
		destinationCount: destinations,
		crosspoints: new Map<number, number>(),
		crosspointFeedbacks: new FeedbackSubscriptions(),
		...mocks,
	} as unknown as SwP02Instance
	return { self, ...mocks }
}

export function actionDefinitions(fake: FakeInstance): CompanionActionDefinitions<ActionSchema> {
	UpdateActions(fake.self)
	return fake.setActionDefinitions.mock.calls[0][0]
}

export function feedbackDefinitions(fake: FakeInstance): CompanionFeedbackDefinitions<FeedbackSchema> {
	UpdateFeedbacks(fake.self)
	return fake.setFeedbackDefinitions.mock.calls[0][0]
}

// The definitions' hooks are typed per action. These take any options, as the values Companion passes are not checked
type AnyCallback = (event: CompanionActionEvent, context: CompanionActionCallbackContext) => Promise<void> | void
type AnyActionHook = (info: CompanionActionInfo, context: CompanionActionContext) => Promise<void> | void
type AnyLearn = (info: CompanionActionInfo | CompanionFeedbackInfo, context: CompanionLearnCallbackContext) => unknown
type AnyFeedbackCallback = (event: CompanionFeedbackBooleanEvent, context: CompanionFeedbackCallbackContext) => boolean
type AnyFeedbackHook = (info: CompanionFeedbackInfo, context: CompanionFeedbackContext) => Promise<void> | void

function actionEvent(actionId: ActionId, options: CompanionOptionValues): CompanionActionEvent {
	return { id: `action-${actionId}`, controlId: 'bank-1', actionId, surfaceId: undefined, options }
}

/**
 * @param id the feedback instance's id. Each feedback placed on a button has its own, which stays the same when its
 * options are changed
 */
function feedbackEvent(
	feedbackId: FeedbackId,
	options: CompanionOptionValues,
	id = `feedback-${feedbackId}`,
): CompanionFeedbackBooleanEvent {
	return {
		type: 'boolean',
		id,
		controlId: 'bank-1',
		feedbackId,
		options,
		previousOptions: null,
	}
}

/** Runs an action's callback as Companion would, with the option values already resolved */
export async function runAction(
	defs: CompanionActionDefinitions<ActionSchema>,
	actionId: ActionId,
	options: CompanionOptionValues,
	signal = new AbortController().signal,
): Promise<void> {
	const def = defs[actionId]
	if (!def) throw new Error(`${actionId} is not defined`)
	await (def.callback as AnyCallback)(actionEvent(actionId, options), { type: 'action', signal } as never)
}

export async function subscribeAction(
	defs: CompanionActionDefinitions<ActionSchema>,
	actionId: ActionId,
	options: CompanionOptionValues,
): Promise<void> {
	const subscribe = (defs[actionId] || undefined)?.subscribe as AnyActionHook | undefined
	if (!subscribe) throw new Error(`${actionId} has no subscribe`)
	await subscribe(actionEvent(actionId, options), { type: 'action' } as never)
}

export async function learnAction(
	defs: CompanionActionDefinitions<ActionSchema>,
	actionId: ActionId,
	options: CompanionOptionValues,
	signal = new AbortController().signal,
): Promise<unknown> {
	const learn = (defs[actionId] || undefined)?.learn as AnyLearn | undefined
	if (!learn) throw new Error(`${actionId} has no learn`)
	return await learn(actionEvent(actionId, options), { type: 'action', signal })
}

export function checkFeedback(
	defs: CompanionFeedbackDefinitions<FeedbackSchema>,
	feedbackId: FeedbackId,
	options: CompanionOptionValues,
	id?: string,
): boolean {
	const def = defs[feedbackId]
	if (!def) throw new Error(`${feedbackId} is not defined`)
	return (def.callback as AnyFeedbackCallback)(feedbackEvent(feedbackId, options, id), {
		type: 'feedback',
		signal: new AbortController().signal,
	})
}

/** As Companion does when a feedback is removed or disabled */
export async function unsubscribeFeedback(
	defs: CompanionFeedbackDefinitions<FeedbackSchema>,
	feedbackId: FeedbackId,
	options: CompanionOptionValues,
	id?: string,
): Promise<void> {
	const unsubscribe = (defs[feedbackId] || undefined)?.unsubscribe as AnyFeedbackHook | undefined
	if (!unsubscribe) throw new Error(`${feedbackId} has no unsubscribe`)
	await unsubscribe(feedbackEvent(feedbackId, options, id), { type: 'feedback' })
}

export async function learnFeedback(
	defs: CompanionFeedbackDefinitions<FeedbackSchema>,
	feedbackId: FeedbackId,
	options: CompanionOptionValues,
	signal = new AbortController().signal,
): Promise<unknown> {
	const learn = (defs[feedbackId] || undefined)?.learn as AnyLearn | undefined
	if (!learn) throw new Error(`${feedbackId} has no learn`)
	return await learn(feedbackEvent(feedbackId, options), { type: 'feedback', signal })
}
