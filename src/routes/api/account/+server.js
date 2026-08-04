// Self-service account deletion. Destructive, so the password is re-checked
// against Odoo instead of trusting the session cookie alone.
import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth.js';
import {
	adminExecute,
	authenticateUser,
	destroySession,
	getUserOrgInfo,
	deleteUserAccount
} from '$lib/server/odoo.js';
import { getSession, clearSessionCookie, clearContextCookie } from '$lib/server/session.js';

export const prerender = false;

// Update own display name and/or avatar. Written with the admin key for the same
// reason getUserOrgInfo reads with it — record rules on res.users can block a
// user editing their own Studio-adjacent fields via their session.
export async function PATCH({ request, cookies }) {
	try {
		const { uid } = await requireUser(cookies);
		const { name, avatar } = await request.json();
		const vals = {};
		if (typeof name === 'string') {
			const n = name.trim();
			if (!n) return json({ ok: false, error: 'Name cannot be empty' }, { status: 400 });
			vals.name = n;
		}
		// avatar: raw base64 to set, '' / null to clear, undefined to leave unchanged
		if (avatar !== undefined) vals.image_1920 = avatar || false;
		if (!Object.keys(vals).length)
			return json({ ok: false, error: 'Nothing to update' }, { status: 400 });
		await adminExecute('res.users', 'write', [[uid], vals]);
		return json({ ok: true, user: await getUserOrgInfo(uid) });
	} catch (e) {
		return json({ ok: false, error: e?.message || 'Failed' }, { status: e?.status || 500 });
	}
}

export async function POST({ request, cookies }) {
	try {
		// requireUser, not requireApprovedUser — pending users may delete themselves too
		const { uid } = await requireUser(cookies);
		const { password } = await request.json();
		if (!password) return json({ ok: false, error: 'Password required' }, { status: 400 });

		const info = await getUserOrgInfo(uid);
		const { sessionId } = await authenticateUser(info.email, password); // throws 401 on mismatch
		destroySession(sessionId);

		// an admin leaving would orphan the org — nobody could approve or invite
		if (info.role === 'admin' && info.companyId) {
			const others = await adminExecute('res.users', 'search_count', [
				[
					['company_id', '=', info.companyId],
					['id', '!=', uid]
				]
			]);
			if (others) {
				return json(
					{ ok: false, error: 'You are the organization admin — remove all other members first.' },
					{ status: 400 }
				);
			}
		}

		await deleteUserAccount(uid);

		const sid = getSession(cookies);
		if (sid) destroySession(sid);
		clearSessionCookie(cookies);
		clearContextCookie(cookies);
		return json({ ok: true });
	} catch (e) {
		return json({ ok: false, error: e?.message || 'Failed' }, { status: e?.status || 500 });
	}
}
