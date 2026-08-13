<script>
	import '@fontsource-variable/inter';
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { user, checkSession, logout } from '$lib/auth.js';
	import { applyTheme, THEMES, preferredTheme } from '$lib/themes.js';
	import { pushSupported, registerSW, currentSubscription, subscribePush, unsubscribePush } from '$lib/push.js';
	import Toast from '$lib/components/Toast.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { toast } from '$lib/toast.js';
	import {
		Wallet,
		LayoutDashboard,
		Receipt,
		Users,
		ArrowLeftRight,
		FileSpreadsheet,
		Shield,
		Bell,
		Maximize2,
		Minimize2,
		Palette,
		LogOut,
		Check
	} from 'lucide-svelte';

	let { children } = $props();

	let pushState = $state('unknown'); // unknown | off | on | unsupported
	let themeOpen = $state(false);
	let curTheme = $state('ink');
	let wide = $state(false); // stretch layout to full width on big screens

	function toggleWide() {
		wide = !wide;
		localStorage.setItem('wide', wide ? '1' : '0');
	}

	const PUBLIC_ROUTES = ['/login', '/signup'];
	const isPublic = (path) => PUBLIC_ROUTES.some((p) => path.startsWith(`${base}${p}`));

	// Keepalive: while logged in, re-sync the session every 10 min and whenever the
	// tab becomes visible. Each /api/auth/me call refreshes the rotated session id
	// and slides the cookie's 30-day expiry, so an idle tab never drifts into logout.
	const KEEPALIVE_MS = 10 * 60 * 1000;

	function pingIfVisible() {
		if ($user && document.visibilityState === 'visible') checkSession();
	}

	onMount(() => {
		document.addEventListener('visibilitychange', pingIfVisible);
		const keepaliveTimer = setInterval(pingIfVisible, KEEPALIVE_MS);
		return () => {
			clearInterval(keepaliveTimer);
			document.removeEventListener('visibilitychange', pingIfVisible);
		};
	});

	onMount(async () => {
		curTheme = preferredTheme();
		applyTheme(curTheme);
		wide = localStorage.getItem('wide') === '1';
		await checkSession();
		registerSW();
		if (!pushSupported()) {
			pushState = 'unsupported';
		} else {
			try {
				pushState = (await currentSubscription()) ? 'on' : 'off';
			} catch {
				pushState = 'off';
			}
		}
	});

	// auth gate: once the session check settles, route guests to /login
	$effect(() => {
		if ($user === null && !isPublic($page.url.pathname)) goto(`${base}/login`);
		if ($user && isPublic($page.url.pathname)) goto(`${base}/`);
	});

	async function enablePush() {
		try {
			await subscribePush();
			pushState = 'on';
			toast.success('Notifications enabled');
		} catch (e) {
			toast.error(e.message || 'Could not enable notifications');
		}
	}

	async function doLogout() {
		// unbind this device's push before the session dies — otherwise the next
		// account on this browser inherits a subscription pointed at this user
		await unsubscribePush().catch(() => {});
		if (pushState === 'on') pushState = 'off';
		await logout();
		goto(`${base}/login`);
	}
</script>

<div class="app" class:app--wide={wide}>
	{#if $user === undefined}
		<div class="boot"><span class="spinner"></span></div>
	{:else if $user === null}
		{@render children()}
	{:else if $user.status !== 'approved'}
		<!-- pending approval screen -->
		<div class="card fade-in" style="padding: 32px; margin-top: 18vh; text-align: center;">
			<h2>Waiting for approval</h2>
			<p class="muted" style="margin-top: 12px;">
				Your request to join <strong>{$user.companyName}</strong> is pending. An organization
				admin needs to approve you before you can share expenses.
			</p>
			<div style="display:flex; gap:10px; justify-content:center; margin-top:20px;">
				<button class="btn" onclick={() => checkSession()}>Check again</button>
				<button class="btn btn--ghost" onclick={doLogout}>Log out</button>
			</div>
		</div>
	{:else}
		<header class="topbar">
			<a href="{base}/" class="brand"><Wallet size={20} /> Mess</a>
			<nav>
				<a href="{base}/" class:active={$page.url.pathname === `${base}/`}>
					<LayoutDashboard size={36} /><span>Balances</span>
				</a>
				<a href="{base}/expenses" class:active={$page.url.pathname.startsWith(`${base}/expense`)}>
					<Receipt size={36} /><span>Expenses</span>
				</a>
				<a href="{base}/settle" class:active={$page.url.pathname.startsWith(`${base}/settle`)}>
					<ArrowLeftRight size={36} /><span>Settle</span>
				</a>
				<a href="{base}/reports" class:active={$page.url.pathname.startsWith(`${base}/reports`)}>
					<FileSpreadsheet size={36} /><span>Reports</span>
				</a>
				{#if $user.role === 'admin'}
					<a href="{base}/groups" class:active={$page.url.pathname.startsWith(`${base}/groups`)}>
						<Users size={36} /><span>Groups</span>
					</a>
				{/if}
				{#if $user.role === 'admin'}
					<a href="{base}/admin" class:active={$page.url.pathname.startsWith(`${base}/admin`)}>
						<Shield size={36} /><span>Admin</span>
					</a>
				{/if}
			</nav>
			<div class="topbar-actions">
				{#if pushState === 'off'}
					<button class="icon-btn" title="Enable notifications" aria-label="Enable notifications" onclick={enablePush}><Bell size={18} /></button>
				{/if}
				<a href="{base}/account" class="icon-btn" title="Account" aria-label="Account"><Avatar id={$user?.uid} name={$user?.name} size={24} /></a>
				<button class="icon-btn wide-btn" title={wide ? 'Normal width' : 'Full width'} aria-label="Toggle width" onclick={toggleWide}>
					{#if wide}<Minimize2 size={18} />{:else}<Maximize2 size={18} />{/if}
				</button>
				<button class="icon-btn" class:on={themeOpen} title="Theme" aria-label="Theme" onclick={() => (themeOpen = !themeOpen)}><Palette size={18} /></button>
				<button class="icon-btn" title="Log out" aria-label="Log out" onclick={doLogout}><LogOut size={18} /></button>
			</div>
		</header>
		{#if themeOpen}
			<div class="card theme-picker fade-in">
				{#each THEMES as t (t.id)}
					<button
						class="theme-swatch"
						class:selected={t.id === curTheme}
						onclick={() => { applyTheme(t.id); curTheme = t.id; themeOpen = false; }}
						title={t.name}
					>
						<span class="swatches">
							{#each t.swatch as c (c)}<span style="background:{c}"></span>{/each}
						</span>
						{t.name}
						{#if t.id === curTheme}<Check size={14} />{/if}
					</button>
				{/each}
			</div>
		{/if}
		{@render children()}
	{/if}
</div>
<Toast />

<style>
	/* pointless on phones — layout is already full width there */
	@media (max-width: 800px) {
		.wide-btn {
			display: none;
		}
	}
	.boot {
		display: flex;
		justify-content: center;
		margin-top: 42vh;
	}
	.spinner {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.topbar {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding-bottom: var(--space-4);
		margin-bottom: var(--space-5);
		border-bottom: 1px solid var(--border);
	}
	.brand {
		font-family: var(--font-display);
		font-weight: 650;
		font-size: 1.1rem;
		letter-spacing: -0.02em;
		color: var(--text);
		text-decoration: none;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.brand :global(svg) {
		color: var(--accent);
	}
	nav {
		display: flex;
		gap: 2px;
		flex: 1;
	}
	nav a {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		color: var(--text-dim);
		text-decoration: none;
		font-size: var(--fs-sm);
		font-weight: 550;
		padding: 7px 12px;
		border-radius: var(--radius-sm);
		transition: color 0.12s ease, background 0.12s ease;
	}
	nav a:hover {
		color: var(--text);
		background: var(--surface-2);
	}
	nav a.active {
		color: var(--text);
		background: var(--surface-2);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.topbar-actions {
		display: flex;
		gap: 2px;
	}
	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: var(--radius-sm);
		color: var(--text-dim);
		border: 1px solid transparent;
		background: transparent;
		transition: color 0.12s ease, background 0.12s ease, border-color 0.12s ease;
	}
	.icon-btn:hover {
		color: var(--text);
		background: var(--surface-2);
		border-color: var(--border);
	}
	.icon-btn.on {
		color: var(--accent);
		background: var(--accent-soft);
	}
	.theme-picker {
		padding: var(--space-2);
		margin-bottom: var(--space-5);
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.theme-swatch {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--fs-sm);
		font-weight: 550;
		color: var(--text-dim);
		padding: 7px 12px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		transition: border-color 0.12s ease, color 0.12s ease;
	}
	.theme-swatch:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.theme-swatch.selected {
		color: var(--text);
		border-color: var(--accent);
	}
	.theme-swatch.selected :global(svg) {
		color: var(--accent);
	}
	.swatches {
		display: inline-flex;
	}
	.swatches span {
		width: 13px;
		height: 13px;
		border-radius: 50%;
		display: inline-block;
		border: 1px solid rgba(128, 128, 128, 0.3);
	}
	.swatches span + span {
		margin-left: -4px;
	}
	@media (max-width: 620px) {
		nav a span {
			display: none;
		}
		nav a {
			padding: 8px 10px;
		}
	}
	@media (max-width: 560px) {
		.topbar {
			flex-wrap: wrap;
			gap: var(--space-3);
		}
		nav {
			order: 3;
			width: 100%;
		}
	}
</style>
