# Vellum

> Desktop app that automates an AI-video prompt workflow end to end · Tauri 2 + React 19 + TipTap

Vellum compresses the "Midjourney drafts → handwritten shots → LLM enhancement → video CLI submit" pipeline from 1–2 hours of manual work down to 5–10 minutes.

## Quick start

See [SETUP.md](./SETUP.md) for prerequisites and full installation.

```bash
cd ~/Projects/vellum && npm run tauri dev
```

## Stack

- **Tauri 2.0** + Rust — native desktop, 18 MB binary
- **React 19 + TypeScript + Vite 7 + TailwindCSS 4**
- **TipTap** rich-text editor (custom `@` image binding)
- **SQLite** for local persistence
- **Zustand** for state

## Core features

- **Image library**: import, drag-drop, role tags (character / scene / prop)
- **Shot editor**: three-stage vertical flow — Draft → First Pass → Final
- **`@` binding**: typing "character/scene/prop" before `@` triggers a role-aware image picker
- **Four LLM backends**: Claude API, Claude Code CLI, OpenAI API, Codex CLI
- **Video CLI submit** (in progress)

## Documentation

- [SETUP.md](./SETUP.md) — installation, configuration, data layout
- [CONTRIBUTING.md](./CONTRIBUTING.md) — contributor workflow
- [CLAUDE.md](./CLAUDE.md) — internal architecture notes (Chinese)

## Disclaimer

Vellum is an independent project. It is **not affiliated with, endorsed by, or sponsored by** Anthropic, OpenAI, Midjourney, or ByteDance. Names of third-party products and services are used only to describe interoperability.

The subscription-based backends (Claude Code CLI, Codex CLI) invoke locally-installed binaries via subprocess. Each user runs them against their own subscription and is responsible for ensuring that usage complies with the provider's terms of service.

## License

MIT — see [LICENSE](./LICENSE).
