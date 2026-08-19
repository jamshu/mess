// Shared cache-key + purge for the pre-aggregated monthly report, so the
// producer (api/reports/monthly) and the invalidators (expense/settlement
// writes) can never drift on the key format — a mismatched key would purge
// nothing and the stale summary would linger until its TTL.

/** The edge-cache key for one company's summary of one month ('' → all-time). */
export function reportCacheKey(companyId, uid, month) {
	const who = companyId ?? 'u' + uid;
	return new Request(`https://reports.cache/monthly/${who}/${month || 'all'}`);
}

/**
 * Drop the cached summaries a write touches: the row's own month plus the
 * all-time view (which every month rolls up into). Best-effort and
 * waitUntil-friendly; a no-op under `vite dev` where there's no edge cache.
 */
export async function purgeReportCache(platform, companyId, uid, months = []) {
	const cache = platform?.caches?.default;
	if (!cache) return;
	const targets = new Set(['all', ...months.filter(Boolean)]);
	await Promise.all([...targets].map((m) => cache.delete(reportCacheKey(companyId, uid, m))));
}
