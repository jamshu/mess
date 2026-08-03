// ponytail: single hard-coded currency symbol. If an org isn't INR, change it
// here (or make it a per-company setting) — no per-page formatting to hunt down.
export const CURRENCY = 'SAR ';

export const fmt = (n) =>
	(Number(n) < 0 ? '-' : '') +
	CURRENCY +
	Math.abs(Number(n) || 0).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
