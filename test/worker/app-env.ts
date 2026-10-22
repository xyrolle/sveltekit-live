// Kit's `$app/env` exists only in a Vite build. The test Worker is bundled by
// Wrangler, so it gets this stand-in: a built Worker, naming its build.
export const dev = false;
export const version = "build-1";
