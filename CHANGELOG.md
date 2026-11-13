# Changelog

## Unreleased

## 1.4.1
- Presented files that cannot be recovered are now listed in the history (Markdown and text) instead of being left out.
- Files that could not be recovered are named in an amber notice on the claude.ai page and in the popup, and the popup shows the last export result when reopened.

## 1.4.0
- Folders and zip names are prefixed with a random 8-digit (32-bit) hex code, new on every download.
- Fix `bun run test` on Windows; check and test scripts work under Node and Bun.
- `scripts/release.js` for one-command versioning and releases.
- Help, Report an issue and GitHub links in the popup. The report link pre-fills version and browser.
- Repository setup: tests, build script, CI and release workflows, issue and PR templates.

## 1.3.0
- Export projects: description, instructions, knowledge documents and optionally their chats.
- Files created with shell commands and presented in a chat are now found and downloaded in full.
- Folders are named `NNNN - Title`; history files are `history.md`, `history.json`, `history.txt`.

## 1.2.0
- Redesigned popup with light and dark themes and a new logo.
- Hide metadata option, on by default.
- Artifacts sorted into folders by type, with per-type selection and counts.

## 1.1.0
- Tool calls, results, thinking and attachments in the history.
- Artifact versions.

## 1.0.0
- First release: export chats as JSON, Markdown or text.
