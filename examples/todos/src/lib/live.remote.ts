import { readAgainCommand } from "sveltekit-live/server";
import { followed } from "./live.ts";

export const readAgain = readAgainCommand(followed);
