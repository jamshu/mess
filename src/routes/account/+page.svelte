<script>
	import { base } from '$app/paths';
	import { user, updateProfile } from '$lib/auth.js';
	import { unsubscribePush } from '$lib/push.js';
	import { toast } from '$lib/toast.js';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import { TriangleAlert, Building2, Mail, Camera } from 'lucide-svelte';

	let password = $state('');
	let busy = $state(false);
	let error = $state('');

	// Profile edit. name syncs from the store until the user starts typing.
	let name = $state('');
	let nameEdited = $state(false);
	let avatarB64 = $state(undefined); // undefined = unchanged, string = new, '' = cleared
	let avatarPreview = $state(''); // data-URL for local preview
	let saving = $state(false);

	$effect(() => {
		if ($user && !nameEdited) name = $user.name ?? '';
	});

	const shownAvatar = $derived(
		avatarPreview || ($user?.avatar ? `data:image/png;base64,${$user.avatar}` : '')
	);

	function fileToBase64(file) {
		return new Promise((res, rej) => {
			const r = new FileReader();
			r.onload = () => res(String(r.result));
			r.onerror = rej;
			r.readAsDataURL(file);
		});
	}

	async function pickAvatar(e) {
		const file = e.target.files?.[0];
		if (!file) return;
		if (file.size > 5 * 1024 * 1024) {
			toast.error('Image too large (max 5MB)');
			return;
		}
		const dataUrl = await fileToBase64(file);
		avatarPreview = dataUrl;
		avatarB64 = dataUrl.split(',')[1] || '';
	}

	async function saveProfile() {
		const payload = {};
		if (name.trim() && name.trim() !== $user?.name) payload.name = name.trim();
		if (avatarB64 !== undefined) payload.avatar = avatarB64;
		if (!Object.keys(payload).length) {
			toast.error('Nothing to update');
			return;
		}
		saving = true;
		try {
			await updateProfile(payload);
			avatarB64 = undefined;
			avatarPreview = '';
			nameEdited = false;
			toast.success('Profile updated');
		} catch (e) {
			toast.error(e.message);
		} finally {
			saving = false;
		}
	}

	async function deleteAccount() {
		if (!password) {
			error = 'Enter your password to confirm.';
			return;
		}
		busy = true;
		error = '';
		try {
			// drop this device's push subscription while the session still works —
			// it survives page reloads and would hide the bell for the next account
			await unsubscribePush().catch(() => {});
			const res = await fetch(`${base}/api/account`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password })
			});
			const d = await res.json();
			if (!d.ok) throw new Error(d.error);
			// full reload clears all client state and lands on login
			location.href = `${base}/login`;
		} catch (e) {
			error = e.message;
			busy = false;
		}
	}
</script>

<div class="head-row">
	<h1>Account</h1>
</div>

<div class="card info-card">
	<label class="avatar-edit" title="Change photo">
		{#if shownAvatar}
			<img class="avatar avatar-img" src={shownAvatar} alt="Your avatar" />
		{:else}
			<div class="avatar">{($user?.name || '?').trim().charAt(0).toUpperCase()}</div>
		{/if}
		<span class="avatar-cam"><Camera size={14} /></span>
		<input type="file" accept="image/*" onchange={pickAvatar} hidden />
	</label>
	<div class="info-lines">
		<strong>{$user?.name}</strong>
		<div class="info-line"><Mail size={14} /> {$user?.email}</div>
		<div class="info-line">
			<Building2 size={14} /> {$user?.companyName}
			<span class="chip chip--accent">{$user?.role === 'admin' ? 'admin' : 'member'}</span>
		</div>
	</div>
</div>

<div class="card edit-card">
	<label class="field-label" for="display-name">Display name</label>
	<input
		id="display-name"
		class="input"
		bind:value={name}
		oninput={() => (nameEdited = true)}
		placeholder="Your name"
		autocomplete="name"
	/>
	<div class="row">
		<button class="btn btn--primary" onclick={saveProfile} disabled={saving}>
			{saving ? 'Saving…' : 'Save changes'}
		</button>
	</div>
</div>

<div class="section-title"><TriangleAlert size={15} /> Danger zone</div>
<div class="card danger-card">
	<p class="muted" style="margin:0 0 12px;">
		Deleting your account is permanent. Your expenses, their comments, your comments on other
		expenses, your settlements, and your expense groups are all deleted and cannot be recovered.
		Settle up first — you stay listed as payer/participant on other people's expenses.
	</p>
	<input
		class="input"
		type="password"
		placeholder="Confirm with your password"
		bind:value={password}
		autocomplete="current-password"
	/>
	{#if error}<p class="error-text">{error}</p>{/if}
	<div class="row">
		<ConfirmButton
			label={busy ? 'Deleting…' : 'Delete my account'}
			confirmLabel="Permanently delete everything?"
			onconfirm={deleteAccount}
		/>
	</div>
</div>

<style>
	.head-row {
		margin: var(--space-2) 0 var(--space-4);
	}
	.info-card {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-4);
	}
	.avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		flex-shrink: 0;
		border-radius: 50%;
		background: var(--accent);
		color: var(--on-accent);
		font-size: 1.2rem;
		font-weight: 650;
	}
	.avatar-img {
		object-fit: cover;
	}
	.avatar-edit {
		position: relative;
		cursor: pointer;
		flex-shrink: 0;
		line-height: 0;
	}
	.avatar-cam {
		position: absolute;
		right: -2px;
		bottom: -2px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--surface);
		border: 1px solid var(--border);
		color: var(--text-dim);
	}
	.edit-card {
		padding: var(--space-4);
		margin-top: var(--space-3);
	}
	.field-label {
		display: block;
		font-size: var(--fs-sm);
		color: var(--text-dim);
		margin-bottom: var(--space-2);
	}
	.info-lines {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}
	.info-lines strong {
		font-size: var(--fs-lg);
	}
	.info-line {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: var(--fs-sm);
		color: var(--text-dim);
	}
	.info-line :global(svg) {
		color: var(--text-faint);
	}
	.danger-card {
		padding: var(--space-4);
		border-color: color-mix(in srgb, var(--red) 40%, var(--border));
		background: color-mix(in srgb, var(--red) 4%, var(--surface));
	}
	.row {
		display: flex;
		justify-content: flex-end;
		margin-top: var(--space-3);
	}
</style>
