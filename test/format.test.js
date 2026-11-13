// Runs under both `node --test` and `bun test`.
const { test } = process.versions.bun ? require('bun:test') : require('node:test');
const assert = require('node:assert/strict');

global.self = global;
require('../extension/lib/zip.js');
require('../extension/lib/format.js');
const { branch, collectArtifacts, artifactFiles, folderName, toMarkdown, toJson, toText, Zip } = self.CX;
const conv = require('./fixtures/chat.json');
const opts = { thinking: true, tools: true, toolResults: true, attachments: true, hideMeta: true };

test('branch follows the active leaf and drops abandoned branches', () => {
  const ids = branch(conv).map((m) => m.uuid);
  assert.deepEqual(ids, ['m1', 'm2', 'm3']);
});

test('folder name is a random 32-bit hex code plus the title', () => {
  const { randomHex } = self.CX;
  assert.match(randomHex(), /^[0-9a-f]{8}$/);
  assert.equal(folderName(conv, 'a3b4c5d6'), 'a3b4c5d6 - Build a todo app v2');
  assert.match(folderName(conv), /^[0-9a-f]{8} - Build a todo app v2$/);
});

test('artifacts: create_file, str_replace, shell heredocs (presented only), artifacts tool', () => {
  const arts = collectArtifacts(branch(conv));
  const by = Object.fromEntries(arts.map((a) => [a.name + '.' + a.ext, a]));
  assert.equal(by['index.html'].category, 'html');
  assert.equal(by['index.html'].versions.at(-1).content, '<h1>v2</h1>');
  assert.equal(by['index.html'].versions.length, 2);
  assert.equal(by['main.py'].category, 'code');
  assert.equal(by['main.py'].versions.at(-1).content, "print('hi')\nprint('bye')\n");
  assert.equal(by['main.py'].remote, true);
  assert.equal(by['app.zip'].category, 'file');
  assert.equal(by['My Chart.svg'].category, 'svg');
  assert.equal(by['scratch.txt'], undefined, 'unpresented shell scratch files are ignored');
});

test('artifactFiles lays files out under artifacts/<type>/ and skips content-less entries', () => {
  const arts = collectArtifacts(branch(conv));
  const files = artifactFiles(arts, false).map((f) => f.path).sort();
  assert.deepEqual(files, [
    'artifacts/code/main.py',
    'artifacts/html/index.html',
    'artifacts/svg/My Chart.svg',
  ]);
  const zipArt = arts.find((a) => a.name === 'app');
  assert.equal(zipArt.file, undefined);
  zipArt.final = new Uint8Array([80, 75]);
  assert.ok(artifactFiles(arts, false).some((f) => f.path === 'artifacts/files/app.zip'));
});

test('markdown starts at the title and hides metadata when asked', () => {
  const arts = collectArtifacts(branch(conv));
  artifactFiles(arts, false);
  const refs = {};
  arts.forEach((a) => { if (a.file) { refs[a.key] = a.file; if (a.remotePath) refs['p:' + a.remotePath] = a.file; } });
  const md = toMarkdown(conv, branch(conv), opts, refs);
  assert.ok(md.startsWith('# Build a todo app v2\n\n## User'));
  assert.ok(!/2026-01-01T/.test(md));
  assert.ok(!md.includes('Abandoned branch'));
  assert.match(md, /Planning the app/);
  assert.match(md, /\*\*Presented:\*\* \[`main.py`\]\(artifacts\/code\/main\.py\)/);
  assert.match(toMarkdown(conv, branch(conv), { ...opts, hideMeta: false }, refs), /Model: claude-test/);
});

test('json hides metadata keys but keeps content', () => {
  const j = JSON.parse(toJson(conv, branch(conv), true));
  assert.equal(j.title, 'Build a todo app v2');
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        assert.ok(!/(^|_)(uuid|timestamp|at)$/.test(k) || k === 'input', `leaked key ${k}`);
        if (k !== 'input') walk(x);
      }
    }
  };
  walk(j.messages);
  assert.equal(j.messages[0].content[0].text, 'Make a todo app');
});

test('text export includes thinking and omits metadata', () => {
  const t = toText(conv, branch(conv), { ...opts, tools: false, toolResults: false }, {});
  assert.ok(t.startsWith('Build a todo app v2\n\nUser\n'));
  assert.match(t, /\[Thinking\]\nPlanning the app/);
});

test('zip writer produces a readable archive with binary-safe entries', async () => {
  const z = new Zip();
  z.add('a/hello.txt', 'héllo');
  z.add('a/bin.dat', new Uint8Array([0, 1, 2, 255]));
  const buf = Buffer.from(await z.blob().arrayBuffer());
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50);
  assert.equal(buf.readUInt16LE(buf.length - 22 + 10), 2);
  assert.ok(buf.includes(Buffer.from([0, 1, 2, 255])));
});

test('presented files that could not be recovered are listed, not dropped', () => {
  const ok = '/mnt/user-data/outputs/a.js', gone = '/mnt/user-data/outputs/b.js';
  const c = { name: 'T', chat_messages: [{ uuid: 'x', sender: 'assistant', created_at: '2026-01-01T00:00:00Z',
    content: [{ type: 'tool_use', name: 'present_files', input: { filepaths: [ok, gone] } }] }] };
  const refs = { ['p:' + ok]: 'artifacts/code/a.js', ['missing:' + gone]: true };
  const md = toMarkdown(c, c.chat_messages, opts, refs);
  assert.match(md, /\*\*Presented:\*\* \[`a\.js`\]\(artifacts\/code\/a\.js\)/);
  assert.match(md, /\*\*Presented \(could not be recovered\):\*\* `b\.js`/);
  assert.match(toText(c, c.chat_messages, opts, refs), /\[Presented, could not be recovered: b\.js\]/);
});
