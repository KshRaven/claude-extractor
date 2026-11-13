<p align="center"><img src="extension/icons/icon-128.png" width="96" alt="Claude Extractor logo"></p>

<h1 align="center">Claude Extractor</h1>

<p align="center">
Export claude.ai chats and projects as a clean zip: history, thinking, tool calls and every artifact, sorted by type.
</p>

<p align="center">
<a href="https://github.com/KshRaven/claude-extractor/actions/workflows/ci.yml"><img src="https://github.com/KshRaven/claude-extractor/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

Works in Chrome, Brave, Edge and Firefox. Everything runs in your browser using your existing claude.ai session; nothing is sent anywhere else.

## Install

Download the zip for your browser from [Releases](https://github.com/KshRaven/claude-extractor/releases), or use the `extension/` folder from a clone.

**Chrome, Brave, Edge:** open `chrome://extensions` (`brave://extensions`, `edge://extensions`), turn on Developer mode, choose **Load unpacked**, and select the `extension/` folder (or the unzipped release).

**Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `manifest.json`. Firefox may need the site allowed under `about:addons`. Temporary add-ons are removed when Firefox restarts.

Open claude.ai, click the extension icon, and export. Reload any claude.ai tab that was open before you installed.

## What you get

A single chat:

```
a3f09c12 - Chat title.zip
└── a3f09c12 - Chat title/
    ├── history.md
    ├── history.json
    ├── history.txt
    └── artifacts/
        ├── html/  react/  svg/  markdown/  mermaid/  code/  files/
```

The 8-digit hex code is random and new on every download press, so two exports never share a name. Several chats give `Claude export <date>.zip` with one folder per chat.

A project:

```
5be1d7a4 - Project name.zip
└── 5be1d7a4 - Project name/
    ├── description.md
    ├── instructions.md
    ├── knowledge/                 the project's documents
    └── chats/a3f09c12 - Chat title/   history and artifacts, optional
```

## Options

| Option | Effect |
| --- | --- |
| Hide metadata (default on) | Removes timestamps, IDs, model and other bookkeeping from every history file |
| Markdown, JSON, Text | Choose the history formats |
| Thinking, tool calls, tool results, attachment text | Choose what the history includes |
| All branches | Include edited and retried messages, not only the visible thread |
| Artifact types | Export only the types you want; counts show what the open chat contains |
| Keep every version | Also save earlier versions under `versions/` |
| Projects tab | Export whole projects, with or without their chats |

Artifacts include the artifacts panel, files Claude created, and files made with shell commands once they were presented in the chat. Presented files are downloaded in full; if that is not possible you get the content rebuilt from the commands, and the popup reports how many files could not be recovered.

## Limitations

- claude.ai has no public export API. This extension uses the same internal endpoints the website does, which can change without notice. If something stops working, [open an issue](https://github.com/KshRaven/claude-extractor/issues/new?template=bug_report.yml).
- Projects export the description, instructions and text documents. Uploaded binary files in a project are not exported.
- A project's chats are matched by the project ID each chat reports.

## Development

```
npm run ci      # syntax and manifest checks, then tests
npm run build   # dist/claude-extractor-<version>-chromium.zip and -firefox.zip
```

No dependencies and no build step: the files in `extension/` are what runs. See [CONTRIBUTING.md](CONTRIBUTING.md). To release, see [Releasing](#releasing).

## Help

- [Usage and install help](#install)
- [Report a bug](https://github.com/KshRaven/claude-extractor/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/KshRaven/claude-extractor/issues/new?template=feature_request.yml)
- [Security policy](SECURITY.md)

## License

[MIT](LICENSE)

## Releasing

Versioning is semi-automatic: `extension/manifest.json` is the source of truth and the script keeps `package.json` in sync (CI fails if they differ).

1. Add changes under `## Unreleased` in `CHANGELOG.md` while you work.
2. From a clean `main`: `bun run release patch` (or `minor`, `major`, or an exact `1.5.0`). Add `--dry` to preview. This runs check and tests, bumps both files, stamps the changelog, commits `Release vX.Y.Z` and tags it.
3. Publish: `git push origin HEAD && git push origin vX.Y.Z`, or add `--push` in step 2.
4. The Release workflow rebuilds, verifies the tag matches the manifest, and creates a GitHub Release with both zips and that version's changelog section as notes.
