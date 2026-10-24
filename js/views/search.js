/* Gen Z — Search view */
import { BRAND } from '../brand.js';
import { api } from '../api.js';
import { esc, h, icon, emptyState, nav, fmtCount } from '../ui.js';
import { postCard, suggestionRow, followButton } from '../components.js';

export async function renderSearch(root, { q = '' } = {}) {
  root.innerHTML = '';
  q = decodeURIComponent(q || '').trim();

  const el = h(`<div>
    <div class="search-hero">
      <div class="search-box">${icon('search').outerHTML}
        <input id="search-input" placeholder="Search posts, people, courses or #hashtags…" value="${esc(q.startsWith('#') ? q.slice(1) : q)}">
      </div>
      <div class="seg" id="search-tabs">
        <button data-s="top" class="active">Top</button>
        <button data-s="people">People</button>
        <button data-s="courses">Courses</button>
        <button data-s="tags">Tags</button>
      </div>
    </div>
    <div id="search-results"><div class="spinner"></div></div>
  </div>`);
  root.appendChild(el);

  const input = el.querySelector('#search-input');
  const results = el.querySelector('#search-results');
  let activeTab = 'top';

  // focus + cursor at end
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  const runSearch = async () => {
    const query = input.value.trim();
    results.innerHTML = `<div class="spinner"></div>`;
    if (!query) { results.innerHTML = ''; results.appendChild(emptyState('search', `Search ${BRAND.name}`, 'Find lecture notes, classmates, courses and trending topics.')); return; }

    try {
      if (activeTab === 'top') {
        const [posts, users, tags, courses] = await Promise.all([
          api.searchPosts(query), api.searchUsers(query), api.searchHashtags(query.replace(/^#/, '')), api.searchCourses(query),
        ]);
        results.innerHTML = '';
        if (![...posts, ...users, ...tags, ...courses].length) {
          results.appendChild(emptyState('search', 'No results', `Nothing found for “${query}”. Try a different word or check the spelling.`));
          return;
        }
        if (users.length) {
          results.appendChild(h(`<h2 style="font-size:15px;font-weight:800;margin:2px 0 8px">People</h2>`));
          const card = h(`<div class="card" style="margin-bottom:14px"></div>`);
          users.slice(0, 4).forEach(u => {
            const row = h(`<div class="user-card">
              <span class="uc-av"></span>
              <div class="uc-meta"><div class="uc-name">${esc(u.fullName)}</div>
              <div class="uc-sub">${esc(u.bio || u.universityEmail)}</div></div>
              <span data-f></span></div>`);
            row.querySelector('.uc-av').replaceWith(importedAvatar(u));
            row.querySelector('.uc-meta').addEventListener('click', () => nav.go(`/user/${u.id}`));
            if (u.id !== (window.scUser?.id || '')) row.querySelector('[data-f]').appendChild(followButton(u.id, false));
            card.appendChild(row);
          });
          results.appendChild(card);
        }
        if (tags.length) {
          results.appendChild(h(`<h2 style="font-size:15px;font-weight:800;margin:2px 0 8px">Hashtags</h2>`));
          const card = h(`<div class="card" style="margin-bottom:14px"></div>`);
          tags.slice(0, 5).forEach(t => {
            const row = h(`<div class="trend-row" style="margin:0"><span class="tr-tag">#${esc(t.tag)}</span><span class="tr-count">${t.count} posts</span></div>`);
            row.addEventListener('click', () => { input.value = '#' + t.tag; activeTab = 'top'; runSearch(); });
            card.appendChild(row);
          });
          results.appendChild(card);
        }
        if (courses.length) {
          results.appendChild(h(`<h2 style="font-size:15px;font-weight:800;margin:2px 0 8px">Courses</h2>`));
          const grid = h(`<div class="course-grid" style="margin-bottom:14px"></div>`);
          courses.slice(0, 4).forEach(c => grid.appendChild(courseMini(c)));
          results.appendChild(grid);
        }
        if (posts.length) {
          results.appendChild(h(`<h2 style="font-size:15px;font-weight:800;margin:2px 0 8px">Posts</h2>`));
          posts.slice(0, 10).forEach(p => results.appendChild(postCard(p)));
        }
      } else if (activeTab === 'people') {
        const users = await api.searchUsers(input.value.trim());
        results.innerHTML = '';
        if (!users.length) { results.appendChild(emptyState('users', 'No people found', 'Try another name.')); return; }
        const card = h(`<div class="card"></div>`);
        users.forEach(u => {
          const row = h(`<div class="user-card">
            <span class="uc-av"></span>
            <div class="uc-meta"><div class="uc-name">${esc(u.fullName)}</div>
            <div class="uc-sub">${esc(u.bio || u.universityEmail)}</div></div>
            <span data-f></span></div>`);
          row.querySelector('.uc-av').replaceWith(importedAvatar(u));
          row.querySelector('.uc-meta').addEventListener('click', () => nav.go(`/user/${u.id}`));
          row.querySelector('[data-f]').appendChild(followButton(u.id, false));
          card.appendChild(row);
        });
        results.appendChild(card);
      } else if (activeTab === 'courses') {
        const courses = await api.searchCourses(input.value.trim());
        results.innerHTML = '';
        if (!courses.length) { results.appendChild(emptyState('book', 'No courses found', 'Try a course code like CSC2101.')); return; }
        const grid = h(`<div class="course-grid"></div>`);
        courses.forEach(c => grid.appendChild(courseMini(c)));
        results.appendChild(grid);
      } else if (activeTab === 'tags') {
        const tags = await api.searchHashtags(input.value.trim().replace(/^#/, ''));
        results.innerHTML = '';
        if (!tags.length) { results.appendChild(emptyState('fire', 'No hashtags found', 'Try another word.')); return; }
        const card = h(`<div class="card"></div>`);
        tags.forEach(t => {
          const row = h(`<div class="trend-row" style="margin:0;padding:13px 16px"><span class="tr-tag" style="font-size:15px">#${esc(t.tag)}</span><span class="tr-count">${t.count} posts</span></div>`);
          row.addEventListener('click', () => { input.value = '#' + t.tag; activeTab = 'top'; runSearch(); });
          card.appendChild(row);
        });
        results.appendChild(card);
      }
    } catch (e) {
      results.innerHTML = '';
      results.appendChild(emptyState('x', 'Search failed', e.message));
    }
  };

  let deb;
  input.addEventListener('input', () => {
    clearTimeout(deb);
    deb = setTimeout(runSearch, 380);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });

  el.querySelectorAll('#search-tabs button').forEach(b => {
    b.addEventListener('click', () => {
      el.querySelectorAll('#search-tabs button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      activeTab = b.dataset.s;
      runSearch();
    });
  });

  if (q) runSearch();
  else results.innerHTML = '';
  results.appendChild(emptyState('search', `Search ${BRAND.name}`, 'Find lecture notes, classmates, courses and trending topics.')) ;
  if (q) results.lastChild.remove();
}

function importedAvatar(u) {
  // local import to avoid cycles
  const av = document.createElement('div');
  av.className = 'avatar'; av.dataset.size = '40';
  av.textContent = u.fullName.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('');
  if (u.avatarUrl) {
    const img = new Image(); img.src = u.avatarUrl; img.loading = 'lazy';
    img.onerror = () => img.remove();
    av.appendChild(img);
  }
  return av;
}

function courseMini(c) {
  const el = h(`<div class="card course-card">
    <div class="cc-grad"></div>
    <div class="course-code">${esc(c.code)}</div>
    <div class="course-name">${esc(c.name)}</div>
    <div class="course-meta">${icon('users').outerHTML} ${fmtCount(c.subscriberCount)} students</div>
  </div>`);
  el.addEventListener('click', () => nav.go(`/courses/${c.id}`));
  return el;
}
