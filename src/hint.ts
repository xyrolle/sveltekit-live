// What travels from a tenant's hub to an open screen. A hint names what
// changed and nothing of what it is now: the screen reads it again through
// the app's own queries, so a hint that reaches the wrong screen reveals only
// that something of a kind changed.

/**
 * What an app declares once, in its `app.d.ts`, so that a misspelled kind
 * fails its typecheck:
 *
 *     declare module "sveltekit-live" {
 *       interface Register {
 *         kind: "todos" | "todo";
 *       }
 *     }
 */
// biome-ignore lint/suspicious/noEmptyInterface: the app's declaration merges into it.
export interface Register {}

/** A kind of change: one the app declared (`Register`), or any string if it declared none. */
export type Kind = Register extends { kind: infer Declared extends string }
	? Declared
	: string;

/**
 * Something changed: a kind the app names, the one record the change is
 * about (`id`), and the one user whose screens alone should hear it
 * (`userId`).
 */
export type Hint = { kind: Kind; id?: string; userId?: string };

/**
 * What a hub says to each socket it takes: where its series of publications
 * stands, and the build of the app's Worker that took the socket.
 */
export type Hello = { series: string; n: number; version: string };

/** One publication: its number in the hub's series, and its hints for this socket. */
export type Publication = { n: number; hints: Hint[] };

/** The liveness check a screen sends, and the answer the hub gives without waking. */
export const PING = "ping";
export const PONG = "pong";

/**
 * What a screen was told since it last read again, by kind: `true` for the
 * kind whole, or the ids of the records the hints named.
 */
export type Told = Record<string, true | string[]>;

/** The most records a screen names for one kind; past it, it reads the kind whole. */
export const TOLD_AT_MOST = 100;
