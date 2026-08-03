<script>
	import { toasts, dismiss } from '$lib/toast.js';
	import { CircleCheck, CircleAlert, Info, X } from 'lucide-svelte';

	const icons = { success: CircleCheck, error: CircleAlert, info: Info };
</script>

<div class="toast-wrap" aria-live="polite" aria-atomic="false">
	{#each $toasts as t (t.id)}
		{@const Icon = icons[t.kind] ?? Info}
		<div class="toast toast--{t.kind}" role="status">
			<Icon size={17} />
			<span class="msg">{t.message}</span>
			<button type="button" class="x" aria-label="Dismiss" onclick={() => dismiss(t.id)}>
				<X size={14} />
			</button>
		</div>
	{/each}
</div>

<style>
	.toast-wrap {
		position: fixed;
		left: 50%;
		bottom: calc(20px + env(safe-area-inset-bottom, 0px));
		transform: translateX(-50%);
		z-index: 200;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: min(420px, calc(100vw - 32px));
		pointer-events: none;
	}
	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: 11px 12px 11px 14px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-strong);
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
		font-size: var(--fs-sm);
		animation: toast-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	.toast--success :global(svg) {
		color: var(--green);
	}
	.toast--error :global(svg) {
		color: var(--red);
	}
	.toast--info :global(svg) {
		color: var(--accent);
	}
	.msg {
		flex: 1;
		min-width: 0;
	}
	.x {
		display: inline-flex;
		padding: 4px;
		border-radius: 6px;
		color: var(--text-faint);
	}
	.x:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.x :global(svg) {
		color: inherit;
	}
	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(10px) scale(0.98);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.toast {
			animation: none;
		}
	}
</style>
