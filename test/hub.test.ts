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
			},
		},
	],
});

/** The test Worker (./worker/index.ts), as the tests call it. */
interface TestApp extends Rpc.WorkerEntrypointBranded {
	publish(tenant: string, hints: Hint[]): void;
}
const worker = server.getWorker<Record<string, never>, { default: TestApp }>();
/** Publishes to a tenant's hub, as an app's command does. */
async function publish(tenant: string, hints: Hint[]): Promise<void> {
	await (await worker.getExport()).publish(tenant, hints);
}

// Starting workerd takes a few seconds.
beforeAll(() => server.listen(), 60_000);
afterAll(() => server.close());

const ORIGIN = "http://app.test";

type Socket = NonNullable<
	Awaited<ReturnType<typeof worker.fetch>>["webSocket"]
>;

/** Opens a screen's socket, keeping every frame but the pongs. */
async function open(tenant: string, user: string) {
	const response = await worker.fetch(
		`${ORIGIN}/socket?tenant=${tenant}&user=${user}`,
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

	it("closes a socket that says anything but a ping", async () => {
		const { socket } = await open("listening", "ana");
		const closed = new Promise<number>((resolve) =>
			socket.addEventListener("close", ({ code }) => resolve(code)),
		);
		socket.send("hello");
		expect(await closed).toBe(1008);
	});
});
