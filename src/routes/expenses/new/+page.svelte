<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { user } from '$lib/auth.js';
	import { odooClient } from '$lib/odoo.js';
	import { toast } from '$lib/toast.js';
	import { fmt } from '$lib/money.js';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { resizeImage } from '$lib/media.js';
	import { ArrowLeft, Users, Check, Paperclip, X } from 'lucide-svelte';

	const CATEGORIES = ['Food', 'Groceries', 'Rent', 'Utilities', 'Transport', 'Other'];
	const today = () => new Date().toISOString().slice(0, 10);

	let members = $state([]); // [{id,name}] incl. self
	let groups = $state([]);
	let loading = $state(true);
	let saving = $state(false);
	let editingId = $state(null);
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
			groups = await odooClient.searchRecords([], ['x_name', 'x_studio_member_ids', 'x_studio_is_default'], 'groups', {
				order: 'x_name asc'
			});

			const editId = Number($page.url.searchParams.get('edit'));
			if (editId) {
				const [ex] = await odooClient.searchRecords(
					[['id', '=', editId]],
					['x_name', 'x_studio_amount', 'x_studio_category', 'x_studio_date', 'x_studio_payer_id', 'x_studio_participant_ids'],
					'expenses'
				);
				if (!ex) throw new Error('Expense not found');
				editingId = editId;
				// Groups aren't stored on the expense, so editing works on individual people.
				f = {
					desc: ex.x_name || '',
					amount: String(ex.x_studio_amount ?? ''),
					category: ex.x_studio_category || '',
					date: ex.x_studio_date || today(),
					payerId: ex.x_studio_payer_id?.[0] ?? null,
					people: new Set(ex.x_studio_participant_ids || []),
					groupIds: new Set()
				};
			} else {
				editingId = null;
				f = newForm();
				f.payerId = $user?.uid ?? null;
				if ($user) f.people = new Set([$user.uid]);
				const def = groups.find((g) => g.x_studio_is_default);
				if (def) f.groupIds = new Set([def.id]);
				applyQuery($page.url.searchParams);
			}
		} catch (e) {
			toast.error(e.message);
		} finally {
			loading = false;
		}
	});

	// Siri Shortcut deep-link: prefill amount + category + description from
	// ?q=<dictated phrase> or explicit params. Split stays the default (group).
	function applyQuery(sp) {
		const q = sp.get('q') || '';
		if (q) {
			const amt = q.match(/\d+(?:\.\d+)?/);
			if (amt) f.amount = amt[0];
			f.category = matchCategory(q);
			f.desc = cleanDesc(q);
		}
		// explicit params win over the parsed phrase
		if (sp.get('amount')) f.amount = sp.get('amount');
		if (sp.get('category')) f.category = matchCategory(sp.get('category')) || sp.get('category');
		if (sp.get('desc')) f.desc = sp.get('desc');
		// opt-in auto-submit — off by default so a mis-parse never posts silently
		if (sp.get('go') === '1') queueMicrotask(() => save(new Event('submit')));
	}

	function matchCategory(text) {
		const t = String(text).toLowerCase();
		return CATEGORIES.find((c) => t.includes(c.toLowerCase().replace(/(ies|s)$/, ''))) || '';
	}

	// Phrase → readable description: drop the amount and connector words.
	function cleanDesc(q) {
		return q
			.replace(/\d+(?:\.\d+)?/g, '')
			.replace(/\b(for|of|the|a|an|add|expense|spent|paid|rs|dollars?|rupees?)\b/gi, '')
			.replace(/\s+/g, ' ')
			.trim();
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

	// Enter advances through the fields in DOM order, then submits from the last one.
	function fieldEnterNext(e) {
		if (e.key !== 'Enter') return;
		const t = e.target;
		if (!(t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
		e.preventDefault();
		const fields = [...t.form.querySelectorAll('input,select')];
		const next = fields[fields.indexOf(t) + 1];
		if (next) next.focus();
		else t.form.requestSubmit(); // last field → submit
	}

	async function save(e) {
		e.preventDefault();
		const amount = Number(f.amount);
		if (!f.desc.trim()) return toast.error('Add a description');
		if (!(amount > 0)) return toast.error('Enter an amount');
		if (!f.payerId) return toast.error('Pick who paid');
		if (participantIds.length === 0) return toast.error('Pick at least one participant');
		saving = true;
		const values = {
			x_name: f.desc.trim(),
			x_studio_amount: amount,
			x_studio_category: f.category.trim() || false,
			x_studio_date: f.date || today(),
			x_studio_payer_id: Number(f.payerId),
			x_studio_participant_ids: [[6, 0, participantIds]]
		};
		try {
			let id = editingId;
			if (editingId) {
				await odooClient.updateRecord(editingId, values, 'expenses');
				if (billFile) await uploadBill(editingId, billFile);
				toast.success('Expense updated');
			} else {
				id = await odooClient.createRecord(values, 'expenses');
				if (billFile) await uploadBill(id, billFile);
				toast.success('Expense added');
			}
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
			body: JSON.stringify({ name, mime, dataBase64 }),
			signal: AbortSignal.timeout(20000)
		}).catch((err) => {
			if (err instanceof TypeError || err?.name === 'TimeoutError' || err?.name === 'AbortError') {
				throw new Error('Connection problem — please try again');
			}
			throw err;
		});
		// read as text first: a truncated/edge error response isn't always JSON
		const d = await res.json().catch(() => null);
		if (!res.ok || !d?.ok) throw new Error(d?.error || `Bill upload failed (${res.status})`);
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

<a href="{base}/expenses" class="back"><ArrowLeft size={16} /> Expenses</a>
<h1>{editingId ? 'Edit expense' : 'Add expense'}</h1>

{#if loading}
	<div class="card" style="margin-top:var(--space-4)">
		<Skeleton h="1rem" w="40%" /><div style="margin-top:12px"><Skeleton h="2rem" w="100%" /></div>
		<div style="margin-top:12px"><Skeleton h="2rem" w="100%" /></div>
	</div>
{:else}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form onsubmit={save} onkeydown={fieldEnterNext} class="form">
		<label class="label" for="desc">Description</label>
		<input id="desc" class="input" placeholder="Dinner, groceries…" bind:value={f.desc} data-autofocus />

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
			{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add expense'}
		</button>
	</form>
{/if}

<style>
	.back {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--text-dim);
		text-decoration: none;
		font-size: var(--fs-sm);
		font-weight: 550;
		margin-bottom: var(--space-3);
	}
	.back:hover { color: var(--text); }
	h1 { margin-bottom: var(--space-5); }
	.form { display: flex; flex-direction: column; max-width: 560px; }
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
