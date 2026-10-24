<script lang="ts">
	import type { Snippet } from "svelte";
	import { followChanges } from "sveltekit-live/client";
	import { readAgain } from "#lib/live.remote.ts";
	import { followed } from "#lib/live.ts";
	import { updated } from "$app/state";

	let { children }: { children: Snippet } = $props();

	const live = followChanges({ socket: "/live", followed, readAgain });
</script>

{#if live.staleSince}
	<p role="status">
		This may be out of date since {live.staleSince.toLocaleTimeString()}.
		<button type="button" onclick={() => live.retry()}>Retry</button>
	</p>
{/if}

{#if updated.current}
	<p role="status">
		A newer version is out.
		<button type="button" onclick={() => location.reload()}>Reload</button>
	</p>
{/if}

{@render children()}
