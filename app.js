// Workday PA — team copy (Drew + KB). Tasks come from data.json.
// Shared data (notes, messages, assignments, Asana to-dos) syncs via Firebase when configured, else stays in this browser.
const USERS = { drew: { name: 'Drew', role: 'Image editing' }, kb: { name: 'KB', role: 'Photographer' } };
const other = u => (u === 'drew' ? 'kb' : 'drew');
const uname = u => USERS[u]?.name || u;
const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem('pa.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pa.' + k, JSON.stringify(v)); } catch {} },
};

let me = store.get('user', null);
let data = { queue: [], team: [] };
const db = { notes: [], messages: [], assignments: [], asanaTodos: [] };
let backend = null;
let about = null;
let view = store.get('view', 'mine');
let mineFilter = 'to', todoFilter = 'open';

const fmt = ms => (ms ? new Date(ms).toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const dayOf = ms => new Date(ms).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const allTasks = () => [...data.queue, ...data.team];
const taskById = id => allTasks().find(t => t.id === id);

/* ---------- assignment model ---------- */
// Queue items default to Drew; everything else starts unassigned until someone assigns it.
function assignment(t) {
  const rec = db.assignments.find(a => a.id === t.id);
  if (rec) return rec;
  return { id: t.id, assignee: t.queuePos ? 'drew' : 'none', by: null, at: null, note: '', implicit: true };
}
async function assign(t, to, note) {
  const prev = assignment(t);
  await backend.set('assignments', t.id, { assignee: to, by: me, note: note || '', taskName: t.name });
  const text = to === 'none' ? `Unassigned "${t.name}".` :
    to === me ? `Took "${t.name}"${prev.assignee !== 'none' && prev.assignee !== me ? ' from ' + uname(prev.assignee) : ''}.` :
    `Passed "${t.name}" to ${uname(to)}.`;
  await backend.add('messages', { author: me, text: text + (note ? '\nNote: ' + note : ''), taskId: t.id, taskName: t.name });
}

/* ---------- user selection ---------- */
function showPicker() { $('#app').hidden = true; $('#pick').hidden = false; }
document.querySelectorAll('.user-btn').forEach(b => b.addEventListener('click', () => { me = b.dataset.user; store.set('user', me); start(); }));
$('#who').addEventListener('click', () => { me = null; store.set('user', null); showPicker(); });

/* ---------- tabs ---------- */
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));
function setView(v) {
  view = v; store.set('view', v);
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  for (const name of ['mine', 'tasks', 'asana', 'messages']) $('#view-' + name).hidden = v !== name;
  if (v === 'messages') { markRead(); renderMessages(); $('#msg').focus(); }
  renderAll();
}
function segment(attr, onPick) {
  document.querySelectorAll(`[data-${attr}]`).forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll(`[data-${attr}]`).forEach(x => x.classList.toggle('active', x === b));
    onPick(b.dataset[attr]);
  }));
}
segment('mine', v => { mineFilter = v; renderMine(); });
segment('todo', v => { todoFilter = v; renderTodos(); });

/* ---------- task cards ---------- */
function taskMeta(t) {
  const bits = [];
  if (t.kind === 'floor') bits.push('Floor stock');
  if (t.kind === 'duty') bits.push('Personal task');
  if (t.owner && t.kind === 'asana') bits.push('Asana: ' + t.owner);
  if (t.stage) bits.push(t.stage);
  if (t.due) bits.push('due ' + t.due);
  const last = t.comments?.[t.comments.length - 1];
  if (last) bits.push('last: ' + last.by + ' ' + fmt(Date.parse(last.at)));
  return bits.join(' · ');
}
const openTasks = new Set();
function taskCard(t, posLabel) {
  const li = $('#task-tpl').content.firstElementChild.cloneNode(true);
  li.dataset.id = t.id;
  li.querySelector('.pos').textContent = posLabel;
  li.querySelector('.title').textContent = t.name;
  li.querySelector('.meta').textContent = taskMeta(t);

  const a = assignment(t);
  const chip = li.querySelector('.assignee');
  chip.className = 'assignee chip ' + a.assignee;
  chip.textContent = a.assignee === 'none' ? 'Unassigned' : uname(a.assignee);
  const mine = db.notes.filter(n => n.taskId === t.id);
  const count = li.querySelector('.count');
  if (mine.length) { count.hidden = false; count.textContent = mine.length + (mine.length === 1 ? ' note' : ' notes'); }

  const body = li.querySelector('.task-body');
  body.hidden = !openTasks.has(t.id);
  li.querySelector('.task-head').addEventListener('click', () => { body.hidden = !body.hidden; body.hidden ? openTasks.delete(t.id) : openTasks.add(t.id); });

  // assign / pass on
  li.querySelector('.assign-now').textContent = a.assignee === 'none' ? 'Not assigned to anyone yet.' :
    `Assigned to ${uname(a.assignee)}` + (a.implicit ? ' (in Drew’s queue)' : a.by ? ` by ${uname(a.by)} · ${fmt(a.at)}` : '') + (a.note ? ` — “${a.note}”` : '');
  const noteIn = li.querySelector('.assign-note');
  const pass = li.querySelector('.assign-pass'), take = li.querySelector('.assign-take'), clear = li.querySelector('.assign-clear');
  const target = a.assignee === me ? other(me) : other(me);
  pass.textContent = 'Pass to ' + uname(target);
  take.textContent = 'Assign to me';
  take.hidden = a.assignee === me; clear.hidden = a.assignee === 'none';
  pass.hidden = a.assignee === target;
  const run = async (to, btn) => { btn.disabled = true; try { await assign(t, to, noteIn.value.trim()); noteIn.value = ''; } catch (e) { alert('Could not update: ' + e.message); } finally { btn.disabled = false; } };
  pass.addEventListener('click', () => run(target, pass));
  take.addEventListener('click', () => run(me, take));
  clear.addEventListener('click', () => run('none', clear));

  li.querySelector('.pa-notes').textContent = t.notes || '';
  li.querySelector('.desc').textContent = t.description || '';
  const cm = li.querySelector('.comments');
  if (t.comments?.length) {
    cm.append(el('h4', null, 'Recent Asana comments'));
    for (const c of t.comments) { const d = el('div', 'comment'); d.append(el('b', null, c.by), el('span', 'when', fmt(Date.parse(c.at))), el('div', null, c.text)); cm.append(d); }
  }
  const nb = li.querySelector('.notes');
  if (!mine.length) nb.append(el('div', 'muted small', 'No shared notes yet.'));
  for (const n of mine) { const d = el('div', 'note ' + n.author); d.append(el('b', null, uname(n.author)), el('span', 'when', fmt(n.at)), el('div', null, n.text)); nb.append(d); }
  const form = li.querySelector('.note-form'), ta = form.querySelector('textarea');
  form.addEventListener('submit', async e => {
    e.preventDefault(); const text = ta.value.trim(); if (!text) return;
    ta.disabled = true;
    try { await backend.add('notes', { taskId: t.id, taskName: t.name, author: me, text }); ta.value = ''; }
    catch (err) { alert('Could not save the note: ' + err.message); }
    finally { ta.disabled = false; }
  });
  li.querySelector('.msg-about').addEventListener('click', () => { setAbout(t); setView('messages'); });
  li.querySelector('.todo-about').addEventListener('click', () => { $('#todo-task').value = t.name; setView('asana'); $('#todo-text').focus(); });
  if (t.url) { const link = li.querySelector('.asana-link'); link.href = t.url; link.hidden = false; }
  return li;
}

/* ---------- All tasks ---------- */
function matches(t, q) {
  return !q || [t.name, t.notes, t.owner, t.description, ...(t.comments || []).map(c => c.text), ...db.notes.filter(n => n.taskId === t.id).map(n => n.text)].join(' ').toLowerCase().includes(q);
}
function renderTasks() {
  const q = $('#search').value.trim().toLowerCase();
  for (const [list, items, numbered] of [[$('#queue'), data.queue, true], [$('#team'), data.team, false]]) {
    list.replaceChildren();
    const shown = items.filter(t => matches(t, q));
    if (!shown.length) list.append(el('li', 'empty', q ? 'No matches.' : 'Nothing here.'));
    for (const t of shown) list.append(taskCard(t, numbered ? String(t.queuePos).padStart(2, '0') : '•'));
  }
}
$('#search').addEventListener('input', renderTasks);

/* ---------- My tasks ---------- */
function renderMine() {
  const list = $('#mine-list'); list.replaceChildren();
  let items, hint;
  if (mineFilter === 'to') { items = allTasks().filter(t => assignment(t).assignee === me); hint = me === 'drew' ? 'Your queue items plus anything KB passed to you.' : 'Tasks Drew has passed to you, or that you took on.'; }
  else if (mineFilter === 'by') { items = allTasks().filter(t => { const a = assignment(t); return !a.implicit && a.by === me && a.assignee !== me; }); hint = 'Tasks you handed to someone else (or unassigned).'; }
  else { items = allTasks().filter(t => assignment(t).assignee === 'none'); hint = 'Nobody has picked these up yet.'; }
  // newest hand-overs first, otherwise keep queue order
  items.sort((x, y) => (assignment(y).at || 0) - (assignment(x).at || 0) || (x.queuePos || 999) - (y.queuePos || 999));
  $('#mine-hint').textContent = hint;
  if (!items.length) list.append(el('li', 'empty', 'Nothing here.'));
  items.forEach((t, i) => list.append(taskCard(t, String(i + 1).padStart(2, '0'))));
  updateCounts();
}

/* ---------- Asana updates ---------- */
function fillTaskNames() {
  const dl = $('#task-names'); dl.replaceChildren();
  for (const t of allTasks()) { const o = document.createElement('option'); o.value = t.name; dl.append(o); }
}
$('#todo-form').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('#todo-text').value.trim(); if (!text) return $('#todo-text').focus();
  const name = $('#todo-task').value.trim();
  const t = allTasks().find(x => x.name === name);
  const btn = e.submitter; if (btn) btn.disabled = true;
  try {
    await backend.add('asanaTodos', { type: $('#todo-type').value, text, taskId: t?.id || null, taskName: name || null, who: $('#todo-who').value, author: me, done: false });
    $('#todo-text').value = ''; $('#todo-task').value = '';
  } catch (err) { alert('Could not add: ' + err.message); }
  finally { if (btn) btn.disabled = false; }
});
function renderTodos() {
  const list = $('#todo-list'); list.replaceChildren();
  let items = db.asanaTodos.slice();
  if (todoFilter === 'open') items = items.filter(x => !x.done);
  else if (todoFilter === 'mine') items = items.filter(x => !x.done && x.who === me);
  else items = items.filter(x => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  if (!items.length) list.append(el('li', 'empty', todoFilter === 'done' ? 'Nothing ticked off yet.' : 'Nothing waiting to be updated in Asana.'));
  for (const x of items) {
    const li = el('li', 'todo' + (x.done ? ' done' : ''));
    const box = el('input'); box.type = 'checkbox'; box.checked = !!x.done; box.title = x.done ? 'Mark as not done' : 'Mark as done in Asana';
    box.addEventListener('change', async () => {
      box.disabled = true;
      try { await backend.update('asanaTodos', x.id, box.checked ? { done: true, doneBy: me, doneAt: 'now' } : { done: false, doneBy: null, doneAt: null }); }
      catch (err) { box.checked = !box.checked; alert('Could not update: ' + err.message); }
      finally { box.disabled = false; }
    });
    const main = el('div', 'todo-main');
    const head = el('div', 'todo-head');
    head.append(el('span', 'chip type', x.type), el('span', 'chip ' + x.who, uname(x.who)));
    if (x.taskName) { const tag = el('span', 'tag', '↳ ' + x.taskName); if (x.taskId) tag.addEventListener('click', () => jumpTo(x.taskId)); head.append(tag); }
    main.append(head, el('div', 'todo-text', x.text));
    main.append(el('div', 'when', `Added by ${uname(x.author)} · ${fmt(x.at)}` + (x.done ? ` — done by ${uname(x.doneBy)} · ${fmt(x.doneAt)}` : '')));
    const right = el('div', 'todo-actions');
    const t = x.taskId && taskById(x.taskId);
    if (t?.url) { const a = el('a', 'ghost', 'Asana ↗'); a.href = t.url; a.target = '_blank'; a.rel = 'noopener'; right.append(a); }
    li.append(box, main, right);
    list.append(li);
  }
  updateCounts();
}

/* ---------- messages ---------- */
function setAbout(t) { about = t ? { id: t.id, name: t.name } : null; $('#about').hidden = !about; if (about) $('#about span').textContent = 'About: ' + about.name; }
$('#about-clear').addEventListener('click', () => setAbout(null));
function renderMessages() {
  const th = $('#thread'); th.replaceChildren();
  if (!db.messages.length) th.append(el('div', 'empty', 'No messages yet. Say hi to the team.'));
  let lastDay = '';
  for (const m of db.messages) {
    const day = dayOf(m.at); if (day !== lastDay) { th.append(el('div', 'day', day)); lastDay = day; }
    const b = el('div', 'bubble' + (m.author === me ? ' mine' : ''));
    const from = el('div', 'from ' + m.author, uname(m.author)); from.append(el('span', 'when', fmt(m.at)));
    b.append(from);
    if (m.taskId) { const tag = el('span', 'tag', '↳ ' + (m.taskName || 'task')); tag.addEventListener('click', () => jumpTo(m.taskId)); b.append(tag); }
    b.append(el('div', null, m.text));
    th.append(b);
  }
  th.scrollTop = th.scrollHeight;
}
function jumpTo(id) {
  setView('tasks'); $('#search').value = ''; openTasks.add(id); renderTasks();
  document.querySelector(`#view-tasks .task[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' });
}
$('#send').addEventListener('submit', async e => {
  e.preventDefault(); const ta = $('#msg'); const text = ta.value.trim(); if (!text) return;
  ta.disabled = true;
  try { await backend.add('messages', { author: me, text, taskId: about?.id || null, taskName: about?.name || null }); ta.value = ''; setAbout(null); }
  catch (err) { alert('Could not send: ' + err.message); }
  finally { ta.disabled = false; ta.focus(); }
});
$('#msg').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#send').requestSubmit(); } });
function markRead() { store.set('read.' + me, Date.now()); updateCounts(); }

function badge(sel, n) { const b = $(sel); b.hidden = !n; b.textContent = n; }
function updateCounts() {
  if (!me) return;
  const seen = store.get('read.' + me, 0);
  const unread = view === 'messages' ? 0 : db.messages.filter(m => m.author !== me && m.at > seen).length;
  badge('#unread', unread);
  badge('#mine-count', allTasks().filter(t => assignment(t).assignee === me).length);
  badge('#asana-count', db.asanaTodos.filter(x => !x.done).length);
  document.title = (unread ? `(${unread}) ` : '') + 'Workday PA';
}
function renderAll() {
  if (view === 'mine') renderMine();
  if (view === 'tasks') renderTasks();
  if (view === 'asana') renderTodos();
  if (view === 'messages') renderMessages();
  updateCounts();
}

/* ---------- backends ---------- */
// Both expose: add(collection, obj), set(collection, id, obj), update(collection, id, patch). "at"/"doneAt: 'now'" become timestamps.
function localBackend() {
  for (const k of Object.keys(db)) db[k] = store.get('local.' + k, []);
  const save = k => { store.set('local.' + k, db[k]); renderAll(); };
  const stamp = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === 'now' ? Date.now() : v]));
  return {
    async add(k, o) { db[k].push({ ...stamp(o), id: crypto.randomUUID(), at: Date.now() }); save(k); },
    async set(k, id, o) { db[k] = db[k].filter(x => x.id !== id); db[k].push({ ...stamp(o), id, at: Date.now() }); save(k); },
    async update(k, id, patch) { const x = db[k].find(r => r.id === id); if (x) Object.assign(x, stamp(patch)); save(k); },
  };
}
async function firebaseBackend(cfg) {
  const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const { initializeApp } = await import(base + 'firebase-app.js');
  const { getAuth, signInAnonymously } = await import(base + 'firebase-auth.js');
  const fs = await import(base + 'firebase-firestore.js');
  const app = initializeApp(cfg);
  await signInAnonymously(getAuth(app));
  const fdb = fs.getFirestore(app);
  const toMs = v => (v?.toMillis ? v.toMillis() : v == null ? null : Date.now());
  const rows = snap => snap.docs.map(d => { const x = d.data(); return { ...x, id: d.id, at: toMs(x.at) || Date.now(), doneAt: toMs(x.doneAt) }; });
  const listen = (name, after) => fs.onSnapshot(
    fs.query(fs.collection(fdb, name), fs.orderBy('at', 'asc'), fs.limitToLast(1000)),
    snap => { db[name] = rows(snap); after?.(); renderAll(); },
    err => banner('Sync error (' + name + '): ' + err.message));
  let first = true;
  listen('notes'); listen('assignments'); listen('asanaTodos');
  listen('messages', () => {
    if (view === 'messages') markRead();
    const last = db.messages[db.messages.length - 1];
    if (!first && last && last.author !== me && document.hidden && 'Notification' in window && Notification.permission === 'granted')
      new Notification('Workday PA', { body: uname(last.author) + ': ' + last.text.slice(0, 120) });
    first = false;
  });
  const prep = o => { const r = {}; for (const [k, v] of Object.entries(o)) { if (v === undefined) continue; r[k] = v === 'now' ? fs.serverTimestamp() : v; } return r; };
  const drop = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));
  return {
    add: (k, o) => fs.addDoc(fs.collection(fdb, k), { ...prep(drop(o)), at: fs.serverTimestamp() }),
    set: (k, id, o) => fs.setDoc(fs.doc(fdb, k, id), { ...prep(drop(o)), at: fs.serverTimestamp() }),
    update: (k, id, patch) => fs.updateDoc(fs.doc(fdb, k, id), prep(patch)),
  };
}
function banner(text) { const b = $('#banner'); b.textContent = text; b.hidden = !text; }

/* ---------- start ---------- */
let started = false;
async function start() {
  if (!me || !USERS[me]) return showPicker();
  $('#pick').hidden = true; $('#app').hidden = false;
  $('#who').textContent = uname(me) + ' · ' + USERS[me].role + ' ▾';
  $('#msg').placeholder = 'Message ' + uname(other(me)) + '…';
  $('#todo-who').value = me;
  if (started) return setView(view);
  started = true;
  // data.js (window.PA_DATA) works everywhere, including when index.html is opened straight from disk.
  if (window.PA_DATA) data = window.PA_DATA;
  else { try { data = await (await fetch('data.json', { cache: 'no-cache' })).json(); } catch { banner('Could not load the task list (data.js).'); } }
  $('#snapshot').textContent = data.exportedAt ? 'Snapshot ' + fmt(Date.parse(data.exportedAt)) : '';
  if (data.focus) { $('#focus').hidden = false; $('#focus').textContent = 'Drew’s current focus: ' + data.focus; }
  fillTaskNames();
  const cfg = window.FIREBASE_CONFIG || {};
  if (cfg.apiKey && cfg.projectId) {
    try { backend = await firebaseBackend(cfg); }
    catch (e) { backend = localBackend(); banner('Could not connect to Firebase (' + e.message + '). Everything is saved in this browser only.'); }
  } else {
    backend = localBackend();
    banner('Shared sync is not set up yet: notes, messages, assignments and Asana to-dos are saved in this browser only. Add your Firebase config to firebase-config.js.');
  }
  setView(['mine', 'tasks', 'asana', 'messages'].includes(view) ? view : 'mine');
  if ('Notification' in window && Notification.permission === 'default') document.addEventListener('click', () => Notification.requestPermission(), { once: true });
}
start();
