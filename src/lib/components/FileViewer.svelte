<script>
	import Modal from './Modal.svelte';
	import { Download } from 'lucide-svelte';
	import { downloadFile } from '$lib/download.js';
	import { toast } from '$lib/toast.js';
	import * as pdfjsLib from 'pdfjs-dist';
	import { marked } from 'marked';
	import Papa from 'papaparse';

	pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

	let { file = $bindable(null), href = '', downloadHref = '' } = $props();
	let canvasEl = $state(null);
	let pdfError = $state('');

	// JSON state
	let jsonContent = $state('');
	let jsonError = $state('');

	// Markdown state
	let mdHtml = $state('');
	let mdError = $state('');

	// CSV state
	let csvData = $state([]);
	let csvError = $state('');

	async function save() {
		try {
			await downloadFile(downloadHref, file.name);
		} catch (e) {
			toast.error(e.message);
		}
	}

	// PDF Render Effect
	$effect(() => {
		if (file?.mimetype !== 'application/pdf' || !href || !canvasEl) return;
		pdfError = '';
		let cancelled = false;
		let loadingTask;

		(async () => {
			try {
				const response = await fetch(href, { credentials: 'include' });
				if (!response.ok) {
					throw new Error(`Failed to fetch file: ${response.statusText}`);
				}
				const data = await response.arrayBuffer();
				if (cancelled) return;

				loadingTask = pdfjsLib.getDocument({
					data,
					standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`
				});

				const pdfDoc = await loadingTask.promise;
				if (cancelled) return;

				const page = await pdfDoc.getPage(1);
				if (cancelled) return;

				const scale = Math.max(2, window.devicePixelRatio || 1);
				const viewport = page.getViewport({ scale });

				canvasEl.width = viewport.width;
				canvasEl.height = viewport.height;

				await page.render({
					canvasContext: canvasEl.getContext('2d'),
					viewport
				}).promise;
			} catch (e) {
				console.error('PDF.js Error:', e);
				if (!cancelled) pdfError = e.message;
			}
		})();

		return () => {
			cancelled = true;
			loadingTask?.destroy();
		};
	});

	// JSON Fetch and Format Effect
	$effect(() => {
		const isJson = file?.mimetype === 'application/json' || file?.name?.endsWith('.json');
		if (!isJson || !href) return;

		jsonError = '';
		jsonContent = '';
		let cancelled = false;

		(async () => {
			try {
				const res = await fetch(href, { credentials: 'include' });
				if (!res.ok) throw new Error(`Failed to fetch JSON: ${res.statusText}`);

				const rawData = await res.json();
				if (cancelled) return;

				jsonContent = JSON.stringify(rawData, null, 2);
			} catch (e) {
				console.error('JSON Preview Error:', e);
				if (!cancelled) jsonError = e.message;
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	// Markdown Fetch and Parse Effect
	$effect(() => {
		const isMarkdown =
			file?.mimetype === 'text/markdown' ||
			file?.name?.endsWith('.md') ||
			file?.name?.endsWith('.markdown');

		if (!isMarkdown || !href) return;

		mdError = '';
		mdHtml = '';
		let cancelled = false;

		(async () => {
			try {
				const res = await fetch(href, { credentials: 'include' });
				if (!res.ok) throw new Error(`Failed to fetch Markdown: ${res.statusText}`);

				const text = await res.text();
				if (cancelled) return;

				mdHtml = await marked.parse(text);
			} catch (e) {
				console.error('Markdown Preview Error:', e);
				if (!cancelled) mdError = e.message;
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	// CSV Fetch and Parse Effect
	$effect(() => {
		const isCsv = file?.mimetype === 'text/csv' || file?.name?.endsWith('.csv');
		if (!isCsv || !href) return;

		csvError = '';
		csvData = [];
		let cancelled = false;

		(async () => {
			try {
				const res = await fetch(href, { credentials: 'include' });
				if (!res.ok) throw new Error(`Failed to fetch CSV: ${res.statusText}`);

				const text = await res.text();
				if (cancelled) return;

				Papa.parse(text, {
					skipEmptyLines: true,
					complete: (results) => {
						if (!cancelled) csvData = results.data;
					},
					error: (err) => {
						if (!cancelled) csvError = err.message;
					}
				});
			} catch (e) {
				console.error('CSV Preview Error:', e);
				if (!cancelled) csvError = e.message;
			}
		})();

		return () => {
			cancelled = true;
		};
	});
</script>

<Modal bind:open={() => !!file, (v) => { if (!v) file = null; }} fullscreen>
	{#snippet header()}
		<span class="name">{file?.name}</span>
		<button class="btn btn--sm btn--secondary" onclick={save}><Download size={15} /> Download</button>
	{/snippet}
	<div class="viewport">
		{#if file?.mimetype === 'application/json' || file?.name?.endsWith('.json')}
			<!-- JSON Preview -->
			<div class="wide-wrapper">
				{#if jsonError}
					<p class="none">Couldn't preview JSON — use Download.</p>
				{:else if jsonContent}
					<div class="json-container">
						<pre><code>{jsonContent}</code></pre>
					</div>
				{:else}
					<p class="none">Loading JSON...</p>
				{/if}
			</div>
		{:else if file?.mimetype === 'text/markdown' || file?.name?.endsWith('.md') || file?.name?.endsWith('.markdown')}
			<!-- Markdown Preview -->
			<div class="wide-wrapper">
				{#if mdError}
					<p class="none">Couldn't preview Markdown — use Download.</p>
				{:else if mdHtml}
					<div class="md-container markdown-body">
						{@html mdHtml}
					</div>
				{:else}
					<p class="none">Loading Markdown...</p>
				{/if}
			</div>
		{:else if file?.mimetype === 'text/csv' || file?.name?.endsWith('.csv')}
			<!-- CSV Table Preview -->
			<div class="wide-wrapper">
				{#if csvError}
					<p class="none">Couldn't preview CSV — use Download.</p>
				{:else if csvData.length > 0}
					<div class="table-container">
						<table>
							<thead>
								<tr>
									{#each csvData[0] as headerCell}
										<th>{headerCell}</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each csvData.slice(1) as row}
									<tr>
										{#each row as cell}
											<td>{cell}</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{:else}
					<p class="none">Loading CSV...</p>
				{/if}
			</div>
		{:else}
			<!-- Phone Frame for Images & PDFs -->
			<div class="phone">
				{#if file?.mimetype?.startsWith('image/')}
					<img class="body" src={href} alt={file.name} />
				{:else if file?.mimetype === 'application/pdf'}
					{#if pdfError}
						<p class="none">Couldn't preview this PDF — use Download.</p>
					{:else}
						<canvas class="body" bind:this={canvasEl}></canvas>
					{/if}
				{:else}
					<p class="none">No preview available — use Download.</p>
				{/if}
			</div>
		{/if}
	</div>
</Modal>

<style>
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-md);
		font-weight: 600;
	}

	.viewport {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		align-items: stretch;
		justify-content: center;
		overflow: hidden;
		padding-top: var(--space-2);
		max-height: 100vh;
		max-height: 100svh;
	}

	.phone {
		height: auto;
		min-height: 0;
		max-height: 932px;
		max-height: min(932px, 100svh);
		width: auto;
		max-width: min(430px, 100%);
		aspect-ratio: 9 / 19.5;
		display: flex;
		overflow: hidden;
	}

	@media (max-width: 430px) {
		.phone {
			width: 100%;
			max-width: 100%;
			aspect-ratio: auto;
		}
	}

	img.body,
	canvas.body {
		flex: 1;
		min-width: 0;
		min-height: 0;
		max-width: 100%;
		max-height: 100%;
		width: auto;
		height: auto;
		object-fit: contain;
		display: block;
		margin: auto;
	}

	/* Shared Wide Container for JSON, Markdown & CSV */
	.wide-wrapper {
		width: 100%;
		max-width: 1000px;
		height: 100%;
		display: flex;
		padding: var(--space-2, 0.5rem);
		box-sizing: border-box;
	}

	/* JSON Viewer Styles */
	.json-container {
		flex: 1;
		width: 100%;
		height: 100%;
		overflow: auto;
		padding: var(--space-4, 1rem);
		background: #111827;
		color: #38bdf8;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.875rem;
		line-height: 1.5;
		text-align: left;
		border-radius: 8px;
		box-sizing: border-box;
	}

	.json-container pre {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
	}

	/* Markdown Preview Styles */
	.md-container {
		flex: 1;
		width: 100%;
		height: 100%;
		overflow: auto;
		padding: var(--space-6, 1.5rem);
		background: #0d1117;
		color: #c9d1d9;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
		font-size: 0.95rem;
		line-height: 1.6;
		text-align: left;
		border-radius: 8px;
		box-sizing: border-box;
	}

	.md-container :global(h1),
	.md-container :global(h2),
	.md-container :global(h3),
	.md-container :global(h4) {
		color: #f0f6fc;
		margin-top: 1.25em;
		margin-bottom: 0.5em;
		font-weight: 600;
		border-bottom: 1px solid #21262d;
		padding-bottom: 0.3em;
	}

	.md-container :global(h1) { font-size: 1.6em; }
	.md-container :global(h2) { font-size: 1.3em; }
	.md-container :global(h3) { font-size: 1.1em; border-bottom: none; }

	.md-container :global(p) {
		margin-top: 0;
		margin-bottom: 1em;
	}

	.md-container :global(a) {
		color: #58a6ff;
		text-decoration: underline;
	}

	.md-container :global(ul),
	.md-container :global(ol) {
		padding-left: 1.5em;
		margin-bottom: 1em;
	}

	.md-container :global(blockquote) {
		margin: 0 0 1em 0;
		padding: 0 1em;
		color: #8b949e;
		border-left: 0.25em solid #30363d;
	}

	.md-container :global(code) {
		padding: 0.2em 0.4em;
		background-color: rgba(110, 118, 129, 0.4);
		border-radius: 6px;
		font-size: 85%;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	}

	.md-container :global(pre) {
		padding: 1em;
		overflow: auto;
		font-size: 85%;
		line-height: 1.45;
		background-color: #161b22;
		border-radius: 6px;
		margin-bottom: 1em;
	}

	.md-container :global(pre code) {
		padding: 0;
		background-color: transparent;
	}

	/* CSV Table Styles */
	.table-container {
		flex: 1;
		width: 100%;
		height: 100%;
		overflow: auto;
		background: #0d1117;
		border-radius: 8px;
		border: 1px solid #30363d;
		box-sizing: border-box;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 0.875rem;
		color: #c9d1d9;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	th, td {
		padding: 10px 14px;
		border-bottom: 1px solid #21262d;
		white-space: nowrap;
	}

	th {
		position: sticky;
		top: 0;
		background: #161b22;
		color: #f0f6fc;
		font-weight: 600;
		border-bottom: 2px solid #30363d;
		z-index: 1;
	}

	tr:hover td {
		background-color: #161b22;
	}

	.none {
		margin: auto;
		padding: var(--space-8);
		color: #fff;
	}
</style>