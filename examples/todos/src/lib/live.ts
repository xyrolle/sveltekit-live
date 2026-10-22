import { follows } from "sveltekit-live";
import { todo, todos } from "./todos.remote.ts";

/** The reads open screens keep live, and what each follows. */
export const followed = [
	follows(todos, "todos"),
	follows(todo, { kind: "todo", id: (id) => id }),
];
