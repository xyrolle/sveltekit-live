<script lang="ts">
	import { add, todos } from "#lib/todos.remote.ts";
	import Todo from "./Todo.svelte";

	let text = $state("");

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		await add(text);
		text = "";
	}
</script>

<h1>Todos</h1>

<form onsubmit={submit}>
	<input bind:value={text} aria-label="New todo" />
	<button type="submit">Add</button>
</form>

<ul>
	{#each await todos() as id (id)}
		<Todo {id} />
	{/each}
</ul>
