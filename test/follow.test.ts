import { fileURLToPath } from "node:url";
import type { D1Database } from "@cloudflare/workers-types";
import {
	type Browser,
	chromium,
	type Page,
	type WebSocketRoute,
} from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, experimental_readRawConfig } from "wrangler";
import type { Hint } from "../src/hint.ts";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The example app (examples/todos), built by `pnpm test`, in workerd, and
// screens of it in a real browser: each its own user, in a context of its own.
// Its Worker runs as configured, but for a hub that a test can have refuse a
// publication (./worker/todos.js).
const { rawConfig } = experimental_readRawConfig({
	config: here("../examples/todos/wrangler.jsonc"),
});
const app = createTestHarness({
	root: here("../examples/todos"),
	workers: [{ config: { ...rawConfig, main: here("worker/todos.js") } }],
});
let origin: URL;
let browser: Browser;

beforeAll(async () => {
	({ url: origin } = await app.listen());
	await app.getWorker().applyD1Migrations("DB");
	browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
	await browser?.close();
	await app.close();
});

/**
 * Opens the board as a new user, after `prepare` (routing the page), and
 * resolves once the screen has caught up: its socket said hello and the
 * read of everything that follows the first hello has landed.
 */
async function openScreen(prepare?: (page: Page) => Promise<unknown>) {
	const page = await (await browser.newContext()).newPage();
	await prepare?.(page);
	const hello = page
		.waitForEvent("websocket")
		.then((socket) => socket.waitForEvent("framereceived"));
	const caughtUp = page.waitForResponse(endsWith("/readAgain"));
	await page.goto(origin.href);
	await Promise.all([hello, caughtUp]);
	return page;
}

/** Hands the page's socket to the hub, passing each frame the hub sends through `pass`. */
const routeSocket =
	(pass: (frame: string, socket: WebSocketRoute) => void) => (page: Page) =>
		page.routeWebSocket(/\/live$/, (socket) => {
			const hub = socket.connectToServer();
			hub.onMessage((frame) => pass(String(frame), socket));
		});

const endsWith = (path: string) => (response: { url(): string }) =>
	response.url().endsWith(path);

/** Adds a todo, once its own screen shows it. */
async function add(page: Page, text: string) {
	await page.getByLabel("New todo").fill(text);
	await page.getByRole("button", { name: "Add" }).click();
	await page.getByLabel(text).waitFor();
}

/** Ticks a todo off, and answers with its command's answer, once what it published is out. */
async function tick(page: Page, text: string) {
	const answered = page.waitForResponse(endsWith("/toggle"));
	await page.getByLabel(text).check();
	return (await answered).json();
}

/** Ticks a todo back on, once what its command published is out. */
async function untick(page: Page, text: string) {
	const answered = page.waitForResponse(endsWith("/toggle"));
	await page.getByLabel(text).uncheck();
	await answered;
}

const shownDone = (page: Page, text: string, done = true) =>
	page.getByRole("checkbox", { name: text, checked: done }).waitFor();

/** Resolves once the screen's next read-again has landed. */
const readsAgain = (page: Page) =>
	page.waitForRequest(/\/readAgain$/).then((request) => request.response());

/** The example's bindings, as the test reaches them from outside the Worker. */
type Env = {
	DB: D1Database;
	LIVE: {
		getByName(name: string): {
			publish(hints: Hint[]): Promise<void>;
			refuseNext(): Promise<void>;
		};
	};
};

/** The example's database. */
async function database(): Promise<D1Database> {
	return (await app.getWorker<Env>().getEnv()).DB;
}

/** The hints the outbox holds, not yet published. */
async function outbox(): Promise<string[]> {
	const { results } = await (await database())
		.prepare("select hints from outbox")
		.all<{ hints: string }>();
	return results.map(({ hints }) => hints);
}

/** The id of the todo of `text`. */
async function idOf(text: string): Promise<string> {
	const row = await (await database())
		.prepare("select id from todos where text = ?")
		.bind(text)
		.first<{ id: string }>();
	if (!row) throw new Error(`No todo "${text}".`);
	return row.id;
}

const closeAll = (...pages: Page[]) =>
	Promise.all(pages.map((page) => page.context().close()));

// A browser and a Worker take seconds, more on a slow machine.
describe("followChanges", { timeout: 15_000 }, () => {
	it("reads again on one screen what another changed", async () => {
		const ana = await openScreen();
		const bob = await openScreen();

		await add(ana, "Buy milk");
		await bob.getByLabel("Buy milk").waitFor();
		await tick(ana, "Buy milk");
		await shownDone(bob, "Buy milk");

		await closeAll(ana, bob);
	});

	it("reads everything again when a publication's number shows it missed one", async () => {
		const ana = await openScreen();
		let dropping = false;
		const { promise: dropped, resolve: drop } = Promise.withResolvers<void>();
		const bob = await openScreen(
			routeSocket((frame, socket) => {
				if (dropping && frame.includes('"hints"')) {
					dropping = false;
					drop();
				} else {
					socket.send(frame);
				}
			}),
		);
		await add(ana, "Call the bank");
		await add(ana, "Water the plants");
		await bob.getByLabel("Water the plants").waitFor();

		dropping = true;
		await tick(ana, "Call the bank");
		await dropped;
		await tick(ana, "Water the plants");

		// Only the lost publication named the bank's todo.
		await shownDone(bob, "Call the bank");
		await closeAll(ana, bob);
	});

	it("reads everything again when it reconnects to find the series moved on", async () => {
		const ana = await openScreen();
		const sockets: WebSocketRoute[] = [];
		const { promise: away, resolve: comeBack } = Promise.withResolvers<void>();
		const bob = await openScreen((page) =>
			page.routeWebSocket(/\/live$/, async (socket) => {
				sockets.push(socket);
				// Bob's next socket reaches the hub only once Ana's change is out.
				if (sockets.length > 1) await away;
				socket.connectToServer();
			}),
		);
		await add(ana, "Book the dentist");
		await bob.getByLabel("Book the dentist").waitFor();

		await sockets[0]?.close();
		await tick(ana, "Book the dentist");
		comeBack();

		await shownDone(bob, "Book the dentist");
		await closeAll(ana, bob);
	});

	it("publishes, once the cron runs, what a command committed but did not get to publish", async () => {
		const bob = await openScreen();
		await add(bob, "Pay the rent");

		// What a Worker that died between its commit and its publication leaves:
		// the change, and its hints in the outbox.
		const id = await idOf("Pay the rent");
		const db = await database();
		await db.batch([
			db.prepare("update todos set done = 1 where id = ?").bind(id),
			db
				.prepare("insert into outbox (id, hints) values (?, ?)")
				.bind(crypto.randomUUID(), JSON.stringify([{ kind: "todo", id }])),
		]);
		await app.getWorker().scheduled({ cron: "* * * * *" });

		await shownDone(bob, "Pay the rent");
		await closeAll(bob);
	});

	it("keeps what the hub refused for the cron, and answers the command that committed it", async () => {
		const ana = await openScreen();
		const bob = await openScreen();
		await add(ana, "Water the cactus");
		await bob.getByLabel("Water the cactus").waitFor();

		const { LIVE } = await app.getWorker<Env>().getEnv();
		await LIVE.getByName("board").refuseNext();
		expect(await tick(ana, "Water the cactus")).toMatchObject({
			type: "result",
		});
		const id = await idOf("Water the cactus");
		expect(await outbox()).toEqual([JSON.stringify([{ kind: "todo", id }])]);

		await app.getWorker().scheduled({ cron: "* * * * *" });
		await shownDone(bob, "Water the cactus");
		expect(await outbox()).toEqual([]);
		await closeAll(ana, bob);
	});

	it("lets the next read go when one has no answer within 15 s, and reads again after its late answer", async () => {
		const ana = await openScreen();
		let holding = false;
		const held = Promise.withResolvers<() => Promise<void>>();
		const bob = await openScreen(async (page) => {
			await page.clock.install();
			await page.route(/\/readAgain$/, async (route) => {
				if (!holding) return route.continue();
				holding = false;
				// Answered by the server now, delivered when the test says.
				const response = await route.fetch();
				held.resolve(() => route.fulfill({ response }));
			});
		});
		await add(ana, "Feed the cat");
		await bob.getByLabel("Feed the cat").waitFor();

		holding = true;
		await tick(ana, "Feed the cat");
		const deliverLate = await held.promise;
		await untick(ana, "Feed the cat");
		const next = readsAgain(bob);
		await bob.clock.runFor(15_000);
		await next;
		await shownDone(bob, "Feed the cat", false);

		// The held answer says the todo is done, which it no longer is.
		const again = readsAgain(bob);
		await deliverLate();
		await again;
		await shownDone(bob, "Feed the cat", false);
		await closeAll(ana, bob);
	});

	it("reads again, once the socket is back, a read that failed on the server", async () => {
		const ana = await openScreen();
		const sockets: WebSocketRoute[] = [];
		const bob = await openScreen((page) =>
			page.routeWebSocket(/\/live$/, (socket) => {
				sockets.push(socket);
				socket.connectToServer();
			}),
		);
		await add(ana, "Call mum");
		await bob.getByLabel("Call mum").waitFor();

		// The todo is done, but no read of it succeeds until its table is back.
		const id = await idOf("Call mum");
		const db = await database();
		await db.batch([
			db.prepare("update todos set done = 1 where id = ?").bind(id),
			db.prepare("alter table todos rename to todos_away"),
		]);
		try {
			const failed = readsAgain(bob);
			const { LIVE } = await app.getWorker<Env>().getEnv();
			await LIVE.getByName("board").publish([{ kind: "todo", id }]);
			await failed;
		} finally {
			await db.prepare("alter table todos_away rename to todos").run();
		}

		const recovered = readsAgain(bob);
		await sockets[0]?.close();
		await recovered;
		await shownDone(bob, "Call mum");
		await closeAll(ana, bob);
	});

	it("takes a read's refusal as its answer, not as a read to do again", async () => {
		const ana = await openScreen();
		const sockets: WebSocketRoute[] = [];
		const bob = await openScreen((page) =>
			page.routeWebSocket(/\/live$/, (socket) => {
				sockets.push(socket);
				socket.connectToServer();
			}),
		);
		let sent = 0;
		bob.on("request", (request) => {
			if (request.url().endsWith("/readAgain")) sent += 1;
		});
		await add(ana, "Sell the bike");
		await bob.getByLabel("Sell the bike").waitFor();

		// Deleted: Bob's read of it is refused (404), which is its answer.
		const id = await idOf("Sell the bike");
		await (await database())
			.prepare("delete from todos where id = ?")
			.bind(id)
			.run();
		const { LIVE } = await app.getWorker<Env>().getEnv();
		const refused = readsAgain(bob);
		await LIVE.getByName("board").publish([{ kind: "todo", id }]);
		await refused;
		const before = sent;

		const hello = bob
			.waitForEvent("websocket")
			.then((socket) => socket.waitForEvent("framereceived"));
		await sockets[0]?.close();
		await hello;
		await LIVE.getByName("board").publish([{ kind: "todos" }]);
		await bob.getByLabel("Sell the bike").waitFor({ state: "detached" });
		// One read, the list's: the socket's return read nothing kept.
		expect(sent).toBe(before + 1);
		await closeAll(ana, bob);
	});

	it("has Kit check for a newer build when the hub's hello names one", async () => {
		const newer = (frame: string) =>
			frame.replace(/"version":"[^"]*"/, '"version":"newer"');
		const bob = await openScreen(async (page) => {
			await page.route("**/_app/version.json", (route) =>
				route.fulfill({ json: { version: "newer" } }),
			);
			await routeSocket((frame, socket) => socket.send(newer(frame)))(page);
		});

		await bob.getByText("A newer version is out.").waitFor();
		await closeAll(bob);
	});
});
