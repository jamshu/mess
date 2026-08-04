<!-- Folded ⋮ actions menu. Slot in .menu-item buttons; the menu closes on any
     item click, outside click, or Escape. -->
<script>
	import { MoreVertical } from 'lucide-svelte';

	let { children, align = 'right' } = $props();
	let open = $state(false);
	let el;

	function toggle(e) {
		e.stopPropagation();
		open = !open;
	}
	function onDoc(e) {
		if (open && el && !el.contains(e.target)) open = false;
	}
	function onKey(e) {
		if (e.key === 'Escape') open = false;
	}
</script>

<svelte:window onclick={onDoc} onkeydown={onKey} />

<div class="kebab" bind:this={el}>
	<button type="button" class="kebab-btn" aria-label="More actions" aria-haspopup="menu" onclick={toggle}>
		<MoreVertical size={16} />
	</button>
	{#if open}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="menu {align}" role="menu" tabindex="-1" onclick={() => (open = false)}>
			{@render children?.()}
		</div>
	{/if}
</div>

<style>
	.kebab {
		position: relative;
		display: inline-flex;
	}
	.kebab-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: var(--radius-sm);
		color: var(--text-dim);
	}
	.kebab-btn:hover {
		color: var(--text);
		background: var(--surface-2);
	}
	.menu {
		position: absolute;
		top: calc(100% + 4px);
		z-index: 40;
		min-width: 140px;
		padding: 4px;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-lg);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.menu.right { right: 0; }
	.menu.left { left: 0; }
	/* items are slotted from the parent, so reach them with :global */
	.menu :global(.menu-item) {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 8px 10px;
		border-radius: var(--radius-sm);
		font-size: var(--fs-sm);
		color: var(--text);
		text-align: left;
		background: none;
		border: none;
		cursor: pointer;
	}
	.menu :global(.menu-item:hover) {
		background: var(--surface-2);
	}
	.menu :global(.menu-item.danger) {
		color: var(--red);
	}
</style>
