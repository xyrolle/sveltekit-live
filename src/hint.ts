// What travels from a tenant's hub to an open screen. A hint names what
// changed and nothing of what it is now: the screen reads it again through
// the app's own queries, so a hint that reaches the wrong screen reveals only
// that something of a kind changed.

/**
 * Something changed: a kind the app names, the one record the change is
 * about (`id`), and the one user whose screens alone should hear it
 * (`userId`).
 */
export type Hint = { kind: string; id?: string; userId?: string };

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
