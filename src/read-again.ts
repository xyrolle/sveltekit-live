import { error } from "@sveltejs/kit";
import { command, type RemoteCommand, requested } from "$app/server";
import type { Followed } from "./follows.ts";
import { TOLD_AT_MOST, type Told } from "./hint.ts";

/** What a screen was told, checked: each kind whole (`true`), or the records named. */
type Heard = Map<string, true | Set<string>>;

/**
 * The one command through which open screens read again what they were
 * told. The app exports it from a remote module:
 *
 *     export const readAgain = readAgainCommand(followed);
 *
 * A screen sends what it was told, and Kit sends along every instance it
 * holds of the reads that follow it, with its argument. Each instance that
 * heard a hint is refreshed through its own query, with whatever checks the
 * query makes; the others keep their answers. The command has no guard of
 * its own, as it reads nothing itself.
 */
export function readAgainCommand(
	followed: readonly Followed[],
): RemoteCommand<Told, void> {
	return command("unchecked", async (told: Told) => {
		const heard = heardOf(told);
		for (const { read, follows } of followed) {
			// Asynchronous, as a query's schema may validate its argument so.
			for await (const { arg, query, ignore } of requested(read, Infinity)) {
				if (follows.some((follow) => isHeard(follow, heard, arg))) {
					// Kit awaits the refresh and sends it with the command's answer.
					void query.refresh();
				} else {
					ignore();
				}
			}
		}
	});
}

function isHeard(
	follow: Followed["follows"][number],
	heard: Heard,
	arg: unknown,
): boolean {
	if (typeof follow === "string") return heard.has(follow);
	const ids = heard.get(follow.kind);
	return ids === true || (ids?.has(follow.id(arg)) ?? false);
}

/** Checks what a screen says it was told, as the command takes it unchecked. */
function heardOf(told: unknown): Heard {
	if (typeof told !== "object" || told === null) {
		error(400, "readAgain expects what the screen was told, by kind.");
	}
	const heard: Heard = new Map();
	const kinds: [string, unknown][] = Object.entries(told);
	for (const [kind, ids] of kinds) {
		const named = ids === true || namedIds(ids);
		if (!named) {
			error(
				400,
				`readAgain expects true or at most ${TOLD_AT_MOST} ids for "${kind}".`,
			);
		}
		heard.set(kind, named);
	}
	return heard;
}

function namedIds(ids: unknown): Set<string> | undefined {
	if (!Array.isArray(ids) || ids.length > TOLD_AT_MOST) return undefined;
	const named: unknown[] = ids;
	return named.every((id) => typeof id === "string")
		? new Set(named)
		: undefined;
}
