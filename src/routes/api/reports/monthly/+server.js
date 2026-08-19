// Pre-aggregated monthly report. The /reports page (and the Siri shortcut) don't
// need every raw expense row to show KPIs, a category breakdown and member
// balances — those are a handful of numbers. This endpoint fetches once
// server-side, aggregates, and returns just the summary, so the client ships a
// small JSON payload instead of the whole month of rows.
//
// Caching: the summary for a (company, month) is identical for every member, so
// it's held in the Cloudflare edge cache (caches.default) for a short TTL. Auth
// still runs on every request BEFORE any cache read, so a cache hit never leaks
// across tenants. Under `vite dev` there is no platform.caches, so it simply
// computes each time. Pass ?nocache=1 to bypass the read (still refreshes it).
import { json } from '@sveltejs/kit';
import { assertConfigured, sessionCallKw, adminExecute } from '$lib/server/odoo.js';
import { requireApprovedUser } from '$lib/server/auth.js';
import { clearSessionCookie, refreshSessionCookie } from '$lib/server/session.js';
import { background } from '$lib/server/push.js';
import { computeBalances, money } from '$lib/balance.js';
import { nextMonthStart } from '$lib/report.js';
import { reportCacheKey } from '$lib/server/reportCache.js';

export const prerender = false;

const TTL = 120; // seconds the edge keeps a summary; a new expense shows within this

export async function GET({ params, url, cookies, platform }) {
	try {
		assertConfigured();
		const { uid, sid, ctx } = await requireApprovedUser(cookies);
		const { orgRole, orgStatus, ...odooCtx } = ctx;
		const companyId = odooCtx.allowed_company_ids?.[0] ?? null;

		const month = normalizeMonth(url.searchParams.get('month'));
		if (month === false) return json({ ok: false, error: 'Bad month (want YYYY-MM)' }, { status: 400 });

		// Same key for every member of a company+month → one cached summary.
		const cache = platform?.caches?.default ?? null;
		const key = reportCacheKey(companyId, uid, month);
		if (cache && url.searchParams.get('nocache') !== '1') {
			const hit = await cache.match(key);
			if (hit) return clientJson(await hit.text());
		}

		// Company-scope reads exactly like /api/odoo does, so a loose Odoo record
		// rule can't pull another tenant's rows into the total.
		const scope = companyId ? [['x_studio_company_id', '=', companyId]] : [['create_uid', '=', uid]];
		const dateDom = month
			? [['x_studio_date', '>=', `${month}-01`], ['x_studio_date', '<', nextMonthStart(month)]]
			: [];

		const call = async (model, dom, fields) => {
			const { result, sessionId } = await sessionCallKw(sid, model, 'search_read', [[...scope, ...dom]], {
				fields,
				context: odooCtx
			});
			refreshSessionCookie(cookies, sessionId, sid);
			return result || [];
		};

		const [exRows, stRows] = await Promise.all([
			call('x_expense', dateDom, ['x_studio_amount', 'x_studio_category', 'x_studio_payer_id', 'x_studio_participant_ids']),
			call('x_settlement', dateDom, ['x_studio_from_id', 'x_studio_to_id', 'x_studio_amount'])
		]);

		const expenses = exRows.map((e) => ({
			amount: e.x_studio_amount,
			payerId: e.x_studio_payer_id?.[0] || null,
			participantIds: e.x_studio_participant_ids || []
		}));
		const settlements = stRows.map((s) => ({
			fromId: s.x_studio_from_id?.[0] || null,
			toId: s.x_studio_to_id?.[0] || null,
			amount: s.x_studio_amount
		}));

		// Category totals + grand total.
		const catMap = new Map();
		let total = 0;
		for (const e of exRows) {
			const amt = Number(e.x_studio_amount) || 0;
			const k = e.x_studio_category || 'Uncategorized';
			catMap.set(k, (catMap.get(k) || 0) + amt);
			total += amt;
		}
		const categories = [...catMap.entries()]
			.map(([name, amount]) => ({ name, amount: money(amount), pct: total ? (amount / total) * 100 : 0 }))
			.sort((a, b) => b.amount - a.amount);

		// Everyone touched by these rows — enough to label the balances, no full roster fetch.
		const involved = new Set();
		for (const e of expenses) { if (e.payerId) involved.add(e.payerId); for (const p of e.participantIds) involved.add(p); }
		for (const s of settlements) { if (s.fromId) involved.add(s.fromId); if (s.toId) involved.add(s.toId); }

		const names = new Map();
		if (involved.size) {
			const users = await adminExecute('res.users', 'read', [[...involved]], { fields: ['name'] });
			for (const u of users) names.set(u.id, u.name);
		}

		const bal = computeBalances(expenses, settlements, [...involved]);
		const members = [...bal.entries()]
			.map(([id, r]) => ({
				id, name: names.get(id) || `#${id}`,
				paid: money(r.paid), cost: money(r.cost), sent: money(r.sent), received: money(r.received), net: money(r.net)
			}))
			.filter((m) => m.paid || m.cost || m.sent || m.received)
			.sort((a, b) => b.net - a.net);

		const bodyStr = JSON.stringify({
			ok: true,
			month: month || null,
			total: money(total),
			count: exRows.length,
			categories,
			members,
			generatedAt: new Date().toISOString()
		});

		// Keep a copy at the edge for the TTL (public so the Cache API stores it;
		// the key is company-scoped and auth gates every request). waitUntil so the
		// put doesn't delay the response.
		if (cache) {
			const edgeRes = new Response(bodyStr, {
				headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
			});
			background(platform, cache.put(key, edgeRes));
		}
		return clientJson(bodyStr);
	} catch (e) {
		const status = e?.status || 500;
		if (status === 401) clearSessionCookie(cookies);
		return json({ ok: false, error: e?.message || 'Failed' }, { status });
	}
}

// Never let the browser reuse this across users — it's per-tenant data behind auth.
function clientJson(str) {
	return new Response(str, {
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }
	});
}

// '' / null → '' (all time). 'YYYY-MM' → itself. Anything else → false (reject).
function normalizeMonth(raw) {
	if (!raw) return '';
	return /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : false;
}
