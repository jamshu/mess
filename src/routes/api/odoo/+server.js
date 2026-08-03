// Data proxy for expenses / groups / settlements. Every call runs as the
// LOGGED-IN user via their Odoo web session (not the admin key), so record rules
// isolate each tenant. The proxy adds: model whitelist, org approval gate,
// company hard-scoping on reads, company auto-fill on create, and an ownership
// check on update/delete. Comments (voice/image) go through the dedicated
// /api/expenses/[id]/comments endpoints, not this generic proxy.
import { json } from '@sveltejs/kit';
import { assertConfigured, sessionCallKw, adminExecute } from '$lib/server/odoo.js';
import { requireApprovedUser } from '$lib/server/auth.js';
import { clearSessionCookie, refreshSessionCookie } from '$lib/server/session.js';
import { sendToUser, background } from '$lib/server/push.js';

export const prerender = false;

// body: { action: create|search|update|delete, model: expenses|groups|settlements, data }
const MODELS = {
	expenses: 'x_expense',
	groups: 'x_expense_group',
	settlements: 'x_settlement'
};

export async function POST({ request, cookies, platform }) {
	try {
		assertConfigured();
		const { uid, sid, ctx } = await requireApprovedUser(cookies);

		const { action, model: modelKey = 'expenses', data } = await request.json();
		const MODEL = MODELS[modelKey];
		if (!MODEL) return json({ success: false, error: 'Invalid model' }, { status: 400 });

		const { orgRole, orgStatus, ...odooCtx } = ctx;
		const companyId = odooCtx.allowed_company_ids?.[0] ?? null;

		const call = async (method, args, kwargs = {}) => {
			const { result, sessionId } = await sessionCallKw(sid, MODEL, method, args, {
				...kwargs,
				context: odooCtx
			});
			refreshSessionCookie(cookies, sessionId, sid);
			return result;
		};

		// only the creator may mutate/remove their own row
		const assertOwner = async (id, msg) => {
			const [rec] = await call('read', [[Number(id)]], { fields: ['create_uid'] });
			if (rec?.create_uid?.[0] !== uid) {
				const e = new Error(msg);
				e.status = 403;
				throw e;
			}
		};

		switch (action) {
			case 'create': {
				const values = { ...data };
				if (companyId && !values.x_studio_company_id) values.x_studio_company_id = companyId;
				const id = await call('create', [values]);
				// notify participants of a new expense — best-effort, never fail the write
				if (modelKey === 'expenses') {
					background(platform, notifyNewExpense(uid, id, values));
				}
				return json({ success: true, id });
			}

			case 'search': {
				const { domain = [], fields = [], order, limit } = data || {};
				// Hard-scope to the caller's tenant so a loose record rule can't leak
				// another company's rows into the app.
				const scope = companyId
					? [['x_studio_company_id', '=', companyId]]
					: [['create_uid', '=', uid]];
				const kwargs = { fields };
				if (order) kwargs.order = order;
				if (limit) kwargs.limit = limit;
				return json({
					success: true,
					results: await call('search_read', [[...scope, ...domain]], kwargs)
				});
			}

			case 'update': {
				const { id, values } = data;
				await assertOwner(id, 'Not yours to edit');
				return json({ success: true, result: await call('write', [[Number(id)], values]) });
			}

			case 'delete': {
				const { id } = data;
				await assertOwner(id, 'Not yours to delete');
				return json({ success: true, result: await call('unlink', [[Number(id)]]) });
			}

			default:
				return json({ success: false, error: 'Invalid action' }, { status: 400 });
		}
	} catch (error) {
		const status = error?.status || 500;
		if (status === 401) clearSessionCookie(cookies);
		console.error('Odoo API Error:', error);
		return json(
			{ success: false, error: error instanceof Error ? error.message : 'Unknown error' },
			{ status }
		);
	}
}

// Push each participant (except the creator) when an expense is added.
async function notifyNewExpense(creatorUid, expenseId, values) {
	// x_studio_participant_ids arrives as [[6, 0, [ids]]]
	const parts = Array.isArray(values.x_studio_participant_ids?.[0])
		? values.x_studio_participant_ids[0][2] || []
		: [];
	const targets = parts.filter((u) => u !== creatorUid);
	if (!targets.length) return;
	const [creator] = await adminExecute('res.users', 'read', [[creatorUid]], { fields: ['name'] });
	const n = parts.length || 1;
	const share = (Number(values.x_studio_amount) || 0) / n;
	const payload = {
		title: `${creator?.name || 'Someone'} added "${values.x_name}"`,
		body: `Your share: ${share.toFixed(2)}`,
		url: `/expense/${expenseId}`
	};
	await Promise.allSettled(targets.map((u) => sendToUser(u, payload)));
}
