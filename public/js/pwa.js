'use strict';

(function () {
  let _installPrompt = null;
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  // ── Install prompt ────────────────────────────────────────────────────────

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _installPrompt = e;
    if (!isStandalone()) _showInstallBtns();
  });

  window.addEventListener('appinstalled', () => {
    _installPrompt = null;
    _hideInstallBtns();
  });

  function _showInstallBtns() {
    document.querySelectorAll('.pwa-install-btn').forEach(b => b.style.display = '');
  }
  function _hideInstallBtns() {
    document.querySelectorAll('.pwa-install-btn').forEach(b => b.style.display = 'none');
  }

  async function installApp() {
    if (!_installPrompt) return;
    _installPrompt.prompt();
    const { outcome } = await _installPrompt.userChoice;
    if (outcome === 'accepted') _hideInstallBtns();
    _installPrompt = null;
  }

  // ── Notifications button ──────────────────────────────────────────────────

  function updateNotifBtns() {
    const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
    document.querySelectorAll('.pwa-notif-btn').forEach(btn => {
      if (perm === 'unsupported' || perm === 'denied') {
        btn.style.display = 'none';
        return;
      }
      btn.style.display = '';
      if (perm === 'granted') {
        btn.textContent = 'Уведомления включены';
        btn.classList.add('pwa-notif-btn--on');
        btn.disabled = true;
      } else {
        btn.textContent = 'Включить уведомления';
        btn.classList.remove('pwa-notif-btn--on');
        btn.disabled = false;
        btn.onclick = async () => {
          btn.disabled = true;
          btn.textContent = 'Подключение...';
          try {
            if (typeof enablePushNotifications === 'function') {
              await enablePushNotifications();
            }
            updateNotifBtns();
          } catch {
            btn.disabled = false;
            btn.textContent = 'Включить уведомления';
          }
        };
      }
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    // Hide install buttons initially — show only when beforeinstallprompt fires
    // or keep hidden in standalone mode
    _hideInstallBtns();
    document.querySelectorAll('.pwa-install-btn').forEach(btn => {
      btn.onclick = installApp;
    });

    updateNotifBtns();

    // Register SW for caching (no push permission request)
    if (typeof registerSW === 'function') {
      registerSW().catch(() => {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.installApp      = installApp;
  window.updateNotifBtns = updateNotifBtns;
})();
