/* StreamCampus — Shorts: fullscreen vertical video feed */
import { api, session } from '../api.js';
import { esc, h, icon, fmtCount, toast, emptyState, nav, rich } from '../ui.js';
import { avatar } from '../ui.js';

export async function renderShorts(root, { index = 0 } = {}) {
  root.innerHTML = '';
  const stage = h(`<div class="shorts-stage">
    <div class="short-top" style="position:absolute;top:0;left:0;right:0;z-index:10;display:flex;align-items:center;gap:10px;padding:14px 18px;color:#fff">
      <button class="icon-btn" data-close style="background:rgba(255,255,255,.14);color:#fff">${icon('x').outerHTML}</button>
      <h3>Shorts</h3>
    </div>
    <div class="short-container" style="position:absolute;inset:0"></div>
    <div class="short-nav-hint">
      <button data-prev title="Previous (↑)">${icon('arrowUp').outerHTML}</button>
      <button data-next title="Next (↓)">${icon('arrowDown').outerHTML}</button>
    </div>
  </div>`);
  root.appendChild(stage);

  const container = stage.querySelector('.short-container');
  const close = () => { history.back(); };
  stage.querySelector('[data-close]').addEventListener('click', close);

  const shorts = await api.feedShorts(1).catch(() => []);
  if (!shorts.length) {
    container.appendChild(h(`<div class="short-empty">${emptyState('play', 'No shorts yet', 'Create a post with a video and mark it as a Short — it will show up here.', '').outerHTML}
      <button class="btn btn-primary" onclick="location.hash='/feed'">Create one</button></div>`));
    return;
  }

  let current = Math.min(index, shorts.length - 1);
  const videos = [];

  function build(item, i) {
    const frame = h(`<div class="short-item" data-i="${i}">
      <div class="short-frame">
        ${item.type === 'Video' && item.mediaUrl
          ? `<video src="${esc(item.mediaUrl)}" ${item.thumbnailUrl ? `poster="${esc(item.thumbnailUrl)}"` : ''} loop playsinline muted></video>`
          : item.mediaUrl
            ? `<img src="${esc(item.mediaUrl)}" alt="">`
            : `<div style="display:grid;place-items:center;height:100%;padding:40px;text-align:center;color:#fff"><p style="font-size:20px;font-weight:700">${rich(item.content)}</p></div>`}
        <div class="short-overlay">
          <div></div>
          <div class="short-bottom">
            <div class="short-meta">
              <div class="sm-author" data-user>${esc(item.user.fullName)}</div>
              <div class="sm-text">${rich(item.content)}</div>
            </div>
            <div class="short-rail">
              <button class="sr-btn ${item.isLikedByCurrentUser ? 'liked' : ''}" data-like>
                <span class="icon-btn">${icon('heart').outerHTML}</span><span class="cnt">${fmtCount(item.likeCount)}</span>
              </button>
              <button class="sr-btn ${item.isBookmarkedByCurrentUser ? 'liked' : ''}" data-mark>
                <span class="icon-btn">${icon('bookmark').outerHTML}</span><span>Save</span>
              </button>
              <button class="sr-btn" data-share><span class="icon-btn">${icon('share').outerHTML}</span><span>Share</span></button>
            </div>
          </div>
        </div>
      </div>
    </div>`);
    return frame;
  }

  // preload current + neighbors
  function show(i) {
    current = Math.max(0, Math.min(i, shorts.length - 1));
    container.innerHTML = '';
    videos.forEach(v => v.pause());
    for (const idx of [current - 1, current, current + 1]) {
      if (idx < 0 || idx >= shorts.length) continue;
      if (!container.querySelector(`[data-i="${idx}"]`)) {
        const f = build(shorts[idx], idx);
        container.appendChild(f);
        wire(f, shorts[idx]);
        const v = f.querySelector('video');
        if (v) videos[idx] = v;
      }
    }
    const active = container.querySelector(`[data-i="${current}"] video`);
    active?.play().catch(() => {});
  }

  function wire(frame, item) {
    frame.addEventListener('click', (e) => {
      if (e.target.tagName === 'VIDEO') {
        e.target.muted = !e.target.muted;
        return;
      }
      if (e.target.closest('[data-like],[data-mark],[data-share],[data-user],img')) return;
      show(current + 1);
    });
    frame.querySelector('[data-user]')?.addEventListener('click', () => { location.hash = `/user/${item.user.id}`; });
    const likeBtn = frame.querySelector('[data-like]');
    likeBtn?.addEventListener('click', async () => {
      const liked = !likeBtn.classList.contains('liked');
      likeBtn.classList.toggle('liked', liked);
      likeBtn.querySelector('.cnt').textContent = fmtCount(item.likeCount + (liked ? 1 : 0));
      try { await (liked ? api.like(item.id) : api.unlike(item.id)); item.isLikedByCurrentUser = liked; }
      catch (e) { likeBtn.classList.toggle('liked', !liked); }
    });
    const markBtn = frame.querySelector('[data-mark]');
    markBtn?.addEventListener('click', async () => {
      const on = !markBtn.classList.contains('liked');
      markBtn.classList.toggle('liked', on);
      try { await (on ? api.bookmark(item.id) : api.unbookmark(item.id)); item.isBookmarkedByCurrentUser = on; toast(on ? 'Saved' : 'Removed', 'info', 1200); }
      catch (e) { markBtn.classList.toggle('liked', !on); }
    });
    frame.querySelector('[data-share]')?.addEventListener('click', async () => {
      const url = `${location.origin}/#/post/${item.id}`;
      try { await navigator.clipboard.writeText(url); toast('Link copied', 'ok'); } catch { toast(url, 'info'); }
    });
  }

  stage.querySelector('[data-prev]').addEventListener('click', () => show(current - 1));
  stage.querySelector('[data-next]').addEventListener('click', () => show(current + 1));

  const onKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'j') show(current + 1);
    else if (e.key === 'ArrowUp' || e.key === 'k') show(current - 1);
    else if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  // touch swipe (vertical)
  let touchY = null;
  stage.addEventListener('touchstart', e => { touchY = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', e => {
    if (touchY === null) return;
    const dy = touchY - e.changedTouches[0].clientY;
    if (Math.abs(dy) > 60) show(current + (dy > 0 ? 1 : -1));
    touchY = null;
  }, { passive: true });

  const cleanup = new MutationObserver(() => {
    if (!document.body.contains(stage)) {
      document.removeEventListener('keydown', onKey);
      videos.forEach(v => v?.pause());
      cleanup.disconnect();
    }
  });
  cleanup.observe(document.body, { childList: true, subtree: true });

  show(current);
}
