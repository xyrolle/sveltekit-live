import { env } from "cloudflare:workers";
import { error } from "@sveltejs/kit";
import * as v from "valibot";
import { command, query } from "$app/server";
import { commit } from "./server/outbox.ts";

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

// Each command commits its write with the hints that tell the board's other
// screens of it (#lib/server/outbox.ts), and refreshes what it changed for its
// own screen, as any Kit command does. The example has one board; an app with
// tenants publishes to the hub of the tenant it changed.

export const add = command(
	v.pipe(v.string(), v.trim(), v.nonEmpty()),
	async (text) => {
		await commit(
			env.DB.prepare(
				"insert into todos (id, text, created) values (?, ?, ?)",
			).bind(crypto.randomUUID(), text, Date.now()),
			[{ kind: "todos" }],
		);
		await todos().refresh();
	},
);

export const toggle = command(v.string(), async (id) => {
	await commit(
		env.DB.prepare("update todos set done = 1 - done where id = ?").bind(id),
		[{ kind: "todo", id }],
	);
	await todo(id).refresh();
});
