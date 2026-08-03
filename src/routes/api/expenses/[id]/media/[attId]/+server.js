// Serve one attachment (voice/image comment clip, or a bill) to a member of the
// expense's organization. Two guards: the caller must belong to the expense's
// company, and the attachment must genuinely belong to THIS expense (directly as
// a bill, or via a comment on it) — without that, the id in the URL would
// address every attachment in the Odoo database.
//
// Byte ranges are honoured because iOS Safari REQUIRES them for <audio>: its
// loader opens with `Range: bytes=0-1` and refuses a 200. Bytes are already in
// memory, so this is buffer slicing, not streaming.
import { json } from '@sveltejs/kit';
import { requireApprovedUser } from '$lib/server/auth.js';
import { clearSessionCookie } from '$lib/server/session.js';
import { assertExpenseInCompany, readAttachment, commentExpense } from '$lib/server/expense.js';
import { IMAGE_MIMES, AUDIO_MIMES, parseRange, b64ToBytes } from '$lib/media.js';

export const prerender = false;

// bills may be images or PDFs; comment clips are images or audio
const SERVABLE = new Set([...IMAGE_MIMES, ...AUDIO_MIMES, 'application/pdf']);

export async function GET({ params, cookies, request }) {
	try {
		const { ctx } = await requireApprovedUser(cookies);
		const companyId = ctx.allowed_company_ids?.[0] ?? null;
		const expenseId = Number(params.id);
		await assertExpenseInCompany(expenseId, companyId);

		const att = await readAttachment(params.attId);
		if (!att?.raw) return json({ ok: false, error: 'Not found' }, { status: 404 });

		// The attachment must trace back to this expense.
		let belongs = false;
		if (att.res_model === 'x_expense' && att.res_id === expenseId) belongs = true;
		else if (att.res_model === 'x_expense_comment') {
			belongs = (await commentExpense(att.res_id)) === expenseId;
		}
		if (!belongs) return json({ ok: false, error: 'Not found' }, { status: 404 });

		// Whitelisted on the way OUT too: serving an arbitrary stored content type
		// from our own origin is how an upload becomes stored XSS.
		const mime = String(att.mimetype || '');
		if (!SERVABLE.has(mime)) return json({ ok: false, error: 'Not found' }, { status: 404 });

		const buf = b64ToBytes(att.raw);
		const headers = {
			'Content-Type': mime,
			'X-Content-Type-Options': 'nosniff',
			'Accept-Ranges': 'bytes',
			'Cache-Control': 'private, max-age=86400'
		};

		const range = parseRange(request.headers.get('range'), buf.length);
		if (range === 'unsatisfiable') {
			return new Response(null, {
				status: 416,
				headers: { ...headers, 'Content-Range': `bytes */${buf.length}`, 'Content-Length': '0' }
			});
		}
		if (range) {
			const slice = buf.subarray(range.start, range.end + 1);
			return new Response(slice, {
				status: 206,
				headers: {
					...headers,
					'Content-Range': `bytes ${range.start}-${range.end}/${buf.length}`,
					'Content-Length': String(slice.length)
				}
			});
		}
		return new Response(buf, { headers: { ...headers, 'Content-Length': String(buf.length) } });
	} catch (e) {
		const status = e?.status || 500;
		if (status === 401) clearSessionCookie(cookies);
		return json({ ok: false, error: e?.message || 'Failed' }, { status });
	}
}
