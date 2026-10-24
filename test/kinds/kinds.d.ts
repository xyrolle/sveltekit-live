// The app's kinds, as it declares them in its app.d.ts.
declare module "sveltekit-live" {
	interface Register {
		kind: "todos" | "todo";
	}
}

export {};
