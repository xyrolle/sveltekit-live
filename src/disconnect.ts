import { dev } from "$app/env";
import type { LiveHub } from "./hub.ts";

/**
 * Closes a user's sockets on a hub, once their access to it has ended (they
 * signed out, or were removed):
 *
 *     await disconnect(env.LIVE.getByName(tenant), user);
 *
 * Each of the user's screens reconnects, and the socket route admits again
 * only those it still would: a screen of a session still signed in comes
 * back, having missed nothing.
 *
 * Under `vite dev` it does nothing: Durable Objects run only in the built
 * Worker, and no screen listens there.
 */
export async function disconnect(
	hub: DurableObjectStub<LiveHub>,
	user: string,
): Promise<void> {
	if (dev) return;
	await hub.disconnect(user);
}
