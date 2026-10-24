import { BRAND } from '../brand.js';
/* Gen Z — Settings: profile, appearance, screen time, premium, danger zone */
import { api, session, getTheme, setTheme } from '../api.js';
import { esc, h, icon, toast, fmtDuration, confirmDialog, avatar } from '../ui.js';
import { editProfileDialog } from './profile.js';
import { clearSession } from '../api.js';

export async function renderSettings(root) {
  root.innerHTML = '';
  const me = session.user;
  const theme = getTheme();

  const el = h(`<div>
    <div class="page-head"><h1>Settings</h1></div>
    <div style="display:grid;gap:16px;max-width:640px">

      <div class="card settings-group">
        <h3 style="font-size:16px;font-weight:800">Account</h3>
        <div class="settings-row">
          <span class="pf-av-slot"></span>
          <div class="grow">
            <div class="sr-label">${esc(me.fullName)}</div>
            <div class="sr-sub">${esc(me.email)}</div>
          </div>
          <button class="btn btn-ghost btn-sm" data-edit>Edit</button>
        </div>
      </div>

      <div class="card settings-group">
        <h3 style="font-size:16px;font-weight:800">Appearance</h3>
        <div class="settings-row">
          <span class="sr-icon">${icon('moon').outerHTML}</span>
          <div class="grow"><div class="sr-label">Dark mode</div>
          <div class="sr-sub">Easier on the eyes during late-night study</div></div>
          <button class="switch ${theme === 'dark' ? 'on' : ''}" data-theme-switch role="switch" aria-label="Dark mode" aria-checked="${theme === 'dark'}"></button>
        </div>
      </div>

      <div class="card settings-group">
        <h3 style="font-size:16px;font-weight:800;display:flex;align-items:center;gap:8px">${icon('timer').outerHTML} Screen time</h3>
        <div class="settings-row">
          <div class="grow">
            <div class="sr-label">Today: <b data-usage>…</b></div>
            <div class="usage-bar"><i data-usage-bar style="width:0%"></i></div>
            <div class="sr-sub" data-usage-note>Tracking your active time in ${BRAND.name}.</div>
          </div>
        </div>
        <div class="field">
          <label>Daily limit: <b data-limit-val>…</b></label>
          <input type="range" min="15" max="480" step="15" value="120" data-limit-range aria-label="Daily screen time limit" style="width:100%">
          <span class="hint">We'll gently remind you when you reach it. Choose 15min – 8h.</span>
        </div>
      </div>

      <div class="card settings-group" data-premium-card>
        <h3 style="font-size:16px;font-weight:800;display:flex;align-items:center;gap:8px">${icon('crown').outerHTML} ${BRAND.name} Premium</h3>
        <div data-premium-body><div class="spinner"></div></div>
      </div>

      <div class="card settings-group" style="border-color:rgba(229,72,77,.35)">
        <h3 style="font-size:16px;font-weight:800;color:var(--danger)">Danger zone</h3>
        <div class="settings-row">
          <div class="grow"><div class="sr-label">Log out</div><div class="sr-sub">End this session on this device</div></div>
          <button class="btn btn-ghost btn-sm" data-logout>Log out</button>
        </div>
        <div class="settings-row">
          <div class="grow"><div class="sr-label">Delete account</div><div class="sr-sub">Permanently remove your account and data</div></div>
          <button class="btn btn-danger-soft btn-sm" data-delete>Delete</button>
        </div>
      </div>
    </div>
  </div>`);
  root.appendChild(el);

  // avatar
  const meFull = await api.me().catch(() => null);
  if (meFull) { session.setUser({ ...me, fullName: meFull.fullName }); }
  const av = avatar(meFull || me, 44);
  el.querySelector('.pf-av-slot').replaceWith(av);

  el.querySelector('[data-edit]').addEventListener('click', () => {
    editProfileDialog(meFull || me, () => renderSettings(root));
  });

  // theme
  el.querySelector('[data-theme-switch]').addEventListener('click', (e) => {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    e.currentTarget.classList.toggle('on', next === 'dark');
    e.currentTarget.setAttribute('aria-checked', String(next === 'dark'));
  });

  // usage
  const usage = await api.usageSummary().catch(() => null);
  if (usage) {
    el.querySelector('[data-usage]').textContent = fmtDuration(usage.totalMinutesToday);
    const pct = usage.dailyLimitMinutes ? Math.min(100, usage.totalMinutesToday / usage.dailyLimitMinutes * 100) : Math.min(100, usage.totalMinutesToday / 480 * 100);
    el.querySelector('[data-usage-bar]').style.width = pct + '%';
    if (usage.limitExceeded) el.querySelector('[data-usage-note]').innerHTML = `<b style="color:var(--warn)">Daily limit reached — time to touch grass 🌱</b>`;
  }
  const range = el.querySelector('[data-limit-range]');
  if (usage?.dailyLimitMinutes) range.value = Math.max(15, Math.min(480, usage.dailyLimitMinutes));
  el.querySelector('[data-limit-val]').textContent = fmtDuration(+range.value);
  range.addEventListener('input', () => { el.querySelector('[data-limit-val]').textContent = fmtDuration(+range.value); });
  range.addEventListener('change', async () => {
    try { await api.setUsageLimit(+range.value); toast('Daily limit saved', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  });

  // premium
  const status = await api.subStatus().catch(() => ({ isActive: false }));
  const pBody = el.querySelector('[data-premium-body]');
  if (status.isActive) {
    pBody.innerHTML = `
      <div class="settings-row">
        <div class="grow">
          <div class="sr-label" style="color:var(--accent)">Premium is active 👑</div>
          <div class="sr-sub">Ad-free browsing${status.expiresAt ? ` · renews ${new Date(status.expiresAt).toLocaleDateString()}` : ''}</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-cancel-prem>Cancel</button>
      </div>`;
    pBody.querySelector('[data-cancel-prem]').addEventListener('click', async () => {
      const ok = await confirmDialog('Cancel Premium?', 'Ads will return to your feed at the end of the period.', 'Cancel Premium');
      if (!ok) return;
      await api.cancelPremium().catch(() => {});
      toast('Premium cancelled', 'info'); renderSettings(root);
    });
  } else {
    pBody.innerHTML = `
      <p style="color:var(--text-2);font-size:14px">Go ad-free, support campus servers, and unlock early features.</p>
      <div class="settings-row" style="gap:18px;flex-wrap:wrap">
        <span style="font-weight:800;font-size:24px">5,000<span style="font-size:13px;color:var(--text-3);font-weight:600"> UGX / month</span></span>
        <span class="grow"></span>
        <button class="btn btn-primary" data-activate>${icon('crown').outerHTML} Activate Premium</button>
      </div>`;
    pBody.querySelector('[data-activate]').addEventListener('click', async () => {
      try { await api.activatePremium(); toast('Welcome to Premium! 👑', 'ok', 4000); renderSettings(root); }
      catch (e) { toast(e.message, 'err'); }
    });
  }

  // logout
  el.querySelector('[data-logout]').addEventListener('click', async () => {
    await api.logout().catch(() => {});
    clearSession();
    location.hash = '/auth';
    location.reload();
  });

  // delete
  el.querySelector('[data-delete]').addEventListener('click', async () => {
    const ok = await confirmDialog('Delete your account?', 'Everything — posts, messages, follows — will be permanently erased. This cannot be undone.', 'Delete forever');
    if (!ok) return;
    try {
      await fetch('/api/Users', { method: 'DELETE', headers: { Authorization: `Bearer ${session.token}` } });
      clearSession();
      location.hash = '/auth';
      location.reload();
    } catch (e) { toast(e.message, 'err'); }
  });
}
