/* StreamCampus — Cartoons: public-domain animated shorts streamed from the Internet Archive.
 *
 * Nothing here is user content: the shelf is a library, so there is no posting, liking
 * or commenting. Every item the Worker returns is public domain and has a playable file,
 * which is why the player can go straight to a <video> with no format sniffing.
 */
import { api } from '../api.js';
import { esc, h, icon, emptyState, toast, debounce } from '../ui.js';

const PAGE_SIZE = 18;

const runtime = (seconds) => (seconds ? `${Math.round(seconds / 60)} min` : 'Short');

function shelfHash({ shelf = '', q = '' } = {}) {
  const params = new URLSearchParams();
  if (shelf) params.set('shelf', shelf);
  if (q) params.set('q', q);
  const query = params.toString();
  return `/cartoons${query ? `?${query}` : ''}`;
}

function posterCard(item) {
  const card = h(`<button class="toon-card" type="button">
    <span class="toon-thumb">
      <img src="${esc(item.posterUrl)}" alt="" loading="lazy" decoding="async">
      <span class="toon-play">${icon('play').outerHTML}</span>
    </span>
    <span class="toon-meta">
      <span class="toon-title">${esc(item.title)}</span>
      <span class="toon-sub">${item.year ? esc(String(item.year)) : 'Classic'}${item.downloads ? ` · ${esc(compact(item.downloads))} views` : ''}</span>
    </span>
  </button>`);

  card.addEventListener('click', () => { location.hash = `/cartoons/${encodeURIComponent(item.id)}`; });
  return card;
}

function compact(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

export async function renderCartoons(main, { shelf = '', q = '' } = {}) {
  main.innerHTML = '<div class="spinner"></div>';

  let page;
  try {
    page = await api.cartoons({ shelf, q, pageSize: PAGE_SIZE });
  } catch (error) {
    main.innerHTML = '';
    main.appendChild(
      emptyState(
        'video',
        'The cartoon library is not answering',
        error?.message || 'Try again in a moment.',
        '<button class="btn btn-primary" data-retry>Retry</button>'
      )
    );
    main.querySelector('[data-retry]')?.addEventListener('click', () => renderCartoons(main, { shelf, q }));
    return;
  }

  const head = h(`<div class="page-head">
    <h1>Cartoons</h1>
    <span class="grow"></span>
    <p class="ph-sub">Public domain, from the Internet Archive</p>
  </div>`);

  const rail = h(`<div class="toon-rails" role="tablist" aria-label="Cartoon shelves"></div>`);
  for (const item of page.shelves) {
    const active = item.id === page.shelf;
    const chip = h(`<button class="toon-chip ${active ? 'active' : ''}" type="button" role="tab"
      aria-selected="${active}" title="${esc(item.blurb)}">${esc(item.label)}</button>`);
    chip.addEventListener('click', () => { location.hash = shelfHash({ shelf: item.id, q: '' }); });
    rail.appendChild(chip);
  }

  const searchRow = h(`<form class="toon-search" role="search">
    <span class="icn">${icon('search').outerHTML}</span>
    <input type="search" name="q" placeholder="Search the shelf — try “Popeye” or “magic”"
      value="${esc(q)}" aria-label="Search cartoons" autocomplete="off">
  </form>`);

  main.innerHTML = '';
  main.append(head, rail, searchRow);

  const input = searchRow.querySelector('input');
  searchRow.addEventListener('submit', (event) => {
    event.preventDefault();
    location.hash = shelfHash({ shelf: page.shelf, q: input.value.trim() });
  });
  input.addEventListener('input', debounce(() => {
    const value = input.value.trim();
    if (value.length === 1) return; // one letter matches almost everything
    location.hash = shelfHash({ shelf: page.shelf, q: value });
  }, 500));

  if (!page.items.length) {
    main.appendChild(
      emptyState(
        'video',
        q ? `Nothing on this shelf matches “${q}”` : 'This shelf is empty',
        q ? 'Try another word, or pick a different shelf.' : 'Pick another shelf — the rest of the library is still there.',
        '<button class="btn btn-ghost" data-all>Show everything</button>'
      )
    );
    main.querySelector('[data-all]')?.addEventListener('click', () => { location.hash = shelfHash({ shelf: page.shelf }); });
    return;
  }

  const grid = h('<div class="toon-grid"></div>');
  page.items.forEach((item) => grid.appendChild(posterCard(item)));
  main.appendChild(grid);

  let nextPage = page.page + 1;
  let hasNext = page.hasNext;

  if (hasNext) {
    const more = h('<button class="btn btn-ghost btn-block" data-more>Load more</button>');
    main.appendChild(more);
    more.addEventListener('click', async () => {
      more.disabled = true;
      try {
        const next = await api.cartoons({ shelf: page.shelf, q, page: nextPage, pageSize: PAGE_SIZE });
        next.items.forEach((item) => grid.appendChild(posterCard(item)));
        nextPage += 1;
        hasNext = next.hasNext;
        if (!hasNext) more.remove();
      } catch (error) {
        toast(error?.message || 'Could not load more', 'err');
      } finally {
        more.disabled = false;
      }
    });
  }
}

export async function renderCartoonPlayer(main, id) {
  main.innerHTML = '<div class="spinner"></div>';

  let item;
  try {
    item = await api.cartoon(id);
  } catch (error) {
    main.innerHTML = '';
    main.appendChild(
      emptyState(
        'video',
        'That cartoon is not available',
        error?.message || 'It may have left the public-domain collection.',
        '<button class="btn btn-primary" data-back>Back to Cartoons</button>'
      )
    );
    main.querySelector('[data-back]')?.addEventListener('click', () => { location.hash = shelfHash(); });
    return;
  }

  const view = h(`<div class="toon-player">
    <div class="page-head">
      <button class="icon-btn" data-back aria-label="Back to Cartoons">${icon('chevL').outerHTML}</button>
      <h1>${esc(item.title)}</h1>
    </div>

    <div class="toon-stage">
      <video src="${esc(item.streamUrl)}" poster="${esc(item.posterUrl)}"
        controls playsinline preload="metadata"></video>
    </div>

    <div class="toon-about card">
      <div class="toon-line">
        <span>${item.year ? esc(String(item.year)) : 'Classic'}</span>
        <span aria-hidden="true">·</span>
        <span>${runtime(item.runtimeSeconds)}</span>
        <span aria-hidden="true">·</span>
        <span class="toon-license">${esc(item.license)}</span>
      </div>
      ${item.credits ? `<p class="toon-credits">${esc(item.credits)}</p>` : ''}
      ${item.description ? `<p class="toon-desc">${esc(item.description)}</p>` : ''}
      <a class="btn btn-ghost btn-sm" href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">
        View on the Internet Archive
      </a>
    </div>
  </div>`);

  main.innerHTML = '';
  main.appendChild(view);

  view.querySelector('[data-back]').addEventListener('click', () => { location.hash = shelfHash(); });

  const video = view.querySelector('video');

  // Navigating away replaces this subtree; the element leaving the DOM already stops
  // playback, but pausing explicitly keeps audio from trailing the route change.
  const observer = new MutationObserver(() => {
    if (!document.body.contains(view)) {
      try { video.pause(); } catch { /* already gone */ }
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
