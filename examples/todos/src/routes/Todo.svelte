<script lang="ts">
	import { todo, toggle } from "#lib/todos.remote.ts";

	let { id }: { id: string } = $props();

	const read = $derived(todo(id));
	// The first answer is awaited. A later read that fails keeps the last one
	// on screen until the follower reads it again.
	const item = $derived(read.current ?? (await read));
</script>

<li>
	<label>
		<input type="checkbox" checked={item.done} onchange={() => toggle(id)} />
		{item.text}
	</label>
</li>
