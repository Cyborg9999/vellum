# HANDOFF.md

> Single source of truth for cross-AI handoff. Read on entry, update on exit.
> Vellum is touched by Claude Code / Codex CLI / Cursor in rotation — each one lands blind without this.

## Last updated
2026-05-29T16:30+0800 by claude-opus-4-7 — recovery incident closed; 4 Codex files unrecoverable; hardening installed on branch `feat/handoff-hardening`

## Branch / commit
- Branch: `feat/handoff-hardening`
- HEAD: `a14471a feat(claude): Pass 0 导演骨架 + 绑定 fallback + 测试` (about to be followed by the handoff-hardening commit)

## Working tree status
Dirty — staging: `.claude/settings.json`, `scripts/safegit.sh`, `HANDOFF.md`, `CLAUDE.md`, `AGENTS.md`, `SETUP.md`, and the entire `.recovery/` archive. No tracked code under `src/` or `src-tauri/` was modified.

## What I just did
- Closed the file-loss incident: 4 files (see `.recovery/README.md` + `.recovery/source-report.md`) were overwritten by a prior agent's `git reset --hard`; salvaged what could be salvaged into `.recovery/by-file/claude.ts/` (BEST + variants).
- Installed 4 handoff guardrails:
  1. `.claude/settings.json` — SessionStart hook auto-stashes any dirty tree before Claude touches anything.
  2. `scripts/safegit.sh` — opt-in alias that refuses destructive git when the tree is dirty (override with `--i-mean-it`).
  3. This `HANDOFF.md` — the cross-AI baton.
  4. `CLAUDE.md` + `AGENTS.md` — handoff protocol section that every agent must obey on entry/exit.
- Archived `.recovery/` into the repo (intentionally NOT gitignored — it's the forensic record).

## What's next
- Resume `feat/openai-image-gen`: wire the OpenAI image-gen path into Pass 2 prompt expansion (see `src/passes/pass2/` if it exists yet, otherwise `src/lib/claude.ts` Pass 2 block).
- Add a vitest case for the fallback branch added in `a14471a` — currently only the happy path is covered.
- Decide whether `.recovery/` stays committed long-term or gets moved to `~/.vellum-recovery/` once the incident has cooled off.

## In flight / WIP
- No uncommitted code logic. The Pass 0 director skeleton is committed at `a14471a`. Pass 2 OpenAI image-gen binding is still on `feat/openai-image-gen` (parallel branch) — not in this hardening branch.

## Test status
- `npm test` (vitest): PASS as of `a14471a`.
- `npx tsc --noEmit`: PASS as of `a14471a`.
- `cd src-tauri && cargo test`: not re-run this session (no Rust changes).

## Heads-up for next AI
- READ THIS FILE FIRST. Then `git log --oneline -5` to confirm branch state.
- DO NOT `git reset --hard` / `git clean -fd` / `git checkout -- <path>` when the tree is dirty. The safegit alias will refuse; don't paper over it with `--i-mean-it` unless you've stashed first.
- `.recovery/` is the archive of the 2026-05-29 loss event. Do NOT delete it without asking the user.
- Jimeng CLI batch path in `scripts/jimeng-batch.ts` (if/when it lands) is fragile around stdin buffering — touch with care.
- Before exit: REWRITE this file in place. Keep it tight, ISO 8601 timestamps with timezone, sign with your agent name.
