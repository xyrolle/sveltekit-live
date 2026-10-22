import { PING, PONG } from "./hint.ts";

const PING_EVERY_MS = 30_000;
const PONG_WITHIN_MS = 10_000;
const RETRY_FIRST_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * Keeps a socket open to `url` and hands `heard` every frame but the pongs.
 * A socket that closes, or answers no ping, is opened again after a delay
 * that doubles from one second to half a minute, spread over its upper half
 * so the screens of a tenant do not all come back at once after an outage.
 * Returns what closes it for good.
 */
export function keepOpen(url: URL, heard: (frame: string) => void): () => void {
	let socket: WebSocket | undefined;
	let failures = 0;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let ping: ReturnType<typeof setInterval> | undefined;
	let pong: ReturnType<typeof setTimeout> | undefined;

	const quiet = () => {
		clearInterval(ping);
		clearTimeout(pong);
		pong = undefined;
	};
	const lose = (lost: WebSocket) => {
		if (socket !== lost) return;
		socket = undefined;
		quiet();
		const ceiling = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** failures);
		failures += 1;
		retry = setTimeout(open, ceiling * (0.5 + Math.random() / 2));
	};
	// A connection can die with neither end told (a laptop lid, a mobile
	// network): silence after a ping means it is gone.
	const check = (open: WebSocket) => {
		if (pong !== undefined) return;
		open.send(PING);
		pong = setTimeout(() => {
			lose(open);
			open.close();
		}, PONG_WITHIN_MS);
	};
	function open() {
		const opened = new WebSocket(url);
		socket = opened;
		opened.addEventListener("open", () => {
			failures = 0;
			ping = setInterval(() => check(opened), PING_EVERY_MS);
		});
		opened.addEventListener("message", ({ data }) => {
			if (data === PONG) {
				clearTimeout(pong);
				pong = undefined;
			} else if (typeof data === "string") {
				heard(data);
			}
		});
		// Follows a refused handshake, a dropped connection and a close alike.
		opened.addEventListener("close", () => lose(opened));
	}

	open();
	return () => {
		const open = socket;
		socket = undefined;
		clearTimeout(retry);
		quiet();
		open?.close(1000);
	};
}
