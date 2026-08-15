// Free-text matching for the expense list / report filters. Participant names
// live client-side (x_studio_participant_ids is a m2m of uids), so this can't be
// an Odoo domain — callers pass their own nameOf() resolver.

/**
 * Case-insensitive substring match over description, payer name and participant names.
 * @param {Record<string, any>} ex expense record
 * @param {string} q raw query — blank matches everything
 * @param {(id:number)=>string} nameOf uid -> display name
 */
export function matchesExpense(ex, q, nameOf) {
	const needle = q.trim().toLowerCase();
	if (!needle) return true;
	// the [1] label is missing on some records — fall back to the resolved uid
	const payer = ex.x_studio_payer_id?.[1] || nameOf(ex.x_studio_payer_id?.[0]);
	const parts = (ex.x_studio_participant_ids || []).map(nameOf);
	return [ex.x_name, payer, ...parts].some((s) =>
		String(s ?? '').toLowerCase().includes(needle)
	);
}
