'use strict';

function _urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// Register SW only — no permission dialog. Call on every page load.
async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return reg;
  } catch (e) {
    console.warn('[SW]', e);
    return null;
  }
}

// Re-send existing push subscription to server (if permission already granted).
// Does NOT prompt for permission.
async function pushRegister() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const keyRes = await fetch('/api/push/vapid-key').then(r => r.json());
    if (!keyRes.key) return;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(keyRes.key)
      });
    }
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(sub)
    });
  } catch (e) {
    console.warn('[Push]', e);
  }
}

// Ask permission then subscribe. Call only from user-initiated action (button click).
async function enablePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push не поддерживается');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Разрешение не получено');
  await pushRegister();
}

// Unsubscribe and remove from server
async function disablePushNotifications() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/push/unsubscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ endpoint: sub.endpoint })
      });
      await sub.unsubscribe();
    }
  } catch (e) {
    console.warn('[Push unsubscribe]', e);
  }
}

window.registerSW             = registerSW;
window.pushRegister           = pushRegister;
window.enablePushNotifications = enablePushNotifications;
window.disablePushNotifications = disablePushNotifications;
