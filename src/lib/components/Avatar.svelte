<!-- Round user avatar. Loads /api/avatar/{id}; on missing photo (404) or no id,
     falls back to the name's initial. Pass `variant` for the fallback ring color. -->
<script>
	import { base } from '$app/paths';

	let { id = null, name = '', size = 38, variant = '' } = $props();

	let failed = $state(false);
	// re-arm the image whenever the id changes (list reuse)
	$effect(() => {
		id;
		failed = false;
	});

	const initial = $derived((name || '?').trim().charAt(0).toUpperCase());
</script>

{#if id && !failed}
	<img
		class="avatar {variant}"
		style="width:{size}px;height:{size}px"
		src="{base}/api/avatar/{id}"
		alt={name}
		onerror={() => (failed = true)}
	/>
{:else}
	<span class="avatar {variant}" style="width:{size}px;height:{size}px">{initial}</span>
{/if}

<style>
	.avatar {
		flex: none;
		border-radius: 50%;
		display: grid;
		place-items: center;
		object-fit: cover;
		font-weight: 650;
		font-size: var(--fs-md);
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text-dim);
	}
	.avatar.pos {
		color: var(--green);
		border-color: color-mix(in srgb, var(--green) 45%, var(--border));
	}
	.avatar.neg {
		color: var(--red);
		border-color: color-mix(in srgb, var(--red) 45%, var(--border));
	}
	.avatar.accent {
		background: var(--accent);
		color: var(--on-accent);
		border-color: transparent;
	}
</style>
