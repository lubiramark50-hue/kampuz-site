/* StreamCampus — Profile view (own + others), followers modals, edit profile */
import { api, session } from '../api.js';
import { esc, h, icon, toast, avatar, timeAgo, emptyState, nav, fmtCount, openModal, confirmDialog } from '../ui.js';
import { postCard, followButton } from '../components.js';

export async function renderProfile(root, { id = null } = {}) {
  root.innerHTML = '';
  const me = session.user;
  const userId = id || me.id;
  const own = userId === me.id;

  const el = h(`<div><div class="spinner"></div></div>`);
  root.appendChild(el);

  let profile, posts, isFollowing = false;
  try {
    [profile, posts] = await Promise.all([api.user(userId), api.userPosts(userId)]);
    if (!own) isFollowing = (await api.isFollowing(userId)).isFollowing;
  } catch (e) {
    el.innerHTML = '';
    el.appendChild(emptyState('user', 'Profile unavailable', e.message));
    return;
  }

  el.innerHTML = `
    <div class="profile-banner">${profile.bannerUrl ? `<img src="${esc(profile.bannerUrl)}" onerror="this.remove()" alt="">` : ''}</div>
    <div class="profile-head">
      <div class="pf-avatar"></div>
      <div class="ph-btns">
        ${own ? `<button class="btn btn-ghost btn-sm" data-edit>${icon('edit').outerHTML} Edit profile</button>` : `
          <button class="btn btn-ghost btn-sm" data-message>${icon('chat').outerHTML} Message</button>
<button class="btn btn-ghost btn-sm" data-call-audio title="Audio call">${icon('phone').outerHTML}</button>
<button class="btn btn-primary btn-sm" data-call-video title="Video call">${icon('cam').outerHTML}</button>
          <span data-follow></span>`}
      </div>
    </div>
    <div class="profile-info">
      <div class="pi-name">${esc(profile.fullName)}
        ${profile.isAdFree ? `<span class="crown">${icon('crown').outerHTML} Premium</span>` : ''}
        ${own ? `<span class="crown" style="color:var(--teal);background:rgba(20,184,166,.12);border-color:rgba(20,184,166,.35)">You</span>` : ''}</div>
      <div class="pi-mail">${icon('globe').outerHTML} ${esc(profile.universityEmail)}</div>
      ${profile.bio ? `<p class="pi-bio">${esc(profile.bio)}</p>` : `<p class="pi-bio" style="color:var(--text-3);font-style:italic">No bio yet${own ? ' — add one to tell campus your story' : ''}</p>`}
    </div>
    <div class="profile-stats">
      <button class="pstat" data-open="posts" style="text-align:left"><b>${posts.degraded ? '–' : fmtCount(posts.length)}</b><span>Posts</span></button>
      <button class="pstat" data-open="followers" style="text-align:left"><b>${posts.degraded ? '–' : fmtCount(profile.followersCount)}</b><span>Followers</span></button>
      <button class="pstat" data-open="following" style="text-align:left"><b>${posts.degraded ? '–' : fmtCount(profile.followingCount)}</b><span>Following</span></button>
    </div>
    <h2 style="font-size:16px;font-weight:800;padding:8px 0 12px">Posts</h2>
    <div class="pf-posts"></div>`;

  const avBox = el.querySelector('.pf-avatar');
  const av = avatar(profile, 88);
  avBox.appendChild(av);
  if (own) {
    av.style.cursor = 'pointer';
    av.title = 'Change avatar';
    av.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.addEventListener('change', async () => {
        if (!input.files[0]) return;
        try { await api.uploadAvatar(input.files[0]); toast('Avatar updated ✨', 'ok'); renderProfile(root, { id }); }
        catch (e) { toast(e.message, 'err'); }
      });
      input.click();
    });
  }

  const postsBox = el.querySelector('.pf-posts');
  if (posts.degraded) {
    postsBox.appendChild(h(`<div class="kz-soon" role="status"><div class="kz-soon-art" aria-hidden="true">${icon('edit').outerHTML}</div>
      <h2>Posts are on the way</h2><p>Profile posts and follower counts are being switched on.</p></div>`));
  } else if (!posts.length) {
    postsBox.appendChild(emptyState('edit', own ? 'You have not posted yet' : 'No posts yet',
      own ? 'Share your first moment with campus from the Home page.' : 'When they post, it will appear here.'));
  } else {
    posts.forEach(p => postsBox.appendChild(postCard(p)));
  }

  // follow / message
  if (!own) {
    el.querySelector('[data-follow]').appendChild(followButton(userId, isFollowing));
    el.querySelector('[data-message]').addEventListener('click', () => nav.go(`/chat/${userId}`));

// calling — the profile is the most natural place to start one
const { startCall } = await import('../call/ui.js');
el.querySelector('[data-call-audio]')?.addEventListener('click', () => startCall(userId, 'audio', profile.fullName));
el.querySelector('[data-call-video]')?.addEventListener('click', () => startCall(userId, 'video', profile.fullName));
  }

  // followers / following modals
  el.querySelectorAll('.pstat').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.open;
      if (kind === 'posts') return;
      usersModal(kind === 'followers' ? api.followers(userId) : api.following(userId),
        kind === 'followers' ? 'Followers' : 'Following');
    });
  });

  if (own) el.querySelector('[data-edit]').addEventListener('click', () => editProfileDialog(profile, () => renderProfile(root, { id })));
}

async function usersModal(loaderPromise, title) {
  const { modal, close } = openModal({ title, body: `<div class="spinner"></div>` });
  try {
    const users = await loaderPromise;
    const body = modal.querySelector('.modal-body');
    body.innerHTML = '';
    if (!users.length) body.innerHTML = `<p style="color:var(--text-3);font-size:13.5px;text-align:center;padding:12px">Nobody here yet.</p>`;
    for (const u of users) {
      body.appendChild(h(`<div class="user-card" style="padding:10px 0">
        <span class="uc-av"></span>
        <div class="uc-meta" data-u="${esc(u.id)}">
          <div class="uc-name">${esc(u.fullName)}</div>
          <div class="uc-sub">${esc(u.bio || '@' + (u.universityEmail || '').split('@')[0])}</div>
        </div>
        <span data-f></span>
      </div>`));
      body.querySelector('.uc-av:last-of-type') || null;
    }
    // attach avatars + follow buttons imperatively
    const rows = body.querySelectorAll('.user-card');
    users.forEach((u, i) => {
      const row = rows[i];
      row.querySelector('.uc-av').replaceWith(avatar(u, 40));
      row.querySelector('[data-u]').addEventListener('click', () => { close(); nav.go(`/user/${u.id}`); });
      if (u.id !== session.user.id) row.querySelector('[data-f]').appendChild(followButton(u.id, false));
    });
  } catch (e) {
    modal.querySelector('.modal-body').innerHTML = `<p style="color:var(--danger);font-size:13px">${esc(e.message)}</p>`;
  }
}

export function editProfileDialog(profile, onSaved) {
  const { modal, close } = openModal({
    title: 'Edit profile',
    body: `
      <div class="field"><label>Full name</label>
        <input class="input" name="fullName" maxlength="100" value="${esc(profile.fullName)}"></div>
      <div class="field"><label>Bio</label>
        <textarea class="input" name="bio" rows="3" maxlength="500" placeholder="Tell campus about yourself…">${esc(profile.bio || '')}</textarea></div>
      <p class="hint" style="color:var(--text-3);font-size:12.5px">Tip: click your avatar on your profile to change the photo.</p>`,
    footer: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-save>Save changes</button>`,
  });
  modal.parentElement.querySelector('[data-cancel]').addEventListener('click', close);
  modal.parentElement.querySelector('[data-save]').addEventListener('click', async () => {
    const fullName = modal.querySelector('[name=fullName]').value.trim();
    const bio = modal.querySelector('[name=bio]').value.trim();
    if (!fullName) { toast('Name cannot be empty', 'err'); return; }
    try {
      await api.updateProfile({ fullName, bio: bio || null });
      // refresh cached user name
      const u = session.user;
      if (u) { u.fullName = fullName; session.setUser(u); }
      close(); toast('Profile updated ✨', 'ok'); onSaved?.();
    } catch (e) { toast(e.message, 'err'); }
  });
}
