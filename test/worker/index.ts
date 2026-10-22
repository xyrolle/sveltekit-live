import { WorkerEntrypoint } from "cloudflare:workers";
import type { Hint } from "../../src/hint.ts";
import type { LiveHub } from "../../src/hub.ts";

export { LiveHub } from "../../src/hub.ts";

type Env = { LIVE: DurableObjectNamespace<LiveHub> };

/**
 * An app, reduced to what the tests choose: its socket route takes the tenant
 * and the user from the address, where an app would take them from a
 * session, and its commands publish through `publish`.
 */
export default class TestApp extends WorkerEntrypoint<Env> {
	override fetch(request: Request): Promise<Response> | Response {
		const url = new URL(request.url);
		const tenant = url.searchParams.get("tenant");
		const user = url.searchParams.get("user");
		if (!tenant || !user) {
			return new Response("Name a tenant and a user.", { status: 400 });
		}
		const hub = new URL("https://live-hub/");
		hub.searchParams.set("user", user);
		hub.searchParams.set("version", "build-1");
		return this.env.LIVE.getByName(tenant).fetch(hub, request);
	}

	async publish(tenant: string, hints: Hint[]): Promise<void> {
		await this.env.LIVE.getByName(tenant).publish(hints);
	}
}
