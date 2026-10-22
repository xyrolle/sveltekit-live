<script lang="ts">
	import { todo, toggle } from "#lib/todos.remote.ts";

	let { id }: { id: string } = $props();

	const item = $derived(await todo(id));
</script>

<li>
	<label>
		<input type="checkbox" checked={item.done} onchange={() => toggle(id)} />
		{item.text}
	</label>
</li>
