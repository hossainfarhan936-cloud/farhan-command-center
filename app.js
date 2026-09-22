/* Content Center — personal dashboard.
   Phase 2: state lives in Cloudflare D1 via the /api Pages Function (same origin).
   localStorage is kept as an instant mirror + offline fallback so nothing is lost. */

const STORE = 'cc_state_v1';
const API = '/api';

const TABS = [
  ['today', 'Today'],
  ['todo', 'To-do'],
  ['content', 'Content'],
  ['leads', 'Leads'],
  ['clients', 'Clients'],
  ['vault', 'Memory Vault'],
  ['learn', 'Learn'],
  ['ideas', 'Ideas'],
  ['research', 'Research'],
  ['team', 'Team'],
];

const CONTENT_STAGES = ['Idea', 'Recorded', 'Editing', 'Ready', 'Published'];
const LEAD_STAGES = ['New', 'Prospect', 'Interested', 'Proposal Sent', 'Nurture', 'Client', 'Lost'];

const SEED_BOOKS = [
  { title: 'The E-Myth Revisited', author: 'Michael E. Gerber', note: 'Work ON the business, not just IN it. Build systems a replaceable employee could run.' },
  { title: 'Atomic Habits', author: 'James Clear', note: 'Identity first: every action is a vote for the person you want to become.' },
  { title: '$100M Offers', author: 'Alex Hormozi', note: 'Make an offer so good people feel stupid saying no: raise value, lower risk.' },
  { title: 'The Almanack of Naval Ravikant', author: 'Eric Jorgenson', note: 'Escape competition through authenticity. Play long-term games with long-term people.' },
  { title: 'Rich Dad Poor Dad', author: 'Robert Kiyosaki', note: 'Buy assets, not liabilities. Your time is the only real capital.' },
  { title: 'Zero to One', author: 'Peter Thiel', note: 'Competition is for losers; build a monopoly in a niche small enough to own.' },
];

const SEED_WEIRD = [
  'An octopus has three hearts, blue blood, and a distributed brain — two-thirds of its neurons are in its arms.',
  'Some trees shed their branches instead of their leaves — deciduous trees drop whole twigs to save energy.',
  'Honey never spoils: sealed pots from Egyptian tombs are still edible after 3,000 years.',
  'Bananas are berries; strawberries are not. Botanically, a berry forms from a single flower ovary.',
  'Sharks existed before trees did — by roughly 50 million years.',
  'The Eiffel Tower can grow about 15 cm taller in summer as the iron expands.',
];

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const now = () => new Date().toISOString();
const dayKey = () => new Date().toISOString().slice(0, 10);
const dayOfYear = () => {
  const d = new Date();
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
};
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fmt = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
};

/* ---------------- state ---------------- */
function defaults() {
  return {
    meta: { title: "Farhan's Command Center", created: now() },
    todos: [], vault: [], content: [], leads: [], clients: [], contacts: [],
    ideas: [], research: [],
    books: SEED_BOOKS.map((b) => ({ id: uid(), ...b, created: now() })),
    weird: SEED_WEIRD.map((f) => ({ id: uid(), fact: f, created: now() })),
    counters: { booksSeen: dayOfYear() % SEED_BOOKS.length, weirdSeen: dayOfYear() % SEED_WEIRD.length, lastDay: dayKey() },
  };
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    return Object.assign(defaults(), parsed, { meta: Object.assign(defaults().meta, parsed.meta || {}) });
  } catch (e) {
    console.warn('local load failed', e);
    return defaults();
  }
}

let state = loadLocal();
let tab = 'today';
let query = '';
let online = false;          // is the API reachable?
let syncStatus = 'idle';     // idle | saving | saved | error | offline
let lastSyncAt = null;
let sessionEmail = '';       // login email reported by the server once authenticated
let lastViewKey = '';        // tab+query of the previous render, to animate only real view changes
let justToggled = null;      // id of the to-do just ticked, so its row can pop
let dailyContent = null;     // today's book lesson + weird fact from the daily job (D1)

function mirrorLocal() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); }
  catch (e) { console.warn('mirror failed', e); }
}

function setSync(status, at) {
  syncStatus = status;
  if (at) lastSyncAt = at;
  const el = document.getElementById('sync-badge');
  if (!el) return;
  const map = { idle: '—', saving: 'saving…', saved: 'synced', error: 'sync error', offline: 'offline (local only)' };
  el.textContent = map[status] || status;
  const cls = status === 'saved' ? ' accent' : (status === 'error' || status === 'offline') ? ' warn' : status === 'saving' ? ' pulsing' : '';
  el.className = 'pill' + cls;
  el.title = lastSyncAt ? 'Last saved ' + new Date(lastSyncAt).toLocaleString() : '';
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON */ }
  return { ok: res.ok, status: res.status, data };
}

let saveTimer = null;
function save() {
  mirrorLocal();                       // always keep a local copy first
  if (!online) { setSync('offline'); return; }
  clearTimeout(saveTimer);
  setSync('saving');
  saveTimer = setTimeout(pushState, 500);
}

async function pushState() {
  try {
    const r = await api('/state', { method: 'PUT', body: JSON.stringify({ state }) });
    if (r.ok) { setSync('saved', r.data && r.data.updatedAt); return; }
    if (r.status === 401) { showLogin('Session expired — sign in again.'); return; }
    setSync('error');
  } catch (e) { online = false; setSync('offline'); }
}

async function pullState() {
  const r = await api('/state');
  if (r.status === 401) return { auth: false };
  if (!r.ok) return { auth: true, offline: true };
  return { auth: true, state: r.data.state, updatedAt: r.data.updatedAt };
}

/* today's book lesson + weird fact, written by the daily job */
async function loadDaily() {
  try {
    const r = await api('/daily');
    if (r.ok) dailyContent = r.data;
  } catch (e) { /* keep the local rotation if the call fails */ }
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 1800);
}

/* daily rotation — advances once per calendar day */
function dailyPick() {
  const today = dayKey();
  if (state.counters.lastDay !== today) {
    state.counters.booksSeen = (state.counters.booksSeen + 1) % Math.max(1, state.books.length);
    state.counters.weirdSeen = (state.counters.weirdSeen + 1) % Math.max(1, state.weird.length);
    state.counters.lastDay = today;
    save();
  }
  return {
    book: state.books.length ? state.books[state.counters.booksSeen % state.books.length] : null,
    weird: state.weird.length ? state.weird[state.counters.weirdSeen % state.weird.length] : null,
  };
}

/* ---------------- render ---------------- */
function render() {
  document.getElementById('brand-name').textContent = state.meta.title || "Farhan's Command Center";
  document.title = state.meta.title || 'Command Center';
  renderTabs();
  renderView();
}

function renderTabs() {
  document.getElementById('tabs').innerHTML = TABS.map(([id, label]) => {
    const n = countFor(id);
    return `<button class="tab${id === tab && !query ? ' active' : ''}" data-action="tab" data-id="${id}">${esc(label)}${n ? ` <span class="pill">${n}</span>` : ''}</button>`;
  }).join('');
}

function countFor(id) {
  if (id === 'todo') return state.todos.filter((t) => !t.done).length || '';
  if (id === 'leads') return state.leads.filter((l) => !['Client', 'Lost'].includes(l.stage)).length || '';
  if (id === 'content') return state.content.filter((c) => c.stage !== 'Published').length || '';
  if (id === 'clients') return state.clients.filter((c) => c.status !== 'Expired').length || '';
  if (id === 'vault') return state.vault.length || '';
  if (id === 'ideas') return state.ideas.length || '';
  return '';
}

function renderView() {
  const el = document.getElementById('view');
  const key = tab + '|' + query;
  const changed = key !== lastViewKey;
  lastViewKey = key;
  if (query) { el.innerHTML = searchView(); if (changed) animateIn(el); return; }
  const views = {
    today: viewToday, todo: viewTodo, content: viewContent, leads: viewLeads,
    clients: viewClients, vault: viewVault, learn: viewLearn,
    ideas: viewIdeas, research: viewResearch, team: viewTeam,
  };
  el.innerHTML = (views[tab] || viewToday)();
  if (changed) animateIn(el);
}

/* staggered card entrance — restart by forcing a reflow so it replays on each view change */
function animateIn(el) {
  const first = el.firstElementChild;
  if (!first) return;
  first.classList.remove('anim-in');
  void first.offsetWidth;
  first.classList.add('anim-in');
}

/* play a row out before mutating state, so deletes do not just blink away */
function animateOut(node, done) {
  if (!node) { done(); return; }
  node.classList.add('removing');
  setTimeout(done, 190);
}

const rowOf = (node) => (node ? node.closest('li, .item, .kv') : null);

/* ---------- Today ---------- */
function viewToday() {
  const d = dailyPick();
  const daily = (dailyContent && dailyContent.today) || null;
  const dailyBook = daily ? {
    day: daily.day, ord: daily.book_ord, title: daily.book_title,
    author: daily.book_author, lesson: daily.book_lesson,
  } : null;
  const weirdText = (daily && daily.weird) || (d.weird ? d.weird.fact : null);
  const open = state.todos.filter((t) => !t.done);
  const dueToday = open.filter((t) => t.due && t.due === dayKey());
  const overdue = open.filter((t) => t.due && t.due < dayKey());
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const activeLeads = state.leads.filter((l) => !['Client', 'Lost'].includes(l.stage));
  const inPipeline = state.content.filter((c) => c.stage !== 'Published');

  return `
  <div class="grid">
    <div class="card wide">
      <div class="card-head"><h3>${esc(dateStr)}</h3>
        <span class="pill accent">${open.length} open · ${dueToday.length} due today · ${overdue.length} overdue</span></div>
      <form data-form="quick-todo" class="inline-form">
        <input type="text" name="text" placeholder="Quick add a task…" required>
        <input type="date" name="due" title="Due date">
        <button class="btn primary" type="submit">Add</button>
      </form>
      <ul class="list">
        ${open.slice(0, 6).map(todoLi).join('') || '<div class="empty">Nothing open. Add something above.</div>'}
      </ul>
    </div>

    <div class="card">
      <div class="card-head"><h3>📖 Book lesson of the day</h3><span class="pill${dailyBook ? ' accent' : ''}">${dailyBook ? 'day ' + esc(dailyBook.day) : 'rotates daily'}</span></div>
      ${dailyBook
        ? `<div class="kv">${esc(dailyBook.lesson || '')}<div class="src">${esc(dailyBook.title)} — ${esc(dailyBook.author || '')}${dailyBook.ord ? ` · book #${esc(dailyBook.ord)} of the rotation` : ''}</div></div>`
        : (d.book ? `<div class="kv">${esc(d.book.note || '')}<div class="src">${esc(d.book.title)} — ${esc(d.book.author || '')}</div></div>` : '<div class="empty">Add a book in Learn →</div>')}
    </div>

    <div class="card">
      <div class="card-head"><h3>🧠 Weird knowledge</h3><span class="pill${dailyBook ? ' accent' : ''}">${dailyBook ? 'day ' + esc(dailyBook.day) : 'rotates daily'}</span></div>
      ${weirdText ? `<div class="kv">${esc(weirdText)}</div>` : '<div class="empty">Add a fact in Learn →</div>'}
    </div>

    <div class="card">
      <div class="card-head"><h3>📈 Snapshot</h3></div>
      <ul class="list">
        <li><span class="txt">Tasks open<small>across all to-dos</small></span><span class="pill accent">${open.length}</span></li>
        <li><span class="txt">Leads in pipeline<small>not yet client or lost</small></span><span class="pill accent">${activeLeads.length}</span></li>
        <li><span class="txt">Content not published<small>idea → ready</small></span><span class="pill accent">${inPipeline.length}</span></li>
        <li><span class="txt">Memory vault entries<small>journal items</small></span><span class="pill accent">${state.vault.length}</span></li>
        <li><span class="txt">Idea inbox<small>unprocessed ideas</small></span><span class="pill accent">${state.ideas.length}</span></li>
      </ul>
    </div>

    <div class="card">
      <div class="card-head"><h3>🔎 Today's leads to move</h3><a class="pill" href="#" data-action="tab" data-id="leads">open pipeline →</a></div>
      ${activeLeads.slice(0, 5).map((l) => `<div class="kv">${esc(l.name || l.business || 'Unnamed')}<div class="src">${esc(l.stage)}${l.value ? ' · worth ' + esc(l.value) : ''}</div></div>`).join('') || '<div class="empty">No active leads.</div>'}
    </div>
  </div>`;
}

/* ---------- To-do ---------- */
function todoLi(t) {
  const overdue = t.due && !t.done && t.due < dayKey();
  const pop = t.id === justToggled ? ' pop' : '';
  return `<li class="${t.done ? 'done' : ''}${pop}">
    <input class="checkbox" type="checkbox" data-action="toggle-todo" data-id="${t.id}" ${t.done ? 'checked' : ''}>
    <span class="txt">${esc(t.text)}<small>${t.due ? (overdue ? '⚠ overdue ' : 'due ') + esc(t.due) : 'no due date'}${t.done && t.doneAt ? ' · done ' + esc(fmt(t.doneAt)) : ''}</small></span>
    <span class="actions"><button class="btn mini" data-action="del-todo" data-id="${t.id}">✕</button></span>
  </li>`;
}

function viewTodo() {
  const open = state.todos.filter((t) => !t.done);
  const done = state.todos.filter((t) => t.done);
  return `
  <div class="grid">
    <div class="card wide">
      <div class="card-head"><h3>To-do</h3><span class="pill accent">${open.length} open · ${done.length} done</span></div>
      <form data-form="todo" class="inline-form">
        <input type="text" name="text" placeholder="What needs doing?" required>
        <input type="date" name="due">
        <button class="btn primary" type="submit">Add task</button>
      </form>
    </div>
    <div class="card">
      <h3>Open</h3>
      <ul class="list">${open.map(todoLi).join('') || '<div class="empty">All clear.</div>'}</ul>
    </div>
    <div class="card">
      <div class="card-head"><h3>Completed</h3>${done.length ? '<button class="btn mini" data-action="clear-done">clear</button>' : ''}</div>
      <ul class="list">${done.slice(0, 40).map(todoLi).join('') || '<div class="empty">Nothing completed yet.</div>'}</ul>
    </div>
  </div>`;
}

/* ---------- Content calendar ---------- */
function viewContent() {
  return `
  <div class="grid">
    <div class="card wide">
      <div class="card-head"><h3>Content calendar</h3><span class="pill accent">${state.content.length} items</span></div>
      <form data-form="content" class="inline-form">
        <input type="text" name="title" placeholder="Video / post title" required>
        <input type="date" name="due">
        <button class="btn primary" type="submit">Add idea</button>
      </form>
    </div>
    <div class="card wide">
      <div class="kanban">
        ${CONTENT_STAGES.map((stage) => `
          <div class="col">
            <h4>${esc(stage)}</h4>
            ${state.content.filter((c) => c.stage === stage).map((c) => `
              <div class="item">
                <div>${esc(c.title)}</div>
                ${c.due ? `<small class="muted">📅 ${esc(c.due)}</small>` : ''}
                <div class="actions">
                  <select class="btn mini" data-action="move-content" data-id="${c.id}">
                    ${CONTENT_STAGES.map((s) => `<option ${s === c.stage ? 'selected' : ''}>${esc(s)}</option>`).join('')}
                  </select>
                  <button class="btn mini" data-action="del-content" data-id="${c.id}">✕</button>
                </div>
              </div>`).join('') || '<div class="empty">—</div>'}
          </div>`).join('')}
      </div>
    </div>
  </div>`;
}

/* ---------- Leads ---------- */
function viewLeads() {
  return `
  <div class="grid">
    <div class="card wide">
      <div class="card-head"><h3>Leads pipeline</h3><span class="pill accent">${state.leads.length} leads</span></div>
      <form data-form="lead" class="two-col">
        <input type="text" name="name" placeholder="Contact name" required>
        <input type="text" name="business" placeholder="Business name">
        <input type="text" name="contact" placeholder="Email or phone">
        <input type="text" name="source" placeholder="Where you found them">
        <input type="text" name="services" placeholder="Services they may need">
        <input type="text" name="value" placeholder="Potential value (e.g. ৳50k/mo)">
        <div style="grid-column:1/-1"><textarea name="notes" placeholder="Opportunity detail / notes"></textarea></div>
        <div style="grid-column:1/-1"><button class="btn primary" type="submit">Add lead</button></div>
      </form>
    </div>
    <div class="card wide">
      <div class="kanban">
        ${LEAD_STAGES.map((stage) => `
          <div class="col">
            <h4>${esc(stage)}</h4>
            ${state.leads.filter((l) => l.stage === stage).map((l) => `
              <div class="item">
                <div>${esc(l.name || l.business || 'Unnamed')}</div>
                <small class="muted">${esc(l.business && l.name ? l.business : '')}${l.value ? ' · ' + esc(l.value) : ''}</small>
                ${l.contact ? `<small class="muted">📞 ${esc(l.contact)}</small>` : ''}
                <div class="actions">
                  <select class="btn mini" data-action="move-lead" data-id="${l.id}">
                    ${LEAD_STAGES.map((s) => `<option ${s === l.stage ? 'selected' : ''}>${esc(s)}</option>`).join('')}
                  </select>
                  <button class="btn mini" data-action="promote-client" data-id="${l.id}" title="Turn into client">→ client</button>
                  <button class="btn mini" data-action="del-lead" data-id="${l.id}">✕</button>
                </div>
              </div>`).join('') || '<div class="empty">—</div>'}
          </div>`).join('')}
      </div>
    </div>
  </div>`;
}

/* ---------- Clients ---------- */
function viewClients() {
  return `
  <div class="grid">
    <div class="card wide">
      <div class="card-head"><h3>Clients</h3><span class="pill accent">${state.clients.length} total</span></div>
      <form data-form="client" class="two-col">
        <input type="text" name="name" placeholder="Client / company" required>
        <input type="text" name="services" placeholder="Services you deliver">
        <input type="text" name="value" placeholder="Monthly value">
        <input type="text" name="since" placeholder="Working since (e.g. Mar 2026)">
        <div style="grid-column:1/-1"><textarea name="notes" placeholder="Notes: keywords, ad spend, ranking status…"></textarea></div>
        <div style="grid-column:1/-1"><button class="btn primary" type="submit">Add client</button></div>
      </form>
    </div>
    <div class="card wide">
      <ul class="list">
        ${state.clients.map((c) => `
          <li>
            <span class="txt"><strong>${esc(c.name)}</strong> <span class="pill${c.status === 'Active' ? ' accent' : ''}">${esc(c.status || 'Active')}</span>
              <small>${esc(c.services || '')}${c.value ? ' · ' + esc(c.value) : ''}${c.since ? ' · since ' + esc(c.since) : ''}</small>
              ${c.notes ? `<small>${esc(c.notes)}</small>` : ''}
            </span>
            <span class="actions">
              <button class="btn mini" data-action="toggle-client" data-id="${c.id}">${c.status === 'Expired' ? 'reactivate' : 'expire'}</button>
              <button class="btn mini" data-action="del-client" data-id="${c.id}">✕</button>
            </span>
          </li>`).join('') || '<div class="empty">No clients yet. Add one above or promote a lead.</div>'}
      </ul>
    </div>
  </div>`;
}

/* ---------- Memory vault ---------- */
function viewVault() {
  return `
  <div class="grid">
    <div class="card wide">
      <div class="card-head"><h3>Memory vault</h3><span class="pill accent">${state.vault.length} entries</span></div>
      <p class="muted">A searchable journal. Write anything you want to remember and find it later with the search box at the top.</p>
      <form data-form="vault">
        <textarea name="text" placeholder="What's on your mind? (decision, idea, plan, reminder…)" required></textarea>
        <div class="row">
          <input type="text" name="tags" placeholder="tags, comma separated (optional)">
          <button class="btn primary" type="submit">Save to vault</button>
        </div>
      </form>
    </div>
    <div class="card wide">
      <h3>Recent entries</h3>
      <ul class="list">
        ${state.vault.slice().reverse().slice(0, 60).map((v) => `
          <li><span class="txt">${esc(v.text)}<small>${esc(fmt(v.created))}${v.tags ? ' · ' + esc(v.tags) : ''}</small></span>
            <span class="actions"><button class="btn mini" data-action="del-vault" data-id="${v.id}">✕</button></span></li>`).join('') || '<div class="empty">Empty vault. Start writing.</div>'}
      </ul>
    </div>
  </div>`;
}

/* ---------- Learn (books + weird knowledge) ---------- */
function viewLearn() {
  return `
  <div class="grid">
    <div class="card">
      <div class="card-head"><h3>📚 Books</h3><span class="pill accent">${state.books.length}</span></div>
      <form data-form="book">
        <input type="text" name="title" placeholder="Book title" required>
        <div class="row"><input type="text" name="author" placeholder="Author"></div>
        <textarea name="note" placeholder="Key lesson (one or two lines)" required></textarea>
        <div class="row"><button class="btn primary" type="submit">Add book</button></div>
      </form>
      <ul class="list">
        ${state.books.map((b) => `<li><span class="txt">${esc(b.title)}<small>${esc(b.author || '')} — ${esc(b.note || '')}</small></span>
          <span class="actions"><button class="btn mini" data-action="del-book" data-id="${b.id}">✕</button></span></li>`).join('')}
      </ul>
    </div>
    <div class="card">
      <div class="card-head"><h3>🧠 Weird knowledge</h3><span class="pill accent">${state.weird.length}</span></div>
      <form data-form="weird">
        <textarea name="fact" placeholder="One strange fact to learn from" required></textarea>
        <div class="row"><button class="btn primary" type="submit">Add fact</button></div>
      </form>
      <ul class="list">
        ${state.weird.map((w) => `<li><span class="txt">${esc(w.fact)}</span>
          <span class="actions"><button class="btn mini" data-action="del-weird" data-id="${w.id}">✕</button></span></li>`).join('')}
      </ul>
    </div>
  </div>`;
}

/* ---------- Ideas ---------- */
function viewIdeas() {
  return `
  <div class="grid">
    <div class="card wide">
      <div class="card-head"><h3>Idea inbox</h3><span class="pill accent">${state.ideas.length}</span></div>
      <form data-form="idea" class="inline-form">
        <input type="text" name="text" placeholder="Business or video idea…" required>
        <select name="kind"><option>Video</option><option>Business</option><option>Product</option><option>Other</option></select>
        <button class="btn primary" type="submit">Add</button>
      </form>
    </div>
    <div class="card wide">
      <ul class="list">
        ${state.ideas.slice().reverse().map((i) => `
          <li><span class="txt">${esc(i.text)}<small>${esc(i.kind)} · ${esc(fmt(i.created))}</small></span>
          <span class="actions">
            <button class="btn mini" data-action="idea-to-content" data-id="${i.id}" title="Send to content calendar">→ content</button>
            <button class="btn mini" data-action="idea-to-research" data-id="${i.id}" title="Research this">→ research</button>
            <button class="btn mini" data-action="del-idea" data-id="${i.id}">✕</button>
          </span></li>`).join('') || '<div class="empty">No ideas yet.</div>'}
      </ul>
    </div>
  </div>`;
}

/* ---------- Research ---------- */
function viewResearch() {
  return `
  <div class="grid">
    <div class="card wide">
      <div class="card-head"><h3>Research queue</h3><span class="pill accent">${state.research.length}</span></div>
      <p class="muted">Queue a topic here. Each item gets a ready-to-send prompt you can paste to the agent (Telegram) — the AI half is wired in phase 2.</p>
      <form data-form="research" class="inline-form">
        <input type="text" name="topic" placeholder="Topic (e.g. why most people never become wealthy)" required>
        <select name="kind"><option>YouTube script</option><option>Business idea</option><option>Market check</option></select>
        <button class="btn primary" type="submit">Add</button>
      </form>
    </div>
    <div class="card wide">
      ${state.research.slice().reverse().map((r) => `
        <div class="kv">
          <strong>${esc(r.topic)}</strong> <span class="pill">${esc(r.kind)}</span> <span class="pill${r.status === 'Done' ? ' accent' : ''}">${esc(r.status)}</span>
          <div class="src">Prompt: ${esc(promptFor(r))}</div>
          <div class="actions" style="margin-top:.5rem">
            <button class="btn mini" data-action="copy-prompt" data-id="${r.id}">copy prompt</button>
            <button class="btn mini" data-action="toggle-research" data-id="${r.id}">${r.status === 'Done' ? 'mark queued' : 'mark done'}</button>
            <button class="btn mini" data-action="del-research" data-id="${r.id}">✕</button>
          </div>
          ${r.output ? `<div class="src" style="margin-top:.5rem">${esc(r.output)}</div>` : ''}
        </div>`).join('') || '<div class="empty">Nothing queued.</div>'}
    </div>
  </div>`;
}

function promptFor(r) {
  if (r.kind === 'YouTube script') return `Write a 15-minute YouTube script on: ${r.topic}. Structure: hook, story, 3 teaching blocks, payoff, CTA.`;
  if (r.kind === 'Business idea') return `Research whether this business is worth starting: ${r.topic}. Cover competitors, whether it already works in nearby countries, startup cost, first 5 steps, and risks.`;
  return `Research the market for: ${r.topic}. Size, competitors, pricing, risks, and 3 concrete opportunities.`;
}

/* ---------- Team ---------- */
function viewTeam() {
  return `
  <div class="grid">
    <div class="card wide">
      <div class="card-head"><h3>Team &amp; contacts</h3><span class="pill accent">${state.contacts.length}</span></div>
      <form data-form="contact" class="two-col">
        <input type="text" name="name" placeholder="Name" required>
        <input type="text" name="role" placeholder="Role">
        <input type="text" name="phone" placeholder="Phone / bKash">
        <input type="text" name="email" placeholder="Email">
        <div style="grid-column:1/-1"><input type="text" name="notes" placeholder="Notes (salary, bank, etc.)"></div>
        <div style="grid-column:1/-1"><button class="btn primary" type="submit">Add contact</button></div>
      </form>
    </div>
    <div class="card wide">
      <ul class="list">
        ${state.contacts.map((c) => `
          <li><span class="txt">${esc(c.name)} <span class="pill">${esc(c.role || '')}</span>
            <small>${esc(c.phone || '')}${c.email ? ' · ' + esc(c.email) : ''}</small>
            ${c.notes ? `<small>${esc(c.notes)}</small>` : ''}</span>
            <span class="actions"><button class="btn mini" data-action="del-contact" data-id="${c.id}">✕</button></span></li>`).join('') || '<div class="empty">No contacts yet.</div>'}
      </ul>
    </div>
  </div>`;
}

/* ---------- search ---------- */
function searchView() {
  const q = query.toLowerCase();
  const hit = (s) => String(s || '').toLowerCase().includes(q);
  const parts = [];
  const add = (label, rows) => { if (rows.length) parts.push(`<div class="card wide"><h3>${label} <span class="pill accent">${rows.length}</span></h3><ul class="list">${rowLi(rows)}</ul></div>`); };
  add('To-dos', state.todos.filter((t) => hit(t.text)).map((t) => [t.text, t.done ? 'done' : t.due ? 'due ' + t.due : '']));
  add('Memory vault', state.vault.filter((v) => hit(v.text) || hit(v.tags)).map((v) => [v.text, fmt(v.created) + (v.tags ? ' · ' + v.tags : '')]));
  add('Content', state.content.filter((c) => hit(c.title)).map((c) => [c.title, c.stage]));
  add('Leads', state.leads.filter((l) => hit(l.name) || hit(l.business) || hit(l.notes) || hit(l.contact)).map((l) => [l.name || l.business, l.stage]));
  add('Clients', state.clients.filter((c) => hit(c.name) || hit(c.notes)).map((c) => [c.name, c.status || 'Active']));
  add('Ideas', state.ideas.filter((i) => hit(i.text)).map((i) => [i.text, i.kind]));
  add('Books', state.books.filter((b) => hit(b.title) || hit(b.note) || hit(b.author)).map((b) => [b.title, b.author + ' — ' + b.note]));
  add('Weird knowledge', state.weird.filter((w) => hit(w.fact)).map((w) => [w.fact, '']));
  add('Contacts', state.contacts.filter((c) => hit(c.name) || hit(c.phone) || hit(c.email) || hit(c.role)).map((c) => [c.name, [c.role, c.phone, c.email].filter(Boolean).join(' · ')]));
  add('Research', state.research.filter((r) => hit(r.topic)).map((r) => [r.topic, r.kind + ' · ' + r.status]));
  if (!parts.length) return `<div class="card wide"><h3>No matches for “${esc(query)}”</h3><p class="muted">Try a shorter word.</p></div>`;
  return `<div class="grid">${parts.join('')}</div>`;
}
const rowLi = (rows) => rows.map(([a, b]) => `<li><span class="txt">${esc(a)}${b ? `<small>${esc(b)}</small>` : ''}</span></li>`).join('');

/* ---------------- events ---------------- */
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const { action, id } = target.dataset;
  if (action === 'tab') { e.preventDefault(); tab = id; query = ''; document.getElementById('search').value = ''; render(); return; }

  if (action === 'toggle-todo') {
    const t = state.todos.find((x) => x.id === id);
    if (t) { t.done = !t.done; t.doneAt = t.done ? now() : null; }
    justToggled = id;                       // row plays a small pop on re-render
  }
  /* deletes play the row out first, then mutate */
  const delTodo = (key) => {
    animateOut(rowOf(target), () => {
      state[key] = state[key].filter((x) => x.id !== id);
      save(); render();
    });
    return;
  };
  if (action === 'del-todo') return delTodo('todos');
  if (action === 'del-vault') return delTodo('vault');
  if (action === 'del-content') return delTodo('content');
  if (action === 'del-lead') return delTodo('leads');
  if (action === 'del-client') return delTodo('clients');
  if (action === 'del-book') return delTodo('books');
  if (action === 'del-weird') return delTodo('weird');
  if (action === 'del-idea') return delTodo('ideas');
  if (action === 'del-research') return delTodo('research');
  if (action === 'del-contact') return delTodo('contacts');
  if (action === 'clear-done') {
    document.querySelectorAll('#view li.done').forEach((li) => li.classList.add('removing'));
    setTimeout(() => { state.todos = state.todos.filter((x) => !x.done); save(); render(); }, 190);
    return;
  }
  if (action === 'toggle-client') {
    const c = state.clients.find((x) => x.id === id);
    if (c) c.status = c.status === 'Expired' ? 'Active' : 'Expired';
  }
  if (action === 'toggle-research') {
    const r = state.research.find((x) => x.id === id);
    if (r) r.status = r.status === 'Done' ? 'Queued' : 'Done';
  }
  if (action === 'promote-client') {
    const l = state.leads.find((x) => x.id === id);
    if (l) {
      state.clients.push({ id: uid(), name: l.business || l.name, services: l.services || '', value: l.value || '', since: new Date().toLocaleDateString(undefined, { month: 'short', year: 'numeric' }), notes: l.notes || '', status: 'Active', created: now() });
      l.stage = 'Client';
      toast('Lead promoted to client');
    }
  }
  if (action === 'idea-to-content') {
    const i = state.ideas.find((x) => x.id === id);
    if (i) { state.content.push({ id: uid(), title: i.text, stage: 'Idea', due: '', created: now() }); state.ideas = state.ideas.filter((x) => x.id !== id); toast('Moved to content calendar'); }
  }
  if (action === 'idea-to-research') {
    const i = state.ideas.find((x) => x.id === id);
    if (i) { state.research.push({ id: uid(), topic: i.text, kind: i.kind === 'Business' ? 'Business idea' : 'YouTube script', status: 'Queued', output: '', created: now() }); toast('Queued for research'); }
  }
  if (action === 'copy-prompt') {
    const r = state.research.find((x) => x.id === id);
    if (r) {
      navigator.clipboard.writeText(promptFor(r)).then(() => toast('Prompt copied')).catch(() => toast('Copy failed — select manually'));
    }
  }
  if (action === 'btn-export' || action === 'btn-import' || action === 'btn-wipe' || action === 'btn-close') { /* handled below */ }
  save(); render();
});

document.addEventListener('change', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const { action, id } = t.dataset;
  if (action === 'move-content') { const c = state.content.find((x) => x.id === id); if (c) c.stage = t.value; }
  if (action === 'move-lead') { const l = state.leads.find((x) => x.id === id); if (l) l.stage = t.value; }
  save(); render();
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  const v = (n) => (form.elements[n] ? String(form.elements[n].value).trim() : '');
  if (kind === 'todo' || kind === 'quick-todo') {
    state.todos.unshift({ id: uid(), text: v('text'), due: v('due'), done: false, created: now() });
    if (kind === 'quick-todo') { toast('Task added'); form.reset(); save(); render(); return; }
  }
  if (kind === 'vault') state.vault.push({ id: uid(), text: v('text'), tags: v('tags'), created: now() });
  if (kind === 'content') state.content.push({ id: uid(), title: v('title'), stage: 'Idea', due: v('due'), created: now() });
  if (kind === 'lead') state.leads.push({ id: uid(), name: v('name'), business: v('business'), contact: v('contact'), source: v('source'), services: v('services'), value: v('value'), notes: v('notes'), stage: 'New', created: now() });
  if (kind === 'client') state.clients.push({ id: uid(), name: v('name'), services: v('services'), value: v('value'), since: v('since'), notes: v('notes'), status: 'Active', created: now() });
  if (kind === 'book') state.books.push({ id: uid(), title: v('title'), author: v('author'), note: v('note'), created: now() });
  if (kind === 'weird') state.weird.push({ id: uid(), fact: v('fact'), created: now() });
  if (kind === 'idea') state.ideas.push({ id: uid(), text: v('text'), kind: v('kind'), created: now() });
  if (kind === 'research') state.research.push({ id: uid(), topic: v('topic'), kind: v('kind'), status: 'Queued', output: '', created: now() });
  if (kind === 'contact') state.contacts.push({ id: uid(), name: v('name'), role: v('role'), phone: v('phone'), email: v('email'), notes: v('notes'), created: now() });
  form.reset();
  save(); render();
  toast('Saved');
});

document.getElementById('search').addEventListener('input', (e) => {
  query = e.target.value.trim();
  render();
});

/* settings modal */
const modal = document.getElementById('modal');
document.getElementById('btn-settings').addEventListener('click', () => {
  document.getElementById('set-title').value = state.meta.title || '';
  const ef = document.getElementById('email-form');
  if (ef && sessionEmail) ef.elements.email.value = sessionEmail;
  modal.hidden = false;
});
document.getElementById('btn-close').addEventListener('click', () => { modal.hidden = true; });
document.getElementById('set-title').addEventListener('change', (e) => {
  state.meta.title = e.target.value.trim() || "Farhan's Command Center"; save(); render();
});
document.getElementById('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `command-center-${dayKey()}.json`;
  a.click(); URL.revokeObjectURL(a.href);
  toast('Exported');
});
document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-import').click());
document.getElementById('file-import').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try { state = Object.assign(defaults(), JSON.parse(rd.result)); save(); render(); toast('Imported'); }
    catch (err) { toast('Invalid file'); }
  };
  rd.readAsText(f);
});
document.getElementById('btn-wipe').addEventListener('click', () => {
  if (confirm('Erase ALL dashboard data on the server AND this browser? This cannot be undone.')) {
    state = defaults(); save(); render(); modal.hidden = true; toast('Erased');
  }
});

/* ---------------- auth + boot ---------------- */
function showLogin(msg) {
  const el = document.getElementById('login');
  el.hidden = false;
  document.getElementById('app-shell').hidden = true;
  const card = document.getElementById('login-form');
  if (card) {
    card.classList.remove('exit');
    card.classList.remove('enter');
    void card.offsetWidth;                 // restart the entrance animation
    card.classList.add('enter');
    if (msg) { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); }
  }
  const err = document.getElementById('login-error');
  if (err) { err.textContent = msg || ''; err.hidden = !msg; }
}

function hideLogin() {
  document.getElementById('login').hidden = true;
  document.getElementById('app-shell').hidden = false;
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.elements.passcode;
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Checking…';
  const r = await api('/login', {
    method: 'POST',
    body: JSON.stringify({
      email: e.target.elements.email.value.trim(),
      passcode: input.value.trim(),
    }),
  });
  btn.disabled = false;
  btn.textContent = label;
  if (r.ok) {
    const card = document.getElementById('login-form');
    card.classList.remove('shake');
    card.classList.add('exit');                 // card flies out before the dashboard appears
    setTimeout(async () => {
      card.classList.remove('exit', 'enter');
      input.value = '';
      await boot();
    }, 250);
    return;
  }
  showLogin((r.data && r.data.error) || 'Sign in failed — server unreachable.');
});

/* show / hide the passcode so a typo is visible */
document.getElementById('toggle-pass').addEventListener('click', (e) => {
  const input = document.getElementById('login-form').elements.passcode;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  e.currentTarget.textContent = showing ? '👁' : '🙈';
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  try { await api('/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  modal.hidden = true;
  showLogin('Signed out.');
});

document.getElementById('passcode-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api('/passcode', { method: 'POST', body: JSON.stringify({ next: e.target.elements.next.value }) });
  if (r.ok) { e.target.reset(); toast('Passcode changed'); }
  else toast((r.data && r.data.error) || 'Could not change passcode');
});

document.getElementById('email-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api('/passcode', { method: 'POST', body: JSON.stringify({ email: e.target.elements.email.value }) });
  if (r.ok) { toast('Login email updated'); }
  else toast((r.data && r.data.error) || 'Could not update email');
});

document.getElementById('btn-sync').addEventListener('click', async () => {
  setSync('saving');
  await pushState();
  const pulled = await pullState();
  if (pulled.state) {
    state = Object.assign(defaults(), pulled.state, { meta: Object.assign(defaults().meta, pulled.state.meta || {}) });
    mirrorLocal(); render();
    setSync('saved', pulled.updatedAt);
    toast('Synced');
  }
});

async function boot() {
  let s;
  try { s = await api('/session'); }
  catch (e) { s = { ok: false }; }
  if (!s.ok) {                              // API unreachable → local-only mode
    online = false; hideLogin(); render(); setSync('offline');
    toast('Server unreachable — working on this device only');
    return;
  }
  online = true;
  sessionEmail = (s.data && s.data.email) || '';
  if (!s.data || !s.data.authenticated) {
    showLogin(s.data && s.data.needsSetup ? 'No passcode is set on the server yet.' : '');
    return;
  }
  const pulled = await pullState();
  if (pulled.offline) { hideLogin(); render(); setSync('offline'); return; }
  if (pulled.state) {
    state = Object.assign(defaults(), pulled.state, { meta: Object.assign(defaults().meta, pulled.state.meta || {}) });
    mirrorLocal();
  } else {
    await pushState();                      // first run: seed the server from local defaults
  }
  await loadDaily();
  hideLogin();
  render();
  setSync('saved', pulled.updatedAt || new Date().toISOString());
}

/* pull remote changes when you come back to the tab (e.g. you edited on your phone) */
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !online) return;
  if (syncStatus === 'saving') return;       // don't clobber unsaved local edits
  const dailyBefore = JSON.stringify(dailyContent);
  await loadDaily();                         // a new day may have new content
  const dailyChanged = JSON.stringify(dailyContent) !== dailyBefore;
  const pulled = await pullState();
  if (pulled.state && pulled.updatedAt && pulled.updatedAt !== lastSyncAt) {
    state = Object.assign(defaults(), pulled.state, { meta: Object.assign(defaults().meta, pulled.state.meta || {}) });
    mirrorLocal(); render(); setSync('saved', pulled.updatedAt);
    toast('Updated from another device');
  } else if (dailyChanged) {
    render();
  }
});

/* 3D tilt on dashboard cards — pointer devices only, rAF-throttled */
(() => {
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!fine) return;
  const view = document.getElementById('view');
  let raf = null, pending = null;

  view.addEventListener('pointermove', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const r = card.getBoundingClientRect();
    pending = {
      card,
      px: (e.clientX - r.left) / r.width - 0.5,
      py: (e.clientY - r.top) / r.height - 0.5,
    };
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      if (!pending) return;
      const { card: c, px, py } = pending;
      c.style.transform = `perspective(1100px) rotateY(${(px * 6).toFixed(2)}deg) rotateX(${(-py * 6).toFixed(2)}deg) translateY(-3px)`;
    });
  });

  view.addEventListener('pointerout', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    if (e.relatedTarget && card.contains(e.relatedTarget)) return;  // ignore child-to-child moves
    card.style.transform = '';
  });

  const reset = () => document.querySelectorAll('.card').forEach((c) => { c.style.transform = ''; });
  document.addEventListener('click', reset, true);
  const search = document.getElementById('search');
  if (search) search.addEventListener('input', reset);
})();

boot();