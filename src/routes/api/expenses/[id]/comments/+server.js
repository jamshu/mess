// Comments on an expense: text, voice, or image. Voice/image bytes go into an
// ir.attachment (admin key); the comment row (create_uid = author) is written
// with the caller's session so record rules + authorship hold. GET polls by
// cursor (comment id) — no websocket.
import { json } from '@sveltejs/kit';
import { assertConfigured, sessionCallKw, adminExecute } from '$lib/server/odoo.js';
import { requireApprovedUser } from '$lib/server/auth.js';
import { clearSessionCookie, refreshSessionCookie } from '$lib/server/session.js';
import { assertExpenseInCompany, createAttachment, expenseAudience } from '$lib/server/expense.js';
import { sendToUser, background } from '$lib/server/push.js';
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
		// A media comment is written in two steps (create, then att_id write). Don't
		// hand out — or advance the cursor past — one caught mid-write, or it renders
		// a broken <img> that only a full reload fixes. It reappears next poll, whole.
		const pending = comments.findIndex((c) => (c.kind === 'image' || c.kind === 'voice') && !c.attId);
		const ready = pending === -1 ? comments : comments.slice(0, pending);
		const cursor = ready.length ? ready[ready.length - 1].id : since;
		return json({ ok: true, comments: ready, cursor });
	} catch (e) {
		return fail(e, cookies);
	}
}

export async function POST({ params, request, cookies, platform }) {
	try {
		assertConfigured();
		const { uid, sid, ctx } = await requireApprovedUser(cookies);
		const { orgRole, orgStatus, ...odooCtx } = ctx;
		const companyId = odooCtx.allowed_company_ids?.[0] ?? null;
		await assertExpenseInCompany(params.id, companyId);

		// A large upload that arrives truncated (flaky mobile network) makes
		// request.json() throw — turn that into a clean, retriable error.
		const body = await request.json().catch(() => null);
		if (!body) return json({ ok: false, error: 'Upload was interrupted — please try again' }, { status: 400 });
		const { text, kind, dataBase64, mime, dur, w, h } = body;
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
		// notify the expense's other members — kept alive past the response via
		// waitUntil, best-effort, never fails the write
		background(platform, notifyComment(Number(params.id), uid, hasMedia ? kind : 'text', trimmed));

		return json({ ok: true, id, attId });
	} catch (e) {
		return fail(e, cookies);
	}
}

// Edit a text comment (author only). Media comments can't be re-edited.
export async function PATCH({ params, request, cookies }) {
	try {
		assertConfigured();
		const { uid, sid, ctx } = await requireApprovedUser(cookies);
		const { orgRole, orgStatus, ...odooCtx } = ctx;
		const companyId = odooCtx.allowed_company_ids?.[0] ?? null;
		await assertExpenseInCompany(params.id, companyId);

		const { commentId, text } = await request.json();
		const trimmed = String(text || '').trim();
		if (!trimmed) return json({ ok: false, error: 'Empty comment' }, { status: 400 });

		const c = await readOwnComment(sid, odooCtx, cookies, Number(commentId), Number(params.id), uid);
		if (c.error) return json({ ok: false, error: c.error }, { status: c.status });
		if (c.x_studio_type && c.x_studio_type !== 'text')
			return json({ ok: false, error: 'Only text comments can be edited' }, { status: 400 });

		await sessionCallKw(sid, 'x_expense_comment', 'write', [
			[Number(commentId)],
			{ x_studio_text: trimmed, x_name: trimmed.slice(0, 60) }
		], { context: odooCtx });
		return json({ ok: true });
	} catch (e) {
		return fail(e, cookies);
	}
}

// Delete a comment (author only). Also drops its attachment bytes if any.
export async function DELETE({ params, url, cookies }) {
	try {
		assertConfigured();
		const { uid, sid, ctx } = await requireApprovedUser(cookies);
		const { orgRole, orgStatus, ...odooCtx } = ctx;
		const companyId = odooCtx.allowed_company_ids?.[0] ?? null;
		await assertExpenseInCompany(params.id, companyId);

		const commentId = Number(url.searchParams.get('commentId'));
		const c = await readOwnComment(sid, odooCtx, cookies, commentId, Number(params.id), uid);
		if (c.error) return json({ ok: false, error: c.error }, { status: c.status });

		await sessionCallKw(sid, 'x_expense_comment', 'unlink', [[commentId]], { context: odooCtx });
		if (c.x_studio_att_id) await adminExecute('ir.attachment', 'unlink', [[c.x_studio_att_id]]).catch(() => {});
		return json({ ok: true });
	} catch (e) {
		return fail(e, cookies);
	}
}

// Read a comment and verify it belongs to this expense and to the caller.
async function readOwnComment(sid, odooCtx, cookies, commentId, expenseId, uid) {
	if (!commentId) return { error: 'Missing comment', status: 400 };
	const { result, sessionId } = await sessionCallKw(sid, 'x_expense_comment', 'read', [
		[commentId]
	], { fields: ['create_uid', 'x_studio_att_id', 'x_studio_type', 'x_studio_expense_id'], context: odooCtx });
	refreshSessionCookie(cookies, sessionId, sid);
	const c = result?.[0];
	if (!c || c.x_studio_expense_id?.[0] !== expenseId) return { error: 'Not found', status: 404 };
	if (c.create_uid?.[0] !== uid) return { error: 'Not yours', status: 403 };
	return c;
}

async function notifyComment(expenseId, authorUid, kind, text) {
	const { name, userIds } = await expenseAudience(expenseId);
	const targets = userIds.filter((u) => u !== authorUid);
	if (!targets.length) return;
	const [author] = await adminExecute('res.users', 'read', [[authorUid]], { fields: ['name'] });
	const who = author?.name || 'Someone';
	const body = kind === 'image' ? '📷 Photo' : kind === 'voice' ? '🎤 Voice note' : text.slice(0, 120);
	const payload = { title: `${who} · ${name}`, body, url: `/expense/${expenseId}` };
	await Promise.allSettled(targets.map((u) => sendToUser(u, payload)));
}

function safeJson(s) {
	try { return s ? JSON.parse(s) : null; } catch { return null; }
}
function fail(e, cookies) {
	const status = e?.status || 500;
	if (status === 401) clearSessionCookie(cookies);
	return json({ ok: false, error: e?.message || 'Failed' }, { status });
}
