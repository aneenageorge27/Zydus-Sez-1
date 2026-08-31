/**
 * Header search — find a meter by name and hand it to the canvas.
 *
 * Matching is a plain case-insensitive substring test: the titles are short
 * and a reader is typically typing a feeder number (`23FA`), a plant word
 * (`CHILLER`) or a panel (`UPS`). Matches are ranked so the ones that read
 * as the answer come first — title start, then word start, then anywhere in
 * the title, then the breadcrumb — because several cards in the diagram carry
 * the same name and only their place in the tree tells them apart.
 */

const MAX_RESULTS = 8;

const esc = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The query wrapped in a <mark> wherever it sits in `text`. */
function mark(text, query) {
  const i = text.toLowerCase().indexOf(query);
  if (i < 0) return esc(text);
  return (
    esc(text.slice(0, i)) +
    `<mark>${esc(text.slice(i, i + query.length))}</mark>` +
    esc(text.slice(i + query.length))
  );
}

/** Lower is better; -1 drops the item. */
function rank(item, query) {
  const i = item.title.toLowerCase().indexOf(query);
  if (i === 0) return 0;
  if (i > 0) return /[\s(-]/.test(item.title[i - 1]) ? 1 : 2;
  return item.path.toLowerCase().includes(query) ? 3 : -1;
}

/**
 * @param items  [{ node, title, path, tone }]
 * @param onPick (node) -> void, called when a row is chosen
 */
export function initSearch(items, onPick, tones) {
  const input = document.getElementById('search');
  const clear = document.getElementById('searchClear');
  const list = document.getElementById('searchResults');

  let hits = [];
  let active = -1;

  function close() {
    list.hidden = true;
    list.textContent = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    hits = [];
    active = -1;
  }

  function highlight(next) {
    const rows = list.querySelectorAll('.result');
    if (!rows.length) return;
    active = (next + rows.length) % rows.length;
    rows.forEach((row, i) => row.setAttribute('aria-selected', String(i === active)));
    input.setAttribute('aria-activedescendant', rows[active].id);
    rows[active].scrollIntoView({ block: 'nearest' });
  }

  function pick(i) {
    const hit = hits[i];
    if (!hit) return;
    close();
    /* Let the canvas own the keyboard again — arrows pan the diagram. */
    input.blur();
    onPick(hit.node);
  }

  function search(query) {
    hits = items
      .map((item) => ({ item, r: rank(item, query) }))
      .filter((h) => h.r >= 0)
      .sort((a, b) => a.r - b.r || a.item.title.length - b.item.title.length)
      .slice(0, MAX_RESULTS)
      .map((h) => h.item);

    if (!hits.length) {
      list.innerHTML = `<li class="results__empty">No meter matches “${esc(query)}”</li>`;
    } else {
      list.innerHTML = hits
        .map((hit, i) => {
          const tone = tones[hit.tone] || {};
          return `<li class="result" id="result-${i}" role="option" aria-selected="false" data-i="${i}">
            <span class="result__tone" style="background:${tone.bg};border-color:${tone.border}"></span>
            <span class="result__text">
              <span class="result__title">${mark(hit.title, query)}</span>
              <span class="result__path">${mark(hit.path, query)}</span>
            </span>
          </li>`;
        })
        .join('');
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
    if (hits.length) highlight(0);
  }

  function refresh() {
    const query = input.value.trim().toLowerCase();
    clear.hidden = !input.value;
    if (!query) close();
    else search(query);
  }

  input.addEventListener('input', refresh);
  input.addEventListener('focus', refresh);

  input.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown':
        highlight(active + 1);
        break;
      case 'ArrowUp':
        highlight(active - 1);
        break;
      case 'Enter':
        pick(active < 0 ? 0 : active);
        break;
      case 'Escape':
        if (list.hidden) {
          input.value = '';
          clear.hidden = true;
          input.blur();
        }
        close();
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  list.addEventListener('mousedown', (e) => {
    /* Ahead of the input's blur, so the row is still there to be read. */
    const row = e.target.closest('.result');
    if (row) pick(Number(row.dataset.i));
  });

  clear.addEventListener('click', () => {
    input.value = '';
    clear.hidden = true;
    close();
    input.focus();
  });

  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.topbar__search')) close();
  });
}
