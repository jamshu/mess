// Tiny toast store. `toast.success('Saved')` / `toast.error('Failed')`.
import { writable } from 'svelte/store';

export const toasts = writable([]);
let id = 0;

function push(message, kind, ms) {
	const t = { id: ++id, message, kind };
	toasts.update((list) => [...list, t]);
	if (ms > 0) setTimeout(() => dismiss(t.id), ms);
	return t.id;
}

export function dismiss(tid) {
	toasts.update((list) => list.filter((t) => t.id !== tid));
}

export const toast = {
	success: (m, ms = 2800) => push(m, 'success', ms),
	error: (m, ms = 4000) => push(m, 'error', ms),
	info: (m, ms = 2800) => push(m, 'info', ms)
};
