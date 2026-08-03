<script>
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { login } from '$lib/auth.js';
	import { Wallet as Files } from 'lucide-svelte';

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit(e) {
		e.preventDefault();
		error = '';
		busy = true;
		try {
			await login(email, password);
			goto(`${base}/`);
		} catch (err) {
			error = err.message;
		} finally {
			busy = false;
		}
	}
</script>

<div class="auth-wrap fade-in">
	<div class="brand-mark"><Files size={26} /></div>
	<h1>Mess</h1>
	<p class="muted" style="margin: 8px 0 26px;">Share a room, split expenses, settle up.</p>
	<form class="card auth-card" onsubmit={submit}>
		<label class="label" for="email">Username, email or mobile</label>
		<!-- svelte-ignore a11y_autofocus -->
		<input id="email" class="input" type="text" bind:value={email} autocomplete="username" placeholder="username, email or mobile" autofocus required />
		<label class="label" for="password">Password</label>
		<input id="password" class="input" type="password" bind:value={password} autocomplete="current-password" required />
		{#if error}<p class="error-text">{error}</p>{/if}
		<button class="btn btn--primary" style="width:100%; margin-top:20px;" disabled={busy}>
			{busy ? 'Signing in…' : 'Sign in'}
		</button>
		<p class="muted" style="text-align:center; margin-top:16px;">
			No account? <a href="{base}/signup">Sign up</a>
		</p>
	</form>
</div>

<style>
	.auth-wrap {
		max-width: 380px;
		margin: 12vh auto 0;
		text-align: center;
	}
	.brand-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 52px;
		height: 52px;
		margin-bottom: var(--space-4);
		border-radius: var(--radius);
		background: var(--accent-soft);
		color: var(--accent);
		border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
	}
	.auth-card {
		padding: var(--space-6);
		text-align: left;
	}
	.auth-card a {
		color: var(--accent);
		font-weight: 550;
	}
</style>
