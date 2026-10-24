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
	/** Runs a page's own `work` after the read on its way, holding the next read until it lands. */
	turn<T>(work: () => Promise<T>): Promise<T>;
	stop(): void;
};

/** A read on its way: what it was told, and whether more was told since. */
type OnItsWay = {
	is: "reading";
	told: Heard;
	toldSince: boolean;
	/** What makes it count as failed, `ANSWER_WITHIN_MS` after it was sent. */
	unanswered: ReturnType<typeof setTimeout>;
	/** Settled once it has landed, failed or counted as failed. */
	over: PromiseWithResolvers<void>;
};

/**
 * Where a screen's reading stands: nothing on its way (`idle`), a read on
 * its way (`reading`), the window since the last read was sent (`pausing`),
 * or a read that failed with nothing told since, whose kinds wait for a hint
 * or the socket (`kept`).
 */
type State =
	| { is: "idle" }
	| OnItsWay
	| { is: "pausing"; until: ReturnType<typeof setTimeout> }
	| { is: "kept" }
	| { is: "stopped" };

/**
 * Decides when a screen reads again what it was told. What is told is read
 * at the end of the task that told it, all in one `read`. One read is on its
 * way at a time; what is told meanwhile waits until it has landed and
 * `WINDOW_MS` has passed since it was sent. What a failed read was told is
 * kept, to be read with the next hint or once the socket is back, never on
 * a timer, and so is what a read answers that it could not read in (a read
 * that failed on the server). A read with no answer within
 * `ANSWER_WITHIN_MS` counts as failed, so that the network holding one does
 * not hold every read after it. A page's own work that also reads (`turn`)
 * goes in the same line: after the read on its way, and before the next.
 */
export function readingOf(read: (told: Told) => Promise<Told>): Reading {
	let state: State = { is: "idle" };
	let pending: Heard = new Map();
	let sentAt = Number.NEGATIVE_INFINITY;
	/** The page's own work on its way, or waiting for the read on its way. */
	let turns = 0;
	let queued = false;

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
		if (state.is === "reading") state.toldSince = true;
		if (state.is === "kept") state = { is: "idle" };
		schedule();
	};
	const next = () => {
		queued = false;
		if (state.is !== "idle" || turns > 0 || pending.size === 0) return;
		const wait = sentAt + WINDOW_MS - Date.now();
		if (wait > 0) {
			state = {
				is: "pausing",
				until: setTimeout(() => {
					state = { is: "idle" };
					schedule();
				}, wait),
			};
			return;
		}
		send();
	};
	const send = () => {
		const reading: OnItsWay = {
			is: "reading",
			told: pending,
			toldSince: false,
			over: Promise.withResolvers(),
			unanswered: setTimeout(() => {
				const failure = new Error(`No answer within ${ANSWER_WITHIN_MS} ms.`);
				fail(reading, reading.told, failure);
			}, ANSWER_WITHIN_MS),
		};
		pending = new Map();
		sentAt = Date.now();
		state = reading;
		read(toldOf(reading.told)).then(
			(unread) => landed(reading, unread),
			(failure: unknown) => {
				if (state === reading) fail(reading, reading.told, failure);
			},
		);
	};
	/** A read landed, answering with what the server could not read in. */
	const landed = (reading: OnItsWay, unread: Told) => {
		if (state !== reading) {
			// It came after its bound. Kit puts it in whenever it lands, maybe
			// over a newer answer: what it was told is read again after it.
			for (const [kind, id] of each(reading.told)) tell(kind, id);
			return;
		}
		const kinds = Object.keys(unread);
		if (kinds.length > 0) {
			const failure = new Error(
				`The server could not read ${kinds.join(", ")} again.`,
			);
			fail(reading, Object.entries(unread), failure);
			return;
		}
		settle(reading, { is: "idle" });
	};
	/** What a read could not read in waits for a hint or the socket, unless one came already. */
	const fail = (reading: OnItsWay, unread: ToldEntries, failure: unknown) => {
		console.error(
			"sveltekit-live: reading again failed. It is read again with the next hint, or once the socket is back.",
			failure,
		);
		for (const [kind, id] of each(unread)) add(kind, id);
		settle(reading, reading.toldSince ? { is: "idle" } : { is: "kept" });
	};
	const settle = (reading: OnItsWay, to: State) => {
		clearTimeout(reading.unanswered);
		state = to;
		reading.over.resolve();
		schedule();
	};

	return {
		tell,
		recover() {
			if (state.is === "kept") state = { is: "idle" };
			schedule();
		},
		async turn(work) {
			turns += 1;
			try {
				if (state.is === "reading") await state.over.promise;
				return await work();
			} finally {
				turns -= 1;
				schedule();
			}
		},
		stop() {
			if (state.is === "reading") {
				clearTimeout(state.unanswered);
				state.over.resolve();
			}
			if (state.is === "pausing") clearTimeout(state.until);
			state = { is: "stopped" };
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
