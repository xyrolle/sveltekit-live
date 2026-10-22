import { TOLD_AT_MOST, type Told } from "./hint.ts";

/** The least time between two reads, so a burst of hints costs two at most. */
const WINDOW_MS = 500;

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
 * a timer.
 */
export function readingOf(read: (told: Told) => Promise<unknown>): Reading {
	let pending = new Map<string, true | Set<string>>();
	let reading = false;
	let window: ReturnType<typeof setTimeout> | undefined;
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
		read(wireOf(told)).then(
			() => {
				reading = false;
				schedule();
			},
			(failure: unknown) => {
				console.error(
					"sveltekit-live: reading again failed. It is read again with the next hint, or once the socket is back.",
					failure,
				);
				reading = false;
				for (const [kind, ids] of told) {
					for (const id of ids === true ? [undefined] : ids) add(kind, id);
				}
				kept = !toldSinceSent;
				schedule();
			},
		);
	};

	return {
		tell(kind, id) {
			add(kind, id);
			toldSinceSent = true;
			kept = false;
			schedule();
		},
		recover() {
			kept = false;
			schedule();
		},
		stop() {
			stopped = true;
			clearTimeout(window);
		},
	};
}

function wireOf(told: Map<string, true | Set<string>>): Told {
	return Object.fromEntries(
		[...told].map(([kind, ids]) => [kind, ids === true ? true : [...ids]]),
	);
}
