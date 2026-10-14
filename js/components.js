/* Kampuz — reusable components (post card, composer, user rows) */
import { api, session } from './api.js';
import { esc, rich, h, avatar, timeAgo, fmtCount, icon, toast, lightbox, confirmDialog, nav } from './ui.js';
import { connectChat } from './realtime.js';

/* ───────────────────────── post card ─────────────────────── */
export function postCard(post, opts = {}) {
  const me = session.user;
  const own = me && post.user.id === me.id;
  const el = h(`<article class="card post-card" data-id="${esc(post.id)}">
    <div class="post-head"></div>
    ${post.courseName ? `<div style="padding:8px 18px 0"><span class="course-chip">${icon('grad').outerHTML}${esc(post.courseName)}</span></div>` : ''}
    <div class="post-body">${rich(post.content)}</div>
    <div class="post-actions">
      <button class="action-chip like ${post.isLikedByCurrentUser ? 'liked' : ''}" data-act="like">
        ${icon('heart').outerHTML}<span class="lc">${fmtCount(post.likeCount)}</span>
      </button>
      <button class="action-chip" data-act="comment">${icon('comment').outerHTML}<span class="cc">${fmtCount(post.commentCount)}</span></button>
      <button class="action-chip share" data-act="share">${icon('share').outerHTML}<span>Share</span></button>
      <span style="flex:1"></span>
      <button class="action-chip bookmark ${post.isBookmarkedByCurrentUser ? 'on' : ''}" data-act="bookmark" aria-label="Bookmark post">${icon('bookmark').outerHTML}</button>
      ${own ? `<button class="action-chip" data-act="delete" title="Delete post">${icon('trash').outerHTML}</button>` : ''}
    </div>
  </article>`);

  // head
  const head = el.querySelector('.post-head');
  const av = avatar(post.user, 44);
  av.style.cursor = 'pointer';
  av.addEventListener('click', () => nav.go(`/user/${post.user.id}`));
  head.append(av);
  head.appendChild(h(`<div class="ph-meta">
    <div class="ph-name" data-user="${esc(post.user.id)}">${esc(post.user.fullName)}
      ${post.user.isAdFree ? `<span class="crown">${icon('crown').outerHTML}Premium</span>` : ''}</div>
    <div class="ph-sub"><span data-user-handle>@${esc((post.user.universityEmail || '').split('@')[0])}</span> · <span>${timeAgo(post.createdAt)}</span>${post.isShort ? ' · <b style="color:var(--accent)">Short</b>' : ''}</div>
  </div>`));
  head.querySelectorAll('[data-user]').forEach(n => n.addEventListener('click', () => nav.go(`/user/${post.user.id}`)));

  // media
  if (post.mediaUrl) {
    const media = h(`<div class="post-media"></div>`);
    if (post.type === 'Video') {
      const v = document.createElement('video');
      v.src = post.mediaUrl;
      if (post.thumbnailUrl) v.poster = post.thumbnailUrl;
      v.controls = true; v.preload = 'metadata'; v.playsInline = true;
      media.appendChild(v);
    } else {
      const img = new Image();
      img.loading = 'lazy';
      img.src = post.mediaUrl;
      img.alt = 'Post image';
      img.style.cursor = 'zoom-in';
      img.onerror = () => { media.innerHTML = `<div style="padding:26px;text-align:center;color:var(--text-3);font-size:13px">Media unavailable</div>`; };
      img.addEventListener('click', () => lightbox(post.mediaUrl));
      media.appendChild(img);
    }
    el.insertBefore(media, el.querySelector('.post-actions'));
  }

  /* actions */
  let likeCount = post.likeCount, liked = post.isLikedByCurrentUser, marked = post.isBookmarkedByCurrentUser;
  const likeBtn = el.querySelector('[data-act="like"]');
  const markBtn = el.querySelector('[data-act="bookmark"]');
  const commentBtn = el.querySelector('[data-act="comment"]');

  likeBtn.addEventListener('click', async () => {
    liked = !liked; likeCount += liked ? 1 : -1;
    likeBtn.classList.toggle('liked', liked);
    likeBtn.querySelector('.lc').textContent = fmtCount(likeCount);
    try { await (liked ? api.like(post.id) : api.unlike(post.id)); }
    catch (e) {
      liked = !liked; likeCount += liked ? 1 : -1;
      likeBtn.classList.toggle('liked', liked);
      likeBtn.querySelector('.lc').textContent = fmtCount(likeCount);
      if (e.status !== 400) toast(e.message, 'err');
      else if (e.status === 400) { /* treat as already-liked sync */ }
    }
  });

  markBtn.addEventListener('click', async () => {
    marked = !marked;
    markBtn.classList.toggle('on', marked);
    try { await (marked ? api.bookmark(post.id) : api.unbookmark(post.id)); marked ? toast('Saved to bookmarks', 'ok') : null; }
    catch (e) { marked = !marked; markBtn.classList.toggle('on', marked); if (e.status !== 400) toast(e.message, 'err'); }
  });

  el.querySelector('[data-act="share"]').addEventListener('click', async () => {
    const url = `${location.origin}/#/post/${post.id}`;
    try { await navigator.clipboard.writeText(url); toast('Post link copied', 'ok'); }
    catch { toast(url, 'info'); }
  });

  const delBtn = el.querySelector('[data-act="delete"]');
  delBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await confirmDialog('Delete post?', 'This permanently removes the post and its media.', 'Delete');
    if (!ok) return;
    try { await api.deletePost(post.id); el.remove(); toast('Post deleted', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
  });

  /* comments */
  let commentsOpen = false;
  commentBtn.addEventListener('click', () => {
    if (commentsOpen) return;
    commentsOpen = true;
    openComments(el, post, commentBtn.querySelector('.cc'));
  });

  // hashtag clicks
  el.querySelectorAll('.hashtag').forEach(tag =>
    tag.addEventListener('click', () => nav.go(`/search?q=%23${tag.dataset.tag}`)));

  return el;
}

async function openComments(el, post, counter) {
  const box = h(`<div class="comments-box">
    <div class="comments-list"><div class="spinner"></div></div>
    <div class="comment-input-row"></div>
  </div>`);
  el.appendChild(box);

  const list = box.querySelector('.comments-list');
  try {
    const comments = await api.comments(post.id);
    list.innerHTML = '';
    if (!comments.length) list.innerHTML = `<p style="padding:14px 18px;color:var(--text-3);font-size:13.5px">No comments yet — start the conversation.</p>`;
    for (const c of comments) list.appendChild(commentRow(c));
    counter.textContent = fmtCount(comments.length);
  } catch (e) {
    list.innerHTML = `<p style="padding:14px 18px;color:var(--danger);font-size:13px">${esc(e.message)}</p>`;
  }

  const me = session.user;
  const row = box.querySelector('.comment-input-row');
  const av = avatar(me?.fullName || '?', 32);
  av.addEventListener('click', () => nav.go('/profile'));
  const input = h(`<input placeholder="Add a comment…" maxlength="500">`);
  const send = h(`<button class="btn btn-primary btn-sm">${icon('send').outerHTML}</button>`);
  row.append(av, input, send);

  const submit = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    
    // Optimistic UI
    const tempComment = { id: 'temp', text, createdAt: new Date().toISOString(), user: me };
    list.querySelector('p')?.remove();
    const tempRow = commentRow(tempComment);
    tempRow.style.opacity = '0.6';
    list.appendChild(tempRow);
    counter.textContent = fmtCount((+counter.textContent.replace(/\D/g, '') || 0) + 1);
    list.scrollTop = list.scrollHeight;

    try {
      const c = await api.addComment(post.id, text);
      tempRow.replaceWith(commentRow(c));
    } catch (e) { 
      toast(e.message, 'err');
      tempRow.remove();
      input.value = text;
      counter.textContent = fmtCount(Math.max(0, (+counter.textContent.replace(/\D/g, '') || 0) - 1));
    }
  };
  send.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  input.focus();
}

function commentRow(c) {
  const el = h(`<div class="comment-row">
    <div class="cb-wrap"><div class="comment-bubble">
      <div class="cb-name" style="cursor:pointer">${esc(c.user.fullName)}</div>
      <div class="cb-text">${rich(c.text)}</div>
      <div class="cb-time">${timeAgo(c.createdAt)}</div>
    </div></div>
  </div>`);
  const av = avatar(c.user, 32);
  av.addEventListener('click', () => nav.go(`/user/${c.user.id}`));
  el.prepend(av);
  el.querySelector('.cb-name').addEventListener('click', () => nav.go(`/user/${c.user.id}`));
  return el;
}

/* ───────────────────────── composer ──────────────────────── */
export function composerCard(onPosted) {
  const me = session.user;
  const el = h(`<div class="card composer">
    <div class="composer-row"></div>
    <div class="composer-media" style="display:none"></div>
    <div class="composer-course" style="display:none">
      ${icon('grad').outerHTML}<span>Share to course:</span><select><option value="">None</option></select>
    </div>
    <div class="composer-tools">
      <button class="icon-btn" data-tool="image" title="Photo">${icon('image').outerHTML}</button>
      <button class="icon-btn" data-tool="video" title="Video">${icon('video').outerHTML}</button>
      <button class="icon-btn" data-tool="short" title="Post as Short">${icon('play').outerHTML}</button>
      <button class="icon-btn" data-tool="ai" title="AI help writing">${icon('sparkles').outerHTML}</button>
      <span class="grow"></span>
      <button class="btn btn-primary btn-sm" data-post>Post</button>
    </div>
  </div>`);

  const row = el.querySelector('.composer-row');
  const av = avatar(me?.fullName || '?', 44);
  av.addEventListener('click', () => nav.go('/profile'));
  const ta = h(`<textarea class="composer-input" rows="1" placeholder="What's happening on campus?" maxlength="500"></textarea>`);
  row.append(av, ta);

  const mediaWrap = el.querySelector('.composer-media');
  const courseRow = el.querySelector('.composer-course');
  const select = courseRow.querySelector('select');

  let mediaFile = null, thumbFile = null, durationSeconds = 0;
  let mediaKind = 'image'; // image | video
  let isShort = false;

  api.myCourses().then(courses => {
    for (const c of courses) select.appendChild(h(`<option value="${esc(c.id)}">${esc(c.code)} — ${esc(c.name)}</option>`));
    if (courses.length) courseRow.style.display = 'flex';
  }).catch(() => {});

  // auto-grow
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'; });

  function setMedia(file, kind) {
    mediaFile = file; mediaKind = kind;
    mediaWrap.style.display = 'block';
    mediaWrap.innerHTML = '';
    const pv = h(`<div class="composer-preview"></div>`);
    if (kind === 'video') {
      const v = document.createElement('video');
      v.src = URL.createObjectURL(file); v.muted = true; v.playsInline = true; v.loop = true;
      pv.appendChild(v); v.play().catch(() => {});
      v.addEventListener('loadedmetadata', () => { durationSeconds = Math.round(v.duration || 0); });
    } else {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      pv.appendChild(img);
      durationSeconds = 0;
    }
    pv.appendChild(h(`<button class="pv-x" title="Remove">${icon('x').outerHTML}</button>`));
    pv.querySelector('.pv-x').addEventListener('click', () => {
      mediaFile = null; thumbFile = null; durationSeconds = 0;
      mediaWrap.style.display = 'none'; mediaWrap.innerHTML = '';
      el.querySelector('[data-tool="image"]').classList.remove('active');
      el.querySelector('[data-tool="video"]').classList.remove('active');
    });
    mediaWrap.appendChild(pv);
  }

  el.querySelector('[data-tool="image"]').addEventListener('click', () => pickFile('image/*', f => {
    setMedia(f, 'image');
    el.querySelector('[data-tool="image"]').classList.add('active');
    el.querySelector('[data-tool="video"]').classList.remove('active');
  }));
  el.querySelector('[data-tool="video"]').addEventListener('click', () => pickFile('video/*', async f => {
    setMedia(f, 'video');
    el.querySelector('[data-tool="video"]').classList.add('active');
    el.querySelector('[data-tool="image"]').classList.remove('active');
    thumbFile = await captureVideoThumb(f);
  }));
  el.querySelector('[data-tool="short"]').addEventListener('click', (e) => {
    isShort = !isShort;
    e.currentTarget.classList.toggle('active', isShort);
    toast(isShort ? 'Will appear in Shorts' : 'Regular post', 'info', 1500);
  });
  el.querySelector('[data-tool="ai"]').addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) { toast('Write something first, then let AI polish it', 'info'); return; }
    try {
      const r = await api.aiSummarize(text);
      ta.value = r.summary || text;
      ta.dispatchEvent(new Event('input'));
      toast('AI polished your draft ✨', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });

  el.querySelector('[data-post]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const content = ta.value.trim();
    if (!content && !mediaFile) { toast('Say something first ✍️', 'info'); return; }
    btn.disabled = true;
    try {
      const type = mediaFile ? (mediaKind === 'video' ? 'Video' : 'Image') : 'Text';
      const post = await api.createPost({
        content: content || '📢', type,
        mediaFile, thumbnailFile: thumbFile, courseId: select.value || null,
        isShort, durationSeconds,
      });
      ta.value = ''; ta.style.height = 'auto';
      mediaWrap.style.display = 'none'; mediaWrap.innerHTML = '';
      mediaFile = thumbFile = null; isShort = false; durationSeconds = 0;
      el.querySelectorAll('.composer-tools .icon-btn').forEach(b => b.classList.remove('active'));
      toast('Posted! 🎉', 'ok');
      onPosted?.(post);
    } catch (err) { toast(err.message, 'err'); }
    btn.disabled = false;
  });

  return el;
}

function pickFile(accept, cb) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = accept;
  input.addEventListener('change', () => { if (input.files[0]) cb(input.files[0]); });
  input.click();
}

/** video poster capture for shorts (best-effort) */
export async function captureVideoThumb(file) {
  return new Promise(resolve => {
    try {
      const v = document.createElement('video');
      v.muted = true; v.src = URL.createObjectURL(file);
      v.addEventListener('loadeddata', () => {
        v.currentTime = Math.min(1, (v.duration || 1) / 3);
      });
      v.addEventListener('seeked', () => {
        const canvas = document.createElement('canvas');
        canvas.width = v.videoWidth || 720; canvas.height = v.videoHeight || 1280;
        canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(b => b ? resolve(new File([b], 'thumb.jpg', { type: 'image/jpeg' })) : resolve(null), 'image/jpeg', 0.8);
      });
      v.addEventListener('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

/* ───────────────────────── user rows ─────────────────────── */
export function suggestionRow(user, onDone) {
  const el = h(`<div class="sugg-row">
    <div class="sr-meta" style="flex:1;display:flex;gap:10px;align-items:center;min-width:0;cursor:pointer">
      <div class="sr-names" style="min-width:0">
        <div class="sr-name">${esc(user.fullName)}</div>
        <div class="sr-reason">${esc(user.bio ? user.bio.slice(0, 42) : '@' + (user.universityEmail || '').split('@')[0])}</div>
      </div>
    </div>
    <button class="btn btn-sm ${user.isFollowing ? 'btn-ghost btn-follow is-following' : 'btn-primary btn-follow'}">${user.isFollowing ? 'Following' : 'Follow'}</button>
  </div>`);

  el.querySelector('.sr-meta').addEventListener('click', () => nav.go(`/user/${user.id}`));
  const av = avatar(user, 40);
  el.querySelector('.sr-meta').prepend(av);

  const btn = el.querySelector('button');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (btn.classList.contains('is-following')) { await api.unfollow(user.id); }
      else { await api.follow(user.id); toast(`Following ${user.fullName}`, 'ok'); }
      btn.classList.toggle('is-following');
      btn.classList.toggle('btn-primary');
      btn.classList.toggle('btn-ghost');
      btn.textContent = btn.classList.contains('is-following') ? 'Following' : 'Follow';
      onDone?.();
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  });
  return el;
}

export function followButton(userId, isFollowing) {
  const btn = h(`<button class="btn btn-sm ${isFollowing ? 'btn-ghost is-following' : 'btn-primary'}">${isFollowing ? 'Following' : 'Follow'}</button>`);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (btn.classList.contains('is-following')) await api.unfollow(userId);
      else await api.follow(userId);
      btn.classList.toggle('is-following');
      btn.classList.toggle('btn-primary'); btn.classList.toggle('btn-ghost');
      btn.textContent = btn.classList.contains('is-following') ? 'Following' : 'Follow';
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  });
  return btn;
}

/* ───────────────────────── ad card ───────────────────────── */
export function adCard(ad) {
  const el = h(`<div class="rail-card ad-card">
    <img src="${esc(ad.imageUrl)}" alt="${esc(ad.headline)}" loading="lazy">
    <div class="ad-meta">
      <div><div style="font-weight:800;font-size:13.5px">${esc(ad.headline)}</div>
      <div class="ad-sponsor">by ${esc(ad.sponsorName)}</div></div>
      <span class="ad-flag">Ad</span>
    </div>
  </div>`);
  api.adImpression(ad.adId).catch(() => {});
  el.addEventListener('click', () => { api.adClick(ad.adId).catch(() => {}); toast('Sponsor link opened', 'info'); });
  return el;
}
