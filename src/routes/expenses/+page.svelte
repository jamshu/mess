<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { user } from '$lib/auth.js';
	import { odooClient } from '$lib/odoo.js';
	import { toast } from '$lib/toast.js';
	import { fmt } from '$lib/money.js';
	import { thisMonth, expenseDomain, workbook, sheet, downloadExcel } from '$lib/report.js';
	import { matchesExpense } from '$lib/search.js';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import KebabMenu from '$lib/components/KebabMenu.svelte';
	import { Plus, Receipt, Pencil, Trash2, Download, Search, X } from 'lucide-svelte';

	let expenses = $state([]);
	let loading = $state(true);
	let error = $state('');

	// Filters — default to the current month so first load only pulls one month.
	let month = $state(thisMonth());
	let includedMe = $state(false);
	let q = $state(''); // free-text search — filters in memory, never refetches
	let names = $state(new Map()); // uid -> name, for participant names in export

	onMount(async () => {
		loadNames();
		await reload();
	});

	async function loadNames() {
		try {
			const d = await fetch(`${base}/api/org/users`).then((r) => r.json());
			const m = new Map();
			if ($user) m.set($user.uid, $user.name);
			if (d.ok) for (const u of d.users) m.set(u.id, u.name);
			names = m;
		} catch { /* export just falls back to ids */ }
	}
	const nameOf = (id) => names.get(id) || `#${id}`;

	async function reload() {
		loading = true;
		error = '';
		try {
			await load();
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	}

	async function load() {
		expenses = await odooClient.searchRecords(
			expenseDomain(month, includedMe, $user?.uid),
			['x_name', 'x_studio_amount', 'x_studio_category', 'x_studio_date', 'x_studio_payer_id', 'x_studio_participant_ids', 'create_uid'],
			'expenses',
			{ order: 'x_studio_date desc, id desc' }
		);
	}

	// Search narrows the working set — list, summary and export all read `shown`.
	let shown = $derived(expenses.filter((ex) => matchesExpense(ex, q, nameOf)));

	// Summary over the filtered set: total spent, my share, count.
	let summary = $derived.by(() => {
		let total = 0, myShare = 0, myPaid = 0;
		for (const ex of shown) {
			const amt = Number(ex.x_studio_amount) || 0;
			total += amt;
			const parts = ex.x_studio_participant_ids || [];
			if ($user && parts.includes($user.uid) && parts.length) myShare += amt / parts.length;
			if ($user && ex.x_studio_payer_id?.[0] === $user.uid) myPaid += amt;
		}
		return { total, myShare, myPaid, count: shown.length };
	});

	function exportExcel() {
		const cols = [
			{ header: 'Date' }, { header: 'Description' }, { header: 'Category' }, { header: 'Payer' },
			{ header: 'Total', type: 'Number', money: true },
			{ header: 'Split', type: 'Number' },
			{ header: 'Participants' },
			{ header: 'My Share', type: 'Number', money: true }
		];
		const rows = shown.map((ex) => {
			const amt = Number(ex.x_studio_amount) || 0;
			const parts = ex.x_studio_participant_ids || [];
			const mine = $user && parts.includes($user.uid) && parts.length ? amt / parts.length : 0;
			return [ex.x_studio_date, ex.x_name, ex.x_studio_category || '', ex.x_studio_payer_id?.[1] || '', amt, parts.length, parts.map(nameOf).join(', '), mine];
		});
		const totals = [null, null, null, 'Total', summary.total, null, null, summary.myShare];
		const xml = workbook([sheet('Expenses', cols, rows, { totals })]);
		downloadExcel(`expenses-${month || 'all'}`, xml);
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

<div class="card filter-bar">
	<div class="filter-row">
		<div class="search">
			<Search size={14} />
			<input class="input input--sm" placeholder="Search name, payer or participant…" bind:value={q} />
			{#if q}
				<button class="search-clear" title="Clear search" aria-label="Clear search" onclick={() => (q = '')}><X size={13} /></button>
			{/if}
		</div>
		<label class="fl">
			Month
			<input class="input input--sm" type="month" bind:value={month} onchange={reload} />
		</label>
		{#if month}
			<button class="btn btn--sm btn--ghost" onclick={() => { month = ''; reload(); }}>All time</button>
		{:else}
			<button class="btn btn--sm btn--ghost" onclick={() => { month = thisMonth(); reload(); }}>This month</button>
		{/if}
		<label class="fl fl--check">
			<input type="checkbox" bind:checked={includedMe} onchange={reload} />
			Only include me
		</label>
		<button class="btn btn--sm" onclick={exportExcel} disabled={loading || !shown.length} style="margin-left:auto;">
			<Download size={14} /> Export
		</button>
	</div>
</div>

{#if error}<p class="error-text">{error}</p>{/if}

{#if loading}
	{#each Array(3) as _}
		<div class="card exp-card"><Skeleton h="1rem" w="50%" /><div style="margin-top:10px"><Skeleton h="0.8rem" w="30%" /></div></div>
	{/each}
{:else}
	{#each shown as ex, i (ex.id)}
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
		<div class="card empty">
			<Receipt size={26} />
			<p class="muted">{q ? `No expenses match “${q}”.` : 'No expenses yet.'}</p>
		</div>
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
	.filter-bar { padding: var(--space-3) var(--space-4); margin-bottom: var(--space-4); }
	.filter-row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
	.fl { display: flex; align-items: center; gap: 7px; font-size: var(--fs-sm); color: var(--text-dim); }
	.fl--check { cursor: pointer; }
	.input--sm { width: auto; padding: 5px 8px; }
	/* icon sits inside the field; padding keeps the text clear of it */
	.search { position: relative; display: flex; align-items: center; flex: 1; min-width: 190px; }
	.search > :global(svg) { position: absolute; left: 9px; color: var(--text-faint); pointer-events: none; }
	.search .input { width: 100%; padding-left: 29px; padding-right: 28px; }
	.search-clear {
		position: absolute; right: 6px;
		display: inline-flex; align-items: center; justify-content: center;
		width: 18px; height: 18px; border-radius: 50%;
		border: none; background: var(--surface-2); color: var(--text-dim); cursor: pointer;
	}
	.search-clear:hover { color: var(--text); }
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
