/* Gen Z over-the-air updater.
 *
 * A deploy publishes /version.json. This script notices a newer build and applies it without
 * ever yanking the page out from under someone:
 *   - polls politely (60s, jittered, ETag, backs off on errors, paused while hidden/offline)
 *   - shows a "ready" banner instead of reloading in the middle of a task
 *   - applies silently at a safe moment: next navigation, or when the tab returns after a while
 *   - never reloads during a call, a live room, an open dialog or a half-written post
 *   - manifest.force = true applies at the next safe moment without waiting for navigation
 *   - reload-loop guard: three reloads inside two minutes stops auto-apply and asks the user
 * index.html carries <meta name="kz-build"> (stamped at deploy) so the page knows its own build.
 */
(() => {
  'use strict';
  const POLL_MS = 60000, MAX_BACKOFF_MS = 300000, LOOP_WINDOW_MS = 120000, LOOP_LIMIT = 3, AWAY_MS = 300000;
  const LOOP_KEY = 'kz-ota-reloads';

  let running = null;           // build this page was loaded with
  let pending = null;           // newer manifest waiting to be applied
  let etag = null, busy = false, failures = 0, timer = 0, hiddenAt = 0, dismissedFor = null, stuck = false, banner = null;

  const meta = document.querySelector('meta[name="kz-build"]')?.content || '';
  if (meta && meta !== 'dev' && !meta.startsWith('__')) running = meta;

  // drop the cache-busting param we add when applying an update
  try {
    const u = new URL(location.href);
    if (u.searchParams.has('v')) { u.searchParams.delete('v'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
  } catch {}

  const recentReloads = () => {
    try { return JSON.parse(sessionStorage.getItem(LOOP_KEY) || '[]').filter(t => Date.now() - t < LOOP_WINDOW_MS); } catch { return []; }
  };

  /** True when reloading right now could lose someone's work or end a session. */
  function isBusy() {
    if (document.getElementById('call-layer')?.children.length) return true;
    if (/^#\/live\/[^/]+/.test(location.hash)) return true;
    if (document.getElementById('modal-root')?.children.length) return true;
    if (document.getElementById('lightbox-root')?.children.length) return true;
    const textish = 'textarea, input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit]):not([type=hidden])';
    for (const el of document.querySelectorAll(textish)) {
      if (el.value && el.value.trim() && el.offsetParent !== null) return true;
    }
    return false;
  }

  function apply(reason) {
    if (!pending) return false;
    const recent = recentReloads();
    if (recent.length >= LOOP_LIMIT) { stuck = true; render(); return false; }
    recent.push(Date.now());
    try { sessionStorage.setItem(LOOP_KEY, JSON.stringify(recent)); } catch {}
    window.dispatchEvent(new CustomEvent('kz:update-applying', { detail: { version: pending.version, reason } }));
    const u = new URL(location.href);
    u.searchParams.set('v', String(pending.version).slice(0, 8));   // bypasses a stale cached index.html
    location.replace(u.toString());
    return true;
  }

  function render() {
    if (!pending || dismissedFor === pending.version) { banner?.remove(); banner = null; return; }
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'kz-update';
      banner.setAttribute('role', 'status');
      banner.innerHTML = '<span class="kz-update-msg"></span><button type="button" class="kz-update-go">Refresh</button>' +
        '<button type="button" class="kz-update-x" aria-label="Dismiss update notice">×</button>';
      banner.querySelector('.kz-update-go').addEventListener('click', () => apply('user'));
      banner.querySelector('.kz-update-x').addEventListener('click', () => { dismissedFor = pending?.version; render(); });
      document.body.appendChild(banner);
    }
    banner.querySelector('.kz-update-msg').textContent = stuck
      ? 'An update is ready but could not be applied. Refresh the page again, or clear site data if it keeps happening.'
      : (pending.notes ? `Update ready: ${pending.notes}` : 'A new version of Gen Z is ready.');
  }

  async function check() {
    if (busy || document.visibilityState !== 'visible' || !navigator.onLine) return;
    busy = true;
    try {
      const res = await fetch('/version.json', { cache: 'no-store', headers: etag ? { 'If-None-Match': etag } : {} });
      if (res.status === 304) { failures = 0; return; }
      if (!res.ok) throw new Error(String(res.status));
      etag = res.headers.get('etag') || etag;
      const m = await res.json();
      failures = 0;
      const next = m && (m.version || m.commit);
      if (!next) return;
      if (!running) { running = next; return; }          // dev / unstamped page: first answer is the baseline
      if (next === running) { pending = null; render(); return; }
      if (!pending || pending.version !== next) {
        pending = { version: next, notes: m.notes || '', force: !!m.force };
        window.dispatchEvent(new CustomEvent('kz:update-ready', { detail: pending }));
      }
      render();
      if (pending.force && !isBusy()) apply('force');
    } catch { failures += 1; }
    finally { busy = false; schedule(); }
  }

  function schedule() {
    clearTimeout(timer);
    const base = Math.min(POLL_MS * Math.pow(2, failures), MAX_BACKOFF_MS);
    timer = setTimeout(check, base + Math.round((Math.random() - 0.5) * 20000));
  }

  // Safe moments to apply a waiting update silently.
  // The app re-renders the page before our hashchange handler runs, so a draft may already be gone from
  // the DOM. Remember that one existed and let this navigation pass; the next one can apply.
  let draft = false;
  document.addEventListener('input', (e) => { const t = e.target; if (t && 'value' in t) draft = !!String(t.value).trim(); }, true);
  window.addEventListener('hashchange', () => {
    const hadDraft = draft; draft = false;
    if (pending && !stuck && !hadDraft && !isBusy()) apply('navigation');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    check();
    if (pending && !stuck && hiddenAt && Date.now() - hiddenAt > AWAY_MS && !isBusy()) apply('returned');
  });
  window.addEventListener('online', check);

  window.kzOTA = { check, apply: () => apply('manual'), isBusy, get status() { return { running, pending: pending && pending.version, stuck, failures }; } };
  check();
})();
