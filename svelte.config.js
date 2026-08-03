import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Cloudflare Workers. The prerendered page shell + assets are served from
		// Cloudflare's edge; only /api/* reaches the Worker (see wrangler.toml
		// assets.run_worker_first). No `routes` option here — the adapter only
		// emits _routes.json for Cloudflare PAGES, so on Workers it is ignored.
		adapter: adapter(),
		prerender: {
			// /expense/[id] is dynamic; with ssr=false the runtime serves the SPA
			// shell. That fallback is configured in wrangler.toml via
			// assets.not_found_handling — miss it and every hard refresh 404s.
			handleUnseenRoutes: 'ignore'
		}
	}
};

export default config;
