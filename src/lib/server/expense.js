// Server-only helpers shared by the expense comment / bill / media endpoints.
// Attachments live in ir.attachment (raw = base64), read back with the admin key.
import { adminExecute } from './odoo.js';

/** Company that owns an expense, or null. Used to scope comment/bill/media access. */
export async function expenseCompany(expenseId) {
	const [e] = await adminExecute('x_expense', 'read', [[Number(expenseId)]], {
		fields: ['x_studio_company_id']
	});
	return e?.x_studio_company_id?.[0] ?? null;
}

/** Reject unless `expenseId` belongs to `companyId`. Throws 403/404. */
export async function assertExpenseInCompany(expenseId, companyId) {
	const cid = await expenseCompany(expenseId);
	if (cid == null) { const e = new Error('Expense not found'); e.status = 404; throw e; }
	if (cid !== companyId) { const e = new Error('Not your organization'); e.status = 403; throw e; }
	return cid;
}

/** Create an ir.attachment holding base64 bytes, linked to res_model/res_id. */
export function createAttachment({ name, mime, dataBase64, resModel, resId }) {
	return adminExecute('ir.attachment', 'create', [{
		name: name || 'attachment',
		mimetype: mime,
		raw: dataBase64,
		res_model: resModel,
		res_id: Number(resId)
	}]);
}

/** Read an attachment's link + bytes with the admin key. */
export async function readAttachment(attId) {
	const [a] = await adminExecute('ir.attachment', 'read', [[Number(attId)]], {
		fields: ['res_model', 'res_id', 'mimetype', 'raw']
	});
	return a || null;
}

/** The expense a comment belongs to (for scoping comment-media reads). */
export async function commentExpense(commentId) {
	const [c] = await adminExecute('x_expense_comment', 'read', [[Number(commentId)]], {
		fields: ['x_studio_expense_id']
	});
	return c?.x_studio_expense_id?.[0] ?? null;
}
