import { createSubscriber } from "svelte/reactivity";
import type { Standing } from "./reading.ts";

/** How long a screen may be out of date before it says so: past a reconnect or two. */
const STALE_AFTER_MS = 15_000;

/** Whether what a screen shows may be out of date (`followChanges`). */
export type Freshness = {
	/**
	 * Since when the screen may be out of date, once that has lasted 15 s:
	 * its socket was lost, or a read failed. Undefined while it is current.
	 * Reactive.
	 */
	readonly staleSince: Date | undefined;
	/** Reconnects at once if the socket is down, and reads again what failed. */
	retry(): void;
};

/** What the follower tells of the screen it keeps current. */
export type Watch = Freshness & {
	/** The socket was lost. */
	lost(): void;
	/** The hub said hello, and the reads it called for are under way. */
	connected(): void;
	/** How the screen's reads stand now. */
	stands(standing: Standing): void;
	stop(): void;
};

/**
 * Watches whether a screen is current. It may not be from the moment its
 * socket is lost or a read fails, until the socket is back and every read
 * has landed. Only once that has lasted `STALE_AFTER_MS` does it say so, so
 * a blip says nothing.
 */
export function freshnessOf(retry: () => void): Watch {
	let hearing = false;
	let standing: Standing = "current";
	let since: Date | undefined;
	let bound: ReturnType<typeof setTimeout> | undefined;
	let said = false;

	let changed = () => {};
	const subscribe = createSubscriber((update) => {
		changed = update;
		return () => {
			changed = () => {};
		};
	});

	const behind = () => {
		if (since) return;
		since = new Date();
		bound = setTimeout(() => {
			said = true;
			changed();
		}, STALE_AFTER_MS);
	};
	const current = () => {
		if (!hearing || standing !== "current" || !since) return;
		clearTimeout(bound);
		since = undefined;
		if (said) {
			said = false;
			changed();
		}
	};

	return {
		get staleSince() {
			subscribe();
			return said ? since : undefined;
		},
		retry,
		lost() {
			hearing = false;
			behind();
		},
		connected() {
			hearing = true;
			current();
		},
		stands(now) {
			standing = now;
			if (now === "failed") behind();
			else current();
		},
		stop() {
			clearTimeout(bound);
		},
	};
}
