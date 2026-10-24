import { version } from "$app/env";
import type { LiveHub } from "./hub.ts";

/**
 * Hands a screen's socket to its tenant's hub. The app's socket route calls
 * it once it has decided who the user is and which hub they may hear:
 *
 *     export const GET: RequestHandler = async ({ request, locals }) => {
 *       const { tenant, user } = signedIn(locals);
 *       return connect(request, { hub: env.LIVE.getByName(tenant), user });
 *     };
 *
 * The hub learns the user, for hints meant for them alone, and this Worker's
 * build (Kit's `version`), for screens of an older one to learn of it. Given
 * when the user's session `expires`, it closes the socket then, and the
 * screen reconnects to be admitted again, or refused.
 */
export async function connect(
	request: Request,
	{
		hub,
		user,
		expires,
	}: { hub: DurableObjectStub<LiveHub>; user: string; expires?: Date },
): Promise<Response> {
	if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
		return new Response("Expected a WebSocket upgrade.", {
			status: 426,
			headers: { upgrade: "websocket" },
		});
	}
	// A browser sends cookies with a WebSocket handshake to any site and
	// applies no CORS to it: the Origin header tells the app's own pages.
	if (request.headers.get("origin") !== new URL(request.url).origin) {
		return new Response("Sockets from another site are refused.", {
			status: 403,
		});
	}
	const url = new URL("https://live-hub/");
	url.searchParams.set("user", user);
	url.searchParams.set("version", version);
	if (expires) url.searchParams.set("expires", String(expires.getTime()));
	const accepted = await hub.fetch(url, { headers: { upgrade: "websocket" } });
	if (!accepted.webSocket) {
		throw new Error(
			`The hub refused the socket (HTTP ${accepted.status}: ${await accepted.text()}). Check that the binding's class is sveltekit-live's LiveHub.`,
		);
	}
	// A response of its own: the hub's has immutable headers, which Kit
	// appends to (the cookies a request set).
	return new Response(null, { status: 101, webSocket: accepted.webSocket });
}
