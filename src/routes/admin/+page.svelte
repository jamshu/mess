<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { user } from '$lib/auth.js';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { toast } from '$lib/toast.js';
	import { Link2, UserCheck, Users, Copy, Check } from 'lucide-svelte';

	let pending = $state([]);
	let members = $state([]);
	let error = $state('');
	let loading = $state(true);
	let copied = $state(false);

	let inviteLink = $derived(
		$user?.inviteToken ? `${location.origin}${base}/signup?invite=${$user.inviteToken}` : ''
	);

	onMount(load);

	async function load() {
		loading = true;
		error = '';
		try {
			const res = await fetch(`${base}/api/org/members`);
			const d = await res.json();
			if (!d.ok) throw new Error(d.error);
			pending = d.pending;
			members = d.members || [];
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	}

	async function act(userId, action) {
		error = '';
		try {
			const res = await fetch(`${base}/api/org/members`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId, action })
			});
			const d = await res.json();
			if (!d.ok) throw new Error(d.error);
			await load();
			toast.success(action === 'approve' ? 'Member approved' : action === 'reject' ? 'Request rejected' : 'Member removed');
		} catch (e) {
			toast.error(e.message);
		}
	}

	async function copyInvite() {
		await navigator.clipboard.writeText(inviteLink);
		copied = true;
		toast.success('Invite link copied');
		setTimeout(() => (copied = false), 1500);
	}
</script>

<div class="head-row">
	<h1>{$user?.companyName}</h1>
</div>

<div class="section-title"><Link2 size={15} /> Invite link</div>
<div class="card invite-card">
	<p class="muted" style="margin:0 0 12px;">
		Anyone who signs up through this link joins your organization automatically — no approval needed.
	</p>
	<div class="invite-row">
		<input class="input mono" readonly value={inviteLink} onfocus={(e) => e.target.select()} />
		<button class="btn btn--primary" onclick={copyInvite}>
			{#if copied}<Check size={16} /> Copied{:else}<Copy size={16} /> Copy{/if}
		</button>
	</div>
</div>

<div class="section-title"><UserCheck size={15} /> Pending approvals</div>
{#if error}<p class="error-text">{error}</p>{/if}
{#if loading}
	{#each Array(2) as _}
		<div class="card pending-row"><div style="flex:1"><Skeleton h="0.95rem" w="30%" /><div style="margin-top:8px"><Skeleton h="0.8rem" w="45%" /></div></div></div>
	{/each}
{:else if pending.length === 0}
	<p class="muted">No one is waiting for approval.</p>
{:else}
	{#each pending as p, i (p.id)}
		<div class="card pending-row fade-in" style="--fade-delay: {i * 0.04}s">
			<div class="avatar">{(p.name || '?').trim().charAt(0).toUpperCase()}</div>
			<div class="who">
				<strong>{p.name}</strong>
				<div class="muted">{p.email}</div>
			</div>
			<div class="actions">
				<button class="btn btn--sm btn--primary" onclick={() => act(p.id, 'approve')}>Approve</button>
				<button class="btn btn--sm btn--danger" onclick={() => act(p.id, 'reject')}>Reject</button>
			</div>
		</div>
	{/each}
{/if}

<div class="section-title"><Users size={15} /> Members</div>
{#if !loading && members.length === 0}
	<p class="muted">No other members yet.</p>
{:else}
	{#each members as m, i (m.id)}
		<div class="card pending-row fade-in" style="--fade-delay: {i * 0.04}s">
			<div class="avatar">{(m.name || '?').trim().charAt(0).toUpperCase()}</div>
			<div class="who">
				<strong>{m.name}</strong>
				<div class="muted">{m.email}</div>
			</div>
			<div class="actions">
				<ConfirmButton
					label="Remove"
					confirmLabel="Delete user + their expenses?"
					onconfirm={() => act(m.id, 'remove')}
				/>
			</div>
		</div>
	{/each}
{/if}

<style>
	.head-row {
		margin: var(--space-2) 0 var(--space-4);
	}
	.invite-card {
		padding: var(--space-4);
	}
	.invite-row {
		display: flex;
		gap: var(--space-2);
	}
	.invite-row .mono {
		font-size: var(--fs-xs);
	}
	.pending-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		margin-bottom: var(--space-2);
	}
	.avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		border-radius: 50%;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text-dim);
		font-weight: 650;
		font-size: 0.9rem;
	}
	.who {
		flex: 1;
		min-width: 0;
	}
	.who strong {
		font-size: var(--fs-sm);
	}
	.who .muted {
		font-size: var(--fs-xs);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
	}
</style>
