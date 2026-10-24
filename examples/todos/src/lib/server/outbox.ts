import { env } from "cloudflare:workers";
import type { Hint } from "sveltekit-live";
import { publish } from "sveltekit-live/server";

/**
 * Commits `change` and publishes `hints`, which tell of it. The hints are
 * kept in the outbox, in the transaction of the change, until the hub has
 * them: if the hub refuses them or the Worker dies before, the cron
 * publishes them (worker.js). The command succeeds either way, as its
 * change did.
 */
export async function commit(
	change: D1PreparedStatement,
	hints: Hint[],
): Promise<void> {
	const kept = crypto.randomUUID();
	await env.DB.batch([
		change,
		env.DB.prepare("insert into outbox (id, hints) values (?, ?)").bind(
			kept,
			JSON.stringify(hints),
		),
	]);
	try {
		await publish(env.LIVE.getByName("board"), hints);
	} catch (failure) {
		console.error(
			`Publishing the hints of outbox row ${kept} failed; the cron publishes them.`,
			failure,
		);
		return;
	}
	await env.DB.prepare("delete from outbox where id = ?").bind(kept).run();
}
