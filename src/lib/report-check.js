// Self-check for report.js — run with: node src/lib/report-check.js
// Guards XML escaping and that the .xlsx zip is well-formed with the expected
// parts. ZIP uses STORE (no compression), so the XML text is searchable raw.
import assert from 'node:assert';
import { esc, sheet, workbook } from './report.js';

assert.equal(esc('a & b < c > "d"'), 'a &amp; b &lt; c &gt; &quot;d&quot;', 'esc');

const cols = [
	{ header: 'Item', type: 'String' },
	{ header: 'Amount', type: 'Number', money: true }
];
const s1 = sheet('Expenses', cols, [['Lunch & tea', 12.5]], { totals: [null, 12.5] });
const s2 = sheet('Summary', cols, [['Food', 12.5]]);
const bytes = workbook([s1, s2]);

assert.ok(bytes instanceof Uint8Array, 'workbook returns bytes');
assert.ok(bytes[0] === 0x50 && bytes[1] === 0x4b, 'PK zip signature'); // "PK"

const text = Buffer.from(bytes).toString('latin1');
assert.ok(text.includes('[Content_Types].xml'), 'content types part');
assert.ok(text.includes('xl/worksheets/sheet2.xml'), 'second worksheet part');
assert.ok(text.includes('name="Expenses"'), 'sheet 1 named');
assert.ok(text.includes('name="Summary"'), 'sheet 2 named');
assert.ok(text.includes('Lunch &amp; tea'), 'string cell escaped');
assert.ok(text.includes('<v>12.5</v>'), 'numeric cell');

console.log('report.js self-check passed');
