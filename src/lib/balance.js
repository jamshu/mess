// Pure balance math, shared by the dashboard endpoint. No imports, no I/O, so it
// bundles cleanly for the Cloudflare Worker. Self-check lives in balance-check.js
// (npm run check:balance) to keep this file free of any Node surface.
//
// Model: an expense is paid by one user and split EQUALLY over its frozen
// participant list (share = amount / n). A settlement is cash "from → to" that
// rebalances nets without touching any expense.
//
//   net(u) = (paid by u − u's share of expenses) + (u sent) − (u received)
//
// net > 0  → the group owes u (u is up).   net < 0 → u owes the group.
// The nets always sum to ~0 (money is conserved); rounding is the only drift.

/**
 * @param {{amount:number, payerId:number, participantIds:number[]}[]} expenses
 * @param {{fromId:number, toId:number, amount:number}[]} settlements
 * @param {number[]} userIds  everyone to report on (payers/participants included even if absent here)
 * @returns {Map<number,{paid:number,cost:number,sent:number,received:number,net:number}>}
 */
export function computeBalances(expenses, settlements, userIds = []) {
	const acc = new Map();
	const row = (id) => {
		let r = acc.get(id);
		if (!r) { r = { paid: 0, cost: 0, sent: 0, received: 0, net: 0 }; acc.set(id, r); }
		return r;
	};
	for (const id of userIds) row(id);

	for (const e of expenses) {
		const parts = e.participantIds || [];
		const amount = Number(e.amount) || 0;
		if (e.payerId) row(e.payerId).paid += amount;
		if (parts.length) {
			const share = amount / parts.length;
			for (const p of parts) row(p).cost += share;
		}
	}

	for (const s of settlements) {
		const amount = Number(s.amount) || 0;
		if (s.fromId) row(s.fromId).sent += amount;
		if (s.toId) row(s.toId).received += amount;
	}

	for (const r of acc.values()) {
		r.net = r.paid - r.cost + r.sent - r.received;
	}
	return acc;
}

/** Round to 2dp for display without accumulating float noise. */
export const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
