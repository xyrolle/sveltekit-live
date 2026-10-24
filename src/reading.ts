import { type Heard, TOLD_AT_MOST, type Told, toldOf } from "./hint.ts";

/** The least time between two reads, so a burst of hints costs two at most. */
const WINDOW_MS = 500;

/** How long a read may go unanswered before it counts as failed and the next may go. */
const ANSWER_WITHIN_MS = 15_000;

/** When a screen reads again what it was told (`readingOf`). */
export type Reading = {
	/** Something of `kind` changed: the record `id`, or the kind whole. */
	tell(kind: string, id?: string): void;
	/** The socket is back: what a failed read was told is read now. */
	recover(): void;
	stop(): void;
};

/**
 * Decides when a screen reads again what it was told. What is told is read
 * at the end of the task that told it, all in one `read`. One read is on its
 * way at a time; what is told meanwhile waits until it has landed and
 * `WINDOW_MS` has passed since it was sent. What a failed read was told is
 * kept, to be read with the next hint or once the socket is back, never on
 * a timer, and so is what a read answers that it could not read in (a read
 * that failed on the server). A read with no answer within
 * `ANSWER_WITHIN_MS` counts as failed, so that the network holding one does
 * not hold every read after it.
 */
export function readingOf(read: (told: Told) => Promise<Told>): Reading {
	let pending: Heard = new Map();
	let reading = false;
	let window: ReturnType<typeof setTimeout> | undefined;
	let unanswered: ReturnType<typeof setTimeout> | undefined;
	let queued = false;
	let kept = false;
	let toldSinceSent = false;
	let stopped = false;

	const schedule = () => {
		if (queued) return;
		queued = true;
		queueMicrotask(next);
	};
	const add = (kind: string, id: string | undefined) => {
		const ids = pending.get(kind);
		if (ids === true) return;
		if (id === undefined) {
			pending.set(kind, true);
			return;
		}
		const named = ids ?? new Set<string>();
		named.add(id);
		pending.set(kind, named.size > TOLD_AT_MOST ? true : named);
	};
	const tell = (kind: string, id: string | undefined) => {
		add(kind, id);
		toldSinceSent = true;
		kept = false;
		schedule();
	};
	const fail = (told: ToldEntries, failure: unknown) => {
		console.error(
			"sveltekit-live: reading again failed. It is read again with the next hint, or once the socket is back.",
			failure,
		);
		reading = false;
		for (const [kind, id] of each(told)) add(kind, id);
		kept = !toldSinceSent;
		schedule();
	};
	const next = () => {
		queued = false;
		if (stopped || reading || window || kept || pending.size === 0) return;
		const told = pending;
		pending = new Map();
		reading = true;
		toldSinceSent = false;
		window = setTimeout(() => {
			window = undefined;
			schedule();
		}, WINDOW_MS);
		let late = false;
		unanswered = setTimeout(() => {
			late = true;
			fail(told, new Error(`No answer within ${ANSWER_WITHIN_MS} ms.`));
		}, ANSWER_WITHIN_MS);
		read(toldOf(told)).then(
			(unread) => {
				// Kit puts a late answer in whenever it lands, maybe over a
				// newer one: what it was told is read again after it.
				if (late) {
					for (const [kind, id] of each(told)) tell(kind, id);
				} else {
					answered(unread);
				}
			},
			(failure: unknown) => {
				if (late) return;
				clearTimeout(unanswered);
				fail(told, failure);
			},
		);
	};
	/** A read landed, with what the server could not read in, kept as a failed read's. */
	const answered = (unread: Told) => {
		clearTimeout(unanswered);
		const kinds = Object.keys(unread);
		if (kinds.length > 0) {
			fail(
				Object.entries(unread),
				new Error(`The server could not read ${kinds.join(", ")} again.`),
			);
			return;
		}
		reading = false;
		schedule();
	};

	return {
		tell,
		recover() {
			kept = false;
			schedule();
		},
		stop() {
			stopped = true;
			clearTimeout(window);
			clearTimeout(unanswered);
		},
	};
}

/** What a read was told, held (`Heard`) or as it travels (`Told`). */
type ToldEntries = Iterable<[string, true | Iterable<string>]>;

/** Each kind a read was told, with each record it named, or none for the kind whole. */
function* each(told: ToldEntries): Generator<[string, string | undefined]> {
	for (const [kind, ids] of told) {
		for (const id of ids === true ? [undefined] : ids) yield [kind, id];
	}
}
