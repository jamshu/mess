// Color themes. Single source of truth, importable from client and server
// (no browser-only deps). The chosen theme id is persisted (localStorage or a
// user settings field) and applied via a data-theme attribute on <html>.
// Each theme's palette lives in app.css under :root[data-theme='<id>'].
// `ink` is the base :root palette (dark-first) — no override block needed.

export const DEFAULT_THEME = 'ink';

// swatch = [accent, surface, bg] — three colors shown in the picker preview.
export const THEMES = [
	{ id: 'ink', name: 'Ink', swatch: ['#3b82f6', '#141414', '#0a0a0a'] },
	{ id: 'daylight', name: 'Daylight', swatch: ['#2563eb', '#ffffff', '#f6f6f7'] },
	{ id: 'claude', name: 'Claude', swatch: ['#c15f3c', '#ffffff', '#faf9f5'] }
];

export const THEME_IDS = THEMES.map((t) => t.id);

export function coerceTheme(id) {
	return THEME_IDS.includes(id) ? id : DEFAULT_THEME;
}

// First-load pick when nothing is saved: honor the OS color scheme.
export function preferredTheme() {
	const saved = localStorage.getItem('theme');
	if (saved && THEME_IDS.includes(saved)) return saved;
	const light =
		typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
	return light ? 'daylight' : 'ink';
}

/** Apply on mount and whenever the user picks a new theme. */
export function applyTheme(id) {
	document.documentElement.dataset.theme = coerceTheme(id);
	localStorage.setItem('theme', coerceTheme(id));
}
