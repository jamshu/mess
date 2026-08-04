<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { user } from '$lib/auth.js';
	import { odooClient } from '$lib/odoo.js';
	import { toast } from '$lib/toast.js';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { Plus, Users, Check } from 'lucide-svelte';

	let groups = $state([]);
	let orgUsers = $state([]);
	let newName = $state('');
	let error = $state('');
	let loading = $state(true);

	onMount(async () => {
		try {
			const res = await fetch(`${base}/api/org/users`);
			const d = await res.json();
			// include yourself — a group may or may not contain its creator
			const me = $user ? [{ id: $user.uid, name: `${$user.name} (you)` }] : [];
			if (d.ok) orgUsers = [...me, ...d.users];
			await load();
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	});

	async function load() {
		groups = await odooClient.searchRecords([], ['x_name', 'x_studio_member_ids', 'create_uid', 'x_studio_is_default'], 'groups', { order: 'x_name asc' });
	}

	async function createGroup(e) {
		e.preventDefault();
		if (!newName.trim()) {
			toast.error('Enter a group name');
			return;
		}
		error = '';
		try {
			await odooClient.createRecord({ x_name: newName.trim() }, 'groups');
			newName = '';
			await load();
			toast.success('Group created');
		} catch (err) {
			toast.error(err.message);
		}
	}

	async function toggleMember(group, userId) {
		const members = group.x_studio_member_ids || [];
		const next = members.includes(userId)
			? members.filter((m) => m !== userId)
			: [...members, userId];
		try {
			await odooClient.updateRecord(group.id, { x_studio_member_ids: [[6, 0, next]] }, 'groups');
			group.x_studio_member_ids = next;
			groups = groups;
		} catch (err) {
			toast.error(err.message);
		}
	}

	// One default group at a time. Flip target on; flip every other default off.
	// ponytail: cross-owner unset can 403 (proxy owner-guard); fine since Groups is
	// admin-managed, and expense auto-select just picks the first default anyway.
	async function toggleDefault(group) {
		const next = !group.x_studio_is_default;
		try {
			await odooClient.updateRecord(group.id, { x_studio_is_default: next }, 'groups');
			group.x_studio_is_default = next;
			if (next) {
				for (const other of groups) {
					if (other.id !== group.id && other.x_studio_is_default) {
						try {
							await odooClient.updateRecord(other.id, { x_studio_is_default: false }, 'groups');
							other.x_studio_is_default = false;
						} catch { /* not ours to edit — leave it */ }
					}
				}
			}
			groups = groups;
		} catch (err) {
			toast.error(err.message);
		}
	}

	async function removeGroup(id) {
		try {
			await odooClient.deleteRecord(id, 'groups');
			await load();
			toast.success('Group deleted');
		} catch (err) {
			toast.error(err.message);
		}
	}
</script>

<div class="head-row">
	<h1>Expense groups</h1>
</div>
<p class="muted">A reusable set of people. Pick a group on an expense to split it across everyone in it at once. You don't have to include yourself.</p>

<form class="card new-group" onsubmit={createGroup}>
	<input class="input" placeholder="New group name…" bind:value={newName} />
	<button class="btn btn--primary"><Plus size={16} /> Create</button>
</form>

{#if error}<p class="error-text">{error}</p>{/if}

{#if loading}
	{#each Array(2) as _}
		<div class="card group-card"><Skeleton h="1.05rem" w="40%" /><div style="margin-top:14px"><Skeleton h="0.8rem" w="25%" /></div></div>
	{/each}
{:else}
	{#each groups as g, i (g.id)}
		{@const count = (g.x_studio_member_ids || []).length}
		<div class="card group-card fade-in" style="--fade-delay: {i * 0.04}s">
			<div class="group-head">
				<h3>{g.x_name}</h3>
				<span class="chip"><Users size={13} /> {count}</span>
				{#if g.create_uid?.[0] === $user?.uid}
					<ConfirmButton label="Delete" confirmLabel="Sure?" onconfirm={() => removeGroup(g.id)} />
				{/if}
			</div>
			{#if g.create_uid?.[0] === $user?.uid}
				<button
					class="chip default-toggle {g.x_studio_is_default ? 'chip--accent' : ''}"
					onclick={() => toggleDefault(g)}
				>{#if g.x_studio_is_default}<Check size={13} />{/if}Default group</button>
				<div class="picker">
					{#each orgUsers as u (u.id)}
						{@const on = (g.x_studio_member_ids || []).includes(u.id)}
						<button
							class="chip {on ? 'chip--accent' : ''}"
							onclick={() => toggleMember(g, u.id)}
						>{#if on}<Check size={13} />{/if}{u.name}</button>
					{/each}
					{#if orgUsers.length === 0}
						<p class="muted">No other members in your organization yet.</p>
					{/if}
				</div>
			{/if}
		</div>
	{:else}
		<p class="muted" style="margin-top:16px;">No groups yet.</p>
	{/each}
{/if}

<style>
	.head-row {
		margin: var(--space-2) 0 var(--space-2);
	}
	.new-group {
		display: flex;
		gap: var(--space-2);
		padding: var(--space-3);
		margin: var(--space-4) 0;
	}
	.group-card {
		padding: var(--space-4);
		margin-bottom: var(--space-3);
	}
	.group-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}
	.group-head h3 {
		flex: 1;
		font-size: var(--fs-lg);
		font-weight: 600;
	}
	.picker {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.picker .chip {
		cursor: pointer;
	}
	.default-toggle {
		cursor: pointer;
		margin-bottom: var(--space-3);
	}
</style>
