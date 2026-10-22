# sveltekit-live: contributor guide

sveltekit-live keeps SvelteKit remote functions live across tabs and users on Cloudflare Workers, by invalidation rather than sync.

## Design invariants
- **A hint never carries data.** It carries a kind, the id of the one record a change is about (for a record kind), and a user id for a person's own kind. Nothing else.
- **Mutations declare what they change (`changes`); queries declare what they follow (`follows`).** Nothing is wired by hand in a page.
- **One Durable Object per tenant numbers its publications in a series kept in its storage.** It greets each socket with where the series stands and the app's build. A screen that missed a number reads everything again. A screen on an older build learns of the new one through Kit's `updated`; the app reloads when its drafts allow.
- **Re-reads are batched into one request,** with one request in flight at a time. What failed is kept until the socket is back.
- **Never poll.**
- **Use SvelteKit's own refresh APIs.** No private internals.

## Testing
- **Runtime behaviour is tested in real workerd** (Wrangler's test harness): hibernation, ordering, and reconnects with missed numbers.
- **Browser behaviour is tested in a real browser,** with no fake sockets where the real one can run.

## Quality bar

The code is small, readable and maintainable by a stranger. Every line earns its place.

- **The smallest public API that covers the real use.** No option, flag, hook or extension point without a concrete user today. Adding one later is easy; removing one is a breaking change.
- **No abstraction without two real uses.** No factories, registries, plugin systems or generic layers "for later".
- **Short files, short functions and plain control flow.** A reader understands a function without scrolling or jumping between files.
- **Names say what a thing is in the domain.** No `utils`, `helpers` or `manager` dumping grounds.
- **No dead code, commented-out code or TODOs in `main`.** Open work goes in `docs/followups.md`.
- **Dependencies are a cost.** Runtime dependencies are the platform and the declared peer dependencies, nothing else, unless a review agrees otherwise.
- **Errors are typed and actionable.** A message says what went wrong and what to do; nothing is swallowed.
- **Tests are few, meaningful and readable.** Each one names a behaviour and fails for one reason. No generated matrices and no snapshot dumps.
- **Every change reaches `main` through a pull request, and nothing merges before review:**
  - one review for design, simplicity, soundness and clean code;
  - findings fixed first, as new commits on the PR branch;
  - then a rebase-merge, so the atomic commits land on `main` as they are.

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
