/* Kampuz — Auth view (login + register) */
import { api, saveSession, setTheme } from '../api.js';
import { esc, h, icon, toast } from '../ui.js';
import { BRAND, logoMark, wordmark } from '../brand.js';

const DEMO = { email: 'test@streamcampus.com', password: 'Test@123' };

export function renderAuth(root, onAuthed) {
  setTheme(localStorage.getItem('sc_theme') || 'dark');
  root.innerHTML = '';

  const el = h(`<div class="auth-wrap">
    <section class="kz-hero" aria-label="About ${esc(BRAND.name)}">
      <div class="auth-brand">${logoMark(44, { inverse: true })}<span class="kz-word">${wordmark()}</span></div>
      <div class="kz-copy">
        <h1>Your campus,<br>live.</h1>
        <p>Course chats, live classes, shorts from people on your campus and an AI study buddy, all in one app.</p>
      </div>
      <ol class="kz-day" aria-label="A sample day on ${esc(BRAND.name)}">
        <li class="live"><time>08:00</time><b>Data Structures</b><small><i></i>Live class</small></li>
        <li><time>11:30</time><b>Calculus group</b><small>Course chat</small></li>
        <li><time>15:00</time><b>Notes from the lecture hall</b><small>Shorts</small></li>
        <li><time>21:00</time><b>Quiz me on chapter 4</b><small>Campus Buddy</small></li>
      </ol>
    </section>
    <div class="auth-panel"><div class="auth-card">
      <div>
        <h2 id="kz-auth-title">Welcome to ${esc(BRAND.name)}</h2>
        <p class="sub" id="kz-auth-sub">Log in to pick up where you left off.</p>
      </div>
      <div class="auth-tabs" role="tablist" aria-label="Account">
        <button class="active" role="tab" aria-selected="true" data-tab="login">Log in</button>
        <button role="tab" aria-selected="false" data-tab="register">Create account</button>
      </div>
      <form class="auth-form" id="auth-form" novalidate></form>
      <div class="kz-or"><span>or</span></div>
      <button class="kz-btn-ghost" type="button" data-demo>Explore with the demo account</button>
      <p class="auth-foot">By continuing you agree to keep campus vibes positive.</p>
    </div></div>
  </div>`);
  root.appendChild(el);

  let mode = 'login';
  const form = el.querySelector('#auth-form');

  const pass = (name, ph, ac) => `<div class="kz-pass"><input class="input" name="${name}" type="password" placeholder="${ph}" autocomplete="${ac}" required>
      <button type="button" class="kz-eye" aria-label="Show password" aria-pressed="false">${icon('eye').outerHTML}</button></div>`;

  const fields = {
    login: () => `
      <div class="field"><label for="f-email">Email</label>
        <input class="input" id="f-email" name="email" type="email" placeholder="you@campus.ac.ug" autocomplete="email" required></div>
      <div class="field"><label>Password</label>${pass('password', 'Your password', 'current-password')}</div>
      <button class="btn btn-primary btn-block" type="submit" style="padding:13px">Log in</button>`,
    register: () => `
      <div class="field"><label for="f-name">Full name</label>
        <input class="input" id="f-name" name="fullName" placeholder="e.g. Nakato Sarah" autocomplete="name" required></div>
      <div class="field"><label for="f-uni">University email</label>
        <input class="input" id="f-uni" name="universityEmail" type="email" placeholder="student@mak.ac.ug" autocomplete="email" required></div>
      <div class="field"><label for="f-mail">Personal email</label>
        <input class="input" id="f-mail" name="email" type="email" placeholder="you@example.com" autocomplete="email" required></div>
      <div class="field"><label>Password</label>${pass('password', '8+ characters', 'new-password')}
        <span class="hint">At least 8 characters, with an uppercase letter and a number.</span></div>
      <button class="btn btn-primary btn-block" type="submit" style="padding:13px">Create my account</button>`,
  };

  function setMode(m) {
    mode = m;
    el.querySelectorAll('.auth-tabs button').forEach(b => {
      const on = b.dataset.tab === m;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    el.querySelector('#kz-auth-sub').textContent = m === 'login'
      ? 'Log in to pick up where you left off.' : 'Takes under a minute. Your campus is waiting.';
    form.innerHTML = fields[m]();
    form.querySelectorAll('.kz-eye').forEach(btn => btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    }));
  }
  setMode('login');
  form.querySelector('input')?.focus({ preventScroll: true });

  el.querySelectorAll('.auth-tabs button').forEach(b =>
    b.addEventListener('click', () => { setMode(b.dataset.tab); form.querySelector('input')?.focus(); }));

  el.querySelector('[data-demo]').addEventListener('click', () => {
    setMode('login');
    form.querySelector('[name=email]').value = DEMO.email;
    form.querySelector('[name=password]').value = DEMO.password;
    form.requestSubmit();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector('button[type=submit]');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = mode === 'login' ? 'Signing you in…' : 'Creating your account…';
    form.querySelectorAll('.error').forEach(x => x.remove());

    try {
      if (mode === 'login') {
        saveSession(await api.login({ email: fd.get('email')?.trim(), password: fd.get('password') }));
      } else {
        const r = await api.register({
          fullName: fd.get('fullName')?.trim(),
          universityEmail: fd.get('universityEmail')?.trim(),
          email: fd.get('email')?.trim(),
          password: fd.get('password'),
        });
        saveSession(r);
        toast(`Welcome to ${BRAND.name}, ${String(r.fullName || '').split(' ')[0] || 'friend'}!`, 'ok', 4200);
      }
      onAuthed();
    } catch (err) {
      form.prepend(h(`<div class="error" role="alert">${esc(err.message)}</div>`));
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}
