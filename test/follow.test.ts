import { fileURLToPath } from "node:url";
import {
	type Browser,
	chromium,
	type Page,
	type WebSocketRoute,
} from "playwright";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createTestHarness } from "wrangler";

// The example app (examples/todos), built by `pnpm test`, in workerd, and
// screens of it in a real browser: each its own user, in a context of its own.
const app = createTestHarness({
	workers: [
		{
			configPath: fileURLToPath(
				new URL("../examples/todos/wrangler.jsonc", import.meta.url),
			),
		},
	],
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

/** Ticks a todo off, once its command has answered: what it published is out. */
async function tick(page: Page, text: string) {
	const answered = page.waitForResponse(endsWith("/toggle"));
	await page.getByLabel(text).check();
	await answered;
}

const shownDone = (page: Page, text: string) =>
	page.getByRole("checkbox", { name: text, checked: true }).waitFor();

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
