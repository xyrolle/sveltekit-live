import { DurableObject } from "cloudflare:workers";
import { type Hello, type Hint, PING, PONG, type Publication } from "./hint.ts";

/** Where the hub keeps its series and the number of its last publication. */
const SERIES = "series";
const PUBLISHED = "published";

/**
 * One tenant's open screens, reached by the tenant's name
 * (`env.LIVE.getByName(tenant)`). It holds their sockets through the
 * WebSocket Hibernation API, so an idle tenant costs nothing, and numbers
 * what it publishes in a series kept in its storage, so a screen can tell
 * that it missed a publication, across evictions and deploys alike.
 *
 * It authorizes nothing: sockets reach it only through `connect`, and
 * publications only through the app's own binding.
 */
export class LiveHub extends DurableObject<unknown> {
	constructor(ctx: DurableObjectState, env: unknown) {
		super(ctx, env);
		this.ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair(PING, PONG),
		);
	}

	/** Takes a screen's socket from `connect`, tagged with its user, and says hello. */
	override fetch(request: Request): Response {
		const url = new URL(request.url);
		const user = url.searchParams.get("user");
		const version = url.searchParams.get("version");
		if (request.headers.get("upgrade") !== "websocket" || !user || !version) {
			return new Response("A LiveHub takes sockets from connect() only.", {
				status: 400,
			});
		}
		const { 0: client, 1: server } = new WebSocketPair();
		this.ctx.acceptWebSocket(server, [user]);
		server.send(
			JSON.stringify({ ...this.standing(), version } satisfies Hello),
		);
		return new Response(null, { status: 101, webSocket: client });
	}

	/**
	 * Sends the hints to every socket, numbered one past the last publication:
	 * a hint with a `userId` to that user's sockets only. A socket that none of
	 * the hints is for still gets the number, so it can tell it missed none.
	 */
	publish(hints: Hint[]): void {
		const n = this.standing().n + 1;
		this.ctx.storage.kv.put(PUBLISHED, n);
		const frames = new Map<string | undefined, string>();
		const frameFor = (user: string | undefined) => {
			let frame = frames.get(user);
			if (frame === undefined) {
				const heard = hints.filter(
					(hint) => hint.userId === undefined || hint.userId === user,
				);
				frame = JSON.stringify({ n, hints: heard } satisfies Publication);
				frames.set(user, frame);
			}
			return frame;
		};
		for (const socket of this.ctx.getWebSockets()) {
			if (socket.readyState !== WebSocket.OPEN) continue;
			const [user] = this.ctx.getTags(socket);
			socket.send(frameFor(user));
		}
	}

	/** A screen only listens; anything it says but a ping is a mistake. */
	override webSocketMessage(socket: WebSocket): void {
		socket.close(1008, "A LiveHub socket only delivers hints.");
	}

	/** Where the series stands: begun once, then counted on. */
	private standing(): Omit<Hello, "version"> {
		const kv = this.ctx.storage.kv;
		const stored = kv.get(SERIES);
		const series = typeof stored === "string" ? stored : crypto.randomUUID();
		if (series !== stored) kv.put(SERIES, series);
		const n = kv.get(PUBLISHED);
		return { series, n: typeof n === "number" ? n : 0 };
	}
}
