// Comments on an expense: text, voice, or image. Voice/image bytes go into an
// ir.attachment (admin key); the comment row (create_uid = author) is written
// with the caller's session so record rules + authorship hold. GET polls by
// cursor (comment id) — no websocket.
import { json } from '@sveltejs/kit';
import { assertConfigured, sessionCallKw } from '$lib/server/odoo.js';
import { requireApprovedUser } from '$lib/server/auth.js';
import { clearSessionCookie, refreshSessionCookie } from '$lib/server/session.js';
import { assertExpenseInCompany, createAttachment } from '$lib/server/expense.js';
import { MEDIA_KINDS, mimeAllowed, MAX_BASE64 } from '$lib/media.js';

export const prerender = false;

export async function GET({ params, url, cookies }) {
	try {
		assertConfigured();
		const { sid, ctx } = await requireApprovedUser(cookies);
		const { orgRole, orgStatus, ...odooCtx } = ctx;
		const companyId = odooCtx.allowed_company_ids?.[0] ?? null;
		await assertExpenseInCompany(params.id, companyId);

		const since = Number(url.searchParams.get('since')) || 0;
		const { result, sessionId } = await sessionCallKw(sid, 'x_expense_comment', 'search_read', [
			[['x_studio_expense_id', '=', Number(params.id)], ['id', '>', since]]
		], {
			fields: ['x_name', 'x_studio_text', 'x_studio_type', 'x_studio_att_id', 'x_studio_meta', 'create_uid', 'create_date'],
			order: 'id asc',
			context: odooCtx
		});
		refreshSessionCookie(cookies, sessionId, sid);

		const comments = (result || []).map((c) => ({
			id: c.id,
			text: c.x_studio_text || '',
			kind: c.x_studio_type || 'text',
			attId: c.x_studio_att_id || null,
			meta: safeJson(c.x_studio_meta),
			authorId: c.create_uid?.[0] || null,
			author: c.create_uid?.[1] || 'Someone',
			createdAt: c.create_date
		}));
		const cursor = comments.length ? comments[comments.length - 1].id : since;
		return json({ ok: true, comments, cursor });
	} catch (e) {
		return fail(e, cookies);
	}
}

export async function POST({ params, request, cookies }) {
	try {
		assertConfigured();
		const { sid, ctx } = await requireApprovedUser(cookies);
		const { orgRole, orgStatus, ...odooCtx } = ctx;
		const companyId = odooCtx.allowed_company_ids?.[0] ?? null;
		await assertExpenseInCompany(params.id, companyId);

		const { text, kind, dataBase64, mime, dur, w, h } = await request.json();
		const trimmed = String(text || '').trim();
		const hasMedia = kind != null;

		if (hasMedia) {
			if (!MEDIA_KINDS.has(kind) || !mimeAllowed(kind, mime)) {
				return json({ ok: false, error: 'Unsupported media' }, { status: 400 });
			}
			if (!dataBase64 || dataBase64.length > MAX_BASE64) {
				return json({ ok: false, error: 'Media too large' }, { status: 413 });
			}
		} else if (!trimmed) {
			return json({ ok: false, error: 'Empty comment' }, { status: 400 });
		}

		const values = {
			x_studio_expense_id: Number(params.id),
			x_studio_type: hasMedia ? kind : 'text',
			x_name: (trimmed || (kind === 'image' ? 'Photo' : kind === 'voice' ? 'Voice note' : 'Comment')).slice(0, 60)
		};
		if (trimmed) values.x_studio_text = trimmed;

		// Create the comment first so the attachment can point res_id at its id —
		// that link is what scopes the media endpoint (comment → expense → company).
		const { result: id, sessionId } = await sessionCallKw(
			sid, 'x_expense_comment', 'create', [values], { context: odooCtx }
		);
		refreshSessionCookie(cookies, sessionId, sid);

		let attId = null;
		if (hasMedia) {
			attId = await createAttachment({
				name: kind === 'image' ? 'photo' : 'voice-note',
				mime,
				dataBase64,
				resModel: 'x_expense_comment',
				resId: id
			});
			await sessionCallKw(sid, 'x_expense_comment', 'write', [[id], {
				x_studio_att_id: attId,
				x_studio_meta: JSON.stringify({
					mime,
					dur: Number(dur) || 0,
					w: Number(w) || 0,
					h: Number(h) || 0,
					bytes: Math.round((dataBase64.length * 3) / 4)
				})
			}], { context: odooCtx });
		}
		return json({ ok: true, id, attId });
	} catch (e) {
		return fail(e, cookies);
	}
}

function safeJson(s) {
	try { return s ? JSON.parse(s) : null; } catch { return null; }
}
function fail(e, cookies) {
	const status = e?.status || 500;
	if (status === 401) clearSessionCookie(cookies);
	return json({ ok: false, error: e?.message || 'Failed' }, { status });
}
