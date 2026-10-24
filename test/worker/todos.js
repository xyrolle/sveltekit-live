// The example's Worker (examples/todos/worker.js), but for its hub, which a
// test can have refuse its next publication, as a hub the Worker cannot reach
// does.
import { LiveHub as Hub } from "../../src/hub.ts";

export { default } from "../../examples/todos/worker.js";

export class LiveHub extends Hub {
	#refusing = false;

	refuseNext() {
		this.#refusing = true;
	}

	publish(hints) {
		if (this.#refusing) {
			this.#refusing = false;
			throw new Error("The hub refused the publication.");
		}
		super.publish(hints);
	}
}
