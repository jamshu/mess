<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { user } from '$lib/auth.js';
	import { odooClient } from '$lib/odoo.js';
	import { fmt } from '$lib/money.js';
	import { computeBalances, money } from '$lib/balance.js';
	import { thisMonth, expenseDomain, workbook, sheet, downloadExcel } from '$lib/report.js';
	import { matchesExpense } from '$lib/search.js';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { Download, FileSpreadsheet, Calendar, Search, X } from 'lucide-svelte';

	const TEMPLATES = [
		{ id: 'detailed', name: 'Detailed expenses' },
		{ id: 'summary', name: 'Monthly summary' }
	];

	let template = $state('detailed');
	let month = $state(thisMonth());
	let includedMe = $state(false);
	let q = $state(''); // free-text search — filters in memory, never refetches
	let loading = $state(true);
	let error = $state('');

	let expenses = $state([]);
	let settlements = $state([]);
	let names = $state(new Map()); // uid -> name

	onMount(reload);

	async function reload() {
		loading = true;
		error = '';
		try {
			// date-only domain for settlements (no participant field on them)
			const dateDom = expenseDomain(month, false, $user?.uid);
			const [ex, st, usersRes] = await Promise.all([
				odooClient.searchRecords(
					expenseDomain(month, includedMe, $user?.uid),
					['x_name', 'x_studio_amount', 'x_studio_category', 'x_studio_date', 'x_studio_payer_id', 'x_studio_participant_ids'],
					'expenses',
					{ order: 'x_studio_date desc, id desc' }
				),
				odooClient.searchRecords(
					dateDom,
					['x_studio_from_id', 'x_studio_to_id', 'x_studio_amount'],
					'settlements'
				),
				fetch(`${base}/api/org/users`).then((r) => r.json())
			]);
			expenses = ex;
			settlements = st;
			const m = new Map();
			if ($user) m.set($user.uid, $user.name);
			if (usersRes.ok) for (const u of usersRes.users) m.set(u.id, u.name);
			names = m;
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	}

	const nameOf = (id) => names.get(id) || `#${id}`;
	const initials = (n) => (n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

	// "August 2026" / "All time" for the hero eyebrow.
	let periodLabel = $derived(
		month
			? new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
			: 'All time'
	);
	let maxCat = $derived(Math.max(1, ...summary.categories.map((c) => c.amount)));

	// Search narrows the working set — every panel below reads `shown`, so the
	// KPIs, ledger, category bars, member balances and export stay consistent.
	let shown = $derived(expenses.filter((ex) => matchesExpense(ex, q, nameOf)));

	// --- Detailed rows (expense + my share) ---
	let detail = $derived.by(() => {
		let total = 0, myShare = 0, myPaid = 0;
		const rows = shown.map((ex) => {
			const amt = Number(ex.x_studio_amount) || 0;
			const parts = ex.x_studio_participant_ids || [];
			const mine = $user && parts.includes($user.uid) && parts.length ? amt / parts.length : 0;
			total += amt;
			myShare += mine;
			if ($user && ex.x_studio_payer_id?.[0] === $user.uid) myPaid += amt;
			return { date: ex.x_studio_date, desc: ex.x_name, cat: ex.x_studio_category || '', payer: ex.x_studio_payer_id?.[1] || '', amt, n: parts.length, participants: parts.map(nameOf).join(', '), mine };
		});
		return { rows, total, myShare, myPaid };
	});

	// --- Summary: per-category totals + member balances ---
	let summary = $derived.by(() => {
		const cat = new Map();
		let total = 0;
		for (const ex of shown) {
			const amt = Number(ex.x_studio_amount) || 0;
			const k = ex.x_studio_category || 'Uncategorized';
			cat.set(k, (cat.get(k) || 0) + amt);
			total += amt;
		}
		const categories = [...cat.entries()]
			.map(([name, amount]) => ({ name, amount, pct: total ? (amount / total) * 100 : 0 }))
			.sort((a, b) => b.amount - a.amount);

		const bal = computeBalances(
			shown.map((e) => ({ amount: e.x_studio_amount, payerId: e.x_studio_payer_id?.[0] || null, participantIds: e.x_studio_participant_ids || [] })),
			settlements.map((s) => ({ fromId: s.x_studio_from_id?.[0] || null, toId: s.x_studio_to_id?.[0] || null, amount: s.x_studio_amount })),
			[...names.keys()]
		);
		const members = [...bal.entries()]
			.map(([id, r]) => ({ id, name: nameOf(id), paid: money(r.paid), cost: money(r.cost), sent: money(r.sent), received: money(r.received), net: money(r.net) }))
			.filter((m) => m.paid || m.cost || m.sent || m.received)
			.sort((a, b) => b.net - a.net);
		return { categories, total, members };
	});

	function exportExcel() {
		if (template === 'detailed') {
			const cols = [
				{ header: 'Date' }, { header: 'Description' }, { header: 'Category' }, { header: 'Payer' },
				{ header: 'Total', type: 'Number', money: true },
				{ header: 'Split', type: 'Number' },
				{ header: 'Participants' },
				{ header: 'My Share', type: 'Number', money: true }
			];
			const rows = detail.rows.map((r) => [r.date, r.desc, r.cat, r.payer, r.amt, r.n, r.participants, r.mine]);
			const totals = [null, null, null, 'Total', detail.total, null, null, detail.myShare];
			downloadExcel(`expenses-${month || 'all'}`, workbook([sheet('Expenses', cols, rows, { totals })]));
		} else {
			const catCols = [
				{ header: 'Category' },
				{ header: 'Amount', type: 'Number', money: true },
				{ header: '%', type: 'Number' }
			];
			const catRows = summary.categories.map((c) => [c.name, c.amount, Math.round(c.pct * 10) / 10]);
			const catSheet = sheet('Category Totals', catCols, catRows, { totals: ['Total', summary.total, null] });

			const memCols = [
				{ header: 'Member' },
				{ header: 'Paid', type: 'Number', money: true },
				{ header: 'Cost', type: 'Number', money: true },
				{ header: 'Sent', type: 'Number', money: true },
				{ header: 'Received', type: 'Number', money: true },
				{ header: 'Net', type: 'Number', money: true }
			];
			const memRows = summary.members.map((m) => [m.name, m.paid, m.cost, m.sent, m.received, m.net]);
			const memSheet = sheet('Member Balances', memCols, memRows);
			downloadExcel(`summary-${month || 'all'}`, workbook([catSheet, memSheet]));
		}
	}
</script>

<!-- Hero: headline number for the period, over an accent glow -->
<section class="hero fade-in">
	<div class="hero-glow"></div>
	<div class="hero-top">
		<span class="eyebrow"><FileSpreadsheet size={13} /> Report · {periodLabel}</span>
		<div class="seg">
			{#each TEMPLATES as t (t.id)}
				<button class="seg-btn" class:on={template === t.id} onclick={() => (template = t.id)}>{t.name}</button>
			{/each}
		</div>
	</div>

	<div class="kpis">
		<div class="kpi kpi--hero">
			<span class="kpi-label">Total spent</span>
			<span class="kpi-val">{fmt(detail.total)}</span>
		</div>
		<div class="kpi">
			<span class="kpi-label">You paid</span>
			<span class="kpi-val">{fmt(detail.myPaid)}</span>
		</div>
		<div class="kpi">
			<span class="kpi-label">My share</span>
			<span class="kpi-val">{fmt(detail.myShare)}</span>
		</div>
		<div class="kpi">
			<span class="kpi-label">Expenses</span>
			<span class="kpi-val">{shown.length}</span>
		</div>
	</div>
</section>

<!-- Toolbar -->
<div class="toolbar fade-in" style="--fade-delay:0.05s">
	<div class="search">
		<Search size={14} />
		<input class="input input--sm" placeholder="Search name, payer or participant…" bind:value={q} />
		{#if q}
			<button class="search-clear" title="Clear search" aria-label="Clear search" onclick={() => (q = '')}><X size={13} /></button>
		{/if}
	</div>
	<label class="fl">
		<Calendar size={14} />
		<input class="input input--sm" type="month" bind:value={month} onchange={reload} />
	</label>
	{#if month}
		<button class="chip-btn" onclick={() => { month = ''; reload(); }}>All time</button>
	{:else}
		<button class="chip-btn" onclick={() => { month = thisMonth(); reload(); }}>This month</button>
	{/if}
	{#if template === 'detailed'}
		<label class="fl fl--check" class:on={includedMe}>
			<input type="checkbox" bind:checked={includedMe} onchange={reload} hidden />
			<span class="dot"></span> Only include me
		</label>
	{/if}
	<button class="btn btn--primary btn--sm export" onclick={exportExcel} disabled={loading || !shown.length}>
		<Download size={14} /> Export Excel
	</button>
</div>

{#if error}<p class="error-text">{error}</p>{/if}

{#if loading}
	<div class="card pad"><Skeleton h="1rem" w="60%" /><div style="margin-top:12px"><Skeleton h="0.8rem" w="40%" /></div><div style="margin-top:12px"><Skeleton h="0.8rem" w="50%" /></div></div>
{:else if !shown.length}
	<div class="card empty">
		<FileSpreadsheet size={28} />
		<p class="muted">{q ? `No expenses match “${q}”.` : 'Nothing to report for this period.'}</p>
	</div>
{:else if template === 'detailed'}
	<div class="card pad fade-in" style="--fade-delay:0.1s">
		<div class="ledger">
			{#each detail.rows as r, i (i)}
				<div class="led-row">
					<div class="led-main">
						<span class="led-desc">{r.desc}</span>
						<span class="led-meta">
							{r.date}{#if r.payer} · {r.payer} paid{/if}
							{#if r.cat}<span class="tag">{r.cat}</span>{/if}
						</span>
					</div>
					<div class="led-amt">
						<span class="led-total">{fmt(r.amt)}</span>
						{#if r.mine}<span class="led-share">{fmt(r.mine)} you</span>{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
{:else}
	<div class="grid2">
		<div class="card pad fade-in" style="--fade-delay:0.1s">
			<h3>By category</h3>
			<div class="bars">
				{#each summary.categories as c, i (c.name)}
					<div class="bar-row" style="--i:{i}">
						<div class="bar-head">
							<span class="bar-name">{c.name}</span>
							<span class="bar-amt">{fmt(c.amount)} <em>{c.pct.toFixed(0)}%</em></span>
						</div>
						<div class="bar-track"><div class="bar-fill" style="width:{(c.amount / maxCat) * 100}%"></div></div>
					</div>
				{/each}
			</div>
		</div>

		<div class="card pad fade-in" style="--fade-delay:0.15s">
			<h3>Member balances</h3>
			<div class="members">
				{#each summary.members as m (m.id)}
					<div class="mem-row">
						<span class="mem-av">{initials(m.name)}</span>
						<div class="mem-info">
							<span class="mem-name">{m.name}</span>
							<span class="mem-sub">paid {fmt(m.paid)} · cost {fmt(m.cost)}</span>
						</div>
						<span class="mem-net" class:pos={m.net > 0} class:neg={m.net < 0}>
							{m.net > 0 ? '+' : ''}{fmt(m.net)}
						</span>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}

<style>
	/* ---- Hero ---- */
	.hero {
		position: relative;
		overflow: hidden;
		border-radius: var(--radius-lg);
		border: 1px solid var(--border);
		background: linear-gradient(160deg, var(--surface-2), var(--surface));
		padding: var(--space-5) var(--space-6) var(--space-6);
		margin: var(--space-2) 0 var(--space-4);
		box-shadow: var(--shadow);
	}
	.hero-glow {
		position: absolute;
		top: -60%;
		right: -20%;
		width: 55%;
		height: 200%;
		background: radial-gradient(closest-side, var(--accent-soft), transparent 70%);
		pointer-events: none;
	}
	.hero-top {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
		margin-bottom: var(--space-5);
	}
	.eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--fs-xs);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-dim);
	}
	.eyebrow :global(svg) { color: var(--accent); }

	/* segmented control */
	.seg {
		display: inline-flex;
		padding: 3px;
		gap: 2px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		border-radius: 999px;
	}
	.seg-btn {
		border: none;
		background: transparent;
		color: var(--text-dim);
		font: inherit;
		font-size: var(--fs-sm);
		font-weight: 550;
		padding: 6px 14px;
		border-radius: 999px;
		cursor: pointer;
		transition: color 0.15s ease, background 0.15s ease;
	}
	.seg-btn:hover { color: var(--text); }
	.seg-btn.on {
		background: var(--accent);
		color: var(--on-accent);
		box-shadow: var(--shadow-sm);
	}

	/* KPI row */
	.kpis {
		position: relative;
		display: grid;
		grid-template-columns: 1.6fr 1fr 1fr 1fr;
		gap: var(--space-5);
	}
	.kpi { display: flex; flex-direction: column; gap: 4px; }
	.kpi--hero { border-right: 1px solid var(--border); }
	.kpi-label {
		font-size: var(--fs-xs);
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.kpi-val {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--fs-xl);
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
	}
	.kpi--hero .kpi-val {
		font-size: var(--fs-2xl);
		background: linear-gradient(90deg, var(--text), var(--accent));
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
	}

	/* ---- Toolbar ---- */
	.toolbar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin-bottom: var(--space-4);
	}
	.fl { display: inline-flex; align-items: center; gap: 7px; font-size: var(--fs-sm); color: var(--text-dim); }
	.fl :global(svg) { color: var(--text-faint); }
	.input--sm { width: auto; padding: 6px 9px; }
	/* icon sits inside the field; padding keeps the text clear of it */
	.search { position: relative; display: flex; align-items: center; flex: 1; min-width: 190px; }
	.search > :global(svg) { position: absolute; left: 10px; color: var(--text-faint); pointer-events: none; }
	.search .input { width: 100%; padding-left: 31px; padding-right: 30px; }
	.search-clear {
		position: absolute; right: 7px;
		display: inline-flex; align-items: center; justify-content: center;
		width: 18px; height: 18px; border-radius: 50%;
		border: none; background: var(--surface-2); color: var(--text-dim); cursor: pointer;
	}
	.search-clear:hover { color: var(--text); }
	.chip-btn {
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-dim);
		font: inherit;
		font-size: var(--fs-sm);
		padding: 6px 12px;
		border-radius: 999px;
		cursor: pointer;
		transition: border-color 0.15s ease, color 0.15s ease;
	}
	.chip-btn:hover { color: var(--text); border-color: var(--border-strong); }
	.fl--check {
		cursor: pointer;
		padding: 6px 12px;
		border: 1px solid var(--border);
		border-radius: 999px;
		transition: border-color 0.15s ease, color 0.15s ease;
	}
	.fl--check .dot {
		width: 8px; height: 8px; border-radius: 50%;
		background: var(--border-strong);
		transition: background 0.15s ease;
	}
	.fl--check.on { color: var(--text); border-color: var(--accent); }
	.fl--check.on .dot { background: var(--accent); }
	.export { margin-left: auto; }

	/* ---- Cards ---- */
	.pad { padding: var(--space-5); }
	.card h3 {
		margin: 0 0 var(--space-4);
		font-size: var(--fs-sm);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-dim);
	}
	.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); align-items: start; }

	/* ---- Detailed ledger ---- */
	.ledger { display: flex; flex-direction: column; }
	.led-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--border);
	}
	.led-row:last-child { border-bottom: none; }
	.led-main { min-width: 0; }
	.led-desc { display: block; font-weight: 600; font-size: var(--fs-md); }
	.led-meta { font-size: var(--fs-xs); color: var(--text-dim); display: flex; align-items: center; gap: 6px; margin-top: 3px; flex-wrap: wrap; }
	.tag {
		font-size: 0.68rem;
		font-weight: 600;
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
	}
	.led-amt { text-align: right; flex: none; }
	.led-total { display: block; font-family: var(--font-display); font-weight: 700; font-size: var(--fs-lg); font-variant-numeric: tabular-nums; }
	.led-share { font-size: var(--fs-xs); color: var(--text-dim); }

	/* ---- Category bars ---- */
	.bars { display: flex; flex-direction: column; gap: var(--space-4); }
	.bar-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; font-size: var(--fs-sm); }
	.bar-name { font-weight: 550; }
	.bar-amt { color: var(--text-dim); font-variant-numeric: tabular-nums; }
	.bar-amt em { color: var(--text-faint); font-style: normal; font-size: var(--fs-xs); margin-left: 4px; }
	.bar-track { height: 8px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
	.bar-fill {
		height: 100%;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--accent-deep), var(--accent));
		transform-origin: left;
		animation: grow 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both;
		animation-delay: calc(var(--i) * 0.05s + 0.15s);
	}
	@keyframes grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }

	/* ---- Member balances ---- */
	.members { display: flex; flex-direction: column; gap: 2px; }
	.mem-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) 0; border-bottom: 1px solid var(--border); }
	.mem-row:last-child { border-bottom: none; }
	.mem-av {
		width: 34px; height: 34px; flex: none;
		display: grid; place-items: center;
		border-radius: 50%;
		background: var(--accent-soft);
		color: var(--accent);
		font-size: var(--fs-xs);
		font-weight: 700;
	}
	.mem-info { min-width: 0; flex: 1; display: flex; flex-direction: column; }
	.mem-name { font-weight: 600; font-size: var(--fs-sm); }
	.mem-sub { font-size: var(--fs-xs); color: var(--text-dim); }
	.mem-net { font-family: var(--font-display); font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text-dim); }
	.mem-net.pos { color: var(--green); }
	.mem-net.neg { color: var(--red); }

	.empty { text-align: center; padding: var(--space-8); color: var(--text-dim); display: grid; place-items: center; gap: 10px; }

	@media (max-width: 640px) {
		.kpis { grid-template-columns: 1fr 1fr; gap: var(--space-4); }
		.kpi--hero { grid-column: 1 / -1; border-right: none; border-bottom: 1px solid var(--border); padding-bottom: var(--space-4); }
		.grid2 { grid-template-columns: 1fr; }
		.export { margin-left: 0; width: 100%; justify-content: center; }
	}
</style>
