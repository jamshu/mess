<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { user } from '$lib/auth.js';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { fmt } from '$lib/money.js';
	import { Plus, ArrowLeftRight, TrendingUp, TrendingDown, Check } from 'lucide-svelte';

	let rows = $state([]);
	let expenseCount = $state(0);
	let loading = $state(true);
	let error = $state('');

	let me = $derived(rows.find((r) => r.isMe));

	onMount(load);

	async function load() {
		loading = true;
		error = '';
		try {
			const res = await fetch(`${base}/api/dashboard`);
			const d = await res.json();
			if (!d.ok) throw new Error(d.error || 'Could not load balances');
			rows = d.rows;
			expenseCount = d.expenseCount;
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	}
</script>

<div class="head-row">
	<h1>Balances</h1>
	<a href="{base}/expenses" class="btn btn--primary"><Plus size={16} /> Add expense</a>
</div>

{#if loading}
	<div class="card hero-card"><Skeleton h="2.2rem" w="55%" /><div style="margin-top:12px"><Skeleton h="0.9rem" w="35%" /></div></div>
	{#each Array(3) as _}
		<div class="card row-card"><Skeleton h="1rem" w="40%" /></div>
	{/each}
{:else if error}
	<p class="error-text">{error}</p>
	<button class="btn" onclick={load}>Retry</button>
{:else}
	<!-- your standing -->
	{#if me}
		{@const owed = me.net > 0.005}
		{@const owe = me.net < -0.005}
		<div class="card hero-card fade-in" class:pos={owed} class:neg={owe}>
			<div class="hero-label">
				{#if owed}<TrendingUp size={16} /> You're owed{:else if owe}<TrendingDown size={16} /> You owe{:else}<Check size={16} /> You're settled up{/if}
			</div>
			<div class="hero-amount">{fmt(Math.abs(me.net))}</div>
			<div class="hero-sub">
				Paid {fmt(me.paid)} · Share {fmt(me.cost)}{#if me.sent} · Settled out {fmt(me.sent)}{/if}{#if me.received} · Settled in {fmt(me.received)}{/if}
			</div>
			{#if owe || owed}
				<a href="{base}/settle" class="btn btn--sm" style="margin-top:14px;"><ArrowLeftRight size={14} /> Settle up</a>
			{/if}
		</div>
	{/if}

	<div class="section-title">Everyone</div>
	{#each rows as r, i (r.id)}
		{@const pos = r.net > 0.005}
		{@const neg = r.net < -0.005}
		<div class="card row-card fade-in" style="--fade-delay:{i * 0.03}s">
			<div class="who">
				<Avatar id={r.id} name={r.name} size={38} variant={pos ? 'pos' : neg ? 'neg' : ''} />
				<div>
					<div class="name">{r.name}{#if r.isMe}<span class="you">you</span>{/if}</div>
					<div class="meta">Paid {fmt(r.paid)} · Share {fmt(r.cost)}{#if r.sent} · Settled out {fmt(r.sent)}{/if}{#if r.received} · Settled in {fmt(r.received)}{/if}</div>
				</div>
			</div>
			<div class="net" class:pos class:neg>
				{#if pos}+{fmt(r.net)}{:else if neg}{fmt(r.net)}{:else}Settled{/if}
			</div>
		</div>
	{:else}
		<p class="muted" style="margin-top:16px;">No members yet.</p>
	{/each}

	{#if expenseCount === 0}
		<div class="card empty fade-in">
			<p class="muted">No expenses yet. Add the first one to start splitting.</p>
			<a href="{base}/expenses" class="btn btn--primary" style="margin-top:12px;"><Plus size={16} /> Add expense</a>
		</div>
	{/if}
{/if}

<style>
	.head-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin: var(--space-2) 0 var(--space-5);
	}
	.hero-card {
		padding: var(--space-6);
		text-align: center;
		border-width: 1px;
	}
	.hero-card.pos { border-color: color-mix(in srgb, var(--green) 45%, var(--border)); background: color-mix(in srgb, var(--green) 7%, var(--surface)); }
	.hero-card.neg { border-color: color-mix(in srgb, var(--red) 45%, var(--border)); background: color-mix(in srgb, var(--red) 7%, var(--surface)); }
	.hero-label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.hero-card.pos .hero-label { color: var(--green); }
	.hero-card.neg .hero-label { color: var(--red); }
	.hero-amount {
		font-family: var(--font-display);
		font-size: 2.6rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		margin-top: var(--space-2);
	}
	.hero-sub { font-size: var(--fs-sm); color: var(--text-dim); margin-top: var(--space-1); }
	.row-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		margin-bottom: var(--space-2);
	}
	.who { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
	.name { font-weight: 600; font-size: var(--fs-md); display: flex; align-items: center; gap: 6px; }
	.you {
		font-size: var(--fs-xs); font-weight: 600; color: var(--accent);
		background: var(--accent-soft); padding: 1px 7px; border-radius: 999px;
	}
	.meta { font-size: var(--fs-xs); color: var(--text-dim); margin-top: 2px; }
	.net {
		font-family: var(--font-display);
		font-weight: 700; font-size: var(--fs-lg);
		font-variant-numeric: tabular-nums;
		color: var(--text-dim);
	}
	.net.pos { color: var(--green); }
	.net.neg { color: var(--red); }
	.empty { padding: var(--space-6); text-align: center; margin-top: var(--space-4); }
</style>
