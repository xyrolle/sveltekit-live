import { fileURLToPath } from "node:url";
import type { Rpc } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";
import {
	type Hello,
	type Hint,
	PING,
	PONG,
	type Publication,
} from "../src/hint.ts";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const server = createTestHarness({
	workers: [
		{
			config: {
				name: "sveltekit-live-test",
				main: here("worker/index.ts"),
				compatibility_date: "2026-10-01",
				durable_objects: {
					bindings: [{ name: "LIVE", class_name: "LiveHub" }],
				},
				migrations: [{ tag: "v1", new_sqlite_classes: ["LiveHub"] }],
				alias: { "$app/env": here("worker/app-env.ts") },
			},
		},
	],
});

/** The test Worker (./worker/index.ts), as the tests call it. */
interface TestApp extends Rpc.WorkerEntrypointBranded {
	publish(tenant: string, hints: Hint[]): void;
	disconnect(tenant: string, user: string): void;
}
const worker = server.getWorker<Record<string, never>, { default: TestApp }>();
/** Publishes to a tenant's hub, as an app's command does. */
async function publish(tenant: string, hints: Hint[]): Promise<void> {
	await (await worker.getExport()).publish(tenant, hints);
}
/** Closes a user's sockets on a tenant's hub, as an app does once their access ended. */
async function disconnect(tenant: string, user: string): Promise<void> {
	await (await worker.getExport()).disconnect(tenant, user);
}

// Starting workerd takes a few seconds.
beforeAll(() => server.listen(), 60_000);
afterAll(() => server.close());

const ORIGIN = "http://app.test";

type Socket = NonNullable<
	Awaited<ReturnType<typeof worker.fetch>>["webSocket"]
>;

/**
 * Opens a screen's socket through `connect`, for a session that `expires` at
 * that time (epoch ms) or never, keeping every frame but the pongs.
 */
async function open(tenant: string, user: string, expires?: number) {
	const session = expires === undefined ? "" : `&expires=${expires}`;
	const response = await worker.fetch(
		`${ORIGIN}/socket?tenant=${tenant}&user=${user}${session}`,
		{ headers: { upgrade: "websocket", origin: ORIGIN } },
	);
	const socket = response.webSocket;
	if (!socket) throw new Error(`No socket: HTTP ${response.status}`);
	socket.accept();
	const frames: (Hello | Publication)[] = [];
	socket.addEventListener("message", ({ data }) => {
		if (data !== PONG) frames.push(JSON.parse(String(data)));
	});
	return { socket, frames };
}

/** Resolves once every frame sent before it has arrived: the pong comes after them. */
async function caughtUp(socket: Socket): Promise<void> {
	const pong = new Promise<void>((resolve) =>
		socket.addEventListener("message", ({ data }) => {
			if (data === PONG) resolve();
		}),
	);
	socket.send(PING);
	await pong;
}

/** Resolves with the code the hub closes the socket with. */
const closed = (socket: Socket) =>
	new Promise<number>((resolve) =>
		socket.addEventListener("close", ({ code }) => resolve(code)),
	);

const publications = (frames: (Hello | Publication)[]) =>
	frames.filter((frame) => "hints" in frame);

describe("LiveHub", () => {
	it("numbers every publication in order for each socket of its tenant, and none of another", async () => {
		const ana = await open("ordering", "ana");
		const bob = await open("ordering", "bob");
		const elsewhere = await open("ordering-elsewhere", "ana");
		await Promise.all(
			Array.from({ length: 20 }, (_, index) =>
				publish("ordering", [{ kind: "todo", id: `todo-${index}` }]),
			),
		);
		for (const { socket } of [ana, bob, elsewhere]) await caughtUp(socket);

		const numbers = publications(ana.frames).map(({ n }) => n);
		expect(numbers).toEqual(
			Array.from({ length: 20 }, (_, index) => index + 1),
		);
		expect(publications(bob.frames)).toEqual(publications(ana.frames));
		expect(publications(elsewhere.frames)).toEqual([]);
	});

	it("sends a user's hints to that user's sockets only, and the number to all", async () => {
		const phone = await open("personal", "ana");
		const laptop = await open("personal", "ana");
		const bob = await open("personal", "bob");
		const shared = { kind: "todo" };
		const anas = { kind: "inbox", userId: "ana" };
		await publish("personal", [shared, anas]);
		await publish("personal", [anas]);
		for (const { socket } of [phone, laptop, bob]) await caughtUp(socket);

		for (const { frames } of [phone, laptop]) {
			expect(publications(frames)).toEqual([
				{ n: 1, hints: [shared, anas] },
				{ n: 2, hints: [anas] },
			]);
		}
		expect(publications(bob.frames)).toEqual([
			{ n: 1, hints: [shared] },
			{ n: 2, hints: [] },
		]);
	});

	it("tells a socket that reconnects how far the series moved, across an eviction", async () => {
		const first = await open("reconnect", "ana");
		await caughtUp(first.socket);
		expect(first.frames).toEqual([
			{ series: expect.any(String), n: 0, version: "build-1" },
		]);
		await publish("reconnect", [{ kind: "todo" }]);
		await publish("reconnect", [{ kind: "todo" }]);
		await worker.evictDurableObject("LIVE", {
			name: "reconnect",
			webSockets: "close",
		});

		const again = await open("reconnect", "ana");
		await caughtUp(again.socket);
		expect(again.frames).toEqual([{ ...first.frames[0], n: 2 }]);
	});

	it("keeps its sockets through hibernation", async () => {
		const ana = await open("hibernation", "ana");
		await worker.evictDurableObject("LIVE", {
			name: "hibernation",
			webSockets: "hibernate",
		});
		await caughtUp(ana.socket);
		await publish("hibernation", [{ kind: "todo" }]);
		await caughtUp(ana.socket);

		expect(publications(ana.frames)).toEqual([
			{ n: 1, hints: [{ kind: "todo" }] },
		]);
	});

	it("closes the sockets of a user who lost access, who hears nothing more", async () => {
		const phone = await open("access", "ana");
		const laptop = await open("access", "ana");
		const bob = await open("access", "bob");
		// workerd ends a hibernated socket that has sent no frame ten seconds
		// after closing it (cloudflare/workerd#7566); a screen's pings are frames.
		for (const { socket } of [phone, laptop]) await caughtUp(socket);
		const codes = Promise.all(
			[phone, laptop].map(({ socket }) => closed(socket)),
		);
		await disconnect("access", "ana");
		await publish("access", [{ kind: "todo" }]);

		expect(await codes).toEqual([1008, 1008]);
		await caughtUp(bob.socket);
		expect(publications(phone.frames)).toEqual([]);
		expect(publications(laptop.frames)).toEqual([]);
		expect(publications(bob.frames)).toEqual([
			{ n: 1, hints: [{ kind: "todo" }] },
		]);
	});

	it("closes a socket once its session has expired, and keeps the others", async () => {
		const expiring = await open("expiry", "ana", Date.now() + 300);
		const live = await open("expiry", "bob");
		// workerd ends a hibernated socket that has sent no frame ten seconds
		// after closing it (cloudflare/workerd#7566); a screen's pings are frames.
		for (const { socket } of [expiring, live]) await caughtUp(socket);
		expect(await closed(expiring.socket)).toBe(1008);

		await publish("expiry", [{ kind: "todo" }]);
		await caughtUp(live.socket);
		expect(publications(expiring.frames)).toEqual([]);
		expect(publications(live.frames)).toEqual([
			{ n: 1, hints: [{ kind: "todo" }] },
		]);
	});

	it("closes each socket at its own session's expiry", async () => {
		const sooner = await open("expiries", "ana", Date.now() + 200);
		const later = await open("expiries", "bob", Date.now() + 1_500);
		for (const { socket } of [sooner, later]) await caughtUp(socket);

		expect(await closed(sooner.socket)).toBe(1008);
		expect(await closed(later.socket)).toBe(1008);
	});

	it("closes a socket at its session's expiry across hibernation", async () => {
		const ana = await open("expiry-hibernation", "ana", Date.now() + 500);
		await caughtUp(ana.socket);
		const code = closed(ana.socket);
		await worker.evictDurableObject("LIVE", {
			name: "expiry-hibernation",
			webSockets: "hibernate",
		});

		expect(await code).toBe(1008);
	});

	it("closes a socket that says anything but a ping", async () => {
		const { socket } = await open("listening", "ana");
		const code = closed(socket);
		socket.send("hello");
		expect(await code).toBe(1008);
	});
});

describe("connect", () => {
	const socketRoute = `${ORIGIN}/socket?tenant=refusals&user=ana`;

	it("refuses a request that is no WebSocket upgrade", async () => {
		const response = await worker.fetch(socketRoute, {
			headers: { origin: ORIGIN },
		});
		expect(response.status).toBe(426);
	});

	it("refuses an expiry that is no date, saying what to pass", async () => {
		const opening = worker.fetch(`${socketRoute}&expires=never`, {
			headers: { upgrade: "websocket", origin: ORIGIN },
		});
		await expect(opening).rejects.toThrow(
			"connect() was given expires: Invalid Date. Pass when the user's session expires, as a valid Date.",
		);
	});

	it("refuses a socket opened from another site", async () => {
		const response = await worker.fetch(socketRoute, {
			headers: { upgrade: "websocket", origin: "https://elsewhere.test" },
		});
		expect(response.status).toBe(403);
	});
});
