// iOS standalone PWAs have no download manager — a plain <a download> navigates
// the app window with no way back. There: fetch the file and hand it to the
// share sheet (user picks "Save to Files"). Android PWAs and regular browsers
// get a normal object-URL download (Android WebAPKs have a real download manager).
// iOS Files app types a saved file by its extension only — a name without one
// saves as unopenable raw binary. Append an extension from the mimetype when missing.
const EXT = {
	'image/jpeg': 'jpg',
	'image/svg+xml': 'svg',
	'text/plain': 'txt',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
	'application/vnd.ms-excel': 'xls',
	'application/msword': 'doc'
};

function withExt(name, type) {
	if (/\.[a-z0-9]{1,5}$/i.test(name)) return name; // already has one
	const ext = EXT[type] || type?.split('/')[1]?.replace(/[^a-z0-9]/g, '').slice(0, 5);
	return ext ? `${name}.${ext}` : name;
}

export async function downloadFile(url, name) {
	const ios = 'standalone' in window.navigator; // property exists only on iOS WebKit
	const standalone =
		window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
	const res = await fetch(url);
	if (!res.ok) throw new Error('Download failed');
	const blob = await res.blob();
	const filename = withExt(name || 'file', blob.type);
	if (ios && standalone && navigator.canShare) {
		const file = new File([blob], filename, { type: blob.type });
		if (navigator.canShare({ files: [file] })) {
			try {
				await navigator.share({ files: [file] });
				return;
			} catch (e) {
				if (e.name === 'AbortError') return; // user closed the sheet
				// share failed (e.g. lost user-gesture window) — fall through to anchor
			}
		}
	}
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = filename;
	a.click();
	URL.revokeObjectURL(a.href);
}
