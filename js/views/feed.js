/* StreamCampus — Home feed view */
import { api, session } from '../api.js';
import { esc, h, icon, toast, skeletonPost, emptyState } from '../ui.js';
import { postCard, composerCard, suggestionRow, adCard } from '../components.js';

export async function renderFeed(root, { tab = 'foryou' } = {}) {
  root.innerHTML = '';
  const me = session.user;

  const wrap = h(`<div>
    <div class="page-head" style="margin-bottom:14px">
      <h1>Home</h1><span class="grow"></span>
      <span class="ph-sub" id="greet"></span>
    </div>
    <div id="composer-slot"></div>
    <div class="feed-tabs" style="margin-top:16px">
      <button class="feed-tab ${tab === 'foryou' ? 'active' : ''}" data-tab="foryou">✨ For you</button>
      <button class="feed-tab ${tab === 'following' ? 'active' : ''}" data-tab="following">${icon('users').outerHTML} Following</button>
      <button class="feed-tab ${tab === 'courses' ? 'active' : ''}" data-tab="courses">${icon('grad').outerHTML} My courses</button>
    </div>
    <div id="feed-list"></div>
  </div>`);
  root.appendChild(wrap);

  const hour = new Date().getHours();
  wrap.querySelector('#greet').textContent =
    hour < 12 ? `Good morning, ${me.fullName.split(' ')[0]} ☀️` :
    hour < 17 ? `Good afternoon, ${me.fullName.split(' ')[0]} 🌤️` :
                `Good evening, ${me.fullName.split(' ')[0]} 🌙`;

  wrap.querySelectorAll('.feed-tab').forEach(b =>
    b.addEventListener('click', () => location.hash = b.dataset.tab === 'foryou' ? '/feed' : `/feed/${b.dataset.tab}`));

  // composer
  const composerSlot = wrap.querySelector('#composer-slot');
  const composer = composerCard((post) => {
    feedList.prepend(postCard(post));
  });
  composerSlot.appendChild(composer);

  // feed list
  const feedList = wrap.querySelector('#feed-list');
  feedList.appendChild(skeletonPost());
  feedList.appendChild(skeletonPost());

  let page = 1;
  let loadFn;
  if (tab === 'foryou') loadFn = (p) => api.feedExplore(p);
  else if (tab === 'following') loadFn = (p) => api.feedFollowing(p);
  else loadFn = async () => {
    // merge posts from my courses
    const courses = await api.myCourses().catch(() => []);
    if (!courses.length) return [];
    const all = await Promise.all(courses.map(c => api.feedCourse(c.id, page).catch(() => [])));
    return all.flat().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  };

  try {
    const posts = await loadFn(page);
    feedList.innerHTML = '';
    if (!posts.length) {
      feedList.appendChild(emptyState('sparkles',
        tab === 'following' ? 'Your following feed is quiet' : 'Nothing here yet',
        tab === 'following'
          ? 'Follow people from Explore and their posts will land here.'
          : 'Be the first to post something — your campus is waiting to hear from you.',
        `<button class="btn btn-primary" data-go-explore>Explore campus</button>`));
      feedList.querySelector('[data-go-explore]')?.addEventListener('click', () => location.hash = '/explore');
      return;
    }
    posts.forEach(p => feedList.appendChild(postCard(p)));
    feedList.appendChild(loadMoreButton(async () => {
      page += 1;
      const more = await loadFn(page);
      return more.map(p => postCard(p));
    }));
  } catch (e) {
    feedList.innerHTML = '';
    feedList.appendChild(emptyState('x', 'Could not load feed', e.message));
  }
}

function loadMoreButton(load) {
  const btn = h(`<div class="load-more"><button class="btn btn-ghost btn-sm">Load more</button></div>`);
  let busy = false;
  btn.querySelector('button').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    const b = btn.querySelector('button');
    b.textContent = 'Loading…';
    try {
      const cards = await load();
      if (cards.length) { btn.before(...cards); b.textContent = 'Load more'; }
      else { btn.innerHTML = `<p style="color:var(--text-3);font-size:13px">You're all caught up 🎉</p>`; }
    } catch (e) { b.textContent = 'Load more'; toast(e.message, 'err'); }
    busy = false;
  });
  return btn;
}
