const api = globalThis.browser ?? globalThis.chrome;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const KEY = 'cx-settings';
const CATS = ['html', 'react', 'svg', 'markdown', 'mermaid', 'code', 'file'];
let port, chats = [], projects = [], currentId = null, pending = false, loading = false;

const status = (t, kind) => { const e = $('#status'); e.textContent = t; e.className = kind || ''; };
const mode = () => $('input[name=mode]:checked').value;
const setBusy = (b) => { $('#go').disabled = b; };

function save() {
  const s = { mode: mode() };
  $$('input[type=checkbox][id], .cat').forEach((i) => { s[i.id || 'cat-' + i.value] = i.checked; });
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    $$('input[type=checkbox][id], .cat').forEach((i) => { const k = i.id || 'cat-' + i.value; if (k in s) i.checked = s[k]; });
    const r = s.mode && $(`input[name=mode][value=${s.mode}]`);
    if (r) r.checked = true;
  } catch { /* ignore */ }
}

function renderList() {
  const l = $('#list');
  l.textContent = '';
  for (const c of chats) {
    const lab = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = c.uuid;
    const t = document.createElement('span'); t.textContent = c.name;
    const d = document.createElement('small'); d.textContent = (c.updated_at || '').slice(0, 10);
    lab.append(cb, t, d);
    lab.dataset.t = (c.name || '').toLowerCase();
    l.append(lab);
  }
}

function renderPlist() {
  const l = $('#plist');
  l.textContent = '';
  for (const p of projects) {
    const lab = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = p.uuid;
    const t = document.createElement('span'); t.textContent = p.name;
    const d = document.createElement('small'); d.textContent = (p.updated_at || '').slice(0, 10);
    lab.append(cb, t, d);
    lab.dataset.t = (p.name || '').toLowerCase();
    l.append(lab);
  }
}

function clearCounts() {
  CATS.forEach((c) => { $('#n-' + c).textContent = ''; $('#n-' + c).closest('.chip').classList.remove('none'); });
}
function scan() {
  if (!port || !currentId || mode() !== 'current') return clearCounts();
  port.postMessage({ cmd: 'scan', id: currentId, allBranches: $('#allBranches').checked });
}

function applyMode() {
  const m = mode();
  $('#chooser').hidden = !(m === 'choose' || m === 'projects');
  $('#list').hidden = m !== 'choose';
  $('#plist').hidden = m !== 'projects';
  $('#projOpt').hidden = m !== 'projects';
  if (port && !loading) {
    if (m === 'projects' && !projects.length) { loading = true; status('Loading projects'); port.postMessage({ cmd: 'projects' }); }
    else if ((m === 'choose' || m === 'all') && !chats.length) { loading = true; status('Loading chats'); port.postMessage({ cmd: 'list' }); }
  }
  scan();
}

function onMsg(m) {
  if (m.type === 'context') {
    currentId = m.chatId;
    applyMode();
    if (!currentId) $('#sub').textContent = 'No chat open in this tab';
  } else if (m.type === 'scan') {
    if (m.id !== currentId || mode() !== 'current') return;
    $('#sub').textContent = m.title;
    CATS.forEach((c) => {
      const n = m.counts[c] || 0;
      $('#n-' + c).textContent = n || '';
      $('#n-' + c).closest('.chip').classList.toggle('none', !n);
    });
  } else if (m.type === 'list') {
    loading = false;
    chats = m.chats.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    renderList();
    if (pending) { pending = false; startExport(); } else status(`${chats.length} chats loaded`);
  } else if (m.type === 'projects') {
    loading = false;
    projects = m.projects.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    renderPlist();
    status(`${projects.length} projects loaded`);
  } else if (m.type === 'progress') status(m.msg);
  else if (m.type === 'done') {
    setBusy(false);
    const bits = [`${m.chats} chat${m.chats === 1 ? '' : 's'}`, `${m.artifacts} artifact${m.artifacts === 1 ? '' : 's'}`];
    if (m.docs != null) bits.push(`${m.docs} document${m.docs === 1 ? '' : 's'}`);
    status(`Saved ${m.name} (${bits.join(', ')})` + (m.missing ? `. ${m.missing} file${m.missing === 1 ? '' : 's'} could not be recovered.` : ''), m.missing ? '' : 'ok');
  } else if (m.type === 'error') { loading = false; pending = false; setBusy(false); status(m.error, 'err'); }
}

async function connect() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/claude\.ai\//.test(tab.url || '')) {
    setBusy(true);
    return status('Open a claude.ai tab, then reopen this popup. In Firefox, allow the site in about:addons.', 'err');
  }
  port = api.tabs.connect(tab.id, { name: 'cx' });
  port.onMessage.addListener(onMsg);
  port.onDisconnect.addListener(() => {
    void api.runtime.lastError;
    setBusy(true);
    status('Not connected. Reload the claude.ai tab, then reopen this popup.', 'err');
  });
  port.postMessage({ cmd: 'context' });
}

function startExport() {
  const m = mode();
  if (m === 'projects') return startProjects();
  const ids = m === 'current' ? (currentId ? [currentId] : [])
    : m === 'all' ? chats.map((c) => c.uuid)
    : $$('#list input:checked').map((i) => i.value);
  const formats = ['md', 'json', 'txt'].filter((f) => $('#f-' + f).checked);
  const artifacts = $('#artifacts').checked;
  const cats = $$('.cat:checked').map((i) => i.value);
  if (!ids.length) return status(m === 'current' ? 'No chat open in this tab.' : 'Select at least one chat.', 'err');
  if (!formats.length && !(artifacts && cats.length)) return status('Choose a history format or an artifact type.', 'err');
  setBusy(true); status('Starting');
  port.postMessage({
    cmd: 'export',
    opts: {
      ids, formats, artifacts, cats,
      thinking: $('#thinking').checked, tools: $('#tools').checked, toolResults: $('#toolResults').checked,
      attachments: $('#attachments').checked, allBranches: $('#allBranches').checked,
      versions: $('#versions').checked, hideMeta: $('#hideMeta').checked,
    },
  });
}

function startProjects() {
  const projectIds = $$('#plist input:checked').map((i) => i.value);
  if (!projectIds.length) return status('Select at least one project.', 'err');
  const formats = ['md', 'json', 'txt'].filter((f) => $('#f-' + f).checked);
  setBusy(true); status('Starting');
  port.postMessage({
    cmd: 'exportProjects',
    opts: {
      projectIds, includeChats: $('#projChats').checked, formats, artifacts: $('#artifacts').checked,
      cats: $$('.cat:checked').map((i) => i.value),
      thinking: $('#thinking').checked, tools: $('#tools').checked, toolResults: $('#toolResults').checked,
      attachments: $('#attachments').checked, allBranches: $('#allBranches').checked,
      versions: $('#versions').checked, hideMeta: $('#hideMeta').checked,
    },
  });
}

$('#go').onclick = () => {
  save();
  if (mode() === 'all' && !chats.length) { pending = true; status('Loading chats'); port.postMessage({ cmd: 'list' }); return; }
  startExport();
};
$$('input[name=mode]').forEach((r) => r.addEventListener('change', () => { save(); applyMode(); }));
$$('input[type=checkbox]').forEach((c) => c.addEventListener('change', save));
$('#allBranches').addEventListener('change', scan);
$('#search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  $$('#list label, #plist label').forEach((l) => { l.hidden = !!q && !l.dataset.t.includes(q); });
});
$('#sel-vis').onclick = () => $$('#list label:not([hidden]) input, #plist label:not([hidden]) input').forEach((i) => { i.checked = true; });
$('#sel-none').onclick = () => $$('#list input, #plist input').forEach((i) => { i.checked = false; });

// Footer: version, and a bug-report link that pre-fills the version and browser.
try {
  const v = api.runtime.getManifest().version;
  $('#ver').textContent = 'v' + v;
  const u = new URL($('#l-report').href);
  u.searchParams.set('version', v);
  u.searchParams.set('browser', navigator.userAgent);
  $('#l-report').href = u.href;
} catch { /* links still work without prefill */ }

load();
connect();
