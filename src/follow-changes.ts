import { onMount } from "svelte";
import { dev, version } from "$app/env";
import type { RemoteCommand } from "$app/server";
import { updated } from "$app/state";
import type { Followed } from "./follows.ts";
import type { Hello, Hint, Publication, Told } from "./hint.ts";
import { type Reading, readingOf } from "./reading.ts";
import { keepOpen } from "./socket.ts";

/**
 * Keeps every followed read the screen holds current, whatever page or
 * component asked for it. Called once, in the root layout:
 *
 *     followChanges({ socket: "/live", followed, readAgain });
 *
 * It opens one socket per tab to the app's route at `socket` (`connect`),
 * and reads again, through `readAgain` (`readAgainCommand`), the reads that
 * follow what its hints name. It reads everything once when the socket is
 * first taken, as what was published before reached no one, and again
 * whenever it finds it missed a publication. A hello from another build
 * has Kit check for it (`updated`); reloading is the app's to decide.
 *
 * Under `vite dev` there is no hub (Durable Objects run in the built
 * Worker), so it does nothing.
 */
export function followChanges(options: Options): void {
	onMount(() => (dev ? undefined : follow(options)));
}

/** The tab's follower, while its root layout is mounted. */
let following: Reading | undefined;

/**
 * Runs a command after the follower's read on its way, and holds the
 * follower's next read until it lands. A command that also refreshes its
 * own screen's reads goes through it, so that neither its answer nor the
 * follower's can land over a newer one:
 *
 *     onchange={() => inTurn(() => toggle(id))}
 *
 * Without a follower (under `vite dev`) it runs the command at once.
 */
export function inTurn<T>(work: () => Promise<T>): Promise<T> {
	return following ? following.turn(work) : work();
}

/** The app's socket route, its followed reads, and the command that reads them again. */
type Options = {
	socket: string;
	followed: readonly Followed[];
	readAgain: RemoteCommand<Told, Told>;
};

function follow({ socket, followed, readAgain }: Options): () => void {
	const kinds = new Set(followed.flatMap(({ follows }) => follows.map(kindOf)));
	const reading = readingOf((told) => {
		const reads = followed
			.filter(({ follows }) =>
				follows.some((follow) => Object.hasOwn(told, kindOf(follow))),
			)
			.map(({ read }) => read);
		return reads.length > 0
			? readAgain(told).updates(...reads)
			: Promise.resolve({});
	});
	const readEverything = () => {
		for (const kind of kinds) reading.tell(kind);
	};

	let heard: Hello | undefined;
	const url = new URL(socket, location.href);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	const close = keepOpen(url, (data) => {
		const frame = frameOf(data);
		if ("series" in frame) {
			if (frame.version !== version) void updated.check();
			const missed =
				heard === undefined ||
				heard.series !== frame.series ||
				heard.n !== frame.n;
			heard = frame;
			if (missed) readEverything();
			else reading.recover();
		} else if (heard) {
			const missed = frame.n !== heard.n + 1;
			heard = { ...heard, n: frame.n };
			if (missed) readEverything();
			else for (const { kind, id } of frame.hints) reading.tell(kind, id);
		}
	});
	following = reading;
	return () => {
		close();
		reading.stop();
		following = undefined;
	};
}

const kindOf = (follow: Followed["follows"][number]): string =>
	typeof follow === "string" ? follow : follow.kind;

function frameOf(data: string): Hello | Publication {
	const frame: unknown = JSON.parse(data);
	if (isHello(frame) || isPublication(frame)) return frame;
	throw new TypeError(
		`sveltekit-live: the hub sent a frame this page cannot read: ${data}. Are the page and the Worker from the same build?`,
	);
}

const isHello = (frame: unknown): frame is Hello =>
	typeof frame === "object" &&
	frame !== null &&
	"series" in frame &&
	typeof frame.series === "string" &&
	"n" in frame &&
	typeof frame.n === "number" &&
	"version" in frame &&
	typeof frame.version === "string";

const isPublication = (frame: unknown): frame is Publication =>
	typeof frame === "object" &&
	frame !== null &&
	"n" in frame &&
	typeof frame.n === "number" &&
	"hints" in frame &&
	Array.isArray(frame.hints) &&
	frame.hints.every(isHint);

const isHint = (hint: unknown): hint is Hint =>
	typeof hint === "object" &&
	hint !== null &&
	"kind" in hint &&
	typeof hint.kind === "string" &&
	(!("id" in hint) || typeof hint.id === "string");
