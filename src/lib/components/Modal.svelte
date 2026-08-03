<script>
	import { X } from 'lucide-svelte';

	// title: string (also the aria-label). fullscreen: for image/PDF viewers.
	let {
		open = $bindable(false),
		title = '',
		fullscreen = false,
		onclose = () => {},
		children,
		header
	} = $props();

	let dialogEl = $state(null);
	const titleId = 'modal-' + Math.random().toString(36).slice(2, 8);

	function close() {
		open = false;
		onclose();
	}

	function onkey(e) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			close();
		} else if (e.key === 'Tab') {
			trap(e);
		}
	}

	// Minimal focus trap — keep Tab within the dialog.
	function trap(e) {
		const nodes = dialogEl?.querySelectorAll(
			'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])'
		);
		if (!nodes || !nodes.length) return;
		const first = nodes[0];
		const last = nodes[nodes.length - 1];
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}

	$effect(() => {
		if (open && dialogEl) {
			const prev = document.activeElement;
			dialogEl.querySelector('input,button,textarea,select,a[href]')?.focus();
			return () => prev?.focus?.();
		}
	});
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="scrim" class:scrim--full={fullscreen} onclick={close} onkeydown={onkey}>
		<div
			class="dialog"
			class:dialog--full={fullscreen}
			bind:this={dialogEl}
			role="dialog"
			aria-modal="true"
			aria-labelledby={title ? titleId : undefined}
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			{#if title || header}
				<div class="head">
					{#if header}{@render header()}{:else}<h3 id={titleId}>{title}</h3>{/if}
					<button type="button" class="x" aria-label="Close" onclick={close}>
						<X size={18} />
					</button>
				</div>
			{/if}
			<div class="body" class:body--full={fullscreen}>
				{@render children?.()}
			</div>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 150;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
		animation: fade-scrim 0.18s ease both;
	}
	.dialog {
		width: min(520px, 100%);
		max-height: min(85vh, 720px);
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		animation: pop 0.2s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	/* the fixed scrim is the viewport lock — no vh/dvh anywhere, so the viewer
	   never hides behind mobile browser chrome nor jumps as the url bar collapses */
	.scrim--full {
		padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
			env(safe-area-inset-left);
	}
	.dialog--full {
		width: 100%;
		height: 100%;
		max-height: none;
		border-radius: 0;
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-4) var(--space-3);
		border-bottom: 1px solid var(--border);
	}
	.head :global(h3) {
		flex: 1;
		font-size: var(--fs-lg);
		min-width: 0;
	}
	.x {
		display: inline-flex;
		padding: 6px;
		border-radius: 8px;
		color: var(--text-dim);
	}
	.x:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.body {
		padding: var(--space-4);
		overflow: auto;
	}
	.body--full {
	flex: 1;
	min-height: 0;
	padding: 0;
	display: flex;
	/* column: .viewport's flex:1 needs to grow height, not width.
	   row (the old default) only stretched it sideways; align-items:center
	   left the vertical axis to shrink to content size. */
	flex-direction: column;
	background: #000;
	border-radius: 0;
}
	@keyframes fade-scrim {
		from {
			opacity: 0;
		}
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.98);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.scrim,
		.dialog {
			animation: none;
		}
	}
</style>
