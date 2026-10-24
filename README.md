# sveltekit-live

Keep SvelteKit remote functions live across tabs and users, on Cloudflare Workers.

A command publishes what it changed. A query declares what it follows. A Durable Object per tenant sends each open screen a small hint: a kind, and the id of the one record it's about, never the data itself. A screen holding reads that follow the hint reads them again, in one request. A screen that missed a hint reads everything again, and one on an older build has Kit check for the newer one.

There's no sync engine, no client cache to keep consistent and no polling, just invalidation with the reads you already have. `docs/design.md` has the decisions and their reasons.

**Status:** first version.

## Install

It's not on npm yet. Installed from GitHub, it builds itself, which pnpm runs only once the app allows it: add the key pnpm prints to `allowBuilds` in `pnpm-workspace.yaml`, then install again.

```sh
pnpm add github:xyrolle/sveltekit-live
```

It needs:

- SvelteKit 3.1 or later with `experimental.remoteFunctions` (remote functions are still experimental in Kit), and Svelte 5;
- `@sveltejs/adapter-cloudflare`, and a Workers compatibility date of 2026-04-07 or later.

## Usage

`examples/todos` is a complete app. Its pieces:

**1. The Worker exports the hub.** adapter-cloudflare has no option for a Worker's other exports. So the adapter reads a config of its own (`wrangler.kit.jsonc`, with `main: ".svelte-kit/kit-worker.js"`), and Wrangler runs an entry that adds the hub to that Worker:

```js
// worker.js
export { LiveHub } from "sveltekit-live/hub";
export { default } from "./.svelte-kit/kit-worker.js";
```

```jsonc
// wrangler.jsonc
"main": "worker.js",
"durable_objects": { "bindings": [{ "name": "LIVE", "class_name": "LiveHub" }] },
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["LiveHub"] }]
```

**2. Reads declare what they follow**, in one module that the browser and the server both import:

```ts
// src/lib/live.ts
import { follows } from "sveltekit-live";
import { todo, todos } from "./todos.remote.ts";

export const followed = [
	follows(todos, "todos"),
	follows(todo, { kind: "todo", id: (id) => id }),
];
```

`todos` is read again after any hint of kind `todos`. `todo(id)` is read again after a hint of kind `todo` that names its id, or that names none.

The kinds are declared once, in `src/app.d.ts`. A kind that is not declared then fails the typecheck, in `follows` and in `publish` alike. An app that declares none takes any string as a kind.

```ts
// src/app.d.ts
declare module "sveltekit-live" {
	interface Register {
		kind: "todos" | "todo";
	}
}
```

**3. One command reads again:**

```ts
// src/lib/live.remote.ts
import { readAgainCommand } from "sveltekit-live/server";
import { followed } from "./live.ts";

export const readAgain = readAgainCommand(followed);
```

**4. Commands publish what they changed.** A command refreshes its own screen's reads as any Kit command does; `publish` tells everyone else, once the write has committed, through the hub of the tenant it changed. A Worker can die between the commit and the publication, and no screen would learn of the change. So the hints go in an outbox, in the transaction of the change, until the hub has them:

```ts
// src/lib/server/outbox.ts
export async function commit(change: D1PreparedStatement, hints: Hint[]) {
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
```

```ts
// src/lib/todos.remote.ts
export const toggle = command(v.string(), async (id) => {
	await commit(
		env.DB.prepare("update todos set done = 1 - done where id = ?").bind(id),
		[{ kind: "todo", id }],
	);
	await todo(id).refresh();
});
```

A command whose publication fails still succeeds, as its change did: the hints wait in the outbox. A Cron Trigger, every minute, publishes what the outbox holds, whether the hub refused it or the Worker died. It calls the hub itself, as `publish` is compiled with the app by Vite and Wrangler bundles the Worker's entry. A publication sent twice (the Worker died after the hub had it) costs each screen one more read.

```js
// worker.js
import kit from "./.svelte-kit/kit-worker.js";

export { LiveHub } from "sveltekit-live/hub";

export default {
	...kit,
	async scheduled(_controller, env) {
		const { results } = await env.DB.prepare(
			"select id, hints from outbox",
		).all();
		for (const { id, hints } of results) {
			await env.LIVE.getByName("board").publish(JSON.parse(hints));
			await env.DB.prepare("delete from outbox where id = ?").bind(id).run();
		}
	},
};
```

The screen that ran the command hears its own hint too, and reads the change once more.

**5. A route takes the sockets.** It decides who the user is and which tenant's hub they hear, or refuses with Kit's `error()`:

```ts
// src/routes/live/+server.ts
export const GET: RequestHandler = ({ request, locals }) =>
	connect(request, { hub: env.LIVE.getByName("board"), user: locals.user });
```

When a user loses access (they signed out, or were removed), the app closes their sockets on every hub they hear. Each of their screens reconnects, and the route admits again only those it still would:

```ts
await disconnect(env.LIVE.getByName(tenant), user);
```

**6. The root layout follows changes,** and says when the screen may be out of date:

```svelte
<script lang="ts">
	import { followChanges } from "sveltekit-live/client";
	import { readAgain } from "#lib/live.remote.ts";
	import { followed } from "#lib/live.ts";

	const live = followChanges({ socket: "/live", followed, readAgain });
</script>

{#if live.staleSince}
	<p role="status">
		This may be out of date since {live.staleSince.toLocaleTimeString()}.
		<button type="button" onclick={() => live.retry()}>Retry</button>
	</p>
{/if}
```

The screen may be out of date from the moment its socket is lost or a read fails, until the socket is back and the reads it calls for have landed. `staleSince` says so only once that has lasted 15 s, so a blip says nothing.

A read that fails on the server is read again with the next hint of its kind, or once the socket is back. Kit keeps its last answer in `.current` meanwhile, and the example shows that answer rather than awaiting the failed read again:

```svelte
<!-- src/routes/Todo.svelte -->
<script lang="ts">
	const read = $derived(todo(id));
	const item = $derived(read.current ?? (await read));
</script>
```

**7. Pages run their commands in turn.** A command that also refreshes its own screen's reads goes through `inTurn`, which runs it after the follower's read on its way, and holds the follower's next read until it lands. Kit keeps whichever command's answer lands last, so without it an older read-again could land over the command's newer answer. Pages wire nothing for reads.

```svelte
<!-- src/routes/Todo.svelte -->
<input type="checkbox" checked={item.done} onchange={() => inTurn(() => toggle(id))} />
```

In the example, `pnpm dev` runs it under Vite, where a tab sees another's changes once it is shown again. `pnpm build` and then `pnpm preview` (`wrangler dev`) run it live across tabs.

## API

- **`follows(read, ...what)`** (`sveltekit-live`): what a remote query follows. Each of `what` is a kind, followed whole, or `{ kind, id }`, where `id(arg)` names the record that the query's argument shows.
- **`Hint`** (`sveltekit-live`): `{ kind; id?: string; userId?: string }`, its `kind` one of the app's kinds. A hint with a `userId` reaches only that user's sockets.
- **`Register`** (`sveltekit-live`): what the app's `app.d.ts` declares: `kind`, the union of its kinds. Undeclared, a kind is any string.
- **`publish(hub, hints)`** (`sveltekit-live/server`): sends the hints, numbered, to every socket on `hub`. Under `vite dev` it does nothing.
- **`readAgainCommand(followed)`** (`sveltekit-live/server`): the command that screens read again through. Each read refreshes through its own query and that query's checks; the command has no guard of its own. It answers with the kinds and records of the reads that failed, which the screen keeps to read again. A refusal (4xx) is a read's own answer, not a failure.
- **`connect(request, { hub, user })`** (`sveltekit-live/server`): hands the socket to `hub`, for `user`. It answers 426 to a request that is no WebSocket upgrade, and 403 to one from another origin.
- **`disconnect(hub, user)`** (`sveltekit-live/server`): closes every socket of `user` on `hub`: none of them hears anything more. Each screen reconnects, and one the socket route refuses keeps retrying, as after any lost connection. Under `vite dev` it does nothing.
- **`followChanges({ socket, followed, readAgain })`** (`sveltekit-live/client`): called once, in the root layout. It opens one socket per tab, to the route at `socket`, and answers with the screen's `Freshness`. Under `vite dev` it opens none, and reads everything again whenever the tab is shown again.
- **`Freshness`** (`sveltekit-live/client`): `staleSince`, since when the screen may be out of date, once that has lasted 15 s, or `undefined` while it is current (reactive); and `retry()`, which reconnects at once if the socket is down and reads again what failed. Under `vite dev` it is always current.
- **`inTurn(work)`** (`sveltekit-live/client`): runs a command after the follower's read on its way, and holds the follower's next read until it lands. It waits for that read 15 s at most. Before the root layout has mounted the follower, it runs the command at once.
- **`LiveHub`** (`sveltekit-live/hub`): the Durable Object that holds a tenant's sockets.

## Limitations

- Changes from other tabs and users reach a screen as they happen only in the built Worker: under `vite dev` there are no Durable Objects, so `publish` does nothing and a screen reads everything again when it is shown again. Build, then run `wrangler dev`.
- Sockets are for browsers. `connect` refuses a request whose `Origin` is not the app's own, including one with no `Origin`.
- A hint without a `userId` reaches every socket on its hub: its kind and id are visible to every user connected there, as metadata, never data. Users who must not see each other's activity (staff and customers, say) belong on separate hubs, `` getByName(`${tenant}:staff`) ``, with each change published to every hub that should hear it.
- Access is checked at the handshake, and again when the app disconnects a user. A session that expires on its own gives the app no moment to call `disconnect`: its screens hear hints (never data) until their sockets drop.
- A command that publishes without an outbox (step 4) loses its change's hints if the Worker dies after the commit, and nothing notices, as no number was taken.
- The user id is the socket's one hibernation tag: at most 256 characters. A hub holds at most 32,768 sockets.
- A query missing from `followed` is not live, and nothing checks that the list is complete.
- The library has Kit check for a newer build, which turns Kit's `updated.current` true. Reloading is the app's decision, as only the app knows its unsaved drafts.

`docs/followups.md` lists what comes next.

## License

MIT
