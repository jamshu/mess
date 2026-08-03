<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { user } from '$lib/auth.js';
	import { odooClient } from '$lib/odoo.js';
	import { toast } from '$lib/toast.js';
	import { fmt } from '$lib/money.js';
	import Modal from '$lib/components/Modal.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { resizeImage } from '$lib/media.js';
	import { Plus, Receipt, Users, Check, Paperclip, X } from 'lucide-svelte';

	const CATEGORIES = ['Food', 'Groceries', 'Rent', 'Utilities', 'Transport', 'Other'];
	const today = () => new Date().toISOString().slice(0, 10);

	let expenses = $state([]);
	let members = $state([]); // [{id,name}] incl. self
	let groups = $state([]);
	let loading = $state(true);
	let error = $state('');

	// create form
	let open = $state(false);
	let saving = $state(false);
	let f = $state(newForm());
	let billFile = $state(null);

	function newForm() {
		return {
			desc: '',
			amount: '',
			category: '',
			date: today(),
			payerId: null,
			people: new Set(),
			groupIds: new Set()
		};
	}

	// resolved equal-split participants = picked people ∪ members of picked groups
	let participantIds = $derived.by(() => {
		const set = new Set(f.people);
		for (const gid of f.groupIds) {
			const g = groups.find((x) => x.id === gid);
			for (const m of g?.x_studio_member_ids || []) set.add(m);
		}
		return [...set];
	});
	let nameOf = $derived((id) => members.find((m) => m.id === id)?.name || `#${id}`);

	onMount(async () => {
		try {
			const res = await fetch(`${base}/api/org/users`);
			const d = await res.json();
			const me = $user ? [{ id: $user.uid, name: `${$user.name} (you)` }] : [];
			members = [...me, ...(d.ok ? d.users : [])];
			groups = await odooClient.searchRecords([], ['x_name', 'x_studio_member_ids'], 'groups', {
				order: 'x_name asc'
			});
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
			['x_name', 'x_studio_amount', 'x_studio_category', 'x_studio_date', 'x_studio_payer_id', 'x_studio_participant_ids'],
			'expenses',
			{ order: 'x_studio_date desc, id desc' }
		);
	}

	function startAdd() {
		f = newForm();
		f.payerId = $user?.uid ?? null;
		if ($user) f.people = new Set([$user.uid]);
		billFile = null;
		open = true;
	}

	function togglePerson(id) {
		const s = new Set(f.people);
		s.has(id) ? s.delete(id) : s.add(id);
		f.people = s;
	}
	function toggleGroup(id) {
		const s = new Set(f.groupIds);
		s.has(id) ? s.delete(id) : s.add(id);
		f.groupIds = s;
	}

	async function save(e) {
		e.preventDefault();
		const amount = Number(f.amount);
		if (!f.desc.trim()) return toast.error('Add a description');
		if (!(amount > 0)) return toast.error('Enter an amount');
		if (!f.payerId) return toast.error('Pick who paid');
		if (participantIds.length === 0) return toast.error('Pick at least one participant');
		saving = true;
		try {
			const id = await odooClient.createRecord(
				{
					x_name: f.desc.trim(),
					x_studio_amount: amount,
					x_studio_category: f.category.trim() || false,
					x_studio_date: f.date || today(),
					x_studio_payer_id: Number(f.payerId),
					x_studio_participant_ids: [[6, 0, participantIds]]
				},
				'expenses'
			);
			if (billFile) await uploadBill(id, billFile);
			toast.success('Expense added');
			open = false;
			await load();
			goto(`${base}/expense/${id}`);
		} catch (err) {
			toast.error(err.message);
		} finally {
			saving = false;
		}
	}

	async function uploadBill(expenseId, file) {
		let dataBase64, mime, name;
		if (file.type.startsWith('image/')) {
			const r = await resizeImage(file);
			dataBase64 = r.dataBase64;
			mime = r.mime;
			name = 'bill.jpg';
		} else {
			dataBase64 = await fileToBase64(file);
			mime = file.type || 'application/pdf';
			name = file.name || 'bill.pdf';
		}
		const res = await fetch(`${base}/api/expenses/${expenseId}/attachments`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, mime, dataBase64 })
		});
		const d = await res.json();
		if (!d.ok) throw new Error(d.error || 'Bill upload failed');
	}

	function fileToBase64(file) {
		return new Promise((resolve, reject) => {
			const fr = new FileReader();
			fr.onload = () => resolve(String(fr.result).split(',')[1]);
			fr.onerror = () => reject(new Error('Could not read file'));
			fr.readAsDataURL(file);
		});
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
		<a href="{base}/expense/{ex.id}" class="card card--interactive exp-card fade-in" style="--fade-delay:{i * 0.03}s">
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
	{:else}
		<div class="card empty"><Receipt size={26} /><p class="muted">No expenses yet.</p></div>
	{/each}
{/if}

<Modal bind:open title="Add expense">
	<form onsubmit={save} class="form">
		<label class="label" for="desc">Description</label>
		<input id="desc" class="input" placeholder="Dinner, groceries…" bind:value={f.desc} />

		<div class="two">
			<div>
				<label class="label" for="amt">Amount</label>
				<input id="amt" class="input" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" bind:value={f.amount} />
			</div>
			<div>
				<label class="label" for="date">Date</label>
				<input id="date" class="input" type="date" bind:value={f.date} />
			</div>
		</div>

		<label class="label" for="cat">Category <span class="opt">optional</span></label>
		<select id="cat" class="select" bind:value={f.category}>
			<option value="">No category</option>
			{#each CATEGORIES as c}<option value={c}>{c}</option>{/each}
		</select>

		<label class="label" for="payer">Who paid</label>
		<select id="payer" class="select" bind:value={f.payerId}>
			{#each members as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
		</select>

		<div class="label">Split between</div>
		<div class="picker">
			{#each members as m (m.id)}
				{@const on = f.people.has(m.id)}
				<button type="button" class="chip {on ? 'chip--accent' : ''}" onclick={() => togglePerson(m.id)}>
					{#if on}<Check size={13} />{/if}{m.name}
				</button>
			{/each}
		</div>
		{#if groups.length}
			<div class="label">…or add a group</div>
			<div class="picker">
				{#each groups as g (g.id)}
					{@const on = f.groupIds.has(g.id)}
					<button type="button" class="chip {on ? 'chip--green' : ''}" onclick={() => toggleGroup(g.id)}>
						{#if on}<Check size={13} />{/if}<Users size={12} /> {g.x_name}
					</button>
				{/each}
			</div>
		{/if}

		<div class="split-note">
			{#if participantIds.length}
				Splits {fmt(Number(f.amount) / participantIds.length || 0)} each across
				<strong>{participantIds.length}</strong>: {participantIds.map(nameOf).join(', ')}
			{:else}
				Pick at least one person or a group.
			{/if}
		</div>

		<label class="label">Bill / receipt <span class="opt">optional</span></label>
		{#if billFile}
			<div class="file-chip">
				<Paperclip size={14} /> {billFile.name}
				<button type="button" class="x" onclick={() => (billFile = null)} aria-label="Remove"><X size={14} /></button>
			</div>
		{:else}
			<input class="input" type="file" accept="image/*,application/pdf" onchange={(e) => (billFile = e.target.files?.[0] || null)} />
		{/if}

		<button class="btn btn--primary btn--block" disabled={saving} style="margin-top:16px;">
			{saving ? 'Saving…' : 'Add expense'}
		</button>
	</form>
</Modal>

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
	.exp-title { font-weight: 600; font-size: var(--fs-md); }
	.exp-meta { font-size: var(--fs-xs); color: var(--text-dim); margin-top: 3px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
	.exp-right { text-align: right; flex: none; }
	.exp-amount { font-family: var(--font-display); font-weight: 700; font-size: var(--fs-lg); font-variant-numeric: tabular-nums; }
	.exp-share { font-size: var(--fs-xs); color: var(--text-dim); }
	.empty { text-align: center; padding: var(--space-7); color: var(--text-dim); display: grid; place-items: center; gap: 8px; }
	.form { display: flex; flex-direction: column; }
	.two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
	.opt { font-weight: 400; color: var(--text-dim); text-transform: none; letter-spacing: 0; }
	.picker { display: flex; flex-wrap: wrap; gap: var(--space-2); }
	.picker .chip { cursor: pointer; }
	.split-note {
		margin-top: var(--space-3);
		font-size: var(--fs-xs);
		color: var(--text-dim);
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: var(--space-3);
		line-height: 1.5;
	}
	.file-chip {
		display: inline-flex; align-items: center; gap: 6px;
		font-size: var(--fs-sm);
		background: var(--surface-2); border: 1px solid var(--border);
		border-radius: var(--radius-sm); padding: 6px 10px;
	}
	.file-chip .x { display: inline-flex; color: var(--text-dim); margin-left: 4px; }
	.btn--block { width: 100%; justify-content: center; }
</style>
