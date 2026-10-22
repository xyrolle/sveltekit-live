# Design

Open screens learn that something changed and read it again through the app's own remote queries. The server sends names of what changed, never data.

## Shape

```ts
// src/lib/live.ts: which reads follow which kinds (imported by browser and server)
import { follows } from "sveltekit-live";
import { list, item } from "./todos.remote.ts";

export const followed = [
	follows(list, "todo"),
	follows(item, { kind: "todo", id: (arg) => arg.id }),
];
```

```ts
// src/lib/live.remote.ts: the one command that reads again
import { readAgainCommand } from "sveltekit-live/server";
import { followed } from "./live.ts";

export const readAgain = readAgainCommand(followed);
```

```ts
// src/routes/todos.remote.ts: a command says what it changed once its write commits
export const add = command(v.string(), async (text) => {
	const { tenant } = await signedIn();
	const id = await insertTodo(tenant, text);
	await publish(env.LIVE.getByName(tenant), [{ kind: "todo", id }]);
});
```

```ts
// src/routes/live/+server.ts: who may open a socket, and to which tenant's hub
export const GET: RequestHandler = async ({ request, locals }) => {
	const { tenant, user } = signedIn(locals);
	return connect(request, { hub: env.LIVE.getByName(tenant), user });
};
```

```svelte
<!-- src/routes/+layout.svelte: one follower per tab -->
<script>
	import { followChanges } from "sveltekit-live/client";
	import { followed } from "#lib/live.ts";
	import { readAgain } from "#lib/live.remote.ts";

	followChanges({ socket: "/live", followed, readAgain });
</script>
```

The Worker entry exports `LiveHub` from `sveltekit-live/hub`, bound as a Durable Object (`env.LIVE`).

Public API: `follows`, `readAgainCommand`, `connect`, `publish`, `followChanges`, `LiveHub`, and the `Hint` type.

## Decisions

### A hint names what changed, never what it is now

`{ kind, id?, userId? }`: a kind the app names, the id of the one record a change is about, and the user whose screens alone should hear it. Every read goes through the app's own queries and whatever checks they make, so a hint at the wrong screen reveals only that something of a kind changed. There is no second permission layer and no client cache to keep consistent.

### Reads declare what they follow in one list

Kit replaces a remote module with stubs in the browser and allows only remote functions as its exports. A declaration beside the query cannot reach the browser without code generation, and both sides need it:

- the browser, to send with `.updates()` only the reads that follow a kind it was told;
- the server, to decide for each instance the browser holds (`requested()`) whether its argument names a record it was told.

So the app lists them in one module both sides import. A read that follows one record names it with a function of its argument, `{ kind, id: (arg) => arg.id }`, typed by the query. A function, not a field name, because many queries take the id itself (`getPost(slug)`). A query missing from the list is simply not live.

Rejected: a Vite plugin or code generation (the source app generates the list from its own procedure builder). A list is less machinery and reads like a route table.

### A command publishes what it changed

The command calls `publish(hub, hints)` with its tenant's hub after its write commits, a Durable Object RPC. A `changes()` wrapper around the handler was rejected: it would need the tenant, which only the handler knows, and a new record's id exists only after the write.

A hint for a write that rolled back costs one re-read. A hint never published (the Worker died between commit and publish) is lost, and nothing notices, as no number was taken. Publishing from an outbox fixes that and is the app's (follow-up).

### One hub per tenant, numbering its publications

- The app picks the tenant: it passes the stub (`getByName(tenant)`) to `connect` and calls `publish` on it. The library never sees a tenant id.
- The hub holds its sockets with the WebSocket Hibernation API and answers pings without waking, so an idle tenant costs nothing.
- It keeps a series id and the number of its last publication in its storage, so both survive eviction and deploys. Each publication is `{ n, hints }`, and every socket gets every number, even with none of its hints, so a screen can tell when it missed one.
- **Who hears what.** `connect` hands the hub the user the app names, and the hub tags the socket with it. A hint with `userId` reaches only that user's sockets; the others get the number with no hints. Every other hint reaches every socket on the hub: its kind and id are visible to every user connected there, as metadata, never data. An app whose users must not see each other's activity (staff and customers, say) uses one hub per audience, `` getByName(`${tenant}:staff`) ``, and publishes to each that should hear.
- On each socket it takes, it says hello: `{ series, n, version }`. `version` is the build of the Worker that served the handshake: Kit's `version` from `$app/env` (the app's `version.name`, a timestamp of the build by default), which `connect` reads there and passes to the hub with the upgrade. The browser compares it with its own `version` from the same module.
- The hub authorizes nothing. Sockets reach it only through `connect`; publications only through the app's binding.

### The socket route

The app's own `GET` handler decides who the user is and which hub they hear, or refuses with Kit's `error()`, then calls `connect(request, { hub, user })`. It refuses a request that is not an upgrade (426) or comes from another origin (403: a browser sends cookies with a WebSocket handshake to any site and applies no CORS to it), and forwards the upgrade with the user and Kit's `version`.

Rejected: `connect(authorize)` returning the handler. The callback did nothing the app's handler does not, and keeping Kit's full `RequestEvent` in it took a generic.

Access is checked once, at the handshake. A socket outlives the session it was opened under until it closes; until then it hears hints, but no data (follow-up).

### The follower

- `followChanges()` is called once in the root layout and opens one socket per tab.
- **First hello:** the screen reads everything once. What was published between the page's render and the socket's acceptance reached no one, and nothing orders the two.
- **Later hello (a reconnect):** if the series or the number moved on, it reads everything; otherwise nothing was missed.
- **A publication whose number is not the last plus one:** it reads everything.
- **One request:** the hints of a task are gathered and read in one `readAgain(told).updates(...reads)`, with only the reads that follow a told kind. Kit sends every instance of them the screen holds, with its argument. The server refreshes the instances that heard a hint and ignores the others, which keep their answers.
- **One request at a time:** what is told while one is on its way waits until it has landed and 500 ms have passed since it was sent. A burst costs two reads at most, however fast they answer.
- **Failures are kept:** a request that fails keeps what it was told, to be read with the next hint or once the socket is back. Nothing retries on a timer, and nothing polls.
- **Liveness:** it pings every 30 s and gives the socket up when no pong comes within 10 s; it reconnects after 1 s, doubling to 30 s, with jitter.
- **An older build:** when hello's version is not this tab's, it calls Kit's `updated.check()`. The reload is the app's, because only the app knows its drafts; Kit's documented `beforeNavigate` pattern loads the new build at the next navigation.

### The read-again command

`readAgainCommand(followed)` is a plain Kit `command`. It has no guard of its own: each read is refreshed through its own query and that query's checks. Its input is checked by hand, as the library takes no schema dependency: each kind maps to `true` or to at most 100 ids, past which the browser reads the kind whole.

### Development

Durable Objects run only in the built Worker; adapter-cloudflare's `vite dev` has none. So under `vite dev`, `publish` and `followChanges()` do nothing; `wrangler dev` on the build runs the real path.

### Packaging

`sveltekit-live/server` and `/client` import `$app/*`, so the package is a SvelteKit library compiled with the app through Vite. `sveltekit-live/hub` imports only `cloudflare:workers`, as Wrangler bundles the Worker entry outside Vite. Peer dependencies: `@sveltejs/kit` and `svelte`.

Kit's remote functions are still experimental, so the app enables `experimental.remoteFunctions`.

## Left out of the first version

What the source app does beyond this core goes in `docs/followups.md`:

- closing the sockets of a session that ended or a user who lost access;
- an outbox, so a committed change is always published;
- a stale notice with Retry while the socket is down or a read failed;
- re-reading a read whose own refresh failed on the server, beside its command that succeeded;
- one ordered line shared by the follower and the page's own refreshes;
- dropping data a screen read ahead (the next week) instead of reading it again;
- re-reading when a tab is shown again under `vite dev`;
- typed kinds declared once by the app.
