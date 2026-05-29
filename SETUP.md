# Vellum Setup

Vellum is a macOS-only desktop app. This guide assumes you are comfortable editing a few hard-coded paths during first-time setup.

## 1. System requirements

- **macOS** (Apple Silicon or Intel)
- **Rust** ≥ 1.95: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Node 22 LTS**: `nvm install 22` (Vite 7 requires ≥ 20.19; Node 21 crashes on `crypto.hash`)
- **Tauri CLI v2**: `cargo install tauri-cli --version "^2"`
- Cross-arch build (Intel Mac binary): `rustup target add x86_64-apple-darwin`

## 2. The three external CLIs

Vellum shells out to three external CLIs. You need access to each of them on your own account:

| CLI | Purpose | Install |
|---|---|---|
| `dreamina` | Video generation backend (the only path that actually submits a video) | Vendor-distributed; requires a subscription and login |
| `codex` | OpenAI Codex CLI (default Pass 2 backend; zero marginal cost under a ChatGPT subscription) | `npm install -g @openai/codex` |
| `claude` | Claude Code CLI (optional backend; zero marginal cost under a Claude subscription) | `curl -fsSL https://claude.ai/install.sh \| bash` |

Verify installation:

```bash
which dreamina codex claude
dreamina --help
codex --version
claude --version
```

> **Terms of service**: Each CLI runs against your own subscription. You are responsible for making sure your usage stays within the relevant provider's terms.

## 3. Patch hard-coded paths (required)

`src-tauri/capabilities/default.json` lists the **absolute paths** Tauri's shell sandbox is allowed to execute. The committed template uses the author's machine layout; you must regenerate it for your own.

**Run `scripts/setup.sh`**. It auto-resolves the three binaries with `which`, renders `src-tauri/capabilities/default.json.template`, and writes a local `src-tauri/capabilities/default.json` (this file is gitignored — one copy per developer):

```bash
./scripts/setup.sh
```

`setup.sh` looks for each binary in this order:
`$HOME/.local/bin/<name>` → `/opt/homebrew/bin/<name>` →
`/usr/local/bin/<name>` → `/usr/bin/<name>` → `which <name>` as a last resort.

If your binary lives somewhere else (e.g. an nvm global bin), `setup.sh` leaves a `__XXX_PATH__` placeholder. Hand-edit `src-tauri/capabilities/default.json` to fill in the absolute path, or symlink the binary into `/opt/homebrew/bin/` and re-run `setup.sh`.

> Tauri 2 capabilities **do not expand** `$HOME` / `~` inside `shell:allow-execute.cmd`, which is why we ship a template + script rather than one shared `default.json`.

## 4. Install and run

```bash
git clone https://github.com/Cyborg9999/vellum.git
cd vellum
./scripts/setup.sh           # generate local capabilities/default.json
npm install
npm run tauri dev            # dev mode, port 1420, hot reload
```

On first launch the SQLite migrations 001–006 run; the console should report `applied migration 6 (add_submit_id_column)`.

## 5. Configure settings (first launch)

Open the app, click ⚙ Settings, and pick an **Auth mode**:

| Mode | Latency | Cost |
|---|---|---|
| Claude API | Fast (3–10 s) | Pay-per-token; requires API key |
| Claude CLI | Slow (30–60 s) | Zero marginal (uses your Claude Code subscription) |
| OpenAI API | Fast (5–25 s) | Pay-per-token; requires API key |
| Codex CLI | Medium (10–30 s) | Zero marginal (uses your ChatGPT subscription) |

API keys are stored in the SQLite `settings` table (**plaintext** — see [Known caveats](#known-caveats)).

## 6. Build a .app

```bash
npm run tauri build           # produces src-tauri/target/release/bundle/macos/Vellum.app
# install to /Applications
rm -rf /Applications/Vellum.app
cp -R src-tauri/target/release/bundle/macos/Vellum.app /Applications/
open /Applications/Vellum.app

# Universal binary (Intel + ARM)
npm run tauri build -- --target universal-apple-darwin
```

`bundle_dmg.sh` occasionally fails due to `osascript` / `hdiutil` timing. **This does not affect the .app**; re-running the build usually works.

## 7. Tests

```bash
npm test            # vitest run, pure-function unit tests
npm run test:watch  # watch mode during development
npx tsc --noEmit    # type check
cargo test --manifest-path src-tauri/Cargo.toml   # Rust side
```

## 8. Where data lives

```
~/Library/Application Support/studio.vellum.desktop/
├── vellum.db          ← project metadata, ref-image rows, shots, submissions
└── pasted/            ← image copies created by Cmd+V paste-to-library
```

**Back up `vellum.db` before upgrading.** Failed migrations are painful to recover from.

## Known caveats

- **API keys are stored in plaintext in SQLite** (grill H5; not yet fixed) — be careful when sharing the DB file.
- **`fs:scope` is fairly broad** (includes `/Volumes/**` and `$HOME/Projects/**`, grill H6) — small renderer-XSS risk.
- **No Tauri updater** (deferred grill finding) — upgrades require manual `git pull` + rebuild.
- **No code signing** (no Apple Developer ID) — Gatekeeper blocks the first run; right-click → Open to bypass once.
