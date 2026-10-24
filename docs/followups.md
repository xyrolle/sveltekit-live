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

## TypeScript 7 alone in the example

The example's types are checked by TypeScript 7: svelte-check takes it as `@typescript/native` (`--tsgo-experimental-api`). But `typescript` itself is still 6, as SvelteKit 3.1 reads `tsconfig.json` through TypeScript's JavaScript API, which 7.0 lacks, and svelte2tsx builds on that API too. svelte-check's maintainers declined to load TypeScript 6 under another name instead (sveltejs/language-tools#3063).

Done when: SvelteKit and svelte2tsx run on TypeScript 7.1's API, and the example drops `typescript` 6 and the alias.
