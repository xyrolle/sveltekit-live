import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The example app under `vite dev`, where there are no Durable Objects and
// no socket, and a screen of it in a real browser.
const example = fileURLToPath(new URL("../examples/todos/", import.meta.url));
const bin = (name: string) => `${example}node_modules/.bin/${name}`;
const PORT = 4750;

let server: ChildProcess | undefined;
let browser: Browser;

beforeAll(async () => {
	// As `pnpm dev` does first: the dev server's database gets the tables.
	const migrated = spawnSync(
		bin("wrangler"),
		["d1", "migrations", "apply", "DB", "--local"],
		{ cwd: example, encoding: "utf8" },
	);
	if (migrated.status !== 0) throw new Error(migrated.stderr);
	const started = spawn(
		bin("vite"),
		["dev", "--port", String(PORT), "--strictPort"],
		{ cwd: example, env: { ...process.env, NO_COLOR: "1" } },
	);
	server = started;
	await new Promise<void>((resolve, reject) => {
		started.stdout?.on("data", (chunk) => {
			if (String(chunk).includes(`localhost:${PORT}`)) resolve();
		});
		started.on("exit", (code) => reject(new Error(`vite dev exited: ${code}`)));
	});
	browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
	await browser?.close();
	server?.kill();
});

/**
 * Hides the tab and shows it again. No Chromium that Playwright drives
 * changes `document.visibilityState`: CDP's lifecycle states, another page
 * brought to the front and a minimised window all leave it "visible",
 * headless or not. So this sets it, and sends the event the follower
 * listens to.
 */
const hideAndShow = (page: Page) =>
	page.evaluate(() => {
		for (const state of ["hidden", "visible"]) {
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				get: () => state,
			});
			document.dispatchEvent(new Event("visibilitychange"));
		}
	});

// A dev server compiles each module on its first request.
describe("followChanges under vite dev", { timeout: 30_000 }, () => {
	it("reads everything again when the tab is shown again", async () => {
		const page = await (await browser.newContext()).newPage();
		await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });

		const read = page.waitForResponse((response) =>
			response.url().endsWith("/readAgain"),
		);
		await hideAndShow(page);
		expect((await read).ok()).toBe(true);
		await page.context().close();
	});
});
