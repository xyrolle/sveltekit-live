# Follow-ups

What the first version leaves out (`docs/design.md`), and what it found along the way.

## Let go of what a screen read ahead

A screen that holds reads offscreen (the next week of a calendar) reads them again on every hint of their kind.

Kit 3.1's public API leaves no way to drop them instead:

- **An instance can't be dropped on demand.** It stays in Kit's cache while a proxy of it is reachable, or pinned by an effect or an await on it. Once none is, it goes only when the garbage collector finalizes the last proxy.
- **The follower can't leave them out.** `.updates(query)` asks the server for every cached instance of `query`, the ones read ahead among them. Leaving some out would mean naming each of the others, and only Kit's cache knows their arguments.
- **Having the server skip them would not help.** It would leave their answers in the cache, out of date, for the screen to show once it moves to them.

So the library waits for Kit rather than reaching into its cache. The likely shape, once Kit can: the app marks a read it holds ahead, and a hint drops those instances. They are read once, when shown, instead of on every hint.

Done when: Kit can drop a query instance, or leave chosen instances out of `.updates()`, through its public API, and then a screen can name the reads it holds ahead, a hint drops them, and a test shows the drop.

## TypeScript 7 alone in the example

The example's types are checked by TypeScript 7: svelte-check takes it as `@typescript/native` (`--tsgo-experimental-api`). But `typescript` itself is still 6, as SvelteKit 3.1 reads `tsconfig.json` through TypeScript's JavaScript API, which 7.0 lacks, and svelte2tsx builds on that API too. svelte-check's maintainers declined to load TypeScript 6 under another name instead (sveltejs/language-tools#3063).

Done when: SvelteKit and svelte2tsx run on TypeScript 7.1's API, and the example drops `typescript` 6 and the alias.
