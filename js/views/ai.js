/* StreamCampus — AI Study Buddy */
import { api } from '../api.js';
import { esc, h, icon } from '../ui.js';

const QUICK = [
  'Quiz me on data structures',
  'How do I stop procrastinating before exams?',
  'Explain Dijkstra vs BFS simply',
  'Tips for writing lab reports',
];

export function renderAI(root) {
  root.innerHTML = '';
  const el = h(`<div class="ai-layout">
    <div class="ai-head">
      <span class="ai-orb">${icon('sparkles').outerHTML}</span>
      <div style="flex:1">
        <div style="font-weight:800">Campus Buddy</div>
        <div style="font-size:12px;color:var(--text-3)">Your AI study companion · always awake</div>
      </div>
    </div>
    <div class="ai-msgs" id="ai-msgs">
      <div class="ai-msg">Hey! I'm Campus Buddy 🎓 Ask me anything — study tips, course concepts, campus life. You can also highlight a post's text and I'll summarize it.</div>
    </div>
    <div class="ai-chips">${QUICK.map(q => `<button class="ai-chip">${esc(q)}</button>`).join('')}</div>
    <div class="chat-input-row">
      <input placeholder="Ask Campus Buddy anything…" maxlength="1000">
      <button class="btn btn-primary" aria-label="Send" style="width:46px;height:46px;padding:0;border-radius:50%">${icon('send').outerHTML}</button>
    </div>
  </div>`);
  root.appendChild(el);

  const msgs = el.querySelector('#ai-msgs');
  const input = el.querySelector('input');
  const sendBtn = el.querySelector('.chat-input-row .btn');

  const ask = async (text) => {
    if (!text.trim()) return;
    input.value = '';
    msgs.appendChild(h(`<div class="ai-msg mine">${esc(text)}</div>`));
    const thinking = h(`<div class="ai-msg" data-think>Thinking…</div>`);
    msgs.appendChild(thinking);
    msgs.scrollTop = msgs.scrollHeight;
    sendBtn.disabled = true;
    try {
      const r = await api.aiChat(text);
      thinking.remove();
      msgs.appendChild(h(`<div class="ai-msg">${esc(r.reply)}</div>`));
    } catch (e) {
      thinking.remove();
      msgs.appendChild(h(`<div class="ai-msg" style="color:var(--danger)">${esc(e.message)}</div>`));
    }
    msgs.scrollTop = msgs.scrollHeight;
    sendBtn.disabled = false;
    input.focus();
  };

  sendBtn.addEventListener('click', () => ask(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') ask(input.value); });
  el.querySelectorAll('.ai-chip').forEach(c => c.addEventListener('click', () => ask(c.textContent)));
}
