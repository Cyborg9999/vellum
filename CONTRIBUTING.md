# Contributing to Vellum

Thanks for taking the time to look at the code. Vellum is maintained by a small group with a single owner who reviews and merges every change; this document describes the workflow we expect from contributors.

## First-time setup

```bash
git clone https://github.com/Cyborg9999/vellum.git
cd vellum
./scripts/setup.sh        # auto-detects dreamina / codex / claude on your machine
npm install
npm run tauri dev
```

`scripts/setup.sh` reads `src-tauri/capabilities/default.json.template` and writes a working `src-tauri/capabilities/default.json` for your machine (**local file, gitignored**).

If your `dreamina` / `codex` / `claude` binaries are not in `~/.local/bin/`, `/opt/homebrew/bin/`, or `/usr/local/bin/`, `setup.sh` leaves placeholders. Hand-edit `default.json` to point at the real absolute paths.

## Workflow

**`main` is protected** — direct pushes are blocked. All changes go through a pull request:

```bash
git checkout main && git pull
git checkout -b feat/your-thing       # or fix/xxx, chore/xxx
# edit code
npm test                              # must pass
npx tsc --noEmit                      # must be clean
git add ... && git commit -m "..."
git push -u origin feat/your-thing
gh pr create --title "..." --body "..."   # or open the PR via the GitHub UI
```

The owner (@Cyborg9999) reviews and merges. After merge, sync with `git checkout main && git pull`.

## Commit message style

Category prefix (`feat` / `fix` / `chore` / `test` / `docs` / `refactor` / `perf`) + short summary:

```
feat: soft-delete in library + Submit/dreamina closed loop
fix(library): make compactImageIndices atomic + add concurrency guard
fix(submit): split submit_id into its own column + whitelist status values
test: vitest baseline + 25 pure-function unit tests
docs: update SETUP.md with Apple Silicon path examples
```

The optional body explains **why**, not what.

## Pre-PR checklist

```bash
npx tsc --noEmit          # zero type errors
npm test                  # vitest passes
cargo build --manifest-path src-tauri/Cargo.toml    # Rust compiles
```

For UI changes also:

- Run `npm run tauri dev` and visually verify the change.
- Critical paths (Library, Shots, Submit, DB writes) need manual testing — passing the build is not enough.

## Code style

- TypeScript strict (`tsc --noEmit` must be clean).
- Comments explain **why**, not what. Don't reference the current PR or leave "TODO next PR" notes.
- Do **not** touch `compactImageIndices` — three critical bugs have already been fixed there. Open an issue first.
- Don't wrap code in `try`/`catch` to silently absorb errors. Let them propagate to the `ErrorBoundary`.

## Database migration protocol (important)

Migration files **are applied to every developer's local DB**. **Never edit an existing migration.** Add a new file instead:

```
src-tauri/migrations/00X_<name>.sql      ← new file, increment the number
src-tauri/src/lib.rs                     ← register the new migration
src/lib/types.ts                         ← keep TS types in sync
src/lib/db.ts                            ← add CRUD as needed
```

**Concurrency hazard**: if two of us both number a migration `007`, whoever merges first wins; the other must rebase and renumber to `008`.

## Do not commit

- `src-tauri/capabilities/default.json` (gitignored; generated per developer)
- `.claude/notes.local.md` (local scratch notes)
- API keys, `.env` files, `vellum.db`
- `grill-report-*.md`, `coverage/`, and other tool output

## Communication

- **Bugs, feature discussion, refactor proposals**: open a GitHub Issue.
- **PR review**: leave comments on the diff itself, not in chat — diff comments stay searchable.

## Known technical pitfalls

See the "已知陷阱" section of [CLAUDE.md](CLAUDE.md). The common ones:

- Vite 7 requires Node ≥ 20.19 (Node 21 crashes on `crypto.hash`).
- Tauri 2 SQL plugin permissions must list `sql:allow-execute` / `select` / `load` / `close`.
- TipTap Mention is unstable in Tauri WebKit release builds; we replaced it with a hand-written `handleKeyDown`.
- macOS Dock caches icons — `killall Dock` after changing them.
- `tauri build`'s `bundle_dmg.sh` occasionally crashes; re-running usually works.
- The Codex CLI must use `--sandbox read-only`. Do **not** use `--dangerously-bypass`.

## License

Vellum is released under the [MIT License](./LICENSE). By contributing you agree that your contributions will be licensed under the same terms.
