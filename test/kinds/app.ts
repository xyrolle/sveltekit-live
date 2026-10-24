// An app's live reads and a command's publication, with kinds misspelled.

import { follows } from "sveltekit-live";
import type { LiveHub } from "sveltekit-live/hub";
import { publish } from "sveltekit-live/server";
import type { RemoteQuery } from "$app/server";

declare const todos: () => RemoteQuery<string[]>;
declare const todo: (id: string) => RemoteQuery<{ text: string }>;
declare const hub: DurableObjectStub<LiveHub>;

export const followed: unknown = [
	follows(todos, "todoz"),
	follows(todo, { kind: "tod", id: (id) => id }),
];
await publish(hub, [{ kind: "todoz" }]);
