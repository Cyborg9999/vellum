# Source Report — Vellum Recovery Scan

Read-only scan of all known backup channels for the 7 lost-edit targets. Per-source detail below.

| # | Label | Accessible | Candidates | Winners |
|---|-------|------------|------------|---------|
| 1 | Cursor Local History | yes | 0 | 0 |
| 2 | apfs-local-snapshots | no | 0 | 0 |
| 3 | VSCode Local History | yes | 0 | 0 |
| 4 | Claude Code CLI session transcripts | yes | 0 | 0 |
| 5 | macOS backup + AI tool transcripts | yes | 15 | 0 |
| 6 | openai-codex-cli | yes | 5 | 1 (partial) |

---

## 1. Cursor Local History

- **Label:** Cursor Local History
- **Accessible:** yes
- **Candidate count:** 0
- **Note:** Cursor is installed but dormant. `~/Library/Application Support/Cursor/User/History/` is empty (last touched 2024-09-15). workspaceStorage contains only 2 stale workspaces from Sep 2024 pointing at `file:///Users/chengyue/Desktop/Visual%20Studio%20Code.app` — not Vellum. User does not appear to have opened the Vellum project in Cursor. Zero backups recoverable.

---

## 2. apfs-local-snapshots

- **Label:** apfs-local-snapshots
- **Accessible:** no
- **Candidate count:** 0
- **Note:** No recoverable APFS snapshots for user data.
  - `tmutil listlocalsnapshots /` returned empty.
  - `tmutil listlocalsnapshots /System/Volumes/Data` returned "No snapshots for disk3s5" — the volume holding `/Users/chengyue/Projects/vellum` has zero snapshots.
  - `tmutil listbackups` returned "No machine directory found for host" — Time Machine never produced a catalog visible from this host.
  - `diskutil apfs listSnapshots /` shows only one OS-update rollback snapshot on the sealed System volume (`com.apple.os.update-DEDECEC5...`). Does NOT contain `/Users/`.
  - `/Volumes/com.apple.TimeMachine.localsnapshots/` does not exist.
  - `/.snapshots/` does not exist.
  - Codex CLI edits between ~08:30 and ~15:30 BJT cannot be recovered via tmutil/snapshot restore.

---

## 3. VSCode Local History

- **Label:** VSCode Local History
- **Accessible:** yes
- **Candidate count:** 0
- **Note:** Root exists but contains only ONE hashed folder (`-44addc4a/`) with 2 backups of `settings.json` from May 25, 2026 — unrelated to Vellum. Exhaustive grep for `vellum`, `ShotsView`, `RichTextarea`, `dreamina`, `claude.test`, `dreamina.test` across the entire VSCode History tree returned zero matches. No VSCode Insiders, Trae, or Windsurf installations present. User likely edited Vellum in a different editor (terminal/Codex direct edits, JetBrains, or no editor with local-history enabled).

---

## 4. Claude Code CLI session transcripts

- **Label:** Claude Code CLI session transcripts
- **Accessible:** yes
- **Candidate count:** 0
- **Note:** Scanned 3 jsonl transcripts in `~/.claude/projects/-Users-chengyue-Projects-vellum/` (mtimes 2026-05-26 18:11, 2026-05-26 15:06, 2026-05-27 21:10) and 2 in the sibling `.../vellum-src-tauri/` (both 2026-05-25). All sessions ended on or before 2026-05-27 21:10 +0800 — 11+ hours BEFORE the `a14471a` baseline (2026-05-29 08:24) and 18+ hours before the Codex CLI extension window. Claude transcripts cannot contain the Codex-authored extensions. The richest transcript (557600bf) does contain historical tool_use blocks for claude.ts, ShotsView.tsx, and RichTextarea.tsx, but those predate the `a14471a` baseline and would REGRESS the working tree. No transcript references SubmitView.tsx, dreamina.ts, claude.test.ts, or dreamina.test.ts.

---

## 5. macOS backup + AI tool transcripts (read-only scan)

- **Label:** macOS backup + AI tool transcripts (read-only scan)
- **Accessible:** yes
- **Candidate count:** 15
- **Note:** Comprehensive surface enumeration. **Zero winners** — all 15 candidates were ruled out (binary SQLite DBs from Codex telemetry, Codex Desktop sparkle-update XML cache, Codex Desktop SQLite WAL, VSCode chat editing session placeholder, vellum.db SQLite snapshots that pre-date `a14471a`, Codex session JSONL transcripts that are read-only audit logs rather than file content).
  - **Time Machine:** NOT configured (`tmutil destinationinfo` reports "No destinations configured").
  - **~/.Trash/:** TCC-sandboxed but appears empty.
  - **/tmp & /private/tmp:** only Claude Code runtime artifacts; no `*.bak`, `*.swp`, `*.orig`, or `*vellum*` files.
  - **/var/folders/:** only AI-tool GPU/Metal/IPC caches; no source.
  - **~/Library/Containers/:** VSCode and Cursor are not sandboxed; no editor backups for Vellum.
  - **T7 Shield external drive:** mounted; contains personal video archive; no `Backups.backupdb`, no `vellum*` directories.
  - **VSCode chatEditingSessions/0f2a626a** (created 15:24, 10 min before reset): `state.json` is an empty placeholder, `contents/` is empty.
  - **Two `vellum.db.backup-*` files:** SQLite DB backups (Vellum desktop app runtime state, not source code). Pre-date `a14471a`.
  - **High-value remaining channels NOT in winner set but flagged:**
    - 72 dangling git blobs in `/Users/chengyue/Projects/vellum/.git/objects/` (git object DB survived the reset)
    - `~/.codex/logs_2.sqlite` (575 MB, 108k rows, `feedback_log_body` column)
    - `~/.codex/state_5.sqlite` (1.2 MB; tables `stage1_outputs`, `agent_job_items`)
    - Codex Desktop fsCachedData at `~/Library/Caches/com.openai.codex/` (mtime 15:35:06 matches loss event exactly)

---

## 6. openai-codex-cli

- **Label:** openai-codex-cli
- **Accessible:** yes
- **Candidate count:** 5
- **Note:** Codex CLI installed at `/opt/homebrew/bin/codex` with state in `~/.codex` (sessions/, state_5.sqlite, logs_2.sqlite, archived_sessions/, session_index.jsonl). Only ONE session in the 2026-05-29 08:00–16:00 BJT window touched Vellum: thread `019e7204-b9fc-7e00-a9b4-e68f81fbcee7` ("检查 Vellum 健康风险"), 12:36:12 → 12:40:42 BJT, rollout at `sessions/2026/05/29/rollout-2026-05-29T12-36-12-019e7204-...jsonl`.
  - That session is **read-only**. All 74 commands are reads (`nl -ba`, `sed -n`, `rg`, `git ls-files`). **Zero writes / apply_patch / heredocs / tee** anywhere.
  - Other recent sessions (019e67cb on 5/27, 019e5e31 on 5/25) also touch Vellum but are read-only inspection.
  - **Codex CLI on this machine did NOT perform the user's 08:30–15:30 editing work.** Editing was likely done in Codex Desktop (Chromium app, no readable transcripts) or never persisted before the reset.
  - **One partial WINNER:** the audit session captured pre-edit file state at 12:36 BJT (~3 h before loss) for src/lib/claude.ts via `nl -ba ... | sed -n A,Bp` commands. Coverage:
    - **src/lib/claude.ts:** 675/~2808 lines (24%) — 7 fragments. **Selected as winner** because the captured tail (lines 2735–2808) proves ~121 extra lines existed past current EOF.
    - src/components/SubmitView.tsx: ~530/530 lines but pre-session snapshot, current is already a superset → not a winner.
    - src/components/ShotsView.tsx: 356/1815+ lines captured but pre-session, current is already a superset → not a winner.
    - src/lib/dreamina.ts: byte-identical to current after stripping `nl -ba` prefixes → not a winner.
    - src/lib/dreamina.test.ts: pre-session fragment, current is superset → not a winner.
    - src/lib/claude.test.ts: NOT captured (only in `rg --files` listing).
    - src/components/editor/RichTextarea.tsx: NOT captured (only in `rg --files` listing).
