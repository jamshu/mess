// Bill/receipt attachments on an expense (images or PDF). Distinct from comment
// media: bills link res_model='x_expense', res_id=expenseId, so listing them is
// a single scoped search. Served through ../media/[attId].
import { json } from '@sveltejs/kit';
import { assertConfigured, adminExecute } from '$lib/server/odoo.js';
import { requireApprovedUser } from '$lib/server/auth.js';
import { clearSessionCookie } from '$lib/server/session.js';
import { assertExpenseInCompany, createAttachment } from '$lib/server/expense.js';
import { MAX_BASE64 } from '$lib/media.js';

export const prerender = false;

const BILL_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export async function GET({ params, cookies }) {
	try {
		assertConfigured();
		const { ctx } = await requireApprovedUser(cookies);
		const companyId = ctx.allowed_company_ids?.[0] ?? null;
		await assertExpenseInCompany(params.id, companyId);
		const rows = await adminExecute('ir.attachment', 'search_read', [
			[['res_model', '=', 'x_expense'], ['res_id', '=', Number(params.id)]]
		], { fields: ['name', 'mimetype'], order: 'id asc' });
		return json({
			ok: true,
			bills: rows.map((r) => ({ id: r.id, name: r.name, mime: r.mimetype }))
		});
	} catch (e) {
		return fail(e, cookies);
	}
}

export async function POST({ params, request, cookies }) {
	try {
		assertConfigured();
		const { ctx } = await requireApprovedUser(cookies);
		const companyId = ctx.allowed_company_ids?.[0] ?? null;
		await assertExpenseInCompany(params.id, companyId);

		const { name, mime, dataBase64 } = await request.json();
		if (!BILL_MIMES.has(mime)) return json({ ok: false, error: 'Only images or PDF' }, { status: 400 });
		if (!dataBase64 || dataBase64.length > MAX_BASE64) {
			return json({ ok: false, error: 'File too large (max ~1MB)' }, { status: 413 });
		}
		const attId = await createAttachment({
			name: name || 'bill',
			mime,
			dataBase64,
			resModel: 'x_expense',
			resId: Number(params.id)
		});
		return json({ ok: true, id: attId });
	} catch (e) {
		return fail(e, cookies);
	}
}

function fail(e, cookies) {
	const status = e?.status || 500;
	if (status === 401) clearSessionCookie(cookies);
	return json({ ok: false, error: e?.message || 'Failed' }, { status });
}
