import adapter from "@sveltejs/adapter-cloudflare";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter({
				config: "wrangler.kit.jsonc",
				// `vite dev` gets the bindings the Worker has.
				platformProxy: { configPath: "wrangler.jsonc" },
			}),
			experimental: { remoteFunctions: true },
			compilerOptions: { experimental: { async: true } },
		}),
	],
});
