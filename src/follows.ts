import type { RemoteQuery } from "$app/server";
import type { Kind } from "./hint.ts";

/** What a read follows of a kind: only the change to the record its argument names (`id`). */
type ByRecord<Arg> = { kind: Kind; id: (arg: Arg) => string };

/**
 * A read that open screens keep live, and what it follows. Made by
 * `follows`. Its functions are declared as methods, whose parameters
 * TypeScript compares both ways, so reads of every argument fit one list.
 */
export type Followed = {
	read(arg: unknown): RemoteQuery<unknown>;
	follows: readonly (Kind | { kind: Kind; id(arg: unknown): string })[];
};

/** A remote query, whatever its argument. */
type Query = (arg: never) => RemoteQuery<unknown>;

/** The argument a query is asked with. */
type ArgOf<Read extends Query> = Parameters<Read>[0];

/**
 * Declares what a remote query follows: every change of a kind, or only the
 * change to the record its argument names. The app lists its live reads in one
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
	// Spelled out, not aliased, so that an error names the app's kinds.
	...what: [Kind | ByRecord<ArgOf<Read>>, ...(Kind | ByRecord<ArgOf<Read>>)[]]
): Followed {
	return { read, follows: what };
}
