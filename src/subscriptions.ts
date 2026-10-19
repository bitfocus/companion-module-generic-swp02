/**
 * The feedback instances in use, by the number each reads its state from: a crosspoint feedback by its destination, an
 * alarm feedback by its alarm. When the router reports a change to one, only the feedbacks reading it are rechecked.
 *
 * A feedback registers from its callback, with the number its options name. Companion runs the callback again when the
 * options change, without calling unsubscribe, so registering also moves the feedback off the number it had before.
 */
export class FeedbackSubscriptions {
	/** The feedback instance ids reading each number */
	readonly #byKey = new Map<number, Set<string>>()
	/** The number each feedback instance reads */
	readonly #keyOf = new Map<string, number>()

	/**
	 * Registers a feedback instance against a number, moving it off any other
	 * @param id the feedback instance's `id`, not the `feedbackId` of its definition
	 */
	subscribe(id: string, key: number): void {
		if (this.#keyOf.get(id) === key) return
		this.unsubscribe(id)
		this.#keyOf.set(id, key)
		let ids = this.#byKey.get(key)
		if (ids === undefined) {
			ids = new Set()
			this.#byKey.set(key, ids)
		}
		ids.add(id)
	}

	/** For a feedback instance that has been removed or disabled */
	unsubscribe(id: string): void {
		const key = this.#keyOf.get(id)
		if (key === undefined) return
		this.#keyOf.delete(id)
		const ids = this.#byKey.get(key)
		ids?.delete(id)
		if (ids?.size === 0) this.#byKey.delete(key)
	}

	/** The ids of the feedback instances reading a number */
	feedbacksFor(key: number): string[] {
		return [...(this.#byKey.get(key) ?? [])]
	}
}
