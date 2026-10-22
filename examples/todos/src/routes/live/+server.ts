import { env } from "cloudflare:workers";
import { connect } from "sveltekit-live/server";
import type { RequestHandler } from "./$types";

// Where each screen opens its socket. An app checks the session here, and
// refuses with Kit's `error()` whoever may not hear the board.
export const GET: RequestHandler = ({ request, locals }) =>
	connect(request, { hub: env.LIVE.getByName("board"), user: locals.user });
