import { writable } from 'svelte/store';

// Unread notification count, shown as a badge on the nav bell. Kept in a store so
// the /notifications page can zero it the moment it marks everything read.
export const unreadCount = writable(0);

export async function refreshUnread(signedIn: boolean) {
  if (!signedIn) { unreadCount.set(0); return; }
  try {
    const r = await fetch('/api/me/notifications');
    if (r.ok) { const d = await r.json(); unreadCount.set(d.unread || 0); }
  } catch { /* offline — leave as-is */ }
}
