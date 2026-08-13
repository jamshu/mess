// Excel export without a dependency — emits a real .xlsx (OOXML) so Excel opens
// it clean (a SpreadsheetML .xls triggers a "format & extension don't match"
// warning). An .xlsx is a ZIP of XML parts; we build the parts as strings and
// pack them with a tiny STORE-only ZIP writer (no compression → no zlib dep).
// Worker-safe: TextEncoder + Uint8Array only. Self-check: npm run check:report.
import { downloadFile } from './download.js';

const enc = new TextEncoder();

export const esc = (s) =>
	String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

/**
 * Describe one worksheet (built into XML lazily inside workbook()).
 * @param {string} name tab name
 * @param {{header:string, type?:'String'|'Number', money?:boolean}[]} columns
 * @param {any[][]} rows values aligned to columns
 * @param {{totals?:(any|null)[]}} [opts] optional bold totals row (null → blank)
 */
export function sheet(name, columns, rows, opts = {}) {
	return { name: String(name).slice(0, 31), columns, rows, totals: opts.totals || null };
}

// --- cell styles (indices into styles.xml cellXfs below) ---
const S_HEADER = 1, S_MONEY = 2, S_TOTAL = 3, S_TOTAL_MONEY = 4;

// A1-style column letter for a 0-based index.
function colLetter(i) {
	let s = '';
	i++;
	while (i) {
		const m = (i - 1) % 26;
		s = String.fromCharCode(65 + m) + s;
		i = Math.floor((i - 1) / 26);
	}
	return s;
}

function cellXml(ref, value, type, style) {
	const s = style ? ` s="${style}"` : '';
	if (type === 'Number') {
		const n = Number(value);
		return `<c r="${ref}"${s}><v>${Number.isFinite(n) ? n : 0}</v></c>`;
	}
	return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function worksheetXml(sh) {
	const out = [];
	let r = 1;
	out.push(
		`<row r="${r}">` +
			sh.columns.map((c, ci) => cellXml(colLetter(ci) + r, c.header, 'String', S_HEADER)).join('') +
			'</row>'
	);
	for (const row of sh.rows) {
		r++;
		out.push(
			`<row r="${r}">` +
				sh.columns
					.map((c, ci) => cellXml(colLetter(ci) + r, row[ci], c.type || 'String', c.money ? S_MONEY : 0))
					.join('') +
				'</row>'
		);
	}
	if (sh.totals) {
		r++;
		out.push(
			`<row r="${r}">` +
				sh.columns
					.map((c, ci) => {
						const v = sh.totals[ci];
						if (v == null) return cellXml(colLetter(ci) + r, '', 'String', S_TOTAL);
						const isNum = c.type === 'Number';
						return cellXml(colLetter(ci) + r, v, isNum ? 'Number' : 'String', c.money ? S_TOTAL_MONEY : S_TOTAL);
					})
					.join('') +
				'</row>'
		);
	}
	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
		`<sheetData>${out.join('')}</sheetData></worksheet>`
	);
}

const STYLES_XML =
	'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
	'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
	'<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
	'<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
	'<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
	'<fills count="3"><fill><patternFill patternType="none"/></fill>' +
	'<fill><patternFill patternType="gray125"/></fill>' +
	'<fill><patternFill patternType="solid"><fgColor rgb="FFEEEEEE"/></patternFill></fill></fills>' +
	'<borders count="1"><border/></borders>' +
	'<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
	'<cellXfs count="5">' +
	'<xf/>' + // 0 default
	'<xf fontId="1" fillId="2" applyFont="1" applyFill="1"/>' + // 1 header
	'<xf numFmtId="164" applyNumberFormat="1"/>' + // 2 money
	'<xf fontId="1" applyFont="1"/>' + // 3 total (bold)
	'<xf fontId="1" numFmtId="164" applyFont="1" applyNumberFormat="1"/>' + // 4 total money
	'</cellXfs>' +
	'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
	'</styleSheet>';

const ROOT_RELS =
	'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
	'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
	'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
	'</Relationships>';

function contentTypes(n) {
	let ov = '';
	for (let i = 1; i <= n; i++)
		ov += `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
		'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
		'<Default Extension="xml" ContentType="application/xml"/>' +
		'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
		'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
		ov +
		'</Types>'
	);
}

function workbookXml(sheets) {
	const s = sheets
		.map((sh, i) => `<sheet name="${esc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
		.join('');
	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
		'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
		`<sheets>${s}</sheets></workbook>`
	);
}

function workbookRels(n) {
	let rels = '';
	for (let i = 1; i <= n; i++)
		rels += `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`;
	rels += `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
		rels +
		'</Relationships>'
	);
}

// --- minimal STORE-only ZIP (no compression) ---
const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();
function crc32(bytes) {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
	const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
	const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
	const parts = [];
	const central = [];
	let offset = 0;
	for (const f of files) {
		const name = enc.encode(f.name);
		const crc = crc32(f.data);
		const size = f.data.length;
		const local = Uint8Array.from([
			...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
			...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0)
		]);
		parts.push(local, name, f.data);
		central.push(
			Uint8Array.from([
				...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
				...u32(crc), ...u32(size), ...u32(size),
				...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)
			]),
			name
		);
		offset += local.length + name.length + size;
	}
	let cdSize = 0;
	for (const c of central) cdSize += c.length;
	const end = Uint8Array.from([
		...u32(0x06054b50), ...u16(0), ...u16(0),
		...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)
	]);
	const all = [...parts, ...central, end];
	let total = 0;
	for (const a of all) total += a.length;
	const out = new Uint8Array(total);
	let p = 0;
	for (const a of all) { out.set(a, p); p += a.length; }
	return out;
}

/** Build an .xlsx (Uint8Array) from sheets. */
export function workbook(sheets) {
	const files = [
		{ name: '[Content_Types].xml', data: enc.encode(contentTypes(sheets.length)) },
		{ name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
		{ name: 'xl/workbook.xml', data: enc.encode(workbookXml(sheets)) },
		{ name: 'xl/_rels/workbook.xml.rels', data: enc.encode(workbookRels(sheets.length)) },
		{ name: 'xl/styles.xml', data: enc.encode(STYLES_XML) }
	];
	sheets.forEach((sh, i) =>
		files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(worksheetXml(sh)) })
	);
	return zip(files);
}

export const thisMonth = () => new Date().toISOString().slice(0, 7); // YYYY-MM

// First day of the month AFTER `month` (YYYY-MM), as YYYY-MM-DD. Upper bound is
// exclusive so a string `<` compare on x_studio_date catches every day.
export function nextMonthStart(month) {
	const [y, m] = month.split('-').map(Number);
	const d = new Date(Date.UTC(y, m, 1)); // m is 0-based next month
	return d.toISOString().slice(0, 10);
}

/** Odoo domain from the shared filters. month='' → all time. */
export function expenseDomain(month, includedMe, uid) {
	const d = [];
	if (month) {
		d.push(['x_studio_date', '>=', `${month}-01`], ['x_studio_date', '<', nextMonthStart(month)]);
	}
	if (includedMe && uid) d.push(['x_studio_participant_ids', 'in', [uid]]);
	return d;
}

/** Browser: download an .xlsx from a workbook byte array (iOS PWA-safe). */
export async function downloadExcel(baseName, bytes) {
	const blob = new Blob([bytes], {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
	const url = URL.createObjectURL(blob);
	try {
		await downloadFile(url, `${baseName}.xlsx`);
	} finally {
		URL.revokeObjectURL(url);
	}
}
