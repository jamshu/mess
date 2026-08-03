// Self-check for balance.js. Run: npm run check:balance
import { computeBalances } from './balance.js';

const approx = (a, b, msg) => {
	if (Math.abs(a - b) > 1e-6) throw new Error(`FAIL ${msg}: ${a} !== ${b}`);
};

// A(1) pays 90 split over A,B,C → each share 30. A up 60, B and C down 30.
const expenses = [{ amount: 90, payerId: 1, participantIds: [1, 2, 3] }];
let bal = computeBalances(expenses, [], [1, 2, 3]);
approx(bal.get(1).net, 60, 'A net before settle');
approx(bal.get(2).net, -30, 'B net before settle');
approx(bal.get(3).net, -30, 'C net before settle');

// B pays A 30 cash → B settles up, A now only owed 30 (by C).
bal = computeBalances(expenses, [{ fromId: 2, toId: 1, amount: 30 }], [1, 2, 3]);
approx(bal.get(1).net, 30, 'A net after settle');
approx(bal.get(2).net, 0, 'B net after settle');
approx(bal.get(3).net, -30, 'C net after settle');

// Creator-only group: split over just [1] → payer bears full cost, net 0.
bal = computeBalances([{ amount: 50, payerId: 1, participantIds: [1] }], [], [1]);
approx(bal.get(1).net, 0, 'creator-only net');

// Nets conserve: they sum to ~0.
const sum = [...bal.values()].reduce((t, r) => t + r.net, 0);
const sum2 = [
	...computeBalances(expenses, [{ fromId: 2, toId: 1, amount: 30 }], [1, 2, 3]).values()
].reduce((t, r) => t + r.net, 0);
approx(sum, 0, 'creator-only nets sum');
approx(sum2, 0, 'settled nets sum to zero');

console.log('balance-check: all self-checks passed');
