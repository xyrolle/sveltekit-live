declare global {
	namespace App {
		interface Locals {
			/** Who this browser is: the example has no sign-in (hooks.server.ts). */
			user: string;
		}
	}
}

export {};
