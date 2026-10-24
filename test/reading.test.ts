import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Told } from "../src/hint.ts";
import { readingOf } from "../src/reading.ts";

/** A screen's reads, each answered when the test says. */
function screen() {
	const sent: Told[] = [];
	const answers: PromiseWithResolvers<Told>[] = [];
	const reading = readingOf((told) => {
		sent.push(told);
		const answer = Promise.withResolvers<Told>();
		answers.push(answer);
		return answer.promise;
	});
	return { reading, sent, answers };
}

/** Lets what was told, or a read's answer, run its course. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("readingOf", () => {
	it("reads what one task told in one read", async () => {
		const { reading, sent } = screen();
		reading.tell("todos");
		reading.tell("todo", "a");
		reading.tell("todo", "b");
		await settle();

		expect(sent).toEqual([{ todos: true, todo: ["a", "b"] }]);
	});

	it("reads a kind whole once a hint names none of it, or past a hundred records", async () => {
		const { reading, sent } = screen();
		reading.tell("todo", "a");
		reading.tell("todo");
		for (let index = 0; index <= 100; index += 1) {
			reading.tell("note", `note-${index}`);
		}
		await settle();

		expect(sent).toEqual([{ todo: true, note: true }]);
	});

	it("keeps one read on its way, and reads what is told meanwhile once it has landed and half a second has passed", async () => {
		const { reading, sent, answers } = screen();
		reading.tell("todo", "a");
		await settle();
		reading.tell("todo", "b");
		reading.tell("todo", "c");
		await vi.advanceTimersByTimeAsync(1_000);
		expect(sent).toHaveLength(1);

		answers[0]?.resolve({});
		await settle();
		expect(sent).toEqual([{ todo: ["a"] }, { todo: ["b", "c"] }]);

		answers[1]?.resolve({});
		reading.tell("todo", "d");
		await settle();
		expect(sent).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(500);
		expect(sent).toEqual([
			{ todo: ["a"] },
			{ todo: ["b", "c"] },
			{ todo: ["d"] },
		]);
	});

	it("keeps what a failed read was told until the socket is back", async () => {
		const { reading, sent, answers } = screen();
		reading.tell("todo", "a");
		await settle();
		answers[0]?.reject(new Error("offline"));
		await vi.advanceTimersByTimeAsync(60_000);
		expect(sent).toHaveLength(1);

		reading.recover();
		await settle();
		expect(sent).toEqual([{ todo: ["a"] }, { todo: ["a"] }]);
	});

	it("keeps what a read answers it could not read in, until the socket is back", async () => {
		const { reading, sent, answers } = screen();
		reading.tell("todos");
		reading.tell("todo", "a");
		await settle();
		answers[0]?.resolve({ todo: ["a"] });
		await vi.advanceTimersByTimeAsync(60_000);
		expect(sent).toHaveLength(1);

		reading.recover();
		await settle();
		expect(sent).toEqual([{ todos: true, todo: ["a"] }, { todo: ["a"] }]);
	});

	it("lets the next read go once one has had no answer for 15 s, with what that one was told", async () => {
		const { reading, sent } = screen();
		reading.tell("todo", "a");
		await settle();
		reading.tell("todo", "b");
		await vi.advanceTimersByTimeAsync(14_999);
		expect(sent).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(1);
		expect(sent).toEqual([{ todo: ["a"] }, { todo: ["b", "a"] }]);
	});

	it("reads again what a read was told when its answer lands after the bound", async () => {
		const { reading, sent, answers } = screen();
		reading.tell("todo", "a");
		await vi.advanceTimersByTimeAsync(15_000);
		expect(sent).toHaveLength(1);

		answers[0]?.resolve({});
		await settle();
		expect(sent).toEqual([{ todo: ["a"] }, { todo: ["a"] }]);
	});
});
