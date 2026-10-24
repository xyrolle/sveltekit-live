// The Worker: the one adapter-cloudflare builds, the board's hub, and the cron
// that publishes what a command committed but did not get to publish
// (src/lib/server/outbox.ts).
import kit from "./.svelte-kit/kit-worker.js";

export { LiveHub } from "sveltekit-live/hub";

export default {
	...kit,
	async scheduled(_controller, env) {
		const { results } = await env.DB.prepare(
			"select id, hints from outbox",
		).all();
		for (const { id, hints } of results) {
			// Straight to the hub: `publish` is compiled with the app by Vite,
			// and Wrangler bundles this file.
			await env.LIVE.getByName("board").publish(JSON.parse(hints));
			await env.DB.prepare("delete from outbox where id = ?").bind(id).run();
		}
	},
};
