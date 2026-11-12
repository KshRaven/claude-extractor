# Contributing

Thanks for helping. The extension has no runtime dependencies and no build step, so the source in `extension/` is exactly what runs.

## Setup

Node 20 or newer is all you need.

```
git clone https://github.com/KshRaven/claude-extractor.git
cd claude-extractor
npm run ci      # syntax and manifest checks, then tests
npm run build   # zips for Chromium and Firefox in dist/
```

Load `extension/` unpacked in your browser (see the README) and reload it after each change.

## Layout

| Path | Purpose |
| --- | --- |
| `extension/lib/format.js` | Turns a conversation into JSON, Markdown and text, and rebuilds artifacts |
| `extension/lib/zip.js` | Small store-only zip writer |
| `extension/content.js` | Runs on claude.ai: fetches chats and projects, builds the zip |
| `extension/popup/` | Popup UI |
| `test/` | Node tests and a synthetic chat fixture |

## Guidelines

- Changes to export behaviour need a test. Use the synthetic fixture in `test/fixtures`, never a real conversation.
- Keep the zip layout stable; people script against it. If it must change, say so in `CHANGELOG.md`.
- claude.ai's internal API is undocumented and changes. Fail soft: keep what you can export and report what you could not.
- Add user-facing changes under `## Unreleased` in `CHANGELOG.md` as you go. Releasing is then one command (see README).

## Reporting problems

Use [Issues](https://github.com/KshRaven/claude-extractor/issues/new/choose). Do not paste private conversation content.
