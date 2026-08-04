<script>
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { base } from '$app/paths';
	import { user } from '$lib/auth.js';
	import { odooClient } from '$lib/odoo.js';
	import { toast } from '$lib/toast.js';
	import { fmt } from '$lib/money.js';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { resizeImage, createVoiceRecorder, MAX_VOICE_MS } from '$lib/media.js';
	import { ArrowLeft, Paperclip, Mic, Square, Send, Image as ImageIcon, FileText } from 'lucide-svelte';

	let id = $derived(Number($page.params.id));

	let expense = $state(null);
	let members = $state([]);
	let bills = $state([]);
	let comments = $state([]);
	let loading = $state(true);
	let error = $state('');

	let cursor = 0;
	let pollTimer = null;

	// composer
	let text = $state('');
	let sending = $state(false);
	let imgInput;
	let recorder = null;
	let recording = $state(false);
	let recSecs = $state(0);
	let recTimer = null;

	let nameOf = $derived((uid) => members.find((m) => m.id === uid)?.name || `#${uid}`);
	let participantIds = $derived(expense?.x_studio_participant_ids || []);
	let share = $derived(
		expense && participantIds.length ? expense.x_studio_amount / participantIds.length : 0
	);
	const mediaUrl = (attId) => `${base}/api/expenses/${id}/media/${attId}`;

	onMount(async () => {
		try {
			const res = await fetch(`${base}/api/org/users`);
			const d = await res.json();
			const me = $user ? [{ id: $user.uid, name: `${$user.name} (you)` }] : [];
			members = [...me, ...(d.ok ? d.users : [])];

			const [ex] = await odooClient.searchRecords(
				[['id', '=', id]],
				['x_name', 'x_studio_amount', 'x_studio_category', 'x_studio_date', 'x_studio_payer_id', 'x_studio_participant_ids'],
				'expenses'
			);
			if (!ex) throw new Error('Expense not found');
			expense = ex;
			await Promise.all([loadBills(), poll()]);
			pollTimer = setInterval(poll, 2500);
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	});

	onDestroy(() => {
		clearInterval(pollTimer);
		clearInterval(recTimer);
		recorder?.cancel?.();
	});

	async function loadBills() {
		const res = await fetch(`${base}/api/expenses/${id}/attachments`);
		const d = await res.json();
		if (d.ok) bills = d.bills;
	}

	async function poll() {
		try {
			const res = await fetch(`${base}/api/expenses/${id}/comments?since=${cursor}`);
			const d = await res.json();
			if (!d.ok) return;
			if (d.comments.length) comments = [...comments, ...d.comments];
			cursor = d.cursor;
		} catch {
			/* transient — next tick retries */
		}
	}

	async function post(body) {
		const res = await fetch(`${base}/api/expenses/${id}/comments`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		const d = await res.json();
		if (!d.ok) throw new Error(d.error || 'Failed to post');
		await poll();
	}

	async function sendText() {
		const t = text.trim();
		if (!t || sending) return;
		sending = true;
		try {
			await post({ text: t });
			text = '';
		} catch (e) {
			toast.error(e.message);
		} finally {
			sending = false;
		}
	}

	async function pickImage(e) {
		const file = e.target.files?.[0];
		e.target.value = '';
		if (!file) return;
		sending = true;
		try {
			const { dataBase64, mime, w, h } = await resizeImage(file);
			await post({ kind: 'image', dataBase64, mime, w, h });
		} catch (err) {
			toast.error(err.message);
		} finally {
			sending = false;
		}
	}

	async function toggleRecord() {
		if (recording) {
			const clip = await recorder.stop();
			recording = false;
			clearInterval(recTimer);
			recSecs = 0;
			if (!clip) return;
			sending = true;
			try {
				await post({ kind: 'voice', dataBase64: clip.dataBase64, mime: clip.mime, dur: clip.dur });
			} catch (e) {
				toast.error(e.message);
			} finally {
				sending = false;
			}
			return;
		}
		recorder ||= createVoiceRecorder();
		try {
			await recorder.start(() => toggleRecord()); // auto-stop at MAX_VOICE_MS
			recording = true;
			recSecs = 0;
			recTimer = setInterval(() => (recSecs += 1), 1000);
		} catch (e) {
			toast.error(e.message || 'Microphone unavailable');
		}
	}

	const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
</script>

<a href="{base}/expenses" class="back"><ArrowLeft size={16} /> Expenses</a>

{#if loading}
	<div class="card" style="padding:20px;margin-top:12px;"><Skeleton h="1.6rem" w="60%" /><div style="margin-top:12px"><Skeleton h="0.9rem" w="40%" /></div></div>
{:else if error}
	<p class="error-text">{error}</p>
{:else if expense}
	<div class="card exp-head fade-in">
		<div class="eh-top">
			<h1>{expense.x_name}</h1>
			<div class="eh-amount">{fmt(expense.x_studio_amount)}</div>
		</div>
		<div class="eh-meta">
			<strong>{expense.x_studio_payer_id?.[1] || 'Someone'}</strong> paid ·
			{expense.x_studio_date}
			{#if expense.x_studio_category}· <span class="chip chip--accent">{expense.x_studio_category}</span>{/if}
		</div>
		<div class="section-title">Split · {fmt(share)} each</div>
		<div class="parts">
			{#each participantIds as pid (pid)}
				<span class="chip">{nameOf(pid)}</span>
			{/each}
		</div>
	</div>

	{#if bills.length}
		<div class="section-title">Bills</div>
		<div class="bills">
			{#each bills as b (b.id)}
				{#if b.mime.startsWith('image/')}
					<a href={mediaUrl(b.id)} target="_blank" rel="noopener" class="bill-thumb">
						<img src={mediaUrl(b.id)} alt={b.name} />
					</a>
				{:else}
					<a href={mediaUrl(b.id)} target="_blank" rel="noopener" class="bill-file">
						<FileText size={18} /> {b.name}
					</a>
				{/if}
			{/each}
		</div>
	{/if}

	<div class="section-title">Comments</div>
	<div class="thread">
		{#each comments as c (c.id)}
			{@const mine = c.authorId === $user?.uid}
			<div class="cmt" class:mine>
				<div class="bubble">
					{#if c.kind === 'image'}
						<a href={mediaUrl(c.attId)} target="_blank" rel="noopener">
							<img class="cmt-img" src={mediaUrl(c.attId)} alt="photo" />
						</a>
					{:else if c.kind === 'voice'}
						<audio src={mediaUrl(c.attId)} controls preload="none"></audio>
						{#if c.meta?.dur}<span class="dur">{mmss(c.meta.dur)}</span>{/if}
					{/if}
					{#if c.text}<div class="cmt-text">{c.text}</div>{/if}
				</div>
				<div class="cmt-by">
					<Avatar id={c.authorId} name={mine ? $user?.name : c.author} size={18} />
					{mine ? 'You' : c.author}
				</div>
			</div>
		{:else}
			<p class="muted">No comments yet. Start the thread.</p>
		{/each}
	</div>

	<div class="composer">
		<input class="input" placeholder="Add a comment…" bind:value={text}
			onkeydown={(e) => e.key === 'Enter' && sendText()} disabled={recording} />
		<input type="file" accept="image/*" hidden bind:this={imgInput} onchange={pickImage} />
		<button class="icon-btn" title="Photo" aria-label="Photo" onclick={() => imgInput.click()} disabled={sending || recording}>
			<ImageIcon size={18} />
		</button>
		<button class="icon-btn" class:rec={recording} title="Voice" aria-label="Voice" onclick={toggleRecord} disabled={sending}>
			{#if recording}<Square size={16} />{:else}<Mic size={18} />{/if}
		</button>
		<button class="btn btn--primary btn--sm" onclick={sendText} disabled={sending || recording || !text.trim()}>
			<Send size={15} />
		</button>
	</div>
	{#if recording}
		<div class="rec-bar">● Recording {mmss(recSecs)} — tap ■ to send (max {MAX_VOICE_MS / 1000}s)</div>
	{/if}
{/if}

<style>
	.back { display: inline-flex; align-items: center; gap: 5px; color: var(--text-dim); text-decoration: none; font-size: var(--fs-sm); margin: var(--space-2) 0; }
	.back:hover { color: var(--text); }
	.exp-head { padding: var(--space-5); margin-bottom: var(--space-4); }
	.eh-top { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
	.eh-top h1 { font-size: var(--fs-xl); }
	.eh-amount { font-family: var(--font-display); font-weight: 700; font-size: var(--fs-xl); font-variant-numeric: tabular-nums; }
	.eh-meta { font-size: var(--fs-sm); color: var(--text-dim); margin-top: 4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
	.parts { display: flex; flex-wrap: wrap; gap: var(--space-2); }
	.bills { display: flex; flex-wrap: wrap; gap: var(--space-2); }
	.bill-thumb img { width: 84px; height: 84px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border); display: block; }
	.bill-file { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); text-decoration: none; color: var(--text); }
	.thread { display: flex; flex-direction: column; gap: var(--space-3); margin-bottom: var(--space-4); }
	.cmt { display: flex; flex-direction: column; align-items: flex-start; max-width: 82%; }
	.cmt.mine { align-self: flex-end; align-items: flex-end; }
	.bubble { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-2) var(--space-3); }
	.cmt.mine .bubble { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); }
	.cmt-text { font-size: var(--fs-md); line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
	.cmt-img { max-width: 220px; border-radius: var(--radius-sm); display: block; }
	.bubble audio { display: block; max-width: 240px; }
	.dur { font-size: var(--fs-xs); color: var(--text-dim); }
	.cmt-by { display: flex; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--text-dim); margin-top: 3px; padding: 0 4px; }
	.cmt.mine .cmt-by { flex-direction: row-reverse; }
	.composer { display: flex; align-items: center; gap: var(--space-2); position: sticky; bottom: 0; padding: var(--space-3) 0; background: linear-gradient(to top, var(--bg) 70%, transparent); }
	.composer .input { flex: 1; }
	.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: var(--radius-sm); color: var(--text-dim); border: 1px solid var(--border); background: var(--surface); }
	.icon-btn:hover:not(:disabled) { color: var(--text); border-color: var(--border-strong); }
	.icon-btn.rec { color: #fff; background: var(--red); border-color: var(--red); }
	.icon-btn:disabled { opacity: 0.5; }
	.rec-bar { font-size: var(--fs-xs); color: var(--red); text-align: center; padding-bottom: var(--space-3); }
</style>
