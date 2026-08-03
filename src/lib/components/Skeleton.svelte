<script>
	// Shimmer placeholder. Use `lines` for stacked text, or w/h/radius for a block.
	let { w = '100%', h = '1em', radius = null, lines = 0, class: klass = '' } = $props();
</script>

{#if lines > 0}
	<div class="stack {klass}">
		{#each Array(lines) as _, i}
			<div
				class="skeleton"
				style="height:{h};width:{i === lines - 1 ? '70%' : '100%'};border-radius:6px"
			></div>
		{/each}
	</div>
{:else}
	<div
		class="skeleton {klass}"
		style="width:{w};height:{h};{radius ? `border-radius:${radius}` : ''}"
	></div>
{/if}

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
</style>
