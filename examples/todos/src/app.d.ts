declare global {
	namespace App {
		interface Locals {
			/** Who this browser is: the example has no sign-in (hooks.server.ts). */
			user: string;
		}
	}
}

// The kinds the example's hints name (src/lib/live.ts, src/lib/todos.remote.ts).
declare module "sveltekit-live" {
	interface Register {
		kind: "todos" | "todo";
	}
}

export {};
