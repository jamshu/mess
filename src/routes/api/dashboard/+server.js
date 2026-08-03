// Balance dashboard: reads every expense + settlement in the caller's company
// and returns per-member paid / cost / net. Reads run as the logged-in user so
// record rules keep it tenant-scoped; member names come from an admin-key read
// (a member's own session can't browse res.users).
import { json } from '@sveltejs/kit';
import { assertConfigured, sessionCallKw, adminExecute } from '$lib/server/odoo.js';
import { requireApprovedUser } from '$lib/server/auth.js';
import { clearSessionCookie, refreshSessionCookie } from '$lib/server/session.js';
import { computeBalances, money } from '$lib/balance.js';

export const prerender = false;

export async function GET({ cookies }) {
	try {
		assertConfigured();
		const { uid, sid, ctx } = await requireApprovedUser(cookies);
		const { orgRole, orgStatus, ...odooCtx } = ctx;
		const companyId = odooCtx.allowed_company_ids?.[0] ?? null;
		if (!companyId) return json({ ok: false, error: 'No organization' }, { status: 400 });

		const call = async (model, method, args, kwargs = {}) => {
			const { result, sessionId } = await sessionCallKw(sid, model, method, args, {
				...kwargs,
				context: odooCtx
			});
			refreshSessionCookie(cookies, sessionId, sid);
			return result;
		};

		const scope = [['x_studio_company_id', '=', companyId]];
		const [expenses, settlements, members] = await Promise.all([
			call('x_expense', 'search_read', [scope], {
				fields: ['x_studio_amount', 'x_studio_payer_id', 'x_studio_participant_ids']
			}),
			call('x_settlement', 'search_read', [scope], {
				fields: ['x_studio_from_id', 'x_studio_to_id', 'x_studio_amount']
			}),
			// approved members of this company, admin-key (id + name only)
			adminExecute('res.users', 'search_read', [
				[['company_id', '=', companyId], ['x_studio_org_status', '=', 'approved']]
			], { fields: ['name'], order: 'name asc' })
		]);

		const bal = computeBalances(
			expenses.map((e) => ({
				amount: e.x_studio_amount,
				payerId: e.x_studio_payer_id?.[0] || null,
				participantIds: e.x_studio_participant_ids || []
			})),
			settlements.map((s) => ({
				fromId: s.x_studio_from_id?.[0] || null,
				toId: s.x_studio_to_id?.[0] || null,
				amount: s.x_studio_amount
			})),
			members.map((m) => m.id)
		);

		const rows = members.map((m) => {
			const r = bal.get(m.id) || { paid: 0, cost: 0, sent: 0, received: 0, net: 0 };
			return {
				id: m.id,
				name: m.name,
				isMe: m.id === uid,
				paid: money(r.paid),
				cost: money(r.cost),
				sent: money(r.sent), // settlement cash they PAID out
				received: money(r.received), // settlement cash they RECEIVED
				net: money(r.net)
			};
		});
		// biggest creditor first, then biggest debtor
		rows.sort((a, b) => b.net - a.net);

		return json({ ok: true, me: uid, rows, expenseCount: expenses.length });
	} catch (error) {
		const status = error?.status || 500;
		if (status === 401) clearSessionCookie(cookies);
		return json({ ok: false, error: error?.message || 'Failed' }, { status });
	}
}
