/* StreamCampus — Explore view: trending hashtags, people, hot posts */
import { api } from '../api.js';
import { esc, h, icon, skeletonPost, emptyState } from '../ui.js';
import { postCard, suggestionRow } from '../components.js';

export async function renderExplore(root) {
  root.innerHTML = '';
  const el = h(`<div>
    <div class="page-head"><h1>Explore</h1><span class="grow"></span>
      <button class="btn btn-ghost btn-sm" data-search>${icon('search').outerHTML} Search</button></div>
    <div class="explore-grid" style="display:grid;gap:16px">
      <div class="rail-card" id="trends-card"><h3>${icon('fire').outerHTML} Trending on campus</h3><div id="trends"><div class="spinner"></div></div></div>
      <div class="rail-card" id="people-card"><h3>${icon('users').outerHTML} People to follow</h3><div id="people"><div class="spinner"></div></div></div>
      <div><h2 style="font-size:17px;font-weight:800;margin:4px 0 12px">What campus is liking</h2><div id="hot"></div></div>
    </div>
  </div>`);
  root.appendChild(el);

  el.querySelector('[data-search]').addEventListener('click', () => location.hash = '/search');

  api.trending(10).then(tags => {
    const box = el.querySelector('#trends');
    if (tags.degraded) { el.querySelector('#trends-card').remove(); return; }
    box.innerHTML = '';
    if (!tags.length) { box.innerHTML = `<p style="color:var(--text-3);font-size:13.5px">No hashtags yet — post with a #tag to start a trend!</p>`; return; }
    for (const t of tags) {
      const row = h(`<div class="trend-row"><span class="tr-tag">#${esc(t.tag)}</span><span class="tr-count">${t.count} post${t.count === 1 ? '' : 's'}</span></div>`);
      row.addEventListener('click', () => location.hash = `/search?q=%23${t.tag}`);
      box.appendChild(row);
    }
  }).catch(() => { el.querySelector('#trends').innerHTML = ''; });

  api.suggested(6).then(users => {
    const box = el.querySelector('#people');
    if (users.degraded) { el.querySelector('#people-card').remove(); return; }
    box.innerHTML = '';
    if (!users.length) { box.innerHTML = `<p style="color:var(--text-3);font-size:13.5px">You're following everyone already — popular! 🌟</p>`; return; }
    users.forEach(u => box.appendChild(suggestionRow(u)));
  }).catch(() => { el.querySelector('#people').innerHTML = ''; });

  const hot = el.querySelector('#hot');
  hot.appendChild(skeletonPost());
  try {
    const posts = await api.feedExplore(1);
    hot.innerHTML = '';
    if (!posts.length) { hot.appendChild(emptyState('compass', 'Nothing to explore yet', 'Once students start posting, the hottest content lands here.')); return; }
    posts.forEach(p => hot.appendChild(postCard(p)));
  } catch (e) {
    hot.innerHTML = '';
    hot.appendChild(emptyState('x', 'Could not load', e.message));
  }
}
