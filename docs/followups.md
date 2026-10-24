# Follow-ups

What the first version leaves out (`docs/design.md`), and what it found along the way.

## Close the sockets of a session that expired

A session that ends on its own (it expires) gives the app no moment to call `disconnect`: its screens hear hints (never data) until their sockets drop.

Done when: a socket closes once the session it was opened under has expired, with no call from the app, tested in workerd.

## Publish from code Vite doesn't build

`publish` imports `$app/env`, which only Vite resolves. Plain Worker code, such as a cron, a queue consumer or a Durable Object, is where an outbox drains, so the example's cron calls the hub itself (`worker.js`).

Done when: `publish`, or a sibling entry, runs from `worker.js`, and the example's cron uses it.

## Let go of what a screen read ahead

A screen that holds reads offscreen (the next week of a calendar) reads them again on every hint of their kind.

Kit 3.1's public API leaves no way to drop them instead:

- **An instance can't be dropped on demand.** It stays in Kit's cache while a proxy of it is reachable, or pinned by an effect or an await on it. Once none is, it goes only when the garbage collector finalizes the last proxy.
- **The follower can't leave them out.** `.updates(query)` asks the server for every cached instance of `query`, the ones read ahead among them. Leaving some out would mean naming each of the others, and only Kit's cache knows their arguments.
- **Having the server skip them would not help.** It would leave their answers in the cache, out of date, for the screen to show once it moves to them.

So the library waits for Kit rather than reaching into its cache. The likely shape, once Kit can: the app marks a read it holds ahead, and a hint drops those instances. They are read once, when shown, instead of on every hint.

Done when: Kit can drop a query instance, or leave chosen instances out of `.updates()`, through its public API, and then a screen can name the reads it holds ahead, a hint drops them, and a test shows the drop.

## The example on TypeScript 7

SvelteKit 3.1 reads `tsconfig.json` through TypeScript's JavaScript API, which TypeScript 7 does not have, and svelte-check needs it too. The example uses TypeScript 6; the library is checked with TypeScript 7.

Done when: `svelte-kit sync` and svelte-check run on TypeScript 7, and the example moves to it.
