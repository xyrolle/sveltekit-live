# sveltekit-live

Keep SvelteKit remote functions live across tabs and users, on Cloudflare Workers.

A command publishes what it changed. A query declares what it follows. A Durable Object per tenant sends each open screen a small hint: a kind, and the id of the one record it's about, never the data itself. A screen holding reads that follow the hint reads them again, in one request. A screen that missed a hint reads everything again, and one on an older build has Kit check for the newer one.

There's no sync engine, no client cache to keep consistent and no polling, just invalidation with the reads you already have. `docs/design.md` has the decisions and their reasons.

**Status:** first version. Not on npm yet.

## Install

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

**3. One command reads again:**

```ts
// src/lib/live.remote.ts
import { readAgainCommand } from "sveltekit-live/server";
import { followed } from "./live.ts";

export const readAgain = readAgainCommand(followed);
```

**4. Commands publish what they changed**, once the write has committed, to the hub of the tenant they changed:

```ts
// src/lib/todos.remote.ts
export const toggle = command(v.string(), async (id) => {
	await env.DB.prepare("update todos set done = 1 - done where id = ?")
		.bind(id)
		.run();
	await env.LIVE.getByName("board").publish([{ kind: "todo", id }]);
});
```

**5. A route takes the sockets.** It decides who the user is and which tenant's hub they hear, or refuses with Kit's `error()`:

```ts
// src/routes/live/+server.ts
export const GET: RequestHandler = ({ request, locals }) =>
	connect(request, { hub: env.LIVE.getByName("board"), user: locals.user });
```

**6. The root layout follows changes:**

```svelte
<script lang="ts">
	import { followChanges } from "sveltekit-live/client";
	import { readAgain } from "#lib/live.remote.ts";
	import { followed } from "#lib/live.ts";

	followChanges({ socket: "/live", followed, readAgain });
</script>
```

In the example, `pnpm build` and then `pnpm preview` (`wrangler dev`) run it.

## API

- **`follows(read, ...what)`** (`sveltekit-live`): what a remote query follows. Each of `what` is a kind, followed whole, or `{ kind, id }`, where `id(arg)` names the record that the query's argument shows.
- **`Hint`** (`sveltekit-live`): `{ kind: string; id?: string; userId?: string }`. A hint with a `userId` reaches only that user's sockets.
- **`readAgainCommand(followed)`** (`sveltekit-live/server`): the command that screens read again through. Each read refreshes through its own query and that query's checks; the command has no guard of its own.
- **`connect(request, { hub, user })`** (`sveltekit-live/server`): hands the socket to `hub`, for `user`. It answers 426 to a request that is no WebSocket upgrade, and 403 to one from another origin.
- **`followChanges({ socket, followed, readAgain })`** (`sveltekit-live/client`): called once, in the root layout. It opens one socket per tab, to the route at `socket`.
- **`LiveHub`** (`sveltekit-live/hub`): the Durable Object. `publish(hints)` sends them, numbered, to every socket on the hub.

## Limitations

- Nothing is live under `vite dev`, as Durable Objects exist only in the built Worker. Build, then run `wrangler dev`.
- Sockets are for browsers. `connect` refuses a request whose `Origin` is not the app's own, including one with no `Origin`.
- A hint without a `userId` reaches every socket on its hub: its kind and id are visible to every user connected there, as metadata, never data. Users who must not see each other's activity (staff and customers, say) belong on separate hubs, `` getByName(`${tenant}:staff`) ``, with each change published to every hub that should hear it.
- Access is checked once, at the handshake. A socket outlives the session it was opened under, until it closes.
- A change whose publication never happens (the Worker died after the commit) goes unnoticed, as no number was taken.
- The user id is the socket's one hibernation tag: at most 256 characters. A hub holds at most 32,768 sockets.
- A query missing from `followed` is not live, and nothing checks that the list is complete.
- The library has Kit check for a newer build, which turns Kit's `updated.current` true. Reloading is the app's decision, as only the app knows its unsaved drafts.

`docs/followups.md` lists what comes next.

## License

MIT
