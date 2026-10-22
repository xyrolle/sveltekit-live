import { dev } from "$app/env";
import type { Hint } from "./hint.ts";
import type { LiveHub } from "./hub.ts";

/**
 * Tells the other screens of a hub's tenant what a command changed, once its
 * write has committed:
 *
 *     await publish(env.LIVE.getByName(tenant), [{ kind: "todo", id }]);
 *
 * Under `vite dev` it does nothing: Durable Objects run only in the built
 * Worker, and no screen listens there.
 */
export async function publish(
	hub: DurableObjectStub<LiveHub>,
	hints: Hint[],
): Promise<void> {
	if (dev) return;
	await hub.publish(hints);
}
