// Serve a user's avatar as an image, by id. Admin-key read (a member's session
// can't browse res.users), scoped to the caller's company so avatars don't leak
// across tenants. 404 when the user has no photo — the <Avatar> component falls
// back to an initial on error. atob (not Buffer) so it runs on Cloudflare Workers.
import { requireApprovedUser } from '$lib/server/auth.js';
import { adminExecute } from '$lib/server/odoo.js';

export const prerender = false;

export async function GET({ params, cookies }) {
	try {
		const { ctx } = await requireApprovedUser(cookies);
		const companyId = ctx.allowed_company_ids?.[0];
		const id = Number(params.id);
		if (!companyId || !id) return new Response('Not found', { status: 404 });

		const [u] = await adminExecute('res.users', 'read', [[id]], {
			fields: ['company_id', 'avatar_128']
		});
		if (!u || u.company_id?.[0] !== companyId || !u.avatar_128)
			return new Response('Not found', { status: 404 });

		const bin = atob(u.avatar_128);
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		return new Response(bytes, {
			headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300' }
		});
	} catch (e) {
		return new Response('Error', { status: e?.status || 500 });
	}
}
