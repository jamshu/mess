<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { user } from '$lib/auth.js';
	import { odooClient } from '$lib/odoo.js';
	import { toast } from '$lib/toast.js';
	import { fmt } from '$lib/money.js';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import KebabMenu from '$lib/components/KebabMenu.svelte';
	import { ArrowRight, Pencil, Trash2 } from 'lucide-svelte';

	const today = () => new Date().toISOString().slice(0, 10);

	let members = $state([]);
	let settlements = $state([]);
	let loading = $state(true);
	let saving = $state(false);

	let fromId = $state(null);
	let toId = $state(null);
	let amount = $state('');
	let date = $state(today());
	let editingId = $state(null); // null → recording new, else editing that row

	onMount(async () => {
		try {
			const res = await fetch(`${base}/api/org/users`);
			const d = await res.json();
			const me = $user ? [{ id: $user.uid, name: `${$user.name} (you)` }] : [];
			members = [...me, ...(d.ok ? d.users : [])];
			fromId = $user?.uid ?? null;
			await load();
		} finally {
			loading = false;
		}
	});

	async function load() {
		settlements = await odooClient.searchRecords(
			[],
			['x_studio_from_id', 'x_studio_to_id', 'x_studio_amount', 'x_studio_date', 'create_uid'],
			'settlements',
			{ order: 'x_studio_date desc, id desc' }
		);
	}

	async function save(e) {
		e.preventDefault();
		const amt = Number(amount);
		if (!fromId || !toId) return toast.error('Pick both people');
		if (fromId === toId) return toast.error('Payer and receiver must differ');
		if (!(amt > 0)) return toast.error('Enter an amount');
		saving = true;
		const values = {
			x_studio_from_id: Number(fromId),
			x_studio_to_id: Number(toId),
			x_studio_amount: amt,
			x_studio_date: date || today()
		};
		try {
			if (editingId) {
				await odooClient.updateRecord(editingId, values, 'settlements');
				toast.success('Settlement updated');
			} else {
				await odooClient.createRecord(values, 'settlements');
				toast.success('Settlement recorded');
			}
			resetForm();
			await load();
		} catch (err) {
			toast.error(err.message);
		} finally {
			saving = false;
		}
	}

	function startEdit(s) {
		editingId = s.id;
		fromId = s.x_studio_from_id?.[0] ?? null;
		toId = s.x_studio_to_id?.[0] ?? null;
		amount = String(s.x_studio_amount ?? '');
		date = s.x_studio_date || today();
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	function resetForm() {
		editingId = null;
		toId = null;
		amount = '';
		date = today();
		fromId = $user?.uid ?? null;
	}

	async function remove(id) {
		try {
			await odooClient.deleteRecord(id, 'settlements');
			await load();
			toast.success('Removed');
		} catch (err) {
			toast.error(err.message);
		}
	}
</script>

<h1>Settle up</h1>
<p class="muted">Record a cash payment from one person to another. It rebalances everyone's totals — no money actually moves here.</p>

<form class="card form" onsubmit={save}>
	<div class="pay-row">
		<div class="who">
			<label class="label" for="from">Payer</label>
			<select id="from" class="select" bind:value={fromId}>
				{#each members as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
			</select>
		</div>
		<ArrowRight class="arrow" size={18} />
		<div class="who">
			<label class="label" for="to">Receiver</label>
			<select id="to" class="select" bind:value={toId}>
				<option value={null} disabled>Choose…</option>
				{#each members as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
			</select>
		</div>
	</div>
	<div class="two">
		<div>
			<label class="label" for="amt">Amount</label>
			<input id="amt" class="input" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" bind:value={amount} />
		</div>
		<div>
			<label class="label" for="date">Date</label>
			<input id="date" class="input" type="date" bind:value={date} />
		</div>
	</div>
	<div class="form-actions">
		{#if editingId}
			<button type="button" class="btn" onclick={resetForm}>Cancel</button>
		{/if}
		<button class="btn btn--primary btn--block" disabled={saving}>
			{saving ? 'Saving…' : editingId ? 'Save changes' : 'Record settlement'}
		</button>
	</div>
</form>

<div class="section-title">History</div>
{#if loading}
	{#each Array(2) as _}<div class="card set-card"><Skeleton h="1rem" w="60%" /></div>{/each}
{:else}
	{#each settlements as s (s.id)}
		<div class="card set-card fade-in">
			<div class="set-main">
				<span class="nm">{s.x_studio_from_id?.[1] || '—'}</span>
				<ArrowRight size={14} />
				<span class="nm">{s.x_studio_to_id?.[1] || '—'}</span>
			</div>
			<div class="set-right">
				<span class="amt">{fmt(s.x_studio_amount)}</span>
				<span class="dt">{s.x_studio_date}</span>
				{#if s.create_uid?.[0] === $user?.uid}
					<KebabMenu>
						<button class="menu-item" onclick={() => startEdit(s)}><Pencil size={14} /> Edit</button>
						<button class="menu-item danger" onclick={() => confirm('Delete this settlement?') && remove(s.id)}><Trash2 size={14} /> Delete</button>
					</KebabMenu>
				{/if}
			</div>
		</div>
	{:else}
		<p class="muted" style="margin-top:14px;">No settlements yet.</p>
	{/each}
{/if}

<style>
	.form { padding: var(--space-4); margin: var(--space-4) 0 var(--space-2); }
	.pay-row { display: flex; align-items: end; gap: var(--space-3); }
	.pay-row .who { flex: 1; min-width: 0; }
	.pay-row :global(.arrow) { color: var(--text-dim); margin-bottom: 11px; flex: none; }
	.two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
	.btn--block { width: 100%; justify-content: center; }
	.form-actions { display: flex; gap: var(--space-2); margin-top: var(--space-4); }
	.set-card {
		display: flex; align-items: center; justify-content: space-between;
		gap: var(--space-3); padding: var(--space-3) var(--space-4); margin-bottom: var(--space-2);
	}
	.set-main { display: flex; align-items: center; gap: var(--space-2); font-weight: 550; }
	.set-main :global(svg) { color: var(--text-dim); }
	.set-right { display: flex; align-items: center; gap: var(--space-3); }
	.amt { font-family: var(--font-display); font-weight: 700; font-variant-numeric: tabular-nums; }
	.dt { font-size: var(--fs-xs); color: var(--text-dim); }
</style>
