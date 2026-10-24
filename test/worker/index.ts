import { WorkerEntrypoint } from "cloudflare:workers";
import { connect } from "../../src/connect.ts";
import { disconnect } from "../../src/disconnect.ts";
import type { Hint } from "../../src/hint.ts";
import type { LiveHub } from "../../src/hub.ts";
import { publish } from "../../src/publish.ts";

export { LiveHub } from "../../src/hub.ts";

type Env = { LIVE: DurableObjectNamespace<LiveHub> };

/**
 * An app, reduced to what the tests choose: its socket route takes the
 * tenant, the user and when their session expires from the address, where
 * an app would take them from a session, its commands publish through `publish`, and it disconnects a
 * user who lost access through `disconnect`.
 */
export default class TestApp extends WorkerEntrypoint<Env> {
	override fetch(request: Request): Promise<Response> | Response {
		const url = new URL(request.url);
		const tenant = url.searchParams.get("tenant");
		const user = url.searchParams.get("user");
		const expires = url.searchParams.get("expires");
		if (!tenant || !user) {
			return new Response("Name a tenant and a user.", { status: 400 });
		}
		const hub = this.env.LIVE.getByName(tenant);
		return expires
			? connect(request, { hub, user, expires: new Date(Number(expires)) })
			: connect(request, { hub, user });
	}

	publish(tenant: string, hints: Hint[]): Promise<void> {
		return publish(this.env.LIVE.getByName(tenant), hints);
	}

	disconnect(tenant: string, user: string): Promise<void> {
		return disconnect(this.env.LIVE.getByName(tenant), user);
	}
}
