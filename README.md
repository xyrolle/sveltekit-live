# sveltekit-live

Keep SvelteKit remote functions live across tabs and users, on Cloudflare Workers.

A mutation declares what it changes. A query declares what it follows. When a change commits, a Durable Object per tenant sends a small hint to every open screen: a kind, and the id of the one record it's about, never the data itself. Screens that follow that kind read again, batched into one request. Screens that missed a hint read everything again, and an outdated build reloads once no draft would be lost.

There's no sync engine, no client cache to keep consistent and no polling, just invalidation with reads you already have.

**Status:** being extracted from a production SvelteKit app on Cloudflare Workers. The code and the first release are coming.

## License

MIT
