# Follow-ups

What the first version leaves out (`docs/design.md`), and what it found along the way.

## Close the sockets of a session that expired

A session that ends on its own (it expires) gives the app no moment to call `disconnect`: its screens hear hints (never data) until their sockets drop.

Done when: a socket closes once the session it was opened under has expired, with no call from the app, tested in workerd.

## Publish from code Vite doesn't build

`publish` imports `$app/env`, which only Vite resolves. Plain Worker code, such as a cron, a queue consumer or a Durable Object, is where an outbox drains, so the example's cron calls the hub itself (`worker.js`).

Done when: `publish`, or a sibling entry, runs from `worker.js`, and the example's cron uses it.

## Say when a screen may be stale

While the socket is down, or after a read-again failed, a screen shows what it read last and does not say so.

Done when: `followChanges` exposes whether the screen may be out of date and since when, with a Retry, and the example shows it.

## Read again a read whose own refresh failed

A read-again command that succeeds can carry a read whose refresh failed on the server. That read shows its error until a hint of its kind comes.

Done when: `readAgain` answers with the kinds of the reads that failed, the follower keeps them as it keeps a failed command, and a browser test shows the read recover once the socket is back.

## Bound a read-again that never answers

One read-again is on its way at a time. A request the network holds without an answer holds every read after it.

Done when: a read-again with no answer within a bound lets the next one go, and the late answer cannot replace a newer one, tested in the browser.

## Keep a page's own refreshes in line with the follower's

A page that refreshes a read itself while the follower's read-again is on its way can show the older answer until the next hint.

Done when: the two cannot land out of order, tested in the browser.

## Let go of what a screen read ahead

A screen that holds reads offscreen (the next week of a calendar) reads them again on every hint of their kind.

Done when: a screen can name the reads it holds ahead, a hint drops them instead of reading them again, and a test shows the drop.

## Something live under `vite dev`

Durable Objects exist only in the built Worker, so under `vite dev` a tab sees its own changes only.

Done when: under `vite dev` a tab reads everything again when it is shown again, tested in the browser.

## The example on TypeScript 7

SvelteKit 3.1 reads `tsconfig.json` through TypeScript's JavaScript API, which TypeScript 7 does not have, and svelte-check needs it too. The example uses TypeScript 6; the library is checked with TypeScript 7.

Done when: `svelte-kit sync` and svelte-check run on TypeScript 7, and the example moves to it.
