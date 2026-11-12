// Runs on claude.ai (first-party, so session cookies apply). Talks to the popup over a port.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const { Zip, safeName, randomHex, folderName, branch, collectArtifacts, artifactFiles, toJson, toMarkdown, toText, chatTitle } = self.CX;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let orgId = null;

  async function jget(path, tries = 4) {
    for (let i = 0; i < tries; i++) {
      const r = await fetch(path, { credentials: 'include', headers: { accept: 'application/json' } });
      if (r.ok) return r.json();
      if (r.status === 429 || r.status >= 500) { await sleep(1000 * (i + 1) * (i + 1)); continue; }
      throw new Error(`HTTP ${r.status} for ${path.split('?')[0]}`);
    }
    throw new Error('Failed after retries: ' + path.split('?')[0]);
  }

  async function getOrg() {
    if (orgId) return orgId;
    const m = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/);
    if (m) return (orgId = decodeURIComponent(m[1]));
    const orgs = await jget('/api/organizations');
    const o = orgs.find((x) => (x.capabilities || []).includes('chat')) || orgs[0];
    if (!o) throw new Error('No organization found. Are you logged in?');
    return (orgId = o.uuid);
  }

  async function listChats() {
    const org = await getOrg();
    let d;
    try {
      d = await jget(`/api/organizations/${org}/chat_conversations`);
      if (!Array.isArray(d)) d = d.data || d.conversations || [];
    } catch {
      d = [];
      for (let off = 0; ; off += 100) {
        const r = await jget(`/api/organizations/${org}/chat_conversations_v2?limit=100&offset=${off}`);
        const arr = Array.isArray(r) ? r : r.data || [];
        d.push(...arr);
        if (!r.has_more || !arr.length) break;
      }
    }
    return d.map((c) => ({
      uuid: c.uuid, name: c.name || c.summary || '(untitled)', created_at: c.created_at,
      updated_at: c.updated_at, model: c.model, is_starred: c.is_starred,
      project_uuid: c.project_uuid || (c.project && c.project.uuid) || null,
    }));
  }

  async function listProjects() {
    const org = await getOrg();
    let d;
    try { d = await jget(`/api/organizations/${org}/projects?include_harmony_projects=true&limit=100`); }
    catch { d = await jget(`/api/organizations/${org}/projects`); }
    if (!Array.isArray(d)) d = d.data || d.projects || [];
    return d.map((p) => ({ uuid: p.uuid, name: p.name || '(untitled project)', updated_at: p.updated_at, created_at: p.created_at }));
  }

  async function getChat(id) {
    const org = await getOrg();
    const base = `/api/organizations/${org}/chat_conversations/${id}`;
    try { return await jget(`${base}?tree=True&rendering_mode=messages&render_all_tools=true&consistency=eventual`); }
    catch { return jget(base); }
  }

  const currentId = () => (location.pathname.match(/\/chat\/([0-9a-f-]{36})/) || [])[1] || null;
  const pick = (conv, all) => (all ? conv.chat_messages || [] : branch(conv));

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 15000);
  }

  const post = (p, m) => { try { p.postMessage(m); } catch { /* popup closed */ } };

  // Download files that were presented in the chat (complete and binary-safe). Falls back to the
  // content rebuilt from the commands when the download is not available.
  async function fetchRemote(convId, arts) {
    const org = await getOrg();
    for (const a of arts) {
      if (!a.remote) continue;
      try {
        const url = `/api/organizations/${org}/conversations/${convId}/wiggle/download-file?path=${encodeURIComponent(a.remotePath || a.path)}`;
        const r = await fetch(url, { credentials: 'include' });
        if (r.ok) a.final = new Uint8Array(await r.arrayBuffer());
      } catch { /* keep reconstructed content */ }
    }
  }

  // Build the zip entries for one chat. `pre` is the folder prefix inside the zip.
  async function chatEntries(conv, o, pre) {
    const fo = { thinking: o.thinking, tools: o.tools, toolResults: o.toolResults, attachments: o.attachments, hideMeta: o.hideMeta };
    const msgs = pick(conv, o.allBranches);
    const arts = o.artifacts ? collectArtifacts(msgs).filter((a) => o.cats.includes(a.category)) : [];
    if (arts.some((a) => a.remote)) await fetchRemote(conv.uuid, arts);
    const files = arts.length ? artifactFiles(arts, o.versions) : [];
    const refs = {};
    arts.forEach((a) => {
      if (!a.file) return;
      refs[a.key] = a.file;
      if (a.remotePath) refs['p:' + a.remotePath] = a.file;
    });
    const e = [];
    if (o.formats.includes('md')) e.push([`${pre}history.md`, toMarkdown(conv, msgs, fo, refs)]);
    if (o.formats.includes('json')) e.push([`${pre}history.json`, toJson(conv, msgs, o.hideMeta)]);
    if (o.formats.includes('txt')) e.push([`${pre}history.txt`, toText(conv, msgs, fo, refs)]);
    files.forEach((f) => e.push([pre + f.path, f.content]));
    return { entries: e, messages: msgs.length, artifacts: arts.filter((a) => a.file).length, missing: arts.filter((a) => !a.file).length };
  }

  const uniq = (used, name) => {
    let d = name, n = 2;
    while (used.has(d.toLowerCase())) d = `${name} (${n++})`;
    used.add(d.toLowerCase());
    return d;
  };
  const textOf = (v) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v, null, 2));

  // Layout:
  //   one chat:   <XX - Title>.zip -> <XX - Title>/{history.md|json|txt, artifacts/<type>/...}
  //   many chats: Claude export <date>.zip -> Claude export <date>/<XX - Title>/{...}
  async function run(o, port) {
    const entries = [], index = [], used = new Set();
    const code = randomHex(); // one new code per download press
    const single = o.ids.length === 1;
    let artCount = 0, ok = 0, missing = 0, topName = '';
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');

    for (let i = 0; i < o.ids.length; i++) {
      post(port, { type: 'progress', msg: `Fetching chat ${i + 1} of ${o.ids.length}` });
      let conv;
      try { conv = await getChat(o.ids[i]); }
      catch (e) { index.push({ uuid: o.ids[i], error: String(e.message || e) }); continue; }
      const dir = uniq(used, folderName(conv, code));
      if (single) topName = dir;
      const r = await chatEntries(conv, o, single ? '' : dir + '/');
      entries.push(...r.entries);
      artCount += r.artifacts; missing += r.missing; ok++;
      index.push({ title: dir, uuid: conv.uuid, created_at: conv.created_at, updated_at: conv.updated_at, model: conv.model, messages: r.messages, artifacts: r.artifacts });
      await sleep(250);
    }

    if (!ok) throw new Error(index[0]?.error || 'Could not fetch the selected chat(s).');
    if (!entries.length) throw new Error('Nothing to export. Pick a history format or at least one artifact type that exists in the chat.');
    if (!single && !o.hideMeta) entries.push(['index.json', JSON.stringify(index, null, 2)]);
    return finish(single ? topName : `Claude export ${stamp}`, entries, { chats: ok, artifacts: artCount, missing });
  }

  // Layout: <XX - Project>.zip -> <XX - Project>/{description.md, instructions.md, knowledge/..., chats/<XX - Title>/...}
  async function runProjects(o, port) {
    const org = await getOrg();
    const entries = [], used = new Set();
    const code = randomHex(); // one new code per download press
    const single = o.projectIds.length === 1;
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
    let chatsN = 0, artCount = 0, missing = 0, docsN = 0, topName = '';
    const all = o.includeChats ? await listChats() : [];

    for (let i = 0; i < o.projectIds.length; i++) {
      const pid = o.projectIds[i];
      post(port, { type: 'progress', msg: `Fetching project ${i + 1} of ${o.projectIds.length}` });
      const p = await jget(`/api/organizations/${org}/projects/${pid}`);
      let docs = [];
      try {
        const d = await jget(`/api/organizations/${org}/projects/${pid}/docs`);
        docs = Array.isArray(d) ? d : d.data || d.docs || [];
      } catch { /* project without readable docs */ }

      const dir = uniq(used, folderName(p, code));
      if (single) topName = dir;
      const pre = single ? '' : dir + '/';
      const start = entries.length;
      if (p.description) entries.push([`${pre}description.md`, p.description.trim() + '\n']);
      if (p.prompt_template) entries.push([`${pre}instructions.md`, p.prompt_template.trim() + '\n']);

      const kn = new Set();
      for (const d of docs) {
        const name = uniq(kn, safeName(d.file_name || d.name) || 'document');
        entries.push([`${pre}knowledge/${name}`, textOf(d.content)]);
        docsN++;
      }

      if (o.includeChats) {
        const mine = all.filter((c) => c.project_uuid === pid);
        const cu = new Set();
        for (let j = 0; j < mine.length; j++) {
          post(port, { type: 'progress', msg: `Project ${i + 1}/${o.projectIds.length}: chat ${j + 1} of ${mine.length}` });
          try {
            const conv = await getChat(mine[j].uuid);
            const r = await chatEntries(conv, o, `${pre}chats/${uniq(cu, folderName(conv, code))}/`);
            entries.push(...r.entries);
            artCount += r.artifacts; missing += r.missing; chatsN++;
          } catch { /* skip chats that fail */ }
          await sleep(250);
        }
      }
      if (entries.length === start) entries.push([`${pre}description.md`, `# ${safeName(p.name) || 'Project'}\n`]);
    }
    return finish(single ? topName : `Claude projects ${stamp}`, entries, { chats: chatsN, artifacts: artCount, missing, docs: docsN });
  }

  function finish(top, entries, stats) {
    const zip = new Zip();
    entries.forEach(([p, c]) => zip.add(`${top}/${p}`, c));
    const name = `${top}.zip`;
    download(zip.blob(), name);
    return { ...stats, files: entries.length, name };
  }

  api.runtime.onConnect.addListener((port) => {
    if (port.name !== 'cx') return;
    port.onMessage.addListener(async (msg) => {
      try {
        if (msg.cmd === 'context') post(port, { type: 'context', chatId: currentId() });
        else if (msg.cmd === 'list') post(port, { type: 'list', chats: await listChats() });
        else if (msg.cmd === 'projects') post(port, { type: 'projects', projects: await listProjects() });
        else if (msg.cmd === 'exportProjects') post(port, { type: 'done', ...(await runProjects(msg.opts, port)) });
        else if (msg.cmd === 'scan') {
          const conv = await getChat(msg.id);
          const counts = {};
          collectArtifacts(pick(conv, msg.allBranches)).forEach((a) => { counts[a.category] = (counts[a.category] || 0) + 1; });
          post(port, { type: 'scan', id: msg.id, title: chatTitle(conv), counts });
        } else if (msg.cmd === 'export') post(port, { type: 'done', ...(await run(msg.opts, port)) });
      } catch (e) {
        post(port, { type: 'error', error: String((e && e.message) || e) });
      }
    });
  });
})();
