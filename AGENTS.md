# sveltekit-live: contributor guide

sveltekit-live keeps SvelteKit remote functions live across tabs and users on Cloudflare Workers, by invalidation rather than sync.

## Design invariants
- **A hint never carries data.** It carries a kind, the id of the one record a change is about (for a record kind), and a user id for a person's own kind. Nothing else.
- **Mutations declare what they change (`changes`); queries declare what they follow (`follows`).** Nothing is wired by hand in a page.
- **One Durable Object per tenant numbers its publications in a series kept in its storage.** It greets each socket with where the series stands and the app's build. A screen that missed a number reads everything again. A screen on an older build reloads once no draft would lose a change.
- **Re-reads are batched into one request,** with one request in flight at a time. What failed is kept until the socket is back.
- **Never poll.**
- **Use SvelteKit's own refresh APIs.** No private internals.

## Testing
- **Runtime behaviour is tested in real workerd** (Wrangler's test harness): hibernation, ordering, and reconnects with missed numbers.
- **Browser behaviour is tested in a real browser,** with no fake sockets where the real one can run.

## Working rules

### Commits and pull requests
- Every commit message is a single-line title with a conventional prefix (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`). No body, no bullet points.
- One cause per commit. A commit carries the test that proves it: red before, green after.
- No `Co-Authored-By` trailer and no AI or tool attribution, in commits, pull request titles or descriptions.
- Never force push a shared branch. Changes after review go in as new commits.
- A pull request description says what was wrong, the cause, what changed and how it was tested. Short, plain, and true to the code as it stands.

### Code
- The smallest change at the cause. Weigh the alternatives and pick the simplest one that fully solves the problem.
- No `as any`, no casts, no `@ts-ignore`/`@ts-expect-error` and no avoidable `!`. Model the type instead.
- Code reads at a glance. A chain that needs a comment becomes a named constant or a small named function. Comments say why, never what.
- No legacy or compatibility code. Delete what you replace in the same change; no fallbacks "for old callers", no aliases.
- Public API changes are deliberate. Every exported name is documented and tested.

### Tests
- Tests exercise the real thing (see the testing section below). No mocks where the real dependency can run.
- A test creates the data it needs and leaves nothing behind.
- No timing sleeps. Wait for an observable condition.

### Tooling
- pnpm only, with the version pinned in `packageManager`. Node 24 LTS.
- The latest stable, fastest tooling: Biome (lint and format), Vitest, and TypeScript 7 (`tsgo`) for type checking.
- `pnpm check`, `pnpm typecheck` and `pnpm test` all pass before a push.

### Docs
- Docs record decisions and their reasons, not implementation retellings.
- Open follow-ups go in `docs/followups.md`, each with "done when"; delete an entry in the change that resolves it.
