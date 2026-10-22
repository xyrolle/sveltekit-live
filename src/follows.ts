import type { RemoteQuery } from "$app/server";

/**
 * What a read follows: every change of a kind, or only the change to the
 * record of a kind that its argument names (`id`).
 */
export type Follow<Arg> = string | { kind: string; id: (arg: Arg) => string };

/**
 * A read that open screens keep live, and what it follows. Made by
 * `follows`. Its functions are declared as methods, whose parameters
 * TypeScript compares both ways, so reads of every argument fit one list.
 */
export type Followed = {
	read(arg: unknown): RemoteQuery<unknown>;
	follows: readonly (string | { kind: string; id(arg: unknown): string })[];
};

/** A remote query, whatever its argument. */
type Query = (arg: never) => RemoteQuery<unknown>;

/** The argument a query is asked with. */
type ArgOf<Read extends Query> = Parameters<Read>[0];

/**
 * Declares what a remote query follows. The app lists its live reads in one
 * module that the browser and the server both import:
 *
 *     export const followed = [
 *       follows(list, "todo"),
 *       follows(item, { kind: "todo", id: (arg) => arg.id }),
 *     ];
 *
 * `list` is read again after any change of a todo; `item` only after a
 * change to the todo it shows, or one that named no record.
 */
export function follows<Read extends Query>(
	read: Read,
	...what: [Follow<ArgOf<Read>>, ...Follow<ArgOf<Read>>[]]
): Followed {
	return { read, follows: what };
}
