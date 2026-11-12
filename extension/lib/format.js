// Conversation -> JSON / Markdown / TXT, active-branch walker, artifact reconstruction.
(() => {
  const CATS = [
    ['html', 'HTML'], ['react', 'React'], ['svg', 'SVG'], ['markdown', 'Markdown'],
    ['mermaid', 'Mermaid'], ['code', 'Code'], ['file', 'Other files'],
  ];
  const CAT_DIR = { html: 'html', react: 'react', svg: 'svg', markdown: 'markdown', mermaid: 'mermaid', code: 'code', file: 'files' };
  const TYPE_MAP = {
    'text/html': ['html', 'html'],
    'image/svg+xml': ['svg', 'svg'],
    'text/markdown': ['markdown', 'md'],
    'application/vnd.ant.react': ['react', 'jsx'],
    'application/vnd.ant.mermaid': ['mermaid', 'mmd'],
    'application/vnd.ant.code': ['code', null],
  };
  const LANG = {
    python: 'py', javascript: 'js', typescript: 'ts', java: 'java', cpp: 'cpp', 'c++': 'cpp', c: 'c',
    csharp: 'cs', go: 'go', rust: 'rs', ruby: 'rb', php: 'php', swift: 'swift', kotlin: 'kt',
    bash: 'sh', shell: 'sh', sql: 'sql', json: 'json', yaml: 'yml', css: 'css', html: 'html',
    xml: 'xml', markdown: 'md', text: 'txt',
  };
  const EXT_CAT = { html: 'html', htm: 'html', svg: 'svg', md: 'markdown', markdown: 'markdown', jsx: 'react', tsx: 'react', mmd: 'mermaid', mermaid: 'mermaid' };
  const CODE_EXT = new Set(['py', 'js', 'mjs', 'cjs', 'ts', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'sh', 'bash', 'sql', 'css', 'scss', 'json', 'yml', 'yaml', 'toml', 'xml', 'vue', 'svelte', 'lua', 'r', 'pl', 'ps1', 'bat']);
  const ART_TOOLS = new Set(['artifacts', 'create_file', 'str_replace']);

  const safeName = (s, max = 80) =>
    String(s || '').normalize('NFKC').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '').replace(/\s+/g, ' ')
      .trim().replace(/^\.+/, '').slice(0, max).replace(/[. ]+$/, '');
  const chatTitle = (c) => safeName(c.name) || safeName(c.summary) || 'Untitled chat';
  const who = (m) => (m.sender === 'human' ? 'User' : 'Claude');
  // Random 32-bit code (8 hex digits), generated fresh for every download press.
  const randomHex = () => crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(8, '0');
  const folderName = (c, code = randomHex()) => `${code} - ${(chatTitle(c).slice(0, 60).trim() || 'Untitled')}`;

  // Follow current_leaf_message_uuid back through parent links (active branch only).
  function branch(conv) {
    const msgs = conv.chat_messages || [];
    const leaf = conv.current_leaf_message_uuid;
    if (!leaf) return msgs;
    const by = new Map(msgs.map((m) => [m.uuid, m]));
    const out = [], seen = new Set();
    let cur = by.get(leaf);
    while (cur && !seen.has(cur.uuid)) { seen.add(cur.uuid); out.push(cur); cur = by.get(cur.parent_message_uuid); }
    return out.length ? out.reverse() : msgs;
  }

  const applyEdits = (text, ups) => {
    for (const u of ups) if (u && u.old_str != null && text.includes(u.old_str)) text = text.replace(u.old_str, () => u.new_str ?? '');
    return text;
  };
  const artKey = (b) => {
    const i = b.input || {};
    return b.name === 'artifacts' ? 'a:' + i.id : 'f:' + i.path;
  };

  const BASH = new Set(['bash_tool', 'bash']);
  const presentedPaths = (i) => [].concat((i && (i.filepaths || i.file_paths || i.paths)) || []).filter((p) => typeof p === 'string');

  // Files written with `cat > path <<'EOF' ... EOF` inside shell commands.
  function heredocs(cmd) {
    const out = [], re = /cat\s*(>>?)\s*(?:"([^"]+)"|'([^']+)'|([^\s<>|&;]+))\s*<<-?\s*(['"]?)(\w+)\5/g;
    let m;
    while ((m = re.exec(cmd))) {
      const nl = cmd.indexOf('\n', re.lastIndex);
      if (nl < 0) break;
      const start = nl + 1, d = m[6];
      const rest = cmd.slice(start);
      const e = rest.search(new RegExp('^[ \\t]*' + d + '[ \\t]*$', 'm'));
      if (e < 0) break;
      out.push({ path: m[2] || m[3] || m[4], append: m[1] === '>>', text: rest.slice(0, e) });
      re.lastIndex = start + e + d.length;
    }
    return out;
  }

  // Rebuild every artifact/file (with versions) from tool calls: the artifacts tool, create_file /
  // str_replace, and shell heredocs. Shell-made files only count once they are presented.
  function collectArtifacts(msgs) {
    const map = new Map();
    const push = (a, content, m, cmd) => a.versions.push({ content: content ?? '', ts: m.created_at || null, command: cmd });
    const findHd = (p) => {
      const exact = map.get('f:' + p);
      if (exact) return exact;
      for (const a of map.values()) {
        if (a.kind !== 'file' || !a.hd) continue;
        const rel = a.path.replace(/^\.\//, '');
        if (!rel.startsWith('/') && p.endsWith('/' + rel)) return a;
      }
      return null;
    };
    for (const m of msgs) for (const b of m.content || []) {
      if (b.type !== 'tool_use' || !b.input || typeof b.input !== 'object') continue;
      const i = b.input;
      const ups = i.updates || (i.old_str != null ? [{ old_str: i.old_str, new_str: i.new_str }] : []);
      if (b.name === 'artifacts' && i.id) {
        const k = 'a:' + i.id;
        let a = map.get(k);
        if (!a) {
          if (i.command === 'update') continue;
          a = { key: k, kind: 'artifact', id: i.id, title: i.id, type: '', language: '', versions: [] };
          map.set(k, a);
        }
        if (i.title) a.title = i.title;
        if (i.type) a.type = i.type;
        if (i.language) a.language = i.language;
        if (i.command === 'update') {
          if (!a.versions.length) continue;
          push(a, applyEdits(a.versions.at(-1).content, ups), m, 'update');
        } else push(a, i.content, m, i.command || 'create');
      } else if (b.name === 'create_file' && i.path) {
        const k = 'f:' + i.path;
        let a = map.get(k);
        if (!a) { a = { key: k, kind: 'file', path: i.path, title: i.path, versions: [] }; map.set(k, a); }
        a.explicit = true;
        push(a, i.file_text, m, 'create');
      } else if (b.name === 'str_replace' && i.path) {
        const a = map.get('f:' + i.path);
        if (a && a.versions.length) push(a, applyEdits(a.versions.at(-1).content, ups), m, 'update');
      } else if (BASH.has(b.name) && typeof i.command === 'string') {
        for (const h of heredocs(i.command)) {
          const k = 'f:' + h.path;
          let a = map.get(k);
          if (!a) { a = { key: k, kind: 'file', path: h.path, title: h.path, versions: [], hd: true }; map.set(k, a); }
          const prev = h.append && a.versions.length ? a.versions.at(-1).content : '';
          push(a, prev + h.text, m, h.append ? 'update' : 'create');
        }
      } else if (b.name === 'present_files') {
        for (const p of presentedPaths(i)) {
          let a = findHd(p);
          if (!a) { a = { key: 'f:' + p, kind: 'file', path: p, title: p, versions: [] }; map.set(a.key, a); }
          a.presented = true;
          a.remote = true;
          a.remotePath = p;
        }
      }
    }
    return [...map.values()]
      .filter((a) => (a.versions.length || a.remote) && (a.kind === 'artifact' || a.explicit || a.presented))
      .map((a) => {
        if (a.kind === 'artifact') {
          const [cat, ext] = TYPE_MAP[a.type] || ['code', null];
          a.category = cat;
          a.ext = ext || LANG[(a.language || '').toLowerCase()] || 'txt';
          a.name = safeName(a.title) || safeName(a.id) || 'artifact';
        } else {
          const base = a.path.split('/').pop();
          const dot = base.lastIndexOf('.');
          const ext = (dot > 0 ? base.slice(dot + 1) : 'txt').toLowerCase().replace(/[^a-z0-9]/g, '') || 'txt';
          a.ext = ext;
          a.category = EXT_CAT[ext] || (CODE_EXT.has(ext) ? 'code' : 'file');
          a.name = safeName(dot > 0 ? base.slice(0, dot) : base) || 'file';
        }
        return a;
      });
  }

  const bodyOf = (a) => (a.final != null ? a.final : a.versions.length ? a.versions.at(-1).content : null);

  // Paths relative to the chat folder: artifacts/<type>/<name>.<ext>. Sets a.file on every artifact written.
  function artifactFiles(arts, allVersions) {
    const used = new Set(), out = [];
    for (const a of arts) {
      const body = bodyOf(a);
      if (body == null) continue;
      const dir = `artifacts/${CAT_DIR[a.category] || 'files'}`;
      let stem = a.name, n = 2;
      while (used.has(`${dir}/${stem}.${a.ext}`.toLowerCase())) stem = `${a.name} (${n++})`;
      a.file = `${dir}/${stem}.${a.ext}`;
      used.add(a.file.toLowerCase());
      out.push({ path: a.file, content: body });
      if (allVersions && a.versions.length > 1) {
        a.versions.forEach((v, i) => out.push({ path: `${dir}/versions/${stem}.v${i + 1}.${a.ext}`, content: v.content }));
      }
    }
    return out;
  }

  // ---- JSON ----
  const NOISE = new Set([
    'index', 'truncated', 'stop_reason', 'model', 'settings', 'is_starred', 'is_temporary', 'is_archived',
    'current_leaf_message_uuid', 'account', 'sync_sources', 'flags', 'thumbnail_url', 'preview_url',
    'thumbnail_asset', 'preview_asset', 'file_kind', 'display_content', 'icon_name', 'integration_name',
    'tool_origin', 'meta', 'cut_off', 'hidden', 'thinking_hidden', 'is_multiplayer', 'platform',
    'workspace_upgraded', 'is_wiggle_enabled', 'effective_thinking_mode',
  ]);
  const META_RE = /(^|_)(uuid|timestamp|at)$/;
  function strip(v) {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) {
        if (META_RE.test(k) || NOISE.has(k)) continue;
        o[k] = k === 'input' ? x : strip(x);
      }
      return o;
    }
    return v;
  }
  function toJson(conv, msgs, hideMeta) {
    if (!hideMeta) return JSON.stringify({ ...conv, chat_messages: msgs }, null, 2);
    const messages = msgs.map((m) => {
      const c = strip(m);
      if (c.content && c.content.length) delete c.text;
      for (const k of ['attachments', 'files', 'files_v2']) if (Array.isArray(c[k]) && !c[k].length) delete c[k];
      return c;
    });
    return JSON.stringify({ title: chatTitle(conv), messages }, null, 2);
  }

  // ---- Markdown / TXT ----
  function fence(s, lang = '') {
    let n = 3;
    const m = String(s).match(/`+/g);
    if (m) n = Math.max(3, Math.max(...m.map((x) => x.length)) + 1);
    const f = '`'.repeat(n);
    return `${f}${lang}\n${s}\n${f}`;
  }

  function resultText(b) {
    const c = b.content;
    if (typeof c === 'string') return c;
    if (!Array.isArray(c)) return JSON.stringify(c ?? b.display_content ?? '', null, 2);
    return c.map((x) => (typeof x === 'string' ? x : x.type === 'text' ? x.text : x.url ? `${x.title || ''} - ${x.url}` : JSON.stringify(x))).join('\n');
  }

  const thinkText = (b) => {
    if (b.thinking) return b.thinking;
    const s = Array.isArray(b.summaries) ? b.summaries.map((x) => x && x.summary).filter(Boolean) : [];
    return s.join('\n\n');
  };
  const blocks = (m) => (m.content && m.content.length ? m.content : [{ type: 'text', text: m.text || '' }]);
  const link = (label, path) => (path ? `[${label}](${encodeURI(path)})` : label);
  const refFor = (b, refs) => (ART_TOOLS.has(b.name) && refs ? refs[artKey(b)] : null);

  function artRef(b, refs) {
    const i = b.input || {};
    const verb = b.name === 'str_replace' ? 'edited' : b.name === 'create_file' ? 'created' : (i.command || 'created') === 'update' ? 'updated' : 'created';
    const label = b.name === 'artifacts' ? i.title || i.id : '`' + i.path + '`';
    return `> **Artifact ${verb}:** ${link(label, refs[artKey(b)])}`;
  }

  function toolCall(b) {
    const i = b.input;
    const desc = b.message ? `\n\n*${b.message}*` : '';
    let body;
    if (i && typeof i === 'object' && typeof i.command === 'string' && Object.keys(i).every((k) => ['command', 'description', 'message'].includes(k))) body = fence(i.command, 'bash');
    else body = fence(typeof i === 'string' ? i : JSON.stringify(i, null, 2), 'json');
    return `**Tool call:** \`${b.name}\`${desc}\n\n${body}`;
  }

  function renderBlock(b, o, refs) {
    switch (b.type) {
      case 'text': return b.text || '';
      case 'thinking': {
        const t = thinkText(b);
        return o.thinking && t ? `<details>\n<summary>Thinking</summary>\n\n${t}\n\n</details>` : '';
      }
      case 'tool_use': {
        if (b.name === 'present_files') {
          const hit = presentedPaths(b.input).filter((p) => refs && refs['p:' + p]);
          if (hit.length) return hit.map((p) => `> **Presented:** ${link('`' + p.split('/').pop() + '`', refs['p:' + p])}`).join('\n');
          return o.tools ? toolCall(b) : '';
        }
        if (refFor(b, refs)) return artRef(b, refs);
        return o.tools ? toolCall(b) : '';
      }
      case 'tool_result':
        return o.toolResults ? `**Tool result:** \`${b.name || ''}\`${b.is_error ? ' (error)' : ''}\n\n${fence(resultText(b))}` : '';
      default:
        return o.tools ? fence(JSON.stringify(b, null, 2), 'json') : '';
    }
  }

  function attachMd(m, o) {
    const r = [];
    for (const a of m.attachments || []) {
      r.push(`> **Attachment:** ${a.file_name || 'file'}` +
        (o.attachments && a.extracted_content ? `\n\n<details><summary>Content</summary>\n\n${fence(a.extracted_content)}\n\n</details>` : ''));
    }
    for (const f of m.files_v2 || m.files || []) r.push(`> **File:** ${f.file_name || 'upload'}`);
    return r;
  }

  function toMarkdown(conv, msgs, o, refs) {
    const out = [`# ${chatTitle(conv)}`];
    if (!o.hideMeta) {
      const meta = [
        conv.model && `- Model: ${conv.model}`,
        conv.created_at && `- Created: ${conv.created_at}`,
        conv.updated_at && `- Updated: ${conv.updated_at}`,
        conv.uuid && `- Link: https://claude.ai/chat/${conv.uuid}`,
      ].filter(Boolean);
      if (meta.length) out.push(meta.join('\n'));
    }
    for (const m of msgs) {
      const parts = [`## ${who(m)}${!o.hideMeta && m.created_at ? ` (${m.created_at})` : ''}`];
      parts.push(...attachMd(m, o));
      for (const b of blocks(m)) { const t = renderBlock(b, o, refs); if (t) parts.push(t); }
      out.push(parts.join('\n\n'));
    }
    return out.join('\n\n') + '\n';
  }

  function toText(conv, msgs, o, refs) {
    const out = [chatTitle(conv)];
    for (const m of msgs) {
      const parts = [];
      for (const b of blocks(m)) {
        if (b.type === 'text' && b.text) parts.push(b.text);
        else if (b.type === 'thinking' && o.thinking && thinkText(b)) parts.push(`[Thinking]\n${thinkText(b)}`);
        else if (b.type === 'tool_use') {
          if (b.name === 'present_files') {
            const hit = presentedPaths(b.input).filter((p) => refs && refs['p:' + p]);
            if (hit.length) parts.push(hit.map((p) => `[Presented: ${refs['p:' + p]}]`).join('\n'));
            else if (o.tools) parts.push(`[Tool call: ${b.name}] ${JSON.stringify(b.input)}`);
          } else if (refFor(b, refs)) parts.push(`[Artifact: ${refs[artKey(b)]}]`);
          else if (o.tools) parts.push(`[Tool call: ${b.name}] ${JSON.stringify(b.input)}`);
        } else if (b.type === 'tool_result' && o.toolResults) parts.push(`[Tool result: ${b.name || ''}]\n${resultText(b)}`);
      }
      out.push(`${who(m)}${!o.hideMeta && m.created_at ? ` (${m.created_at})` : ''}\n${parts.join('\n\n')}`);
    }
    return out.join('\n\n') + '\n';
  }

  self.CX = Object.assign(self.CX || {}, {
    CATS, safeName, chatTitle, randomHex, folderName, branch, collectArtifacts, artifactFiles, toJson, toMarkdown, toText,
  });
})();
