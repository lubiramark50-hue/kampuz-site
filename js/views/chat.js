/* StreamCampus — Messages
 * Threads with delivery receipts, reactions, replies, edits, attachments, voice notes,
 * presence, in-thread search and one-tap audio/video calling. */

import { api, session } from '../api.js';
import { esc, h, icon, timeAgo, avatar, toast, emptyState, openModal, confirmDialog, fmtBytes, lightbox } from '../ui.js';
import { connectChat, chatHub, joinCourseGroup, leaveCourseGroup } from '../realtime.js';
import { isOnline, hydrate, onChange, wire as wirePresence } from '../presence.js';
import { startCall, renderCallHistory } from '../call/ui.js';

const QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];
const EMOJI_PALETTE = [
  '😀', '😄', '😁', '😊', '🙂', '😉', '😍', '🤩', '😘', '😜',
  '🤔', '🤨', '😐', '😴', '😢', '😭', '😤', '😠', '🤯', '🥳',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '🤝', '✌️', '👌', '🫶',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🔥', '✨', '🎉', '🎓',
  '📚', '✏️', '💻', '📱', '⏰', '☕', '🍕', '⚽', '🎵', '🌍',
];

let activeConvo = null;   // { type, id, name }
let typingTimer = null;
let replyTarget = null;   // message DTO currently being replied to

/* ══════════════════════════════ entry ══════════════════════════════ */

export async function renderChat(root, { id = null, type = 'direct', tab = 'chats' } = {}) {
  root.innerHTML = '';
  const el = h(`<div class="chat-page">
    <div class="page-head chat-page-head">
      <h1>Messages</h1>
      <span class="grow"></span>
      <div class="chat-tabs" role="tablist">
        <button class="ctab ${tab !== 'calls' ? 'active' : ''}" data-tab="chats" role="tab">Chats</button>
        <button class="ctab ${tab === 'calls' ? 'active' : ''}" data-tab="calls" role="tab">Calls</button>
      </div>
    </div>
    <div class="chat-layout" data-pane="chats">
      <div class="chat-list">
        <div class="chat-list-head">
          <div class="search-box chat-search">
            <span class="cs-icon">${icon('search').outerHTML}</span>
            <input placeholder="Search people, courses, messages" data-search aria-label="Search messages">
          </div>
        </div>
        <div class="chat-list-body"><div class="spinner"></div></div>
      </div>
      <div class="chat-pane">
        <div class="chat-welcome">
          ${emptyState('chat', 'Pick a conversation', 'Direct messages and course groups live here — or start a call from any thread.').outerHTML}
        </div>
      </div>
    </div>
    <div class="chat-calls" data-pane="calls" hidden></div>
  </div>`);
  root.appendChild(el);

  const layout = el.querySelector('.chat-layout');
  const listBox = el.querySelector('.chat-list-body');
  const callsBox = el.querySelector('.chat-calls');

  // ── tabs ──
  const showTab = async (name) => {
    el.querySelectorAll('.ctab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    const isCalls = name === 'calls';
    layout.hidden = isCalls;
    callsBox.hidden = !isCalls;
    const { parts } = { parts: location.hash.replace(/^#\/?/, '').split('/') };
    history.replaceState(null, '', isCalls ? '#/messages?tab=calls' : '#/messages');
    if (isCalls) {
      await renderCallHistory(callsBox);
      await api.markMissedSeen().catch(() => {});
      window.dispatchEvent(new CustomEvent('sc:refresh-badge'));
    }
    void parts;
  };
  el.querySelector('[data-tab="chats"]').addEventListener('click', () => showTab('chats'));
  el.querySelector('[data-tab="calls"]').addEventListener('click', () => showTab('calls'));
  if (tab === 'calls') await showTab('calls');

  // ── conversation list ──
  let conversations = [];
  const loadConvos = async () => {
    conversations = await api.conversations().catch(() => []);
    renderConvoList(listBox, conversations, layout);
    await wirePresence();
    await hydrate(conversations.filter(c => c.type === 'direct').map(c => c.id));
  };
  await loadConvos();

  // live presence dots
  onChange((userId, online) => {
    listBox.querySelectorAll(`.convo-item[data-id="${CSS.escape(userId)}"]`)
      .forEach(item => item.querySelector('.presence-dot')?.classList.toggle('on', online));
    const header = layout.querySelector('.chat-head .presence-dot');
    if (header && activeConvo?.type === 'direct' && activeConvo.id === userId) {
      header.classList.toggle('on', online);
      const sub = layout.querySelector('.ch-sub');
      if (sub) sub.innerHTML = `<span class="presence-dot ${online ? 'on' : ''}"></span>${online ? 'Online' : 'Offline'}`;
    }
  });

  // ── search ──
  const searchInput = el.querySelector('[data-search]');
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const q = searchInput.value.trim();
      if (q.length < 2) { renderConvoList(listBox, conversations, layout); return; }
      await renderSearchResults(listBox, q, layout);
    }, 280);
  });

  // ── deep link ──
  if (id && tab !== 'calls') {
    const target = conversations.find(c => c.id === id && c.type === type)
      || { id, type, name: 'Chat' };
    openConversation(target, layout);
  } else if (window.matchMedia('(max-width: 860px)').matches && tab !== 'calls') {
    layout.classList.add('show-list');
  }

  // ── realtime ──
  await connectChat();
  const hub = chatHub();
  if (hub) {
    ['messageReceived', 'userTyping', 'userStoppedTyping', 'receipt', 'messageEdited',
      'messageDeleted', 'messageReacted', 'missedCall'].forEach(ev => hub.off(ev));

    hub.on('messageReceived', (msg) => {
      const isActive = activeConvo && msg && (
        (activeConvo.type === 'direct' && !msg.courseId
          && (msg.senderId === activeConvo.id || msg.receiverId === activeConvo.id)) ||
        (activeConvo.type === 'course' && msg.courseId === activeConvo.id));

      if (isActive) {
        upsertMessage(layout, msg, session.user.id);
        if (msg.senderId !== session.user.id) {
          hub.invoke('MarkRead', activeConvo.id, activeConvo.type === 'course').catch(() => {});
        }
      } else if (msg.senderId !== session.user.id) {
        bumpConvo(msg);
      }
    });

    hub.on('receipt', (r) => applyReceipt(layout, r));
    hub.on('messageEdited', (m) => upsertMessage(layout, m, session.user.id));
    hub.on('messageDeleted', (m) => upsertMessage(layout, m, session.user.id));
    hub.on('messageReacted', (m) => upsertMessage(layout, m, session.user.id));

    let clearTyping = null;
    hub.on('userTyping', ({ fromUserId, fromName }) => {
      if (activeConvo?.type !== 'direct' || fromUserId !== activeConvo.id) {
        const row = listBox.querySelector(`.convo-item[data-id="${CSS.escape(fromUserId)}"] .ci-last`);
        if (row) row.innerHTML = `<em class="typing-inline">typing…</em>`;
        return;
      }
      const t = layout.querySelector('.typing-row');
      if (!t) return;
      t.innerHTML = `<span class="tdots"><span></span><span></span><span></span></span> ${esc(fromName)} is typing…`;
      clearTimeout(clearTyping);
      clearTyping = setTimeout(() => { t.innerHTML = ''; }, 2600);
    });
    hub.on('userStoppedTyping', () => {
      const t = layout.querySelector('.typing-row');
      if (t) t.innerHTML = '';
    });

    hub.on('missedCall', ({ fromName, kind }) => {
      toast(`📞 Missed ${kind} call from ${fromName}`, 'info', 4200);
      window.dispatchEvent(new CustomEvent('sc:refresh-badge'));
    });

    window.addEventListener('sc:refresh-convos', loadConvos, { once: true });
  }
}

/* ══════════════════════════ conversation list ══════════════════════ */

function renderConvoList(listBox, conversations, layout) {
  listBox.innerHTML = '';
  if (!conversations.length) {
    listBox.innerHTML = `<p class="cl-empty">No conversations yet.<br>Message someone from their profile, or join a course!</p>`;
    return;
  }

  const total = conversations.reduce((n, c) => n + (c.unreadCount || 0), 0);
  if (total > 0) {
    listBox.appendChild(h(`<div class="unread-summary">${total} unread message${total === 1 ? '' : 's'}</div>`));
  }

  for (const c of conversations) listBox.appendChild(convoItem(c, layout));
}

function previewFor(c) {
  if (c.lastMessageKind === 'image') return '📷 Photo';
  if (c.lastMessageKind === 'voice') return '🎤 Voice note';
  if (c.lastMessageKind === 'file') return '📎 Attachment';
  return c.lastMessage ? c.lastMessage.slice(0, 60) : (c.type === 'course' ? 'Course group chat' : 'Say hello 👋');
}

function convoItem(c, layout) {
  const online = c.type === 'direct' && isOnline(c.id);
  const unread = c.unreadCount || 0;

  const el = h(`<div class="convo-item ${unread ? 'unread' : ''}" data-id="${esc(c.id)}" data-type="${esc(c.type)}" role="button" tabindex="0">
    <div class="ci-avatar-wrap">
      ${c.type === 'course'
        ? `<span class="convo-icon">${icon('grad').outerHTML}</span>`
        : avatar(c, 46).outerHTML}
      ${c.type === 'direct' ? `<span class="presence-dot ${online ? 'on' : ''}"></span>` : ''}
    </div>
    <div class="ci-body">
      <div class="ci-top">
        <span class="ci-name">${esc(c.name)}</span>
        <span class="ci-time">${c.lastMessageAt ? timeAgo(c.lastMessageAt) : ''}</span>
      </div>
      <div class="ci-bottom">
        <span class="ci-last">${esc(previewFor(c))}</span>
        ${unread ? `<span class="ci-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
      </div>
    </div>
  </div>`);

  const open = () => {
    layout.classList.remove('show-list');
    openConversation(c, layout);
  };
  el.addEventListener('click', open);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return el;
}

async function renderSearchResults(listBox, q, layout) {
  listBox.innerHTML = `<div class="spinner"></div>`;
  const hits = await api.chatSearch(q).catch(() => []);

  if (!hits.length) {
    listBox.innerHTML = `<p class="cl-empty">No messages match “${esc(q)}”.</p>`;
    return;
  }

  listBox.innerHTML = '';
  listBox.appendChild(h(`<div class="unread-summary">${hits.length} result${hits.length === 1 ? '' : 's'} for “${esc(q)}”</div>`));
  for (const hit of hits) {
    const el = h(`<div class="convo-item search-hit">
      ${hit.conversationType === 'course'
        ? `<span class="convo-icon">${icon('grad').outerHTML}</span>`
        : avatar(hit.conversationName, 42, hit.avatarUrl).outerHTML}
      <div class="ci-body">
        <div class="ci-top">
          <span class="ci-name">${esc(hit.conversationName)}</span>
          <span class="ci-time">${timeAgo(hit.sentAt)}</span>
        </div>
        <div class="ci-last">${esc(hit.senderName)}: ${esc(hit.content.slice(0, 70))}</div>
      </div>
    </div>`);
    el.addEventListener('click', () => {
      layout.classList.remove('show-list');
      openConversation({ id: hit.conversationId, type: hit.conversationType, name: hit.conversationName }, layout, hit.messageId);
    });
    listBox.appendChild(el);
  }
}

function bumpConvo(msg) {
  const item = document.querySelector(`.convo-item[data-id="${CSS.escape(msg.courseId || msg.senderId)}"]`);
  if (item) {
    item.classList.add('unread');
    const badge = item.querySelector('.ci-badge');
    const n = badge ? parseInt(badge.textContent, 10) + 1 : 1;
    if (badge) badge.textContent = n > 99 ? '99+' : n;
    else item.querySelector('.ci-bottom')?.appendChild(h(`<span class="ci-badge">1</span>`));
    item.querySelector('.ci-last').textContent = previewFor({ lastMessage: msg.content, lastMessageKind: msg.kind });
  }
  toast('💬 New message', 'info', 2200);
}

/* ══════════════════════════════ thread ══════════════════════════════ */

async function openConversation(convo, layout, focusMessageId = null) {
  if (!layout) return;
  activeConvo = { type: convo.type, id: convo.id, name: convo.name };
  replyTarget = null;

  layout.querySelectorAll('.convo-item').forEach(i =>
    i.classList.toggle('active', i.dataset.id === convo.id));

  const isCourse = convo.type === 'course';
  const pane = layout.querySelector('.chat-pane');
  pane.innerHTML = `
    <div class="chat-head">
      <button class="icon-btn back-btn" aria-label="Back">${icon('chevL').outerHTML}</button>
      <div class="ch-title">
        <div class="ch-name">${esc(convo.name)}</div>
        <div class="ch-sub">${isCourse
          ? `<span class="presence-dot on"></span>course group`
          : `<span class="presence-dot ${isOnline(convo.id) ? 'on' : ''}"></span>${isOnline(convo.id) ? 'Online' : 'Offline'}`}</div>
      </div>
      <div class="ch-actions">
        <button class="icon-btn" data-audio title="Audio call">${icon('phone').outerHTML}</button>
        <button class="icon-btn" data-video title="Video call">${icon('cam').outerHTML}</button>
        <button class="icon-btn" data-thread-search title="Search in conversation">${icon('search').outerHTML}</button>
      </div>
    </div>
    <div class="thread-search" hidden>
      <input placeholder="Search this conversation" data-thread-search-input>
      <button class="icon-btn" data-thread-search-close>${icon('x').outerHTML}</button>
    </div>
    <div class="chat-msgs" data-msgs><div class="spinner"></div></div>
    <div class="typing-row"></div>
    <div class="reply-bar" hidden></div>
    <div class="chat-input-row">
      <button class="ci-btn" data-attach title="Attach file">${icon('paperclip').outerHTML}</button>
      <input type="file" hidden data-file>
      <div class="input-wrap">
        <textarea rows="1" placeholder="${isCourse ? 'Message the class…' : 'Type a message…'}" maxlength="4000" data-input></textarea>
        <button class="ci-btn" data-emoji title="Emoji">${icon('emoji').outerHTML}</button>
      </div>
      <button class="ci-btn rec" data-record title="Hold to record a voice note">${icon('mic').outerHTML}</button>
      <button class="ci-btn send" data-send title="Send">${icon('send').outerHTML}</button>
    </div>`;

  const msgs = pane.querySelector('[data-msgs]');
  const input = pane.querySelector('[data-input]');
  const fileInput = pane.querySelector('[data-file]');
  const typingRow = pane.querySelector('.typing-row');

  // mobile back button
  const backBtn = pane.querySelector('.back-btn');
  if (window.matchMedia('(max-width: 860px)').matches) {
    backBtn.style.display = 'grid';
    layout.classList.remove('show-list');
  }
  backBtn.addEventListener('click', () => layout.classList.add('show-list'));

  // calls
  const canCall = !isCourse && convo.id !== session.user.id;
  pane.querySelector('[data-audio]').disabled = !canCall;
  pane.querySelector('[data-video]').disabled = !canCall;
  pane.querySelector('[data-audio]').addEventListener('click', () => startCall(convo.id, 'audio', convo.name));
  pane.querySelector('[data-video]').addEventListener('click', () => startCall(convo.id, 'video', convo.name));

  // ── history ──
  const loader = isCourse ? api.courseMessages(convo.id) : api.directMessages(convo.id);
  const history = await loader.catch(() => []);
  msgs.innerHTML = '';
  if (!history.length) {
    msgs.innerHTML = `<div class="thread-empty">
      <div class="te-art">${icon('chat').outerHTML}</div>
      <p>${isCourse ? 'No class messages yet — start the discussion!' : 'No messages yet — say hi! 👋'}</p></div>`;
  }
  renderThread(msgs, history, session.user.id);
  scrollToBottom(msgs, false);

  if (isCourse) await joinCourseGroup(convo.id);

  // mark read + delivered the moment the thread opens
  const hub = chatHub();
  if (hub) {
    if (isCourse) hub.invoke('MarkRead', convo.id, true).catch(() => {});
    else {
      hub.invoke('MarkDelivered', convo.id).catch(() => {});
      hub.invoke('MarkRead', convo.id, false).catch(() => {});
    }
    await hydrate([convo.id]);
  }

  if (focusMessageId) {
    const target = msgs.querySelector(`[data-mid="${CSS.escape(focusMessageId)}"]`);
    target?.scrollIntoView({ block: 'center' });
    target?.classList.add('flash');
    setTimeout(() => target?.classList.remove('flash'), 2200);
  }

  // ── send ──
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    autoGrow(input);

    const clientId = cryptoId();
    const optimistic = {
      id: `tmp-${clientId}`, clientId, senderId: session.user.id,
      senderName: session.user.fullName, content: text, kind: 'text',
      sentAt: new Date().toISOString(), pending: true,
      receiverId: isCourse ? null : convo.id, courseId: isCourse ? convo.id : null,
      replyToId: replyTarget?.id || null,
      replyToPreview: replyTarget?.content, replyToSender: replyTarget?.senderName,
    };
    appendMessageRow(msgs, optimistic, session.user.id, { scroll: true });
    clearReply();

    const c = chatHub();
    if (!c) { markFailed(msgs, optimistic.id); toast('Chat is offline — reconnecting…', 'err'); return; }

    try {
      if (isCourse) await c.invoke('SendMessageToCourse', convo.id, text, clientId, optimistic.replyToId);
      else await c.invoke('SendMessageToUser', convo.id, text, clientId, optimistic.replyToId);
    } catch (e) {
      markFailed(msgs, optimistic.id);
      toast(e.message || 'Message failed', 'err');
      input.value = text;
    }
  };

  pane.querySelector('[data-send]').addEventListener('click', send);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener('input', () => {
    autoGrow(input);
    if (isCourse) return;
    if (typingTimer) return;
    chatHub()?.invoke('NotifyTyping', convo.id).catch(() => {});
    typingTimer = setTimeout(() => {
      typingTimer = null;
      chatHub()?.invoke('StopTyping', convo.id).catch(() => {});
    }, 2600);
  });

  // ── attachments ──
  pane.querySelector('[data-attach]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) await sendAttachment(file, pane, msgs, convo, isCourse);
  });
  msgs.addEventListener('dragover', e => { e.preventDefault(); msgs.classList.add('dragging'); });
  msgs.addEventListener('dragleave', () => msgs.classList.remove('dragging'));
  msgs.addEventListener('drop', async e => {
    e.preventDefault();
    msgs.classList.remove('dragging');
    const file = e.dataTransfer?.files?.[0];
    if (file) await sendAttachment(file, pane, msgs, convo, isCourse);
  });

  // ── voice notes ──
  pane.querySelector('[data-record]').addEventListener('click', () =>
    recordVoiceNote(pane, msgs, convo, isCourse));

  // ── emoji picker ──
  pane.querySelector('[data-emoji]').addEventListener('click', (e) =>
    openEmojiPicker(e.currentTarget, input));

  // ── in-thread search ──
  const searchBar = pane.querySelector('.thread-search');
  const searchField = pane.querySelector('[data-thread-search-input]');
  pane.querySelector('[data-thread-search]').addEventListener('click', () => {
    searchBar.hidden = !searchBar.hidden;
    if (!searchBar.hidden) searchField.focus();
    else { searchField.value = ''; msgs.querySelectorAll('.msg-row').forEach(r => r.classList.remove('dim')); }
  });
  pane.querySelector('[data-thread-search-close]').addEventListener('click', () => {
    searchBar.hidden = true; searchField.value = '';
    msgs.querySelectorAll('.msg-row').forEach(r => r.classList.remove('dim'));
  });
  searchField.addEventListener('input', () => {
    const q = searchField.value.trim().toLowerCase();
    msgs.querySelectorAll('.msg-row').forEach(r => {
      if (!q) { r.classList.remove('dim'); return; }
      const hit = (r.dataset.text || '').toLowerCase().includes(q);
      r.classList.toggle('dim', !hit);
    });
  });

  // ── realtime rewire for this thread ──
  const hubNow = chatHub();
  hubNow?.off('reconnected-thread');
}

function scrollToBottom(msgs, smooth = true) {
  requestAnimationFrame(() => {
    msgs.scrollTo({ top: msgs.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  });
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 148) + 'px';
}

function markFailed(msgs, tmpId) {
  const row = msgs.querySelector(`[data-mid="${CSS.escape(tmpId)}"]`);
  row?.classList.add('failed');
  row?.querySelector('.msg-tick')?.replaceChildren(icon('x').firstElementChild);
}

function cryptoId() {
  return crypto.randomUUID ? crypto.randomUUID() : `c${Date.now()}${Math.random().toString(16).slice(2)}`;
}

/* ══════════════════════════ thread rendering ═══════════════════════ */

function renderThread(msgs, list, myId) {
  let lastDay = null, lastSender = null, lastTime = 0;

  for (const m of list) {
    const day = new Date(m.sentAt).toDateString();
    if (day !== lastDay) {
      msgs.appendChild(h(`<div class="day-sep"><span>${esc(dayLabel(day))}</span></div>`));
      lastDay = day; lastSender = null;
    }
    const t = new Date(m.sentAt).getTime();
    const grouped = m.senderId === lastSender && (t - lastTime) < 5 * 60 * 1000;
    appendMessageRow(msgs, m, myId, { grouped });
    lastSender = m.senderId;
    lastTime = t;
  }
}

function appendMessageRow(msgs, m, myId, { scroll = false, grouped = false } = {}) {
  const existing = msgs.querySelector(`[data-mid="${CSS.escape(m.id)}"]`)
    || (m.clientId ? msgs.querySelector(`[data-client="${CSS.escape(m.clientId)}"]`) : null);

  const row = buildMessageRow(m, myId, grouped);

  if (existing) {
    existing.replaceWith(row);
  } else {
    msgs.querySelector('.thread-empty')?.remove();
    msgs.appendChild(row);
  }
  if (scroll) scrollToBottom(msgs);
  return row;
}

/** Replace-or-append used by realtime events. */
function upsertMessage(layout, m, myId) {
  const msgs = layout.querySelector('[data-msgs]');
  if (!msgs || !m) return;
  appendMessageRow(msgs, m, myId, { scroll: true });
}

function buildMessageRow(m, myId, grouped) {
  const mine = m.senderId === myId;
  const deleted = !!m.deletedAt;

  const row = h(`<div class="msg-row ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''} ${deleted ? 'deleted' : ''}"
      data-mid="${esc(m.id)}" data-client="${esc(m.clientId || '')}" data-text="${esc(m.content || '')}">
    ${mine ? '' : `<div class="mr-av">${grouped ? '' : avatar(m.senderName, 30, m.senderAvatarUrl).outerHTML}</div>`}
    <div class="mr-body">
      ${(!mine && !grouped) ? `<div class="msg-sender">${esc(m.senderName)}</div>` : ''}
      ${m.replyToId ? `<div class="msg-reply">
          <span class="mrp-sender">${esc(m.replyToSender || 'Reply')}</span>
          <span class="mrp-text">${esc((m.replyToPreview || '').slice(0, 90))}</span>
        </div>` : ''}
      <div class="msg-bubble ${m.kind || 'text'}">
        ${renderBubbleContent(m, deleted)}
        <div class="msg-foot">
          ${m.editedAt && !deleted ? '<span class="msg-edited">edited</span>' : ''}
          <span class="msg-time">${timeAgo(m.sentAt)}</span>
          ${mine ? `<span class="msg-tick ${tickClass(m)}" title="${tickTitle(m)}">${tickSvg(m)}</span>` : ''}
        </div>
      </div>
      ${renderReactions(m)}
    </div>
    ${deleted ? '' : `<button class="msg-menu-btn" aria-label="Message actions">${icon('more').outerHTML}</button>`}
  </div>`);

  if (!deleted) {
    row.querySelector('.msg-menu-btn')?.addEventListener('click', (e) =>
      openMessageMenu(e, m, myId, row));
    row.querySelectorAll('[data-react-pill]').forEach(pill =>
      pill.addEventListener('click', () => toggleReaction(m, pill.dataset.reactPill)));
    wireAttachment(row, m);
  }

  return row;
}

function renderBubbleContent(m, deleted) {
  if (deleted) return `<div class="msg-text deleted-text">${icon('trash').outerHTML}<em>This message was deleted</em></div>`;

  const kind = m.kind || 'text';
  if (kind === 'image' && m.attachmentUrl) {
    return `<img class="msg-image" src="${esc(m.attachmentUrl)}" alt="${esc(m.attachmentName || 'Photo')}" loading="lazy" data-open-image>
      ${m.content ? `<div class="msg-text">${esc(m.content)}</div>` : ''}`;
  }
  if (kind === 'voice' && m.attachmentUrl) {
    return `${voiceNotePlayer(m)}${m.content ? `<div class="msg-text">${esc(m.content)}</div>` : ''}`;
  }
  if (kind === 'file' && m.attachmentUrl) {
    return `<a class="msg-file" href="${esc(m.attachmentUrl)}" download="${esc(m.attachmentName || '')}" target="_blank" rel="noopener">
        <span class="mf-icon">${icon('paperclip').outerHTML}</span>
        <span class="mf-meta">
          <span class="mf-name">${esc(m.attachmentName || 'Attachment')}</span>
          <span class="mf-size">${m.attachmentSizeBytes ? esc(fmtBytes(m.attachmentSizeBytes)) : 'Download'}</span>
        </span>
        <span class="mf-dl">${icon('download').outerHTML}</span>
      </a>${m.content ? `<div class="msg-text">${esc(m.content)}</div>` : ''}`;
  }
  return `<div class="msg-text">${esc(m.content)}</div>`;
}

function voiceNotePlayer(m) {
  const secs = Math.round(m.durationSeconds || 0);
  return `<div class="voice-note" data-voice data-src="${esc(m.attachmentUrl)}">
    <button class="vn-play" data-vn-play aria-label="Play voice note">${icon('play').outerHTML}</button>
    <div class="vn-wave" data-vn-wave>${'<i></i>'.repeat(26)}</div>
    <span class="vn-time">${secs ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '0:00'}</span>
    <audio preload="metadata" src="${esc(m.attachmentUrl)}"></audio>
  </div>`;
}

function renderReactions(m) {
  const reactions = m.reactions || [];
  if (!reactions.length) return '<div class="reaction-row"></div>';
  return `<div class="reaction-row">${reactions.map(r =>
    `<button class="reaction ${r.mine ? 'mine' : ''}" data-react-pill="${esc(r.emoji)}" title="${r.count} reaction${r.count === 1 ? '' : 's'}">
      <span>${esc(r.emoji)}</span>${r.count > 1 ? `<b>${r.count}</b>` : ''}
    </button>`).join('')}</div>`;
}

function tickSvg(m) {
  if (m.pending) return icon('clock').innerHTML;
  if (m.readAt) return icon('checkAll').innerHTML;
  if (m.deliveredAt) return icon('checkAll').innerHTML;
  return icon('check').innerHTML;
}

function tickClass(m) {
  if (m.pending) return 'pending';
  if (m.readAt) return 'read';
  if (m.deliveredAt) return 'delivered';
  return 'sent';
}

function tickTitle(m) {
  if (m.pending) return 'Sending…';
  if (m.readAt) return 'Read';
  if (m.deliveredAt) return 'Delivered';
  return 'Sent';
}

function dayLabel(day) {
  const d = new Date(day);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/* ══════════════════════════ receipts ═══════════════════════════════ */

function applyReceipt(layout, r) {
  const msgs = layout.querySelector('[data-msgs]');
  if (!msgs) return;
  for (const id of r.messageIds || []) {
    const row = msgs.querySelector(`[data-mid="${CSS.escape(id)}"]`);
    if (!row) continue;
    const tick = row.querySelector('.msg-tick');
    if (!tick) continue;
    tick.classList.remove('sent', 'delivered');
    tick.classList.add(r.state === 'read' ? 'read' : 'delivered');
    tick.innerHTML = icon('checkAll').innerHTML;
    tick.title = r.state === 'read' ? 'Read' : 'Delivered';
  }
}

/* ══════════════════════════ message actions ═══════════════════════ */

function openMessageMenu(event, m, myId, row) {
  document.querySelector('.msg-menu')?.remove();
  const mine = m.senderId === myId;

  const menu = h(`<div class="msg-menu" role="menu">
    <div class="mm-reactions">
      ${QUICK_REACTIONS.map(e => `<button data-react="${esc(e)}">${esc(e)}</button>`).join('')}
    </div>
    <button class="mm-item" data-act="reply">${icon('reply').outerHTML}Reply</button>
    <button class="mm-item" data-act="copy">${icon('book').outerHTML}Copy text</button>
    ${mine && m.kind === 'text' ? `<button class="mm-item" data-act="edit">${icon('edit').outerHTML}Edit</button>` : ''}
    ${mine ? `<button class="mm-item danger" data-act="delete">${icon('trash').outerHTML}Delete</button>` : ''}
  </div>`);

  const rect = event.currentTarget.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 260)}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.left - 140, window.innerWidth - 250))}px`;
  document.body.appendChild(menu);

  const close = () => menu.remove();
  setTimeout(() => document.addEventListener('click', close, { once: true }), 0);

  menu.querySelectorAll('[data-react]').forEach(b =>
    b.addEventListener('click', () => { toggleReaction(m, b.dataset.react); close(); }));

  menu.querySelector('[data-act="reply"]')?.addEventListener('click', () => {
    setReply(m); close();
  });

  menu.querySelector('[data-act="copy"]')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(m.content || ''); toast('Copied', 'ok', 1500); }
    catch { toast('Could not copy', 'err'); }
    close();
  });

  menu.querySelector('[data-act="edit"]')?.addEventListener('click', () => {
    close();
    const bubble = row.querySelector('.msg-bubble');
    const textEl = bubble.querySelector('.msg-text');
    const original = m.content;
    textEl.innerHTML = `<textarea class="edit-box" rows="1">${esc(original)}</textarea>
      <div class="edit-actions"><button class="btn btn-ghost" data-cancel>Cancel</button>
      <button class="btn btn-primary" data-save>Save</button></div>`;
    const ta = textEl.querySelector('textarea');
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    autoGrow(ta);

    textEl.querySelector('[data-cancel]').addEventListener('click', () => upsertMessage(row.closest('.chat-pane'), m, myId));
    textEl.querySelector('[data-save]').addEventListener('click', async () => {
      const next = ta.value.trim();
      if (!next || next === original) { upsertMessage(row.closest('.chat-pane'), m, myId); return; }
      await chatHub()?.invoke('EditMessage', m.id, next).catch(e => toast(e.message, 'err'));
    });
  });

  menu.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
    close();
    const ok = await confirmDialog('Delete message?', 'This removes it for everyone in the conversation.', 'Delete');
    if (ok) await chatHub()?.invoke('DeleteMessage', m.id).catch(e => toast(e.message, 'err'));
  });
}

async function toggleReaction(m, emoji) {
  const hub = chatHub();
  if (!hub) return;
  await hub.invoke('ReactMessage', m.id, emoji).catch(e => toast(e.message, 'err'));
}

function setReply(m) {
  replyTarget = m;
  const bar = document.querySelector('.reply-bar');
  if (!bar) return;
  bar.hidden = false;
  bar.innerHTML = `<div class="rb-line"></div>
    <div class="rb-body">
      <div class="rb-sender">${esc(m.senderName)}</div>
      <div class="rb-text">${esc((m.content || '').slice(0, 110))}</div>
    </div>
    <button class="icon-btn" data-rb-close>${icon('x').outerHTML}</button>`;
  bar.querySelector('[data-rb-close]').addEventListener('click', clearReply);
  document.querySelector('.chat-pane textarea[data-input]')?.focus();
}

function clearReply() {
  replyTarget = null;
  const bar = document.querySelector('.reply-bar');
  if (bar) { bar.hidden = true; bar.innerHTML = ''; }
}

/* ══════════════════════════ attachments ═══════════════════════════ */

async function sendAttachment(file, pane, msgs, convo, isCourse) {
  const MAX = 25 * 1024 * 1024;
  if (file.size > MAX) { toast(`“${file.name}” is larger than 25 MB`, 'err'); return; }

  const isImage = file.type.startsWith('image/');
  const clientId = cryptoId();

  // Show a local preview immediately so the send feels instant.
  const preview = {
    id: `tmp-${clientId}`, clientId, senderId: session.user.id, senderName: session.user.fullName,
    content: '', kind: isImage ? 'image' : 'file', sentAt: new Date().toISOString(), pending: true,
    attachmentUrl: isImage ? URL.createObjectURL(file) : null,
    attachmentName: file.name, attachmentSizeBytes: file.size,
  };
  appendMessageRow(msgs, preview, session.user.id, { scroll: true });

  try {
    const saved = await api.uploadAttachment(file, {
      targetId: convo.id, isCourse, caption: '', clientId,
      replyToId: replyTarget?.id || null,
    });
    clearReply();
    upsertMessage(pane, saved, session.user.id);
  } catch (e) {
    markFailed(msgs, preview.id);
    toast(e.message || 'Upload failed', 'err');
  }
}

function wireAttachment(row, m) {
  row.querySelector('[data-open-image]')?.addEventListener('click', (e) =>
    lightbox(e.currentTarget.src));

  const vn = row.querySelector('[data-voice]');
  if (!vn) return;
  const audio = vn.querySelector('audio');
  const btn = vn.querySelector('[data-vn-play]');
  const wave = vn.querySelector('[data-vn-wave]');

  // Deterministic pseudo-waveform from the URL so every note looks distinct.
  const bars = wave.querySelectorAll('i');
  let seed = 0;
  for (const ch of (m.attachmentUrl || '')) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  bars.forEach((b, i) => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    b.style.height = `${18 + (seed % 70)}%`;
    b.style.animationDelay = `${i * 22}ms`;
  });

  const toggle = () => {
    if (audio.paused) {
      document.querySelectorAll('.voice-note audio').forEach(a => { if (a !== audio) a.pause(); });
      audio.play().catch(() => toast('Cannot play this voice note', 'err'));
    } else audio.pause();
  };
  btn.addEventListener('click', toggle);
  audio.addEventListener('play', () => {
    vn.classList.add('playing');
    btn.innerHTML = icon('stop').outerHTML;
    const secs = audio.duration || m.durationSeconds || 0;
    vn.style.setProperty('--vn-progress', '0%');
    void secs;
  });
  audio.addEventListener('pause', () => { vn.classList.remove('playing'); btn.innerHTML = icon('play').outerHTML; });
  audio.addEventListener('ended', () => { vn.classList.remove('playing'); btn.innerHTML = icon('play').outerHTML; });
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    vn.style.setProperty('--vn-progress', `${(audio.currentTime / audio.duration) * 100}%`);
  });
  wave.addEventListener('click', (e) => {
    if (!audio.duration) return;
    const rect = wave.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
  });
}

/* ══════════════════════════ voice recording ═══════════════════════ */

async function recordVoiceNote(pane, msgs, convo, isCourse) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast('Voice notes are not supported on this device', 'err');
    return;
  }

  let stream, recorder, chunks = [], startedAt = 0;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast('Microphone permission is needed for voice notes', 'err');
    return;
  }

  const overlay = h(`<div class="rec-overlay">
    <div class="rec-card">
      <div class="rec-dot"></div>
      <div class="rec-time" data-rec-time>0:00</div>
      <div class="rec-wave">${'<i></i>'.repeat(30)}</div>
      <div class="rec-actions">
        <button class="btn btn-ghost" data-rec-cancel>Cancel</button>
        <button class="btn btn-primary" data-rec-send>${icon('send').outerHTML} Send</button>
      </div>
    </div>
  </div>`);
  document.body.appendChild(overlay);

  const timeEl = overlay.querySelector('[data-rec-time]');
  const bars = [...overlay.querySelectorAll('.rec-wave i')];

  // Live level meter so the user can see they are being heard.
  let rafId = null, analyser = null, audioCtx = null;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      bars.forEach((b, i) => { b.style.height = `${8 + (data[i % data.length] / 255) * 92}%`; });
      rafId = requestAnimationFrame(tick);
    };
    tick();
  } catch { /* level meter is a nicety */ }

  const cleanup = () => {
    if (rafId) cancelAnimationFrame(rafId);
    try { audioCtx?.close(); } catch {}
    stream.getTracks().forEach(t => t.stop());
    overlay.remove();
  };

  const start = () => {
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
      .find(t => MediaRecorder.isTypeSupported?.(t)) || '';
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.start(250);
    startedAt = Date.now();
  };

  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (s >= 300) finish(true);   // 5 minute cap keeps uploads sane
  }, 250);

  const finish = (send) => {
    clearInterval(timer);
    const duration = (Date.now() - startedAt) / 1000;
    if (!recorder || recorder.state === 'inactive') { cleanup(); return; }

    recorder.onstop = async () => {
      cleanup();
      if (!send || duration < 0.6) return;

      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      const ext = (recorder.mimeType || '').includes('ogg') ? 'ogg'
        : (recorder.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
      const file = new File([blob], `voice-note.${ext}`, { type: blob.type });
      const clientId = cryptoId();

      const optimistic = {
        id: `tmp-${clientId}`, clientId, senderId: session.user.id, senderName: session.user.fullName,
        content: '', kind: 'voice', sentAt: new Date().toISOString(), pending: true,
        attachmentUrl: URL.createObjectURL(blob), durationSeconds: duration,
      };
      appendMessageRow(msgs, optimistic, session.user.id, { scroll: true });

      try {
        const saved = await api.uploadAttachment(file, {
          targetId: convo.id, isCourse, durationSeconds: duration, clientId,
        });
        upsertMessage(pane, saved, session.user.id);
      } catch (e) {
        markFailed(msgs, optimistic.id);
        toast(e.message || 'Could not send the voice note', 'err');
      }
    };
    recorder.stop();
  };

  overlay.querySelector('[data-rec-cancel]').addEventListener('click', () => finish(false));
  overlay.querySelector('[data-rec-send]').addEventListener('click', () => finish(true));
  start();
}

/* ══════════════════════════ emoji picker ══════════════════════════ */

function openEmojiPicker(anchor, input) {
  document.querySelector('.emoji-pop')?.remove();
  const pop = h(`<div class="emoji-pop">${EMOJI_PALETTE.map(e => `<button data-e="${esc(e)}">${esc(e)}</button>`).join('')}</div>`);
  const rect = anchor.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  pop.style.left = `${Math.max(8, Math.min(rect.left - 150, window.innerWidth - 320))}px`;
  document.body.appendChild(pop);

  const close = () => pop.remove();
  setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
  pop.querySelectorAll('[data-e]').forEach(b => b.addEventListener('click', () => {
    input.value += b.dataset.e;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    close();
  }));
}

/* ═══════════════════ embedded course chat (course page) ═══════════════ */

export async function renderCourseChat(container, course) {
  const me = session.user;
  const el = h(`<div class="chat-layout embedded">
    <div class="chat-pane">
      <div class="chat-head">
        <span class="convo-icon">${icon('chat').outerHTML}</span>
        <div class="ch-title">
          <div class="ch-name">${esc(course.code)} group chat</div>
          <div class="ch-sub"><span class="presence-dot on"></span>live course discussion</div>
        </div>
        <div class="ch-actions">
          <button class="icon-btn" data-start-room title="Start a study room">${icon('cam').outerHTML}</button>
        </div>
      </div>
      <div class="chat-msgs" data-msgs><div class="spinner"></div></div>
      <div class="typing-row"></div>
      <div class="chat-input-row">
        <div class="input-wrap">
          <textarea rows="1" placeholder="Message the class…" maxlength="4000" data-input></textarea>
        </div>
        <button class="ci-btn send" data-send>${icon('send').outerHTML}</button>
      </div>
    </div>
  </div>`);
  container.appendChild(el);

  const msgs = el.querySelector('[data-msgs]');
  const input = el.querySelector('[data-input]');

  const history = await api.courseMessages(course.id).catch(() => []);
  msgs.innerHTML = '';
  if (!history.length) {
    msgs.innerHTML = `<div class="thread-empty"><div class="te-art">${icon('chat').outerHTML}</div>
      <p>No class messages yet — start the discussion!</p></div>`;
  }
  renderThread(msgs, history, me.id);
  scrollToBottom(msgs, false);

  el.querySelector('[data-start-room]').addEventListener('click', async () => {
    const { startGroupRoom } = await import('../call/ui.js').catch(() => ({}));
    if (startGroupRoom) startGroupRoom(course.id, `${course.code} study room`);
    else toast('Study rooms need the calling service', 'err');
  });

  await joinCourseGroup(course.id);
  const hub = chatHub();
  hub?.off('messageReceived');
  hub?.off('userTyping');
  hub?.off('messageReacted');
  hub?.off('messageEdited');
  hub?.off('messageDeleted');

  hub?.on('messageReceived', (msg) => {
    if (msg?.courseId !== course.id) return;
    appendMessageRow(msgs, msg, me.id, { scroll: true });
  });
  hub?.on('messageReacted', (msg) => { if (msg?.courseId === course.id) appendMessageRow(msgs, msg, me.id); });
  hub?.on('messageEdited', (msg) => { if (msg?.courseId === course.id) appendMessageRow(msgs, msg, me.id); });
  hub?.on('messageDeleted', (msg) => { if (msg?.courseId === course.id) appendMessageRow(msgs, msg, me.id); });
  hub?.on('userTyping', ({ fromUserId, fromName }) => {
    if (fromUserId === me.id) return;
    const t = el.querySelector('.typing-row');
    if (!t) return;
    t.innerHTML = `<span class="tdots"><span></span><span></span><span></span></span> ${esc(fromName || 'Someone')} is typing…`;
    setTimeout(() => { t.innerHTML = ''; }, 2600);
  });

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    autoGrow(input);
    await chatHub()?.invoke('SendMessageToCourse', course.id, text, cryptoId())
      .catch(e => toast(e.message, 'err'));
  };
  el.querySelector('[data-send]').addEventListener('click', send);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  input.addEventListener('input', () => {
    autoGrow(input);
    if (typingTimer) return;
    chatHub()?.invoke('NotifyTypingCourse', course.id).catch(() => {});
    typingTimer = setTimeout(() => { typingTimer = null; }, 2600);
  });

  new MutationObserver((_, obs) => {
    if (!document.body.contains(el)) { leaveCourseGroup(course.id); obs.disconnect(); }
  }).observe(document.body, { childList: true, subtree: true });
}
