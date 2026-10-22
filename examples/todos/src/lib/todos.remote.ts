import { env } from "cloudflare:workers";
import { error } from "@sveltejs/kit";
import { publish } from "sveltekit-live/server";
import * as v from "valibot";
import { command, query } from "$app/server";

type Row = { id: string; text: string; done: number };

/** The ids of the board's todos, oldest first. */
export const todos = query(async () => {
	const { results } = await env.DB.prepare(
		"select id from todos order by created",
	).all<Pick<Row, "id">>();
	return results.map(({ id }) => id);
});

/** One todo, by its id. */
export const todo = query(v.string(), async (id) => {
	const row = await env.DB.prepare(
		"select id, text, done from todos where id = ?",
	)
		.bind(id)
		.first<Row>();
	if (!row) error(404, "No such todo.");
	return { id: row.id, text: row.text, done: row.done === 1 };
});

// Each command tells the board's open screens what it changed, once its
// write has committed. The example has one board; an app with tenants names
// the hub of the tenant it changed.

export const add = command(
	v.pipe(v.string(), v.trim(), v.nonEmpty()),
	async (text) => {
		await env.DB.prepare(
			"insert into todos (id, text, created) values (?, ?, ?)",
		)
			.bind(crypto.randomUUID(), text, Date.now())
			.run();
		await publish(env.LIVE.getByName("board"), [{ kind: "todos" }]);
	},
);

export const toggle = command(v.string(), async (id) => {
	await env.DB.prepare("update todos set done = 1 - done where id = ?")
		.bind(id)
		.run();
	await publish(env.LIVE.getByName("board"), [{ kind: "todo", id }]);
});
