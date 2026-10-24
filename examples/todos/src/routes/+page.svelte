<script lang="ts">
	import { inTurn } from "sveltekit-live/client";
	import { add, todos } from "#lib/todos.remote.ts";
	import Todo from "./Todo.svelte";

	let text = $state("");
	const list = todos();
	// As in Todo.svelte, a later read that fails keeps the last answer.
	const ids = $derived(list.current ?? (await list));

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		await inTurn(() => add(text));
		text = "";
	}
</script>

<h1>Todos</h1>

<form onsubmit={submit}>
	<input bind:value={text} aria-label="New todo" />
	<button type="submit">Add</button>
</form>

<ul>
	{#each ids as id (id)}
		<Todo {id} />
	{/each}
</ul>
