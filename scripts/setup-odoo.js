// One-time (idempotent, re-runnable) Odoo provisioning for the Mess app.
// Creates the manual x_ models/fields the app expects, their access rights, and
// company-scope record rules, then bootstraps org role/status + invite token for
// any pre-existing users. Safe to re-run; each ensure* helper is a no-op if the
// object already exists.
//
// Run: npm run setup:odoo   (reads .env via node --env-file)

const URL_ = (process.env.ODOO_URL || '').replace(/\/$/, '');
const DB = process.env.ODOO_DB;
const USER = process.env.ODOO_USERNAME;
const KEY = process.env.ODOO_API_KEY;
if (!URL_ || !DB || !USER || !KEY) {
	console.error('Set ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY in .env');
	process.exit(1);
}

async function service(serviceName, method, args) {
	const res = await fetch(`${URL_}/jsonrpc`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			method: 'call',
			params: { service: serviceName, method, args },
			id: Date.now()
		})
	});
	const data = await res.json();
	if (data.error) throw new Error(data.error.data?.message || data.error.message || 'Odoo error');
	return data.result;
}

let uid;
async function x(model, method, args = [], kwargs = {}) {
	return service('object', 'execute_kw', [DB, uid, KEY, model, method, args, kwargs]);
}

async function ensureModel(model, name) {
	const found = await x('ir.model', 'search', [[['model', '=', model]]]);
	if (found.length) return found[0];
	const id = await x('ir.model', 'create', [{ name, model, state: 'manual' }]);
	console.log(`  + model ${model}`);
	return id;
}

async function ensureField(modelId, model, vals) {
	const found = await x('ir.model.fields', 'search', [
		[['model_id', '=', modelId], ['name', '=', vals.name]]
	]);
	if (found.length) return found[0];
	const id = await x('ir.model.fields', 'create', [
		{ model_id: modelId, state: 'manual', field_description: vals.name.replace(/^x_studio_/, '').replace(/_/g, ' '), ...vals }
	]);
	console.log(`  + field ${model}.${vals.name} (${vals.ttype})`);
	return id;
}

// Odoo 19+ replaced ir.model.access with the unified ir.access (single group_id,
// one `operation: 'crud'` selection instead of four perm_ booleans). Detect once.
let hasIrAccess = null;
async function detectAccessModel() {
	if (hasIrAccess == null) {
		const found = await x('ir.model', 'search', [[['model', '=', 'ir.access']]]);
		hasIrAccess = found.length > 0;
		console.log(`  access model: ${hasIrAccess ? 'ir.access (Odoo 19+)' : 'ir.model.access'}`);
	}
	return hasIrAccess;
}

// Grant internal users CRUD on a model, scoped to `domain`. On Odoo 19 the domain
// rides ON the ir.access permission (unified ACL + record rule) — a permission
// with a domain grants the operation only on matching rows, so no separate
// ir.rule is needed. On 17/18 the ACL is unscoped and the domain becomes an
// ir.rule (see ensureLegacyRule, only used on that path).
async function ensureAccess(modelId, model, groupId, domain = false) {
	if (await detectAccessModel()) {
		const found = await x('ir.access', 'search', [
			[['model_id', '=', modelId], ['group_id', '=', groupId], ['kind', '=', 'permission']]
		]);
		if (found.length) {
			// keep the scope current on re-runs
			await x('ir.access', 'write', [found, { operation: 'crud', domain }]);
			return found[0];
		}
		const id = await x('ir.access', 'create', [{
			name: `${model} user access`,
			model_id: modelId,
			group_id: groupId,
			operation: 'crud',
			domain
		}]);
		console.log(`  + access ${model} (crud${domain ? ', scoped' : ''})`);
		return id;
	}
	const found = await x('ir.model.access', 'search', [
		[['model_id', '=', modelId], ['group_id', '=', groupId]]
	]);
	if (found.length) return found[0];
	const id = await x('ir.model.access', 'create', [{
		name: `${model} user access`,
		model_id: modelId,
		group_id: groupId,
		perm_read: true, perm_write: true, perm_create: true, perm_unlink: true
	}]);
	console.log(`  + access ${model}`);
	return id;
}

async function groupIdByXmlId(module, name) {
	const rows = await x('ir.model.data', 'search_read', [
		[['module', '=', module], ['name', '=', name], ['model', '=', 'res.groups']],
		['res_id']
	]);
	return rows[0]?.res_id || null;
}

async function ensureRule(name, modelId, domainForce, groupId) {
	const found = await x('ir.rule', 'search', [[['name', '=', name]]]);
	if (found.length) return found[0];
	const id = await x('ir.rule', 'create', [{
		name,
		model_id: modelId,
		domain_force: domainForce,
		groups: [[6, 0, [groupId]]]
	}]);
	console.log(`  + rule ${name}`);
	return id;
}

async function main() {
	uid = await service('common', 'login', [DB, USER, KEY]);
	if (!uid) throw new Error('Admin login failed — check ODOO_USERNAME / ODOO_API_KEY');
	console.log(`Logged in as uid ${uid} on ${URL_} (${DB})`);

	/* ---- models & fields ---- */
	console.log('Models & fields:');

	// Reusable named member set. Creator is NOT auto-added — a group can be made
	// without its owner, and a group holding only its creator lands all cost on
	// the creator. x_name (the record name) is auto-created on manual models.
	const groupModel = await ensureModel('x_expense_group', 'Expense Group');
	for (const f of [
		{ name: 'x_studio_member_ids', ttype: 'many2many', relation: 'res.users' },
		{ name: 'x_studio_company_id', ttype: 'many2one', relation: 'res.company' }
	]) await ensureField(groupModel, 'x_expense_group', f);

	// One expense. x_name = description. participant_ids is the FROZEN resolved
	// split list (direct users ∪ picked groups' members), snapshotted at creation
	// so later group edits never rewrite past splits. Equal split: share =
	// amount / len(participant_ids). category/currency stored as plain char to
	// avoid provisioning selection option records.
	const expenseModel = await ensureModel('x_expense', 'Expense');
	for (const f of [
		{ name: 'x_studio_category', ttype: 'char' },
		{ name: 'x_studio_amount', ttype: 'float' },
		{ name: 'x_studio_date', ttype: 'date' },
		{ name: 'x_studio_payer_id', ttype: 'many2one', relation: 'res.users' },
		{ name: 'x_studio_participant_ids', ttype: 'many2many', relation: 'res.users' },
		{ name: 'x_studio_company_id', ttype: 'many2one', relation: 'res.company' }
	]) await ensureField(expenseModel, 'x_expense', f);

	// Comment on an expense. type is 'text' | 'voice' | 'image'; att_id points at
	// the ir.attachment holding voice/image bytes; meta is JSON {mime,dur,w,h,bytes}.
	const commentModel = await ensureModel('x_expense_comment', 'Expense Comment');
	for (const f of [
		{ name: 'x_studio_text', ttype: 'text' },
		{ name: 'x_studio_type', ttype: 'char' },
		{ name: 'x_studio_att_id', ttype: 'integer' },
		{ name: 'x_studio_meta', ttype: 'text' },
		{ name: 'x_studio_expense_id', ttype: 'many2one', relation: 'x_expense' }
	]) await ensureField(commentModel, 'x_expense_comment', f);

	// Manual "A paid B amount" record that rebalances nets. No real money moves.
	const settleModel = await ensureModel('x_settlement', 'Settlement');
	for (const f of [
		{ name: 'x_studio_from_id', ttype: 'many2one', relation: 'res.users' },
		{ name: 'x_studio_to_id', ttype: 'many2one', relation: 'res.users' },
		{ name: 'x_studio_amount', ttype: 'float' },
		{ name: 'x_studio_date', ttype: 'date' },
		{ name: 'x_studio_company_id', ttype: 'many2one', relation: 'res.company' }
	]) await ensureField(settleModel, 'x_settlement', f);

	const pushModel = await ensureModel('x_push_subscription', 'Push Subscription');
	for (const f of [
		{ name: 'x_studio_user_id', ttype: 'many2one', relation: 'res.users' },
		{ name: 'x_studio_endpoint', ttype: 'char' },
		{ name: 'x_studio_keys_p256dh', ttype: 'char' },
		{ name: 'x_studio_keys_auth', ttype: 'char' }
	]) await ensureField(pushModel, 'x_push_subscription', f);

	/* ---- fields on existing models ---- */
	const [companyModel] = await x('ir.model', 'search', [[['model', '=', 'res.company']]]);
	await ensureField(companyModel, 'res.company', { name: 'x_studio_invite_token', ttype: 'char' });
	const [usersModel] = await x('ir.model', 'search', [[['model', '=', 'res.users']]]);
	await ensureField(usersModel, 'res.users', { name: 'x_studio_org_role', ttype: 'char' });
	await ensureField(usersModel, 'res.users', { name: 'x_studio_org_status', ttype: 'char' });

	/* ---- access rights + tenant scoping (fine-grained authz is in /api) ----
	   Strict company scope — no False branch, so a company-less orphan row can't
	   leak to every tenant. The proxy always sets x_studio_company_id on create. */
	console.log('Access rights:');
	const internalGid = await groupIdByXmlId('base', 'group_user');
	if (!internalGid) throw new Error('base.group_user not found');
	const companyScope = "[('x_studio_company_id','in',company_ids)]";
	// comments carry no company field; scope them through their parent expense
	const commentScope = "[('x_studio_expense_id.x_studio_company_id','in',company_ids)]";

	await ensureAccess(expenseModel, 'x_expense', internalGid, companyScope);
	await ensureAccess(groupModel, 'x_expense_group', internalGid, companyScope);
	await ensureAccess(settleModel, 'x_settlement', internalGid, companyScope);
	await ensureAccess(commentModel, 'x_expense_comment', internalGid, commentScope);
	await ensureAccess(pushModel, 'x_push_subscription', internalGid); // per-user, app-filtered

	// Legacy Odoo (17/18): the ACL above is unscoped, so the domain must live in a
	// separate ir.rule. On 19+ the domain rode on the permission — skip this.
	if (!(await detectAccessModel())) {
		console.log('Record rules (legacy):');
		await ensureRule('x_expense: company scope', expenseModel, companyScope, internalGid);
		await ensureRule('x_expense_group: company scope', groupModel, companyScope, internalGid);
		await ensureRule('x_settlement: company scope', settleModel, companyScope, internalGid);
		await ensureRule('x_expense_comment: company scope', commentModel, commentScope, internalGid);
	}

	/* ---- bootstrap org fields for pre-existing users (only when unset) ---- */
	console.log('Org bootstrap:');
	const seed = await x('res.users', 'search_read', [
		[['share', '=', false], ['active', '=', true], ['x_studio_org_status', '=', false]],
		['id', 'company_id']
	]);
	for (const u of seed) {
		await x('res.users', 'write', [[u.id], {
			x_studio_org_role: u.id === uid ? 'admin' : 'member',
			x_studio_org_status: 'approved'
		}]);
		console.log(`  user ${u.id} → ${u.id === uid ? 'admin' : 'member'}/approved`);
	}
	const [adminUser] = await x('res.users', 'read', [[uid], ['company_id']]);
	const cid = adminUser.company_id[0];
	const [comp] = await x('res.company', 'read', [[cid], ['x_studio_invite_token']]);
	if (!comp.x_studio_invite_token) {
		await x('res.company', 'write', [[cid], { x_studio_invite_token: crypto.randomUUID() }]);
		console.log(`  company ${cid} invite token generated`);
	}

	console.log('Done.');
}

main().catch((e) => {
	console.error('FAILED:', e.message);
	process.exit(1);
});
