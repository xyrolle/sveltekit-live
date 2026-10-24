import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** The errors TypeScript finds in the app of ./kinds, its kinds `declared` or not. */
function errorsOf(declared: "declared" | "undeclared"): string[] {
	const { stdout } = spawnSync(
		here("../node_modules/.bin/tsc"),
		["-p", here(`kinds/tsconfig.${declared}.json`), "--pretty", "false"],
		{ encoding: "utf8" },
	);
	return stdout
		.split("\n")
		.filter((line) => line.includes("error TS"))
		.map((line) => line.replace(/^.*error TS\d+: /, ""));
}

// Each runs TypeScript, which takes a second or two.
describe("kinds", { timeout: 15_000 }, () => {
	it("fails the typecheck of a kind the app did not declare, naming those it did", () => {
		expect(errorsOf("declared")).toEqual([
			`Argument of type '"todoz"' is not assignable to parameter of type '"todo" | "todos" | ByRecord<undefined>'.`,
			`Type '"tod"' is not assignable to type '"todo" | "todos"'. Did you mean '"todo"'?`,
			`Type '"todoz"' is not assignable to type '"todo" | "todos"'. Did you mean '"todo"'?`,
		]);
	});

	it("takes any string as a kind when the app declares none", () => {
		expect(errorsOf("undeclared")).toEqual([]);
	});
});
