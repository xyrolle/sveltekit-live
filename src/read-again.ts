import { error, isHttpError } from "@sveltejs/kit";
import { command, type RemoteCommand, requested } from "$app/server";
import type { Followed } from "./follows.ts";
import { type Heard, TOLD_AT_MOST, type Told, toldOf } from "./hint.ts";

/** One thing a read follows. */
type Follow = Followed["follows"][number];

/**
 * The one command through which open screens read again what they were
 * told. The app exports it from a remote module:
 *
 *     export const readAgain = readAgainCommand(followed);
 *
 * A screen sends what it was told, and Kit sends along every instance it
 * holds of the reads that follow it, with its argument. Each instance that
 * heard a hint is refreshed through its own query, with whatever checks the
 * query makes; the others keep their answers. The command answers with what
 * it could not read in: the kinds, or records, of the reads that failed. It
 * has no guard of its own, as it reads nothing itself.
 */
export function readAgainCommand(
	followed: readonly Followed[],
): RemoteCommand<Told, Told> {
	return command("unchecked", async (told: Told) => {
		const heard = heardOf(told);
		const unread: Heard = new Map();
		const reads: Promise<unknown>[] = [];
		for (const { read, follows } of followed) {
			// Asynchronous, as a query's schema may validate its argument so.
			for await (const { arg, query, ignore } of requested(read, Infinity)) {
				const hearing = follows.filter((follow) => isHeard(follow, heard, arg));
				if (hearing.length === 0) {
					ignore();
					continue;
				}
				void query.refresh();
				// Awaited here, to learn whether it failed; Kit sends this same
				// answer with the command's.
				reads.push(
					query.catch((failure: unknown) => {
						if (isAnswer(failure)) return;
						for (const follow of hearing) keep(unread, follow, arg);
					}),
				);
			}
		}
		await Promise.all(reads);
		return toldOf(unread);
	});
}

/** A refusal (4xx) is the read's own answer, such as a record since deleted, not a failure. */
const isAnswer = (failure: unknown): boolean =>
	isHttpError(failure) && failure.status < 500;

/** Keeps what a failed read of `arg` heard, to be read again: its kind whole, or its record. */
function keep(unread: Heard, follow: Follow, arg: unknown): void {
	if (typeof follow === "string") {
		unread.set(follow, true);
		return;
	}
	const ids = unread.get(follow.kind) ?? new Set<string>();
	if (ids === true) return;
	unread.set(follow.kind, ids.add(follow.id(arg)));
}

function isHeard(follow: Follow, heard: Heard, arg: unknown): boolean {
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
