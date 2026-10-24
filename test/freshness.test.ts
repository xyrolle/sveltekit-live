import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshnessOf } from "../src/freshness.ts";

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("freshnessOf", () => {
	it("says nothing of a socket back within 15 s", async () => {
		const watch = freshnessOf(() => {});
		watch.connected();
		watch.lost();
		await vi.advanceTimersByTimeAsync(14_999);
		watch.connected();
		await vi.advanceTimersByTimeAsync(60_000);

		expect(watch.staleSince).toBeUndefined();
	});

	it("says since when once the socket has been down 15 s, until it is back and its reads have landed", async () => {
		const watch = freshnessOf(() => {});
		watch.connected();
		const lostAt = new Date();
		watch.lost();
		await vi.advanceTimersByTimeAsync(14_999);
		expect(watch.staleSince).toBeUndefined();
		await vi.advanceTimersByTimeAsync(1);
		expect(watch.staleSince).toEqual(lostAt);

		watch.stands("reading");
		watch.connected();
		expect(watch.staleSince).toEqual(lostAt);
		watch.stands("current");
		expect(watch.staleSince).toBeUndefined();
	});

	it("says since when once a read has stayed failed for 15 s, until it is read", async () => {
		const watch = freshnessOf(() => {});
		watch.connected();
		watch.stands("failed");
		await vi.advanceTimersByTimeAsync(15_000);
		expect(watch.staleSince).toBeInstanceOf(Date);

		watch.stands("reading");
		watch.stands("current");
		expect(watch.staleSince).toBeUndefined();
	});
});
