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

Done when: a screen can name the reads it holds ahead, a hint drops them instead of reading them again, and a test shows the drop.

## Something live under `vite dev`

Durable Objects exist only in the built Worker, so under `vite dev` a tab sees its own changes only.

Done when: under `vite dev` a tab reads everything again when it is shown again, tested in the browser.

## The example on TypeScript 7

SvelteKit 3.1 reads `tsconfig.json` through TypeScript's JavaScript API, which TypeScript 7 does not have, and svelte-check needs it too. The example uses TypeScript 6; the library is checked with TypeScript 7.

Done when: `svelte-kit sync` and svelte-check run on TypeScript 7, and the example moves to it.
