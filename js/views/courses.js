/* StreamCampus — Courses: catalogue, detail with posts + group chat */
import { api, session } from '../api.js';
import { esc, h, icon, toast, emptyState, nav, fmtCount } from '../ui.js';
import { postCard } from '../components.js';
import { renderCourseChat } from './chat.js';

const GRADS = [
  'linear-gradient(135deg,#7C3AED,#DB2777)', 'linear-gradient(135deg,#EA580C,#F59E0B)',
  'linear-gradient(135deg,#0E7490,#22D3EE)', 'linear-gradient(135deg,#166534,#4ADE80)',
  'linear-gradient(135deg,#1D4ED8,#60A5FA)', 'linear-gradient(135deg,#BE123C,#FB7185)',
];
function gradFor(code) {
  let hash = 0; for (const ch of code) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
  return GRADS[hash % GRADS.length];
}

export async function renderCourses(root, { id = null } = {}) {
  root.innerHTML = '';
  if (id) return renderCourseDetail(root, id);

  const el = h(`<div>
    <div class="page-head">
      <h1>Courses</h1><span class="grow"></span>
      <button class="btn btn-ghost btn-sm" data-new-course>${icon('plus').outerHTML} New course</button>
    </div>
    <div class="page-head" style="margin-top:-6px">
      <p class="ph-sub">Join your classes to see their feeds and group chats.</p>
    </div>
    <h2 style="font-size:16px;font-weight:800;margin:0 0 10px">My courses</h2>
    <div class="course-grid" id="my-courses"></div>
    <h2 style="font-size:16px;font-weight:800;margin:22px 0 10px">Course catalogue</h2>
    <div class="course-grid" id="all-courses"><div class="spinner"></div></div>
  </div>`);
  root.appendChild(el);

  el.querySelector('[data-new-course]').addEventListener('click', () => newCourseDialog(root));

  api.myCourses().then(courses => {
    const box = el.querySelector('#my-courses');
    box.innerHTML = '';
    if (!courses.length) { box.innerHTML = `<p style="color:var(--text-3);font-size:13.5px">Not subscribed to any course yet — pick one below 👇</p>`; return; }
    courses.forEach(c => box.appendChild(courseCard(c, true)));
  }).catch(() => {});

  api.coursesAll().then(courses => {
    const box = el.querySelector('#all-courses');
    box.innerHTML = '';
    if (!courses.length) { box.appendChild(emptyState('book', 'No courses yet', 'Lecturers or class reps can create the first course.', `<button class="btn btn-primary" data-new2>Create course</button>`)); box.querySelector('[data-new2]')?.addEventListener('click', () => newCourseDialog(root)); return; }
    courses.forEach(c => box.appendChild(courseCard(c, false)));
  }).catch(e => { el.querySelector('#all-courses').innerHTML = `<p style="color:var(--danger)">${esc(e.message)}</p>`; });
}

function courseCard(course, subscribed) {
  const el = h(`<div class="card course-card">
    <div class="cc-grad" style="background:${gradFor(course.code)}"></div>
    <div class="course-code">${esc(course.code)}</div>
    <div class="course-name">${esc(course.name)}</div>
    <div class="course-desc">${esc(course.description || '')}</div>
    <div class="course-meta">${icon('users').outerHTML} ${fmtCount(course.subscriberCount)} student${course.subscriberCount === 1 ? '' : 's'}
      ${subscribed ? `<span class="course-chip" style="margin-left:auto">Joined</span>` : ''}</div>
  </div>`);
  el.addEventListener('click', () => nav.go(`/courses/${course.id}`));
  return el;
}

async function renderCourseDetail(root, courseId) {
  root.innerHTML = '';
  const el = h(`<div><div class="spinner"></div></div>`);
  root.appendChild(el);

  const [course, posts, subscribed] = await Promise.all([
    api.course(courseId).catch(e => { throw e; }),
    api.feedCourse(courseId).catch(() => []),
    api.isSubscribed(courseId).catch(() => ({ isSubscribed: false })),
  ]);

  el.innerHTML = `
    <div class="page-head">
      <button class="icon-btn" data-back>${icon('chevL').outerHTML}</button>
      <div style="flex:1">
        <h1>${esc(course.code)}</h1>
        <p class="ph-sub">${esc(course.name)} · ${fmtCount(course.subscriberCount)} students</p>
      </div>
      <button class="btn ${subscribed.isSubscribed ? 'btn-ghost is-following' : 'btn-primary'}" data-sub>
        ${subscribed.isSubscribed ? 'Subscribed ✓' : 'Subscribe'}</button>
    </div>
    ${course.description ? `<p style="color:var(--text-2);margin:-6px 0 16px;padding:0 2px">${esc(course.description)}</p>` : ''}
    <div style="display:grid;gap:16px">
      <div id="course-chat"></div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <h2 style="font-size:16px;font-weight:800">Course feed</h2>
        <div class="seg" style="font-size:12px;margin:0">
          <button class="active" data-filter="all">All posts</button>
          <button data-filter="video">Lectures</button>
        </div>
      </div>
      <div id="course-posts"></div>
    </div>`;

  el.querySelector('[data-back]').addEventListener('click', () => nav.go('/courses'));

  const postsBox = el.querySelector('#course-posts');
  function renderPosts(filter = 'all') {
    postsBox.innerHTML = '';
    const filtered = filter === 'video' ? posts.filter(p => p.type === 'Video') : posts;
    if (!filtered.length) {
      postsBox.appendChild(emptyState('grad', filter === 'video' ? 'No video lectures yet' : 'No posts for this course yet', 'Tag your post with this course from the composer to share notes here.'));
    } else {
      filtered.forEach(p => postsBox.appendChild(postCard(p)));
    }
  }

  el.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderPosts(btn.dataset.filter);
    });
  });
  renderPosts('all');
  const subBtn = el.querySelector('[data-sub]');
  let isSub = subscribed.isSubscribed;
  subBtn.addEventListener('click', async () => {
    subBtn.disabled = true;
    try {
      if (isSub) { await api.unsubscribeCourse(courseId); isSub = false; toast('Unsubscribed', 'info'); }
      else { await api.subscribeCourse(courseId); isSub = true; toast(`Joined ${course.code}! 🎓`, 'ok'); }
      subBtn.className = `btn ${isSub ? 'btn-ghost is-following' : 'btn-primary'}`;
      subBtn.textContent = isSub ? 'Subscribed ✓' : 'Subscribe';
    } catch (e) { toast(e.message, 'err'); }
    subBtn.disabled = false;
  });

  renderCourseChat(el.querySelector('#course-chat'), course);
}

function newCourseDialog(root) {
  import('../ui.js').then(({ openModal }) => {
    const { modal, close } = openModal({
      title: 'Create a course',
      body: `
        <div class="field"><label>Course code</label><input class="input" name="code" placeholder="e.g. CSC2101" maxlength="20"></div>
        <div class="field"><label>Course name</label><input class="input" name="name" placeholder="e.g. Data Structures & Algorithms" maxlength="100"></div>
        <div class="field"><label>Description (optional)</label><textarea class="input" name="description" rows="3" maxlength="500" placeholder="What's it about?"></textarea></div>`,
      footer: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-save>Create</button>`,
    });
    modal.parentElement.querySelector('[data-cancel]').addEventListener('click', close);
    modal.parentElement.querySelector('[data-save]').addEventListener('click', async () => {
      const code = modal.querySelector('[name=code]').value.trim();
      const name = modal.querySelector('[name=name]').value.trim();
      const description = modal.querySelector('[name=description]').value.trim();
      if (!code || !name) { toast('Code and name are required', 'err'); return; }
      try {
        const c = await api.createCourse({ code, name, description: description || null });
        close();
        toast('Course created 🎓', 'ok');
        nav.go(`/courses/${c.id}`);
      } catch (e) { toast(e.message, 'err'); }
    });
  });
}
