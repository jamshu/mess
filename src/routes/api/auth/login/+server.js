import { json } from '@sveltejs/kit';
import {
	assertConfigured,
	authenticateUser,
	buildSessionContext,
	getUserOrgInfo,
	normalizeLogin
} from '$lib/server/odoo.js';
import { setSessionCookie, setContextCookie } from '$lib/server/session.js';

export const prerender = false;

export async function POST({ request, cookies }) {
	try {
		assertConfigured();
		const { email, password } = await request.json();
		if (!email || !password) {
			return json({ ok: false, error: 'Email or username and password are required' }, { status: 400 });
		}

		const { sessionId, info } = await authenticateUser(normalizeLogin(email), password);
		const orgInfo = await getUserOrgInfo(info.uid);
		setSessionCookie(cookies, sessionId);
		setContextCookie(cookies, {
			...buildSessionContext(info),
			orgRole: orgInfo.role,
			orgStatus: orgInfo.status
		});

		return json({ ok: true, user: orgInfo });
	} catch (e) {
		return json({ ok: false, error: e?.message || 'Login failed' }, { status: e?.status || 401 });
	}
}
