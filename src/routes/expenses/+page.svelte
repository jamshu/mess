<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { user } from '$lib/auth.js';
	import { odooClient } from '$lib/odoo.js';
	import { toast } from '$lib/toast.js';
	import { fmt } from '$lib/money.js';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import KebabMenu from '$lib/components/KebabMenu.svelte';
	import { Plus, Receipt, Pencil, Trash2 } from 'lucide-svelte';

	let expenses = $state([]);
	let loading = $state(true);
	let error = $state('');

	onMount(async () => {
		try {
			await load();
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	});

	async function load() {
		expenses = await odooClient.searchRecords(
			[],
			['x_name', 'x_studio_amount', 'x_studio_category', 'x_studio_date', 'x_studio_payer_id', 'x_studio_participant_ids', 'create_uid'],
			'expenses',
			{ order: 'x_studio_date desc, id desc' }
		);
	}

	function startAdd() {
		goto(`${base}/expenses/new`);
	}

	function startEdit(ex) {
		goto(`${base}/expenses/new?edit=${ex.id}`);
	}

	async function deleteExpense(ex) {
		try {
			await odooClient.deleteRecord(ex.id, 'expenses');
			toast.success('Expense deleted');
			await load();
		} catch (err) {
			toast.error(err.message);
		}
	}
</script>

<div class="head-row">
	<h1>Expenses</h1>
	<button class="btn btn--primary" onclick={startAdd}><Plus size={16} /> Add expense</button>
</div>

{#if error}<p class="error-text">{error}</p>{/if}

{#if loading}
	{#each Array(3) as _}
		<div class="card exp-card"><Skeleton h="1rem" w="50%" /><div style="margin-top:10px"><Skeleton h="0.8rem" w="30%" /></div></div>
	{/each}
{:else}
	{#each expenses as ex, i (ex.id)}
		{@const n = (ex.x_studio_participant_ids || []).length}
		{@const owner = ex.create_uid?.[0] === $user?.uid}
		<div class="exp-wrap fade-in" style="--fade-delay:{i * 0.03}s">
		<a href="{base}/expense/{ex.id}" class="card card--interactive exp-card">
			<div class="exp-main">
				<div class="exp-title">{ex.x_name}</div>
				<div class="exp-meta">
					{ex.x_studio_payer_id?.[1] || 'Someone'} paid · Split {n}
					{#if ex.x_studio_category}· <span class="chip chip--accent">{ex.x_studio_category}</span>{/if}
				</div>
			</div>
			<div class="exp-right">
				<div class="exp-amount">{fmt(ex.x_studio_amount)}</div>
				{#if n}<div class="exp-share">{fmt(ex.x_studio_amount / n)}/head</div>{/if}
			</div>
		</a>
		{#if owner}
			<div class="exp-actions">
				<KebabMenu>
					<button class="menu-item" onclick={() => startEdit(ex)}><Pencil size={14} /> Edit</button>
					<button class="menu-item danger" onclick={() => confirm('Delete this expense?') && deleteExpense(ex)}><Trash2 size={14} /> Delete</button>
				</KebabMenu>
			</div>
		{/if}
		</div>
	{:else}
		<div class="card empty"><Receipt size={26} /><p class="muted">No expenses yet.</p></div>
	{/each}
{/if}

<style>
	.head-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin: var(--space-2) 0 var(--space-5);
	}
	.exp-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-4);
		margin-bottom: var(--space-2);
		text-decoration: none;
		color: inherit;
	}
	.exp-wrap { position: relative; margin-bottom: var(--space-2); }
	/* reserve the top-right corner so the amount clears the kebab */
	.exp-wrap .exp-card { margin-bottom: 0; padding-right: 44px; }
	/* kebab in the card's top-right corner — sibling of the <a> (not nested) */
	.exp-actions { position: absolute; top: 6px; right: 6px; }
	.exp-title { font-weight: 600; font-size: var(--fs-md); }
	.exp-meta { font-size: var(--fs-xs); color: var(--text-dim); margin-top: 3px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
	.exp-right { text-align: right; flex: none; }
	.exp-amount { font-family: var(--font-display); font-weight: 700; font-size: var(--fs-lg); font-variant-numeric: tabular-nums; }
	.exp-share { font-size: var(--fs-xs); color: var(--text-dim); }
	.empty { text-align: center; padding: var(--space-7); color: var(--text-dim); display: grid; place-items: center; gap: 8px; }
</style>
