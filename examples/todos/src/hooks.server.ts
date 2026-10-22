import type { Handle } from "@sveltejs/kit/hooks";

// Each browser is a user of its own, named by a cookie: the example has no
// sign-in. An app takes the user from its session instead.
export const handle: Handle = ({ event, resolve }) => {
	let user = event.cookies.get("user");
	if (!user) {
		user = crypto.randomUUID();
		event.cookies.set("user", user, { path: "/", sameSite: "lax" });
	}
	event.locals.user = user;
	return resolve(event);
};
