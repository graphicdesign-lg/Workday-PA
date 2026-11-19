// Workday PA — team site (Drew + KB).
// Tasks: live Asana snapshot published by Drew's PA (Firestore asana/snapshot), falling back to data.js.
// Shared (Firestore): stages + history, assignments, notes, messages, Asana-update to-dos, PA requests.
// The PA brain (Claude) runs on Drew's PC and answers paRequests. Asana itself is changed via ChatGPT (copy prompts).
const USERS = { drew: { name: 'Drew', role: 'Image editing' }, kb: { name: 'KB', role: 'Photographer' }, calvin: { name: 'Calvin', role: 'Web dev' }, pa: { name: 'PA', role: 'Assistant' } };
const STAGES = ['To do', 'To shoot', 'Ready to edit', 'Editing', 'Ready for review', 'Changes requested', 'Approved', 'Ready to upload', 'Uploaded to website', 'Asana updated', 'On hold'];
const FINISHED = new Set(['Asana updated']);
const VIEWS = ['pa', 'brief', 'board', 'mine', 'asana', 'messages', 'activity'];
const PRIORITIES = ['High', 'Normal', 'Low'];
const PEOPLE = ['drew', 'kb', 'calvin'];
const others = u => PEOPLE.filter(p => p !== u);
// Conversations: "team" group chat, or a private 1-to-1 chat "dm:<a>+<b>" (names sorted).
const dmKey = (a, b) => 'dm:' + [a, b].sort().join('+');
const convOf = m => m.to || 'team';
const inConv = (c, u) => c === 'team' || c.slice(3).split('+').includes(u);
const convName = c => c === 'team' ? 'Team chat' : c.slice(3).split('+').filter(p => p !== me).map(uname).join(', ');
let conv = 'team';
const uname = u => USERS[u]?.name || u || '—';
const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem('pa.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pa.' + k, JSON.stringify(v)); } catch {} },
};

let me = store.get('user', null);
let view = store.get('view', 'pa');
let fallbackData = window.PA_DATA || { queue: [], team: [] };
let data = fallbackData, dataSource = 'snapshot file';
const db = { notes: [], messages: [], assignments: [], asanaTodos: [], stages: [], stageLog: [], paRequests: [], taskEdits: [], customTasks: [], log: [] };
let asanaStatus = null;
let backend = null;
let msgAbout = null, paAbout = null, drawerTask = null;
let mineFilter = 'to', todoFilter = 'open', boardWho = 'all', actFilter = 'all';

const fmt = ms => (ms ? new Date(ms).toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const ago = ms => { if (!ms) return 'never'; const s = Math.round((Date.now() - ms) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago'; };
const dayOf = ms => new Date(ms).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const ts = v => (typeof v === 'string' ? Date.parse(v) : v) || 0;
// Task list = live Asana/PA snapshot + tasks created on this site, with team edits (name, due, priority) applied.
let taskCache = null, taskCacheKey = null;
function allTasks() {
  const key = [data, db.taskEdits, db.customTasks];
  if (taskCache && taskCacheKey && key.every((k, i) => k === taskCacheKey[i])) return taskCache;
  const custom = db.customTasks.filter(c => !c.archived).map(c => ({ id: 'c-' + c.id, kind: 'team', name: c.name, owner: null, due: c.due || null, description: c.description || '', notes: '', comments: [], createdBy: c.createdBy, createdAt: c.at, priority: c.priority }));
  const edits = new Map(db.taskEdits.map(e => [e.id, e]));
  taskCache = [...data.queue, ...data.team, ...custom].map(t => {
    const e = edits.get(t.id);
    return e ? { ...t, origName: t.name, name: e.name || t.name, due: e.due || t.due || null, priority: e.priority || t.priority || 'Normal', editedBy: e.by, editedAt: e.at } : { ...t, priority: t.priority || 'Normal' };
  });
  taskCacheKey = key; return taskCache;
}
const taskById = id => allTasks().find(t => t.id === id);
const daysTo = d => d ? Math.round((Date.parse(d + 'T12:00:00') - Date.now()) / 864e5) : null;
function toast(t) { const x = $('#toast'); x.textContent = t; x.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (x.hidden = true), 3200); }
function banner(text) { const b = $('#banner'); b.textContent = text || ''; b.hidden = !text; }

/* ---------- stage + assignment model ---------- */
function inferStage(t) {
  if (t.completed) return 'Asana updated';
  if (t.kind === 'floor') {
    const act = (t.name.split('—')[1] || '').toLowerCase();
    if (/shoot/.test(act)) return 'To shoot';
    if (/edit|colour|retouch|correction|generate/.test(act)) return 'Ready to edit';
    if (/upload/.test(act)) return 'Ready to upload';
    return 'To do';
  }
  return ({ 'In progress': 'Editing', 'Ready for review': 'Ready for review', 'Done — my work': 'Ready for review', 'Waiting on someone': 'Ready for review', 'Verified closed': 'Asana updated' })[t.paStage || t.stage] || 'To do';
}
function stageOf(t) { const rec = db.stages.find(s => s.id === t.id); return rec ? { stage: rec.stage, rec } : { stage: inferStage(t), auto: true }; }
function assignment(t) {
  const rec = db.assignments.find(a => a.id === t.id);
  return rec || { id: t.id, assignee: t.queuePos ? 'drew' : 'none', implicit: true };
}

/* ---------- writes ---------- */
async function setStage(t, stage, note) {
  const from = stageOf(t);
  await backend.batch([
    { op: 'set', col: 'stages', id: t.id, data: { stage, by: me, note: note || '', taskName: t.name } },
    { op: 'add', col: 'stageLog', data: { taskId: t.id, taskName: t.name, stage, from: from.auto ? null : from.stage, by: me, note: note || '' } },
  ]);
}
async function assign(t, to, note) {
  const prev = assignment(t);
  const text = to === 'none' ? `Unassigned "${t.name}".` :
    to === me ? `Took "${t.name}"${prev.assignee !== 'none' && prev.assignee !== me ? ' from ' + uname(prev.assignee) : ''}.` : `Passed "${t.name}" to ${uname(to)}.`;
  // Hand-overs go to the quiet History log, not to Messages.
  await backend.batch([
    { op: 'set', col: 'assignments', id: t.id, data: { assignee: to, by: me, note: note || '', taskName: t.name } },
    { op: 'add', col: 'log', data: { kind: 'assign', by: me, text: text + (note ? ' Note: ' + note : ''), taskId: t.id, taskName: t.name } },
  ]);
}
async function saveDetails(t, { name, due, priority }, logAsana) {
  const changes = [];
  if (name && name !== t.name) changes.push(`renamed to "${name}"`);
  if ((due || null) !== (t.due || null)) changes.push(due ? 'due ' + due : 'due date removed');
  if (priority !== t.priority) changes.push('priority ' + priority);
  if (!changes.length) return false;
  const ops = [];
  if (t.kind === 'team' && t.id.startsWith('c-')) ops.push({ op: 'set', col: 'customTasks', id: t.id.slice(2), data: { name: name || t.name, due: due || null, priority, description: t.description || '', createdBy: t.createdBy || me } });
  else ops.push({ op: 'set', col: 'taskEdits', id: t.id, data: { name: name || t.name, due: due || null, priority, by: me } });
  ops.push({ op: 'add', col: 'log', data: { kind: 'edit', by: me, text: `"${t.name}" ${changes.join(', ')}.`, taskId: t.id, taskName: name || t.name } });
  if (logAsana && t.kind === 'asana') {
    if (name && name !== t.name) ops.push({ op: 'add', col: 'asanaTodos', data: { type: 'Update description', text: `Rename the task "${t.origName || t.name}" to "${name}".`, taskId: t.id, taskName: name, who: me, author: me, done: false } });
    if ((due || null) !== (t.due || null)) ops.push({ op: 'add', col: 'asanaTodos', data: { type: 'Change due date', text: due ? `Set the due date to ${due}.` : 'Remove the due date.', taskId: t.id, taskName: name || t.name, who: me, author: me, done: false } });
  }
  await backend.batch(ops);
  return true;
}
async function createTask(f) {
  const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())).replace(/-/g, '').slice(0, 20);
  const tid = 'c-' + id;
  const ops = [
    { op: 'set', col: 'customTasks', id, data: { name: f.name, due: f.due || null, priority: f.priority, description: f.description || '', createdBy: me } },
    { op: 'set', col: 'stages', id: tid, data: { stage: f.stage, by: me, note: 'Created', taskName: f.name } },
    { op: 'add', col: 'stageLog', data: { taskId: tid, taskName: f.name, stage: f.stage, from: null, by: me, note: 'Created' } },
    { op: 'add', col: 'log', data: { kind: 'create', by: me, text: `Created "${f.name}"` + (f.who !== 'none' ? ' for ' + uname(f.who) : '') + '.', taskId: tid, taskName: f.name } },
  ];
  if (f.who !== 'none') ops.push({ op: 'set', col: 'assignments', id: tid, data: { assignee: f.who, by: me, note: '', taskName: f.name } });
  if (f.asana) ops.push({ op: 'add', col: 'asanaTodos', data: { type: 'Create new task', text: `Create a task "${f.name}"` + (f.due ? `, due ${f.due}` : '') + (f.description ? `. Description: ${f.description}` : '') + '.', taskId: tid, taskName: f.name, who: me, author: me, done: false } });
  await backend.batch(ops);
}

/* ---------- user + navigation ---------- */
function showPicker() { $('#app').hidden = true; $('#pick').hidden = false; }
document.querySelectorAll('.user-btn').forEach(b => b.addEventListener('click', () => { me = b.dataset.user; store.set('user', me); start(); }));
$('#who').addEventListener('click', () => { me = null; store.set('user', null); closeDrawer(); showPicker(); });
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));
function setView(v) {
  view = VIEWS.includes(v) ? v : 'pa'; store.set('view', view);
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  for (const n of VIEWS) $('#view-' + n).hidden = n !== view;
  if (view === 'pa') markRead('pa');
  renderAll();
  if (view === 'messages' || view === 'pa') scrollThread();
}
function segment(id, attr, onPick) {
  document.querySelectorAll(`#${id} [data-${attr}]`).forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll(`#${id} [data-${attr}]`).forEach(x => x.classList.toggle('active', x === b));
    onPick(b.dataset[attr]);
  }));
}
segment('mine-seg', 'mine', v => { mineFilter = v; renderMine(); });
segment('todo-seg', 'todo', v => { todoFilter = v; renderTodos(); });
segment('board-who', 'who', v => { boardWho = v; renderBoard(); });
segment('act-seg', 'act', v => { actFilter = v; renderActivity(); });
$('#search').addEventListener('input', () => renderBoard());
$('#board-done').addEventListener('change', () => renderBoard());

/* ---------- chips ---------- */
function stageChip(t) { const s = stageOf(t); return el('span', 'chip stage' + (s.auto ? ' auto' : ''), s.stage + (s.auto ? ' (auto)' : '')); }
function assigneeChip(t) { const a = assignment(t).assignee; return el('span', 'chip ' + a, a === 'none' ? 'Unassigned' : uname(a)); }
function extraChips(t) {
  const out = [];
  if (t.priority && t.priority !== 'Normal') out.push(el('span', 'chip pri-' + t.priority, t.priority));
  const d = daysTo(t.due);
  if (d != null && d <= 2 && !FINISHED.has(stageOf(t).stage)) out.push(el('span', 'chip due-soon', d < 0 ? 'Overdue' : d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : 'Due in 2 days'));
  return out;
}
function metaLine(t) {
  const bits = [];
  if (t.kind === 'floor') bits.push('Floor stock'); else if (t.kind === 'duty') bits.push('Personal task'); else if (t.kind === 'team') bits.push('Team task'); else if (t.owner) bits.push('Asana: ' + t.owner);
  if (t.queuePos) bits.push('#' + t.queuePos + ' in Drew’s queue');
  if (t.due) bits.push('due ' + t.due);
  const last = t.comments?.[t.comments.length - 1];
  if (last) bits.push('last comment ' + last.by + ' ' + ago(ts(last.at)));
  return bits.join(' · ');
}

/* ---------- PA ---------- */
const SUGGEST = {
  drew: ['What should I do next?', 'Summarise what changed today', 'What is waiting on KB?', 'Draft the Asana updates for my finished tasks'],
  kb: ['What do I need to shoot?', 'What changed since yesterday?', 'Which reshoots are open?', 'Tell Drew the shoot is done'],
  calvin: ['What is ready to upload?', 'What did I upload this week?', 'Which tasks are waiting on me?', 'Mark Stellan as uploaded to website'],
};
function paOnline() { return asanaStatus && Date.now() - ts(asanaStatus.at) < 3 * 60000; }
function renderBrief() {
  const b = $('#brief'); b.replaceChildren();
  const mine = allTasks().filter(t => assignment(t).assignee === me && !FINISHED.has(stageOf(t).stage));
  const review = allTasks().filter(t => stageOf(t).stage === 'Ready for review');
  const todos = db.asanaTodos.filter(x => !x.done);
  const unread = myConvs().reduce((n, c) => n + unreadIn(c), 0);
  const stat = (n, label, go) => { const s = el('button', 'stat'); s.type = 'button'; s.append(el('b', null, String(n)), el('span', null, label)); s.addEventListener('click', go); return s; };
  b.append(
    stat(mine.length, 'my open tasks', () => setView('mine')),
    stat(review.length, 'ready for review', () => { boardWho = 'all'; setView('board'); }),
    stat(todos.length, 'Asana updates to do', () => setView('asana')),
    stat(unread, 'unread messages', () => setView('messages')),
  );
  if (data.focus) b.append(el('div', 'focus-line', 'Drew’s current focus: ' + data.focus));
}
function renderPA() {
  renderBrief();
  const th = $('#pa-thread'); th.replaceChildren();
  const rows = db.paRequests.slice().sort((a, b) => a.at - b.at);
  if (!rows.length) {
    const hello = el('div', 'bubble pa');
    hello.append(el('div', 'from pa', 'PA'), el('div', null, `Hi ${uname(me)}. I keep track of every task, stage, hand-over and Asana change for you, ${others(me).map(uname).join(' and ')}. Ask me what to do next, to move a task to a new stage, to pass something on, or to log an Asana update for ChatGPT.`));
    th.append(hello);
  }
  let lastDay = '';
  for (const r of rows) {
    const day = dayOf(r.at); if (day !== lastDay) { th.append(el('div', 'day', day)); lastDay = day; }
    const q = el('div', 'bubble' + (r.author === me ? ' mine' : ''));
    const f = el('div', 'from ' + r.author, uname(r.author)); f.append(el('span', 'when', fmt(r.at))); q.append(f);
    if (r.taskId) q.append(taskTag(r.taskId, r.taskName));
    q.append(el('div', null, r.text)); th.append(q);
    const a = el('div', 'bubble pa'); a.append(el('div', 'from pa', 'PA'));
    if (r.status === 'done' || r.status === 'error') {
      a.firstChild.append(el('span', 'when', fmt(r.repliedAt)));
      a.append(el('div', null, r.reply || ''));
      if (r.applied?.length) { const ap = el('div', 'applied'); for (const x of r.applied) ap.append(el('span', 'chip pa', '✓ ' + x)); a.append(ap); }
      if (r.references?.length) { const rf = el('div', 'applied'); for (const id of r.references.slice(0, 8)) { const t = taskById(id); if (t) rf.append(taskTag(id, t.name)); } if (rf.childNodes.length) a.append(rf); }
    } else a.append(el('div', 'typing', r.status === 'working' ? 'Thinking…' : paOnline() ? 'Queued — the PA will answer in a moment…' : 'Queued — the PA brain is offline (Drew’s PC). It will answer when it is back.'));
    th.append(a);
  }
  const chips = $('#pa-chips'); chips.replaceChildren();
  for (const s of SUGGEST[me] || []) { const c = el('button', null, s); c.type = 'button'; c.addEventListener('click', () => { $('#pa-input').value = s; $('#pa-input').focus(); }); chips.append(c); }
  $('#pa-note').textContent = backend?.local ? 'Shared sync is off, so the PA can’t receive requests from this page.' :
    paOnline() ? 'PA brain online · answers with Claude on Drew’s PC · it can change stages, assignments, notes and log Asana updates — it never edits Asana directly.' :
    'PA brain offline — Drew’s PA isn’t running or team sync isn’t connected. Requests wait in the queue.';
}
function taskTag(id, name) { const tag = el('span', 'tag', '↳ ' + (name || 'task')); tag.addEventListener('click', () => openDrawer(id)); return tag; }
function setPaAbout(t) { paAbout = t ? { id: t.id, name: t.name } : null; $('#pa-about').hidden = !paAbout; if (paAbout) $('#pa-about span').textContent = 'About: ' + paAbout.name; }
$('#pa-about button').addEventListener('click', () => setPaAbout(null));
$('#pa-form').addEventListener('submit', async e => {
  e.preventDefault(); const ta = $('#pa-input'); const text = ta.value.trim(); if (!text) return;
  ta.disabled = true;
  try { await backend.add('paRequests', { author: me, text, status: 'pending', taskId: paAbout?.id || null, taskName: paAbout?.name || null }); ta.value = ''; setPaAbout(null); }
  catch (err) { toast('Could not send to the PA: ' + err.message); }
  finally { ta.disabled = false; ta.focus(); }
});
$('#pa-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#pa-form').requestSubmit(); } });

/* ---------- board ---------- */
function filtered() {
  const q = $('#search').value.trim().toLowerCase();
  return allTasks().filter(t => {
    if (boardWho !== 'all') { const a = assignment(t).assignee; if (a !== (boardWho === 'me' ? me : boardWho)) return false; }
    if (!q) return true;
    return [t.name, t.notes, t.owner, t.description, ...(t.comments || []).map(c => c.text), ...db.notes.filter(n => n.taskId === t.id).map(n => n.text)].join(' ').toLowerCase().includes(q);
  });
}
function renderBoard() {
  const board = $('#board'); board.replaceChildren();
  const showDone = $('#board-done').checked;
  const tasks = filtered();
  for (const st of STAGES) {
    if (!showDone && FINISHED.has(st)) continue;
    const items = tasks.filter(t => stageOf(t).stage === st);
    const col = el('div', 'col'); const h = el('h3', null, st); h.append(el('span', null, String(items.length))); col.append(h);
    items.sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || (a.queuePos || 999) - (b.queuePos || 999));
    for (const t of items) col.append(boardCard(t));
    board.append(col);
  }
}
function boardCard(t) {
  const c = el('button', 'tcard'); c.type = 'button';
  c.append(el('div', 't', t.name), el('div', 'm', metaLine(t)));
  const r = el('div', 'chips-row'); r.append(assigneeChip(t), ...extraChips(t));
  const n = db.notes.filter(x => x.taskId === t.id).length; if (n) r.append(el('span', 'chip', n + ' note' + (n > 1 ? 's' : '')));
  c.append(r); c.addEventListener('click', () => openDrawer(t.id)); return c;
}

/* ---------- my work ---------- */
function rowCard(t) {
  const c = el('button', 'trow'); c.type = 'button';
  const r = el('div', 'chips-row'); r.append(...extraChips(t), stageChip(t), assigneeChip(t));
  c.append(el('div', 't', t.name), r, el('div', 'm', metaLine(t)));
  c.addEventListener('click', () => openDrawer(t.id)); return c;
}
function renderMine() {
  const box = $('#mine-list'); box.replaceChildren();
  let items;
  if (mineFilter === 'to') items = allTasks().filter(t => assignment(t).assignee === me);
  else if (mineFilter === 'by') items = allTasks().filter(t => { const a = assignment(t); return !a.implicit && a.by === me && a.assignee !== me; });
  else items = allTasks().filter(t => assignment(t).assignee === 'none');
  if (!items.length) { box.append(el('p', 'empty', 'Nothing here.')); return; }
  for (const st of STAGES) {
    const g = items.filter(t => stageOf(t).stage === st).sort((a, b) => (a.queuePos || 999) - (b.queuePos || 999));
    if (!g.length) continue;
    box.append(el('h2', 'group', `${st} · ${g.length}`));
    const ul = el('div', 'list'); for (const t of g) ul.append(rowCard(t)); box.append(ul);
  }
}

/* ---------- Asana updates + ChatGPT ---------- */
function fillTaskNames() { const dl = $('#task-names'); dl.replaceChildren(); for (const t of allTasks()) { const o = document.createElement('option'); o.value = t.name; dl.append(o); } }
$('#todo-form').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('#todo-text').value.trim(); if (!text) return $('#todo-text').focus();
  const name = $('#todo-task').value.trim(); const t = allTasks().find(x => x.name === name);
  try {
    await backend.add('asanaTodos', { type: $('#todo-type').value, text, taskId: t?.id || null, taskName: name || null, who: $('#todo-who').value, author: me, done: false });
    $('#todo-text').value = ''; $('#todo-task').value = ''; toast('Added to Asana updates.');
  } catch (err) { toast('Could not add: ' + err.message); }
});
function gptPrompt(items) {
  const lines = items.map((x, i) => {
    const t = x.taskId && taskById(x.taskId);
    return `${i + 1}. [U-${x.id.slice(0, 6)}] Task: ${x.taskName || '(new task — see details)'}${t?.url ? '\n   Link: ' + t.url : ''}\n   Action: ${x.type}\n   Details: ${x.text}`;
  });
  return `Use the Asana app to make these exact updates in Asana for Leather Gallery.\n` +
    `Rules: do only what is listed; post comment text exactly as written; if a task can't be found or an action fails, say so — don't guess or change anything else.\n\n` +
    lines.join('\n\n') +
    `\n\nWhen finished, reply with a numbered list: ✅ done (with the task link) or ❌ not done (reason) for each item, keeping each [U-ref], then the workday-pa-sync block.`;
}
async function copyText(s, what) {
  try { await navigator.clipboard.writeText(s); toast(what + ' copied — paste it into ChatGPT.'); }
  catch { const ta = el('textarea'); ta.value = s; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast(what + ' copied.'); }
}
// Remember which items were sent, in order, so ChatGPT's numbered ✅ reply can tick them off.
function sendToGpt(items, what) {
  store.set('gptBatch', { ids: items.map(x => x.id), at: Date.now() });
  copyText(gptPrompt(items), what); updateBatchInfo();
}
function updateBatchInfo() {
  const b = store.get('gptBatch', null);
  $('#gpt-batch-info').textContent = b?.ids?.length ? `Last copied: ${b.ids.length} item${b.ids.length > 1 ? 's' : ''} · ${ago(b.at)}` : 'Copy updates for ChatGPT first.';
}
$('#gpt-all').addEventListener('click', () => {
  const open = db.asanaTodos.filter(x => !x.done).sort((a, b) => a.at - b.at);
  if (!open.length) return toast('No open Asana updates.');
  sendToGpt(open, open.length + ' update' + (open.length > 1 ? 's' : ''));
});
// Read ChatGPT's reply: [U-ref] / numbered ✅❌ lines, plus an optional ```workday-pa-sync JSON block
// describing what ChatGPT changed in Asana from the chat, stage moves, notes and follow-ups.
const refToId = ref => { const r = String(ref || '').replace(/^\[?U-/i, '').replace(/\]$/, '').slice(0, 6); return r.length === 6 ? db.asanaTodos.find(x => x.id.startsWith(r))?.id : null; };
function findTask(name, link) {
  const gid = String(link || '').match(/task\/(\d{6,})/)?.[1] || String(link || '').match(/\/(\d{10,})(?:\/f)?\/?$/)?.[1];
  if (gid) { const t = taskById(gid); if (t) return t; }
  const n = String(name || '').trim().toLowerCase(); if (!n) return null;
  const all = allTasks();
  return all.find(t => t.name.trim().toLowerCase() === n || (t.origName || '').trim().toLowerCase() === n) || all.find(t => t.name.toLowerCase().includes(n) || n.includes(t.name.trim().toLowerCase()));
}
function parseGptReply(text) {
  const out = { done: new Set(), failed: new Set(), sync: null };
  const b = store.get('gptBatch', null);
  const block = text.match(/```\s*workday-pa-sync\s*([\s\S]*?)```/i) || text.match(/workday-pa-sync\s*(\{[\s\S]*\})/i);
  if (block) { try { out.sync = JSON.parse(block[1].trim()); } catch { out.syncError = true; } }
  for (const line of text.replace(block?.[0] || '', '').split(/\r?\n/)) {
    const isBad = /❌|✖️/u.test(line), isOk = /✅|✔️|✔/u.test(line);
    if (!isBad && !isOk) continue;
    const ref = line.match(/U-[A-Za-z0-9_-]{6}/)?.[0];
    let id = ref ? refToId(ref) : null;
    if (!id && b?.ids?.length) { const n = Number(line.match(/(?:^|\s)(\d{1,3})[.)]/)?.[1]); if (n) id = b.ids[n - 1]; }
    if (id) (isBad ? out.failed : out.done).add(id);
  }
  for (const r of out.sync?.done || []) { const id = refToId(r); if (id) out.done.add(id); }
  for (const f of out.sync?.failed || []) { const id = refToId(f.ref || f); if (id) { out.failed.add(id); out.done.delete(id); } }
  return out;
}
$('#gpt-reply').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('#gpt-reply-text').value; if (!text.trim()) return;
  const r = parseGptReply(text), s = r.sync || {};
  const ops = [], summary = [];
  const doneIds = [...r.done].filter(id => db.asanaTodos.some(x => x.id === id && !x.done));
  for (const id of doneIds) ops.push({ op: 'update', col: 'asanaTodos', id, data: { done: true, doneBy: me, doneAt: 'now' } });
  if (doneIds.length) summary.push(`${doneIds.length} update${doneIds.length > 1 ? 's' : ''} ticked off`);
  for (const c of (s.asanaChanges || []).slice(0, 30)) {
    const t = findTask(c.task, c.link);
    ops.push({ op: 'add', col: 'log', data: { kind: 'chatgpt', by: me, text: `Asana (via ChatGPT): ${c.action || 'changed'} — ${c.task || 'task'}${c.details ? ': ' + String(c.details).slice(0, 600) : ''}`, taskId: t?.id || null, taskName: t?.name || c.task || null } });
  }
  if (s.asanaChanges?.length) summary.push(`${s.asanaChanges.length} Asana change${s.asanaChanges.length > 1 ? 's' : ''} logged`);
  let stageN = 0, skipped = 0;
  for (const x of (s.boardStages || []).slice(0, 30)) {
    const t = findTask(x.task, x.link);
    if (!t || !STAGES.includes(x.stage)) { skipped++; continue; }
    const from = stageOf(t);
    ops.push({ op: 'set', col: 'stages', id: t.id, data: { stage: x.stage, by: me, note: String(x.note || 'via ChatGPT').slice(0, 500), taskName: t.name } });
    ops.push({ op: 'add', col: 'stageLog', data: { taskId: t.id, taskName: t.name, stage: x.stage, from: from.auto ? null : from.stage, by: me, note: String(x.note || 'via ChatGPT').slice(0, 500) } });
    stageN++;
  }
  if (stageN) summary.push(`${stageN} stage${stageN > 1 ? 's' : ''} moved`);
  for (const x of (s.boardNotes || []).slice(0, 30)) {
    const t = findTask(x.task, x.link); if (!t || !x.text) { skipped++; continue; }
    ops.push({ op: 'add', col: 'notes', data: { taskId: t.id, taskName: t.name, author: me, text: '(via ChatGPT) ' + String(x.text).slice(0, 1900) } });
  }
  if (s.boardNotes?.length) summary.push(`${s.boardNotes.length} note${s.boardNotes.length > 1 ? 's' : ''}`);
  const TYPES = ['Post a comment', 'Mark complete', 'Reassign', 'Change due date', 'Attach files / folder path', 'Update description', 'Create new task', 'Other'];
  for (const x of (s.followUps || []).slice(0, 30)) {
    if (!x.details) continue; const t = findTask(x.task, x.link);
    ops.push({ op: 'add', col: 'asanaTodos', data: { type: TYPES.includes(x.type) ? x.type : 'Other', text: String(x.details).slice(0, 1900), taskId: t?.id || null, taskName: t?.name || x.task || null, who: PEOPLE.includes(x.who) ? x.who : 'drew', author: me, done: false } });
  }
  if (s.followUps?.length) summary.push(`${s.followUps.length} follow-up${s.followUps.length > 1 ? 's' : ''} added`);
  if (!ops.length) return toast(r.syncError ? 'The workday-pa-sync block could not be read — ask ChatGPT to resend it as valid JSON.' : 'Nothing new to apply (no ✅ items or sync block found).');
  try {
    for (let i = 0; i < ops.length; i += 400) await backend.batch(ops.slice(i, i + 400));
    $('#gpt-reply-text').value = '';
    toast('Synced from ChatGPT: ' + summary.join(' · ') + (r.failed.size ? ` · ${r.failed.size} still open (❌)` : '') + (skipped ? ` · ${skipped} skipped (task not found)` : '') + '.');
  } catch (err) { toast('Could not sync: ' + err.message); }
});
function renderTodos() {
  updateBatchInfo();
  const list = $('#todo-list'); list.replaceChildren();
  let items = db.asanaTodos.slice().sort((a, b) => a.at - b.at);
  if (todoFilter === 'open') items = items.filter(x => !x.done);
  else if (todoFilter === 'mine') items = items.filter(x => !x.done && x.who === me);
  else items = items.filter(x => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  if (!items.length) list.append(el('li', 'empty', todoFilter === 'done' ? 'Nothing ticked off yet.' : 'Nothing waiting to be updated in Asana.'));
  for (const x of items) {
    const li = el('li', 'todo' + (x.done ? ' done' : ''));
    const box = el('input'); box.type = 'checkbox'; box.checked = !!x.done; box.title = x.done ? 'Mark as not done' : 'Done in Asana';
    box.addEventListener('change', async () => {
      box.disabled = true;
      try { await backend.update('asanaTodos', x.id, box.checked ? { done: true, doneBy: me, doneAt: 'now' } : { done: false, doneBy: null, doneAt: null }); }
      catch (err) { box.checked = !box.checked; toast('Could not update: ' + err.message); } finally { box.disabled = false; }
    });
    const main = el('div', 'todo-main'); const head = el('div', 'todo-head');
    head.append(el('span', 'chip stage', x.type), el('span', 'chip ' + x.who, uname(x.who)));
    if (x.taskName) head.append(x.taskId ? taskTag(x.taskId, x.taskName) : el('span', 'tag', x.taskName));
    main.append(head, el('div', 'todo-text', x.text), el('div', 'when', `Added by ${uname(x.author)} · ${fmt(x.at)}` + (x.done ? ` — done by ${uname(x.doneBy)} · ${fmt(x.doneAt)}` : '')));
    const act = el('div', 'todo-actions');
    if (!x.done) { const g = el('button', 'ghost', 'Copy for ChatGPT'); g.type = 'button'; g.addEventListener('click', () => sendToGpt([x], 'Update')); act.append(g); }
    const t = x.taskId && taskById(x.taskId);
    if (t?.url) { const a = el('a', 'ghost', 'Asana ↗'); a.href = t.url; a.target = '_blank'; a.rel = 'noopener'; act.append(a); }
    li.append(box, main, act); list.append(li);
  }
}

/* ---------- messages ---------- */
function setMsgAbout(t) { msgAbout = t ? { id: t.id, name: t.name } : null; $('#about').hidden = !msgAbout; if (msgAbout) $('#about span').textContent = 'About: ' + msgAbout.name; }
$('#about button').addEventListener('click', () => setMsgAbout(null));
const readKey = c => `read.conv.${c}.${me}`;
function unreadIn(c) { const seen = store.get(readKey(c), c === 'team' ? store.get('read.msg.' + me, 0) : 0); return db.messages.filter(m => convOf(m) === c && m.author !== me && m.at > seen).length; }
function myConvs() { return ['team', ...others(me).map(p => dmKey(me, p))]; }
function openConv(c) { conv = c; store.set('conv.' + me, c); store.set(readKey(c), Date.now()); renderMessages(); updateCounts(); $('#msg').focus(); }
function renderMessages() {
  if (!inConv(conv, me)) conv = 'team';
  store.set(readKey(conv), Date.now());
  const list = $('#conv-list'); list.replaceChildren();
  for (const c of myConvs()) {
    const n = unreadIn(c), last = db.messages.filter(m => convOf(m) === c).at(-1);
    const b = el('button', 'conv' + (c === conv ? ' active' : '')); b.type = 'button';
    const top = el('div', 'conv-top'); top.append(el('span', 'conv-name', (c === 'team' ? '# ' : '🔒 ') + convName(c)));
    if (n) top.append(el('span', 'badge', String(n)));
    b.append(top, el('div', 'conv-last', last ? `${uname(last.author)}: ${last.text.slice(0, 50)}` : (c === 'team' ? 'Everyone' : 'Private chat')));
    b.addEventListener('click', () => openConv(c)); list.append(b);
  }
  $('#conv-title').textContent = conv === 'team' ? 'Team chat — Drew, KB, Calvin' : 'Private chat with ' + convName(conv);
  $('#msg').placeholder = conv === 'team' ? 'Message the team…' : 'Message ' + convName(conv) + ' privately…';
  const th = $('#thread'); th.replaceChildren();
  const msgs = db.messages.filter(m => convOf(m) === conv).sort((a, b) => a.at - b.at);
  if (!msgs.length) th.append(el('div', 'empty', conv === 'team' ? 'No messages yet. Say hi to the team.' : 'No messages yet.'));
  let lastDay = '';
  for (const m of msgs) {
    const day = dayOf(m.at); if (day !== lastDay) { th.append(el('div', 'day', day)); lastDay = day; }
    const b = el('div', 'bubble' + (m.author === me ? ' mine' : m.author === 'pa' ? ' pa' : ''));
    const f = el('div', 'from ' + m.author, uname(m.author)); f.append(el('span', 'when', fmt(m.at))); b.append(f);
    if (m.taskId) b.append(taskTag(m.taskId, m.taskName));
    b.append(el('div', null, m.text)); th.append(b);
  }
}
$('#send').addEventListener('submit', async e => {
  e.preventDefault(); const ta = $('#msg'); const text = ta.value.trim(); if (!text) return;
  ta.disabled = true;
  try { await backend.add('messages', { author: me, text, to: conv, taskId: msgAbout?.id || null, taskName: msgAbout?.name || null }); ta.value = ''; setMsgAbout(null); }
  catch (err) { toast('Could not send: ' + err.message); } finally { ta.disabled = false; ta.focus(); }
});
$('#msg').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#send').requestSubmit(); } });
function scrollThread() { requestAnimationFrame(() => { const m = $('main'); m.scrollTop = m.scrollHeight; }); }

/* ---------- activity ---------- */
function renderActivity() {
  const ul = $('#activity'); ul.replaceChildren();
  const rows = [];
  if (actFilter === 'all' || actFilter === 'asana') for (const a of data.activity || []) rows.push({ at: ts(a.at), cls: 'asana', title: a.text, sub: 'Asana' + (a.by ? ' · ' + a.by : ''), taskId: a.taskId });
  if (actFilter === 'all' || actFilter === 'team') {
    for (const l of db.log) rows.push({ at: l.at, cls: l.kind === 'assign' ? 'assign' : 'edit', title: l.text, sub: uname(l.by), taskId: l.taskId });
    for (const s of db.stageLog) rows.push({ at: s.at, cls: 'stage', title: `${s.taskName}: ${s.from ? s.from + ' → ' : ''}${s.stage}`, sub: uname(s.by) + (s.note ? ' · “' + s.note + '”' : ''), taskId: s.taskId });
    for (const n of db.notes) rows.push({ at: n.at, cls: '', title: `Note on ${n.taskName}`, sub: uname(n.author) + ': ' + n.text.slice(0, 160), taskId: n.taskId });
    for (const x of db.asanaTodos) rows.push({ at: x.done ? x.doneAt : x.at, cls: '', title: (x.done ? 'Asana updated: ' : 'Asana update logged: ') + (x.taskName || x.type), sub: (x.done ? uname(x.doneBy) : uname(x.author)) + ' · ' + x.text.slice(0, 140) });
  }
  rows.sort((a, b) => b.at - a.at);
  if (!rows.length) ul.append(el('li', 'empty', 'No activity yet.'));
  for (const r of rows.slice(0, 200)) {
    const li = el('li', r.cls); li.append(el('div', null, r.title), el('div', 'muted small', r.sub), el('span', 'when', fmt(r.at)));
    if (r.taskId && taskById(r.taskId)) { li.style.cursor = 'pointer'; li.addEventListener('click', () => openDrawer(r.taskId)); }
    ul.append(li);
  }
}

/* ---------- Brief ---------- */
function bcard(title, items, { full, empty = 'Nothing here.', count } = {}) {
  const c = el('div', 'bcard' + (full ? ' full' : ''));
  const h = el('h3', null, title); if (count != null) h.append(el('span', null, String(count))); c.append(h);
  if (!items.length) { c.append(el('div', 'none', empty)); return c; }
  const ul = el('ul');
  for (const it of items) { const li = el('li', it.taskId ? 'link' : null, it.text); if (it.taskId) li.addEventListener('click', () => openDrawer(it.taskId)); ul.append(li); }
  c.append(ul); return c;
}
function renderBriefView() {
  const now = new Date();
  $('#brief-title').textContent = `${now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening'}, ${uname(me)}`;
  const src = dataSource === 'live' ? 'Live Asana via Drew’s PA' : 'Asana snapshot ' + fmt(ts(data.exportedAt));
  $('#brief-sub').textContent = now.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + src;
  const body = $('#brief-body'); body.replaceChildren();
  const open = allTasks().filter(t => !FINISHED.has(stageOf(t).stage));
  const mine = open.filter(t => assignment(t).assignee === me).sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || (a.queuePos || 999) - (b.queuePos || 999));
  const theirs = open.filter(t => others(me).includes(assignment(t).assignee));
  const since = Date.now() - 24 * 3600e3;
  const label = t => t.name + ` — ${stageOf(t).stage}` + (t.due ? `, due ${t.due}` : '');
  // headline
  const counts = STAGES.map(s => [s, open.filter(t => stageOf(t).stage === s).length]).filter(([, n]) => n);
  const bar = el('div', 'bcard full'); bar.append(el('h3', null, 'Pipeline'));
  const sb = el('div', 'stagebar'); for (const [s, n] of counts) { const c = el('span', 'chip stage', `${s}: ${n}`); c.style.cursor = 'pointer'; c.addEventListener('click', () => setView('board')); sb.append(c); }
  bar.append(sb);
  if (data.focus) bar.append(el('p', 'small muted', 'Drew’s current focus: ' + data.focus));
  const grid = el('div', 'bgrid');
  grid.append(
    bar,
    bcard('Your next tasks', mine.slice(0, 8).map(t => ({ text: label(t), taskId: t.id })), { count: mine.length, empty: 'Nothing assigned to you.' }),
    bcard('The team is working on', theirs.slice(0, 10).map(t => ({ text: uname(assignment(t).assignee) + ': ' + label(t), taskId: t.id })), { count: theirs.length }),
    bcard('Needs attention', [
      ...open.filter(t => { const d = daysTo(t.due); return d != null && d <= 2; }).map(t => ({ text: '⏰ ' + label(t), taskId: t.id })),
      ...open.filter(t => stageOf(t).stage === 'Changes requested').map(t => ({ text: '↩ Changes requested: ' + t.name, taskId: t.id })),
      ...open.filter(t => stageOf(t).stage === 'Ready for review').map(t => ({ text: '👀 Ready for review: ' + t.name, taskId: t.id })),
      ...open.filter(t => t.priority === 'High').map(t => ({ text: '❗ High priority: ' + t.name, taskId: t.id })),
    ].slice(0, 12), { empty: 'Nothing urgent.' }),
    bcard('Asana updates to make (ChatGPT)', db.asanaTodos.filter(x => !x.done).map(x => ({ text: `${x.type}${x.taskName ? ' · ' + x.taskName : ''} (${uname(x.who)})`, taskId: x.taskId && taskById(x.taskId) ? x.taskId : null })), { count: db.asanaTodos.filter(x => !x.done).length, empty: 'All Asana updates done.' }),
    bcard('New in Asana (last 24 h)', (data.activity || []).filter(a => ts(a.at) > since).slice(0, 10).map(a => ({ text: a.text, taskId: taskById(a.taskId) ? a.taskId : null })), { empty: 'No Asana changes in the last 24 hours.' }),
    bcard('Email & calendar', [], { empty: 'Drew’s inbox and calendar stay private on Drew’s PC. The PA reads them when answering — use “Ask PA for a written brief” to include them.' }),
    bcard('Team activity (last 24 h)', [
      ...db.stageLog.filter(s => s.at > since).map(s => ({ at: s.at, text: `${uname(s.by)}: ${s.taskName} → ${s.stage}`, taskId: s.taskId })),
      ...db.log.filter(l => l.at > since).map(l => ({ at: l.at, text: `${uname(l.by)}: ${l.text}`, taskId: l.taskId })),
    ].sort((a, b) => b.at - a.at).slice(0, 10), { full: true, empty: 'No team changes yet today.' }),
  );
  body.append(grid);
}
$('#brief-ask').addEventListener('click', async () => {
  try { await backend.add('paRequests', { author: me, text: `Give me my brief for today: what changed, my priorities in order, what's blocked or waiting, and which Asana updates are still open.`, status: 'pending', taskId: null, taskName: null }); setView('pa'); }
  catch (e) { toast('Could not ask the PA: ' + e.message); }
});

/* ---------- new task ---------- */
const ntStage = $('#nt-stage'); for (const s of STAGES) { const o = document.createElement('option'); o.value = o.textContent = s; ntStage.append(o); }
$('#nt-open').addEventListener('click', () => { $('#new-task').hidden = false; $('#nt-who').value = me; $('#nt-name').focus(); });
$('#nt-cancel').addEventListener('click', () => { $('#new-task').hidden = true; });
$('#new-task').addEventListener('submit', async e => {
  e.preventDefault(); const name = $('#nt-name').value.trim(); if (!name) return;
  const btn = e.submitter; if (btn) btn.disabled = true;
  try {
    await createTask({ name, stage: ntStage.value, who: $('#nt-who').value, due: $('#nt-due').value || null, priority: $('#nt-pri').value, description: $('#nt-desc').value.trim(), asana: $('#nt-asana').checked });
    $('#new-task').reset(); $('#new-task').hidden = true; toast('Task created.');
  } catch (err) { toast('Could not create: ' + err.message); } finally { if (btn) btn.disabled = false; }
});

/* ---------- drawer ---------- */
const sel = $('#d-stage'); for (const s of STAGES) { const o = document.createElement('option'); o.value = o.textContent = s; sel.append(o); }
function openDrawer(id) { const t = taskById(id); if (!t) return toast('That task is no longer in the list.'); drawerTask = id; $('#drawer-wrap').hidden = false; renderDrawer(); }
function closeDrawer() { drawerTask = null; renderDrawer.last = null; $('#drawer-wrap').hidden = true; }
$('#d-close').addEventListener('click', closeDrawer);
$('.drawer-bg').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawerTask) closeDrawer(); });
function renderDrawer() {
  const t = drawerTask && taskById(drawerTask); if (!t) return;
  $('#d-kind').textContent = t.kind === 'floor' ? 'Floor priority stock' : t.kind === 'duty' ? 'Personal task' : t.kind === 'team' ? 'Team task (created on this board)' : 'Asana task' + (t.owner ? ' · owner ' + t.owner : '');
  $('#d-title').textContent = t.name; $('#d-meta').textContent = metaLine(t);
  if (renderDrawer.last !== t.id) { $('#d-name').value = t.name; $('#d-due').value = t.due || ''; $('#d-pri').value = t.priority || 'Normal'; $('#d-asana-rename').checked = false; renderDrawer.last = t.id; }
  $('#d-asana-rename-wrap').hidden = t.kind !== 'asana';
  $('#d-orig').textContent = t.origName && t.origName !== t.name ? (t.kind === 'asana' ? 'Asana name: ' : 'Original name: ') + t.origName : '';
  const s = stageOf(t);
  if (document.activeElement !== sel) sel.value = s.stage;
  const hist = $('#d-stages'); hist.replaceChildren();
  const log = db.stageLog.filter(x => x.taskId === t.id).sort((a, b) => b.at - a.at);
  if (s.auto) hist.append(el('li', 'muted', `Stage guessed from the task (${s.stage}). Set it to start the history.`));
  for (const x of log) hist.append(el('li', null, `${fmt(x.at)} · ${uname(x.by)}: ${x.from ? x.from + ' → ' : ''}${x.stage}${x.note ? ' — “' + x.note + '”' : ''}`));
  const a = assignment(t);
  $('#d-assign-now').textContent = a.assignee === 'none' ? 'Not assigned yet.' : `Assigned to ${uname(a.assignee)}` + (a.implicit ? ' (in Drew’s queue)' : ` by ${uname(a.by)} · ${fmt(a.at)}`) + (a.note ? ` — “${a.note}”` : '');
  const sel2 = $('#d-assign-to');
  if (renderDrawer.lastAssign !== t.id + a.assignee) { sel2.replaceChildren(...others(me).filter(p => p !== a.assignee).map(p => { const o = document.createElement('option'); o.value = p; o.textContent = uname(p) + ' (' + USERS[p].role + ')'; return o; })); renderDrawer.lastAssign = t.id + a.assignee; }
  $('#d-take').hidden = a.assignee === me; $('#d-clear').hidden = a.assignee === 'none';
  const link = $('#d-link'); link.hidden = !t.url; if (t.url) link.href = t.url;
  $('#d-pa-sec').hidden = !t.notes; $('#d-pa-notes').textContent = t.notes || '';
  $('#d-desc-sec').hidden = !t.description; $('#d-desc').textContent = t.description || '';
  const cm = $('#d-comments'); cm.replaceChildren(); $('#d-com-sec').hidden = !t.comments?.length;
  for (const c of t.comments || []) { const d = el('div', 'comment'); d.append(el('b', null, c.by), el('span', 'when', fmt(ts(c.at))), el('div', null, c.text)); cm.append(d); }
  const nb = $('#d-notes'); nb.replaceChildren();
  const notes = db.notes.filter(n => n.taskId === t.id).sort((a, b) => a.at - b.at);
  if (!notes.length) nb.append(el('div', 'muted small', 'No shared notes yet.'));
  for (const n of notes) { const d = el('div', 'note ' + n.author); d.append(el('b', null, uname(n.author)), el('span', 'when', fmt(n.at)), el('div', null, n.text)); nb.append(d); }
}
const withTask = fn => async e => { const t = taskById(drawerTask); if (!t) return; const b = e?.currentTarget; if (b) b.disabled = true; try { await fn(t); } catch (err) { toast('Could not update: ' + err.message); } finally { if (b) b.disabled = false; } };
$('#d-save').addEventListener('click', withTask(async t => {
  const changed = await saveDetails(t, { name: $('#d-name').value.trim() || t.name, due: $('#d-due').value || null, priority: $('#d-pri').value }, $('#d-asana-rename').checked);
  renderDrawer.last = null; toast(changed ? 'Saved.' + ($('#d-asana-rename').checked && t.kind === 'asana' ? ' Asana change logged for ChatGPT.' : '') : 'Nothing changed.');
}));
$('#d-stage-save').addEventListener('click', withTask(async t => { await setStage(t, sel.value, $('#d-stage-note').value.trim()); $('#d-stage-note').value = ''; toast('Stage updated: ' + sel.value); }));
$('#d-pass').addEventListener('click', withTask(async t => { const to = $('#d-assign-to').value; if (!to) return; await assign(t, to, $('#d-assign-note').value.trim()); $('#d-assign-note').value = ''; toast('Passed to ' + uname(to)); }));
$('#d-take').addEventListener('click', withTask(async t => { await assign(t, me, $('#d-assign-note').value.trim()); $('#d-assign-note').value = ''; }));
$('#d-clear').addEventListener('click', withTask(async t => { await assign(t, 'none', $('#d-assign-note').value.trim()); $('#d-assign-note').value = ''; }));
$('#d-ask').addEventListener('click', () => { const t = taskById(drawerTask); closeDrawer(); setPaAbout(t); setView('pa'); $('#pa-input').focus(); });
$('#d-msg').addEventListener('click', () => { const t = taskById(drawerTask); closeDrawer(); setMsgAbout(t); setView('messages'); $('#msg').focus(); });
$('#d-todo').addEventListener('click', () => { const t = taskById(drawerTask); closeDrawer(); $('#todo-task').value = t.name; setView('asana'); $('#todo-text').focus(); });
$('#d-note-form').addEventListener('submit', withTask(async t => {
  const ta = $('#d-note-form textarea'); const text = ta.value.trim(); if (!text) return;
  await backend.add('notes', { taskId: t.id, taskName: t.name, author: me, text }); ta.value = '';
}));

/* ---------- counts + render ---------- */
function markRead(k) { if (me) store.set(`read.${k}.${me}`, Date.now()); updateCounts(); }
function badge(id, n) { const b = $(id); b.hidden = !n; b.textContent = n; }
function updateCounts() {
  if (!me) return;
  const seenP = store.get('read.pa.' + me, 0);
  const unread = myConvs().reduce((n, c) => n + (view === 'messages' && c === conv ? 0 : unreadIn(c)), 0);
  const paNew = view === 'pa' ? 0 : db.paRequests.filter(r => r.status === 'done' && (r.repliedAt || 0) > seenP && r.author === me).length;
  badge('#c-unread', unread);
  badge('#c-mine', allTasks().filter(t => assignment(t).assignee === me && !FINISHED.has(stageOf(t).stage)).length);
  badge('#c-asana', db.asanaTodos.filter(x => !x.done).length);
  const paTab = document.querySelector('.tab[data-view="pa"]'); paTab.textContent = '✦ PA' + (paNew ? ` (${paNew})` : '');
  document.title = (unread + paNew ? `(${unread + paNew}) ` : '') + 'Workday PA';
  // status pills
  const pA = $('#pill-asana'), pP = $('#pill-pa');
  const snapAt = dataSource === 'live' ? ts(asanaStatus?.asanaAt) || ts(data.publishedAt) : ts(data.exportedAt);
  pA.className = 'pill ' + (dataSource === 'live' && asanaStatus?.live && paOnline() ? 'ok' : dataSource === 'live' ? 'warn' : 'bad');
  pA.lastChild.textContent = dataSource === 'live' ? (asanaStatus?.live && paOnline() ? 'Asana live' : 'Asana ' + ago(snapAt)) : 'Asana snapshot ' + ago(snapAt);
  pA.title = dataSource === 'live' ? 'Live Asana data from Drew’s PA (checked every ~15 s while it runs). Last Asana data: ' + fmt(snapAt) : 'Static snapshot from ' + fmt(snapAt) + '. Live sync not connected.';
  pP.className = 'pill ' + (paOnline() ? 'ok' : 'bad'); pP.lastChild.textContent = paOnline() ? 'PA online' : 'PA offline';
}
function renderAll() {
  if (!me) return;
  if (view === 'pa') renderPA();
  if (view === 'brief') renderBriefView();
  if (view === 'board') renderBoard();
  if (view === 'mine') renderMine();
  if (view === 'asana') renderTodos();
  if (view === 'messages') renderMessages();
  if (view === 'activity') renderActivity();
  if (drawerTask) renderDrawer();
  updateCounts();
}
setInterval(updateCounts, 30000);

/* ---------- backends ---------- */
function localBackend() {
  for (const k of Object.keys(db)) db[k] = store.get('local.' + k, []);
  const stamp = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === 'now' ? Date.now() : v]));
  const apply = (o) => {
    const k = o.col;
    if (o.op === 'add') db[k] = [...db[k], { ...stamp(o.data), id: crypto.randomUUID().replace(/-/g, '').slice(0, 20), at: Date.now() }];
    if (o.op === 'set') db[k] = [...db[k].filter(x => x.id !== o.id), { ...stamp(o.data), id: o.id, at: Date.now() }];
    if (o.op === 'update') db[k] = db[k].map(x => x.id === o.id ? { ...x, ...stamp(o.data) } : x);
    store.set('local.' + k, db[k]);
  };
  return {
    local: true,
    async batch(ops) { ops.forEach(apply); renderAll(); },
    async add(col, data) { apply({ op: 'add', col, data }); renderAll(); },
    async update(col, id, data) { apply({ op: 'update', col, id, data }); renderAll(); },
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
  const rows = snap => snap.docs.map(d => { const x = d.data(); return { ...x, id: d.id, at: toMs(x.at) || Date.now(), doneAt: toMs(x.doneAt), repliedAt: toMs(x.repliedAt) }; });
  // No pop-up/browser notifications: unread counts and the tab title are the only signals.
  const listen = (name, n, after) => fs.onSnapshot(fs.query(fs.collection(fdb, name), fs.orderBy('at', 'asc'), fs.limitToLast(n)),
    snap => { const prev = db[name]; db[name] = rows(snap); after?.(prev); renderAll(); },
    err => banner('Sync error (' + name + '): ' + err.message));
  listen('notes', 1000); listen('assignments', 1000); listen('asanaTodos', 500); listen('stages', 1000); listen('stageLog', 600);
  listen('taskEdits', 1000); listen('customTasks', 500); listen('log', 600);
  listen('messages', 800, () => { if (view === 'messages') scrollThread(); });
  listen('paRequests', 150, () => { if (view === 'pa') { markRead('pa'); scrollThread(); } });
  fs.onSnapshot(fs.doc(fdb, 'asana', 'snapshot'), d => {
    if (!d.exists()) return;
    try { const x = d.data(); const j = JSON.parse(x.json); j.publishedAt = toMs(x.at); data = j; dataSource = 'live'; fillTaskNames(); renderAll(); } catch {}
  }, () => {});
  fs.onSnapshot(fs.doc(fdb, 'asana', 'status'), d => { asanaStatus = d.exists() ? { ...d.data(), at: toMs(d.data().at) } : null; renderAll(); }, () => {});
  const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v === 'now' ? fs.serverTimestamp() : v]));
  const dropNull = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));
  return {
    async batch(ops) {
      const b = fs.writeBatch(fdb);
      for (const o of ops) {
        if (o.op === 'add') b.set(fs.doc(fs.collection(fdb, o.col)), { ...clean(dropNull(o.data)), at: fs.serverTimestamp() });
        if (o.op === 'set') b.set(fs.doc(fdb, o.col, o.id), { ...clean(dropNull(o.data)), at: fs.serverTimestamp() });
        if (o.op === 'update') b.update(fs.doc(fdb, o.col, o.id), clean(o.data));
      }
      await b.commit();
    },
    add(col, data) { return this.batch([{ op: 'add', col, data }]); },
    update(col, id, data) { return this.batch([{ op: 'update', col, id, data }]); },
  };
}

/* ---------- start ---------- */
let started = false;
async function start() {
  if (!me || !USERS[me] || me === 'pa') return showPicker();
  $('#pick').hidden = true; $('#app').hidden = false;
  $('#who').textContent = uname(me) + ' · ' + USERS[me].role + ' ▾';
  $('#todo-who').value = me;
  conv = store.get('conv.' + me, 'team'); if (!inConv(conv, me)) conv = 'team';
  if (started) return setView(view);
  started = true;
  fillTaskNames();
  const cfg = window.FIREBASE_CONFIG || {};
  if (cfg.apiKey && cfg.projectId) {
    try { backend = await firebaseBackend(cfg); }
    catch (e) { backend = localBackend(); banner('Could not connect to shared sync (' + e.message + '). Changes are saved in this browser only.'); }
  } else {
    backend = localBackend();
    banner('Shared sync is not set up: changes are saved in this browser only.');
  }
  setView(view);
}
start();
