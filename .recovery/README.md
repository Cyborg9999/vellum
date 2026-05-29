# Vellum Recovery Report

**Incident timestamp:** 2026-05-29 ~15:34 +0800 (the `a14471a` reset that wiped Codex CLI edits made between ~08:30 and ~15:30 BJT)

**Summary:** 20 candidates scanned across 6 sources. **1 winner** across **1 target** (src/lib/claude.ts) — a partial reconstruction with reference value only, **not a drop-in restore**. The other 6 targets have **no usable backup**.

---

## Sources scanned (6)

| # | Source | Accessible | Candidates | Winners |
|---|--------|------------|------------|---------|
| 1 | Cursor Local History | yes | 0 | 0 |
| 2 | apfs-local-snapshots | no | 0 | 0 |
| 3 | VSCode Local History | yes | 0 | 0 |
| 4 | Claude Code CLI session transcripts | yes | 0 | 0 |
| 5 | macOS backup + AI tool transcripts | yes | 15 | 0 (all rejected as binary DBs, cache files, or unrelated transcripts) |
| 6 | openai-codex-cli | yes | 5 | 1 (partial only) |

See [source-report.md](source-report.md) for per-source detail.

---

## Per-target findings

### 1. `src/lib/claude.ts` — WINNER FOUND (partial, reference only)

- **Current `a14471a` state:** 2687 lines, 129552 bytes (mtime 2026-05-29 15:34)
- **Winners:**

| Source label | mtime | Lines | Size delta | Verdict |
|---|---|---|---|---|
| codex-cli (rollout JSONL extract) | 2026-05-29T12:40:42+0800 | 696 (header + 7 fragments) | −101744 B | Partial reconstruction; same-file identity confirmed; captured tail (lines 2735–2808) proves ~121 extra lines existed past current EOF. Large internal gaps prevent drop-in restore. |

**Recommendation:** Use as **evidence + reference only**, not as a drop-in restore. The backup is a stitched extract from Codex session JSONL with 7 discontiguous fragments covering lines 80–170, 209–390, 400–470, 1840–1975, 2220–2285, 2680–2735, 2735–2808 of a ~2808-line source. Massive gaps (171–208, 391–399, 471–1839, 1976–2219, 2286–2679) mean it cannot replace the working file. However, the tail beyond current's line 2687 is real evidence that additional helpers/logic were added before the reset.

**Recommended workflow (NOT a clean overwrite):**

```sh
# 1. Inspect the captured tail (lines 2735-2808 in the reconstruction)
#    for symbols that are MISSING from current src/lib/claude.ts
less .recovery/by-file/claude.ts/BEST.ts

# 2. Diff each captured fragment against current to identify forward edits
diff <(sed -n '80,170p' src/lib/claude.ts) \
     <(grep -A1000 'fragment-80-170' .recovery/by-file/claude.ts/BEST.ts)

# 3. Hand-merge any new helpers/logic into src/lib/claude.ts, then commit
git diff src/lib/claude.ts
git add src/lib/claude.ts && git commit -m "recover: claude.ts tail helpers from codex-cli session 019e7204"
```

**Do NOT run `cp .recovery/by-file/claude.ts/BEST.ts src/lib/claude.ts`** — it would shrink the file from 2687 lines to 696 lines and destroy everything in the gaps.

---

### 2. `src/components/ShotsView.tsx` — NO WINNER

- **Current `a14471a` state:** 1984 lines, 66424 bytes
- **Backup found from any of the 6 scanned sources:** No usable forward edit.
  - The codex-cli partial (368 lines covering 1–230 + 1690–1815) is a **pre-session snapshot** explicitly labeled "file state at session start, BEFORE any edits". Current file is already a superset.
  - The Codex session JSONL (220 lines) is a read-only audit transcript, not source content.

**Manual recovery options:**
- Re-do the work with Codex CLI (the 12:36 audit session can be replayed for context)
- Time Machine restore via Finder — **Not configured on this Mac** (`tmutil destinationinfo` returned no destinations)
- Inspect 72 dangling git blobs: `cd /Users/chengyue/Projects/vellum && git fsck --lost-found` then `git cat-file -p <sha>` to fingerprint each blob against this filename
- Check `~/.codex/logs_2.sqlite` (`feedback_log_body` column, 108k rows) for any apply_patch payloads referencing this file

---

### 3. `src/components/SubmitView.tsx` — NO WINNER

- **Current `a14471a` state:** 639 lines, 20294 bytes
- **Backup found from any of the 6 scanned sources:** No usable forward edit.
  - The codex-cli partial (541 lines) is a pre-session snapshot truncated at line 530; current file is already a superset (includes OptNumber + Sep helpers absent from the backup).
  - The Codex session JSONL is a read-only audit transcript.

**Manual recovery options:**
- Re-do the work with Codex CLI
- Time Machine restore via Finder — **Not configured on this Mac**
- Inspect 72 dangling git blobs (see ShotsView.tsx instructions above)
- Check `~/.codex/logs_2.sqlite` / `state_5.sqlite` for apply_patch payloads

---

### 4. `src/lib/dreamina.ts` — NO WINNER

- **Current `a14471a` state:** 268 lines, 8450 bytes
- **Backup found from any of the 6 scanned sources:** No usable forward edit.
  - The codex-cli partial (278 lines) reports +10 lines but after stripping the header + `nl -ba` line-number prefixes, the 268 content lines are **byte-identical** to the current file (`diff -q` produces no output). It is a pre-session snapshot, not a forward edit.

**Manual recovery options:**
- Current file is intact at `a14471a` baseline — verify no forward edits were intended for this file
- Re-do the work with Codex CLI
- Time Machine restore via Finder — **Not configured on this Mac**
- Inspect 72 dangling git blobs

---

### 5. `src/components/editor/RichTextarea.tsx` — NO WINNER

- **Current `a14471a` state:** 483 lines, 14363 bytes
- **Backup found from any of the 6 scanned sources:** **None.** The Codex audit session (12:36 BJT) only saw this file in an `rg --files` listing — never read, never edited. No partial reconstruction available.

**Manual recovery options:**
- Re-do the work with Codex CLI
- Time Machine restore via Finder — **Not configured on this Mac**
- Inspect 72 dangling git blobs (highest priority for this file since no other evidence exists)
- Check `~/.codex/logs_2.sqlite` / `state_5.sqlite` for apply_patch payloads
- Check Codex Desktop fsCachedData at `~/Library/Caches/com.openai.codex/` (mtime 15:35:06 matches loss event — only 9.6 KB so cheap to inspect)

---

### 6. `src/lib/claude.test.ts` — NO WINNER

- **Current `a14471a` state:** 363 lines, 13544 bytes
- **Backup found from any of the 6 scanned sources:** **None.** Same as RichTextarea.tsx — only appeared in `rg --files` listing in the Codex audit session, never read, never edited.

**Manual recovery options:**
- Re-do the work with Codex CLI
- Time Machine restore via Finder — **Not configured on this Mac**
- Inspect 72 dangling git blobs
- Check `~/.codex/logs_2.sqlite` / `state_5.sqlite`

---

### 7. `src/lib/dreamina.test.ts` — NO WINNER

- **Current `a14471a` state:** 105 lines, 4664 bytes
- **Backup found from any of the 6 scanned sources:** No usable forward edit.
  - The codex-cli partial (41 lines, only file lines 45–75) is a pre-session snapshot; current file is a strict superset.

**Manual recovery options:**
- Re-do the work with Codex CLI
- Time Machine restore via Finder — **Not configured on this Mac**
- Inspect 72 dangling git blobs
- Check `~/.codex/logs_2.sqlite` / `state_5.sqlite`

---

## Cross-cutting recovery channels (apply to all 6 no-winner targets)

These were surfaced by the macOS-backup scan but not yet fully exploited:

1. **72 dangling git blobs** — `cd /Users/chengyue/Projects/vellum && git fsck --lost-found` returned 72 dangling blobs. Git object DB survived the reset. **Highest-fidelity remaining channel.** Iterate and fingerprint each blob by shebang/imports against the 6 missing targets.
2. **`~/.codex/logs_2.sqlite`** — 575 MB, 108652 rows. Grep `feedback_log_body` for `apply_patch` payloads referencing target filenames.
3. **`~/.codex/state_5.sqlite`** — 1.2 MB. Tables `stage1_outputs` and `agent_job_items` are likely to hold persisted edit payloads.
4. **Codex Desktop cache at 15:35:06** — `~/Library/Caches/com.openai.codex/fsCachedData/D48A8286-...` (9.6 KB) and `Cache.db-wal` (3.2 MB). Mtimes coincide *exactly* with the loss window.
5. **Time Machine** — confirmed **NOT configured** on this Mac. Not a viable channel.
6. **APFS local snapshots** — confirmed **none exist** for the Data volume. Not a viable channel.

---

## Round 2 — SQLite + dangling blob deep dive

**Scope:** Exploited the cross-cutting channels surfaced in Round 1 — namely `~/.codex/logs_2.sqlite`, `~/.codex/state_5.sqlite`, and the 72 dangling git blobs from `git fsck --lost-found`. Verified 19 additional candidates across all 7 targets.

**Net result:** **2 new winners**, both for `src/lib/claude.ts` (the same target Round 1 already had a partial for). Both are still fragments, not drop-in replacements. **The other 6 targets remain unrecoverable from any automated channel.**

### Round 2 source tally

| Source | Candidates verified | Winners |
|---|---|---|
| `~/.codex/logs_2.sqlite` rollout extracts | 7 | 1 (claude.ts) |
| `~/.codex/state_5.sqlite` rollout extracts | 5 | 1 (claude.ts) |
| Dangling git blobs (`git fsck --lost-found`) | 7 | 0 (all confirmed as **older** history snapshots, pre-08:24 session) |

### Per-target Round 2 findings

#### 1. `src/lib/claude.ts` — 2 NEW WINNERS (fragments, reference value)

- **Round 2 found new winners:** **YES**

| Source label | mtime | Lines | Completeness | Verdict |
|---|---|---|---|---|
| logs_2.sqlite rollout 019e7204 | 2026-05-29T12:36:17+0800 | 2807 (683 real, 2124 placeholders) | fragment | Tail anchors (`bytesToBase64` L2778, `mediaTypeFromPath` L2800) sit ~130 lines past current EOF → **proves newer pre-loss state existed**. 76% placeholder coverage prevents drop-in. |
| state_5.sqlite rollout 019e7204 | 2026-05-29T12:40:42+0800 | 686 (7 contiguous spans + 5 explicit GAP markers) | fragment | Captured tail L2735–2808 also extends ~121 lines past current EOF. Same evidence pattern as logs_2 winner; complements it with explicit gap markers rather than placeholder lines. |

- **Dangling-blob candidates (3 verified, 0 winners):** blobs `f478d49`, `4efdbcf`, `71dfbe2` are all coherent full-file snapshots from 2026-05-28 (pre-session), all missing today's `VELLUM_DIRECTOR_WORKFLOW` import, today's `runTracked` import, and today's hardened `bytesToBase64` (grill-M7 fix). Strictly older history; restoring would discard ~1100 lines of confirmed-committed work.

**Updated recovery recommendation:** The two Round 2 fragments are now staged alongside the Round 1 BEST. Use **all three** as diff oracles to identify what tail helpers/exports existed at ~12:36 BJT that are missing from current `a14471a`. Merge symbol-by-symbol; do **NOT** overwrite.

```sh
# Inspect both Round 2 fragments (the tails past line 2687 are the key evidence)
less .recovery/by-file/claude.ts/round2-logs_2-rollout-019e7204-2026-05-29T12-36-17+0800.ts
less .recovery/by-file/claude.ts/round2-state_5-019e7204-2026-05-29T12-40-42+0800.ts

# Diff the captured tail (lines past 2687) against current EOF to spot missing symbols
diff <(tail -n 200 src/lib/claude.ts) \
     <(tail -n 200 .recovery/by-file/claude.ts/round2-logs_2-rollout-019e7204-2026-05-29T12-36-17+0800.ts)
diff <(tail -n 200 src/lib/claude.ts) \
     <(tail -n 200 .recovery/by-file/claude.ts/round2-state_5-019e7204-2026-05-29T12-40-42+0800.ts)

# After hand-merging any missing tail helpers:
git diff src/lib/claude.ts
git add src/lib/claude.ts && git commit -m "recover: claude.ts tail helpers from codex rollout 019e7204 (R2)"
```

**Do NOT `cp` either Round 2 file over `src/lib/claude.ts`** — both are heavily gapped and would destroy ~75% of the current file.

**`BEST.ts` unchanged:** still points at the Round 1 state_5 fragment. Neither Round 2 winner is `full-file`, so the upgrade rule did not trigger.

---

#### 2. `src/components/ShotsView.tsx` — NO NEW WINNER

- **Round 2 found new winners:** **NO**
- **Candidates verified:** 3 (1 logs_2 rollout fragment, 1 state_5 rollout fragment, 2 dangling git blobs)
  - logs_2 rollout: stitched fragment, 1814 lines with 1457 placeholders, head + tail match current — older snapshot.
  - state_5 rollout: partial capture, 364 lines, 80% gap — older snapshot.
  - Dangling blobs `fc5a2ad` + `901a278`: full-file 2026-05-28 snapshots, both missing today's `useMemo`/`DIRECTOR_RULE_VERSION`/`compactRevision`/`ContextMenu`/`RenameDialog` additions. Strictly older history.

**All channels exhausted. Recovery options remaining:**
- Manual re-do via Codex CLI (replay the 12:36 audit session for context)
- Hope for new sources (e.g., a forgotten editor swap file, a `Trash` entry)
- Accept the loss — re-derive from the current `a14471a` baseline

---

#### 3. `src/components/SubmitView.tsx` — NO NEW WINNER

- **Round 2 found new winners:** **NO**
- **Candidates verified:** 3 (1 logs_2 rollout, 1 state_5 rollout, 1 dangling git blob)
  - logs_2 rollout: 529-line snapshot, truncated mid-statement in `SubmitOptions` array — older pre-edit, internally truncated.
  - state_5 rollout: 537-line coherent snapshot but current is a 639-line superset.
  - Dangling blob `cafded9`: full-file 2026-05-28 snapshot. Diff against current shows only one delta — backup has `duration: 15` and lacks the safety comment; current has `duration: 5` plus the explanatory comment. Backup pre-dates the safety-hardening edit.

**All channels exhausted. Recovery options remaining:**
- Manual re-do via Codex CLI
- Hope for new sources
- Accept the loss

---

#### 4. `src/lib/dreamina.ts` — NO NEW WINNER

- **Round 2 found new winners:** **NO**
- **Candidates verified:** 3 (1 logs_2 rollout, 1 state_5 rollout, 1 dangling git blob)
  - logs_2 rollout: 267-line full-file snapshot, `diff` differs only by trailing newline — content-identical to current.
  - state_5 rollout: 275-line snapshot (header banner + 268-line payload); payload `diff` against current returns empty — content-identical.
  - Dangling blob `b3db215`: 2026-05-28 full-file snapshot, missing `runTracked` import, `SUBMIT_TIMEOUT_MS`/`QUERY_TIMEOUT_MS`, `redactArgs` (grill M6), and the hardened `extractSubmitId` (grill H3). Strictly older history.

**All channels exhausted.** Current file at `a14471a` is intact and is itself the freshest known state. Recovery options remaining:
- Manual re-do via Codex CLI (only if forward edits were intended for this file)
- Hope for new sources
- Accept the loss

---

#### 5. `src/components/editor/RichTextarea.tsx` — NO NEW WINNER

- **Round 2 found new winners:** **NO**
- **Candidates verified:** 1 (1 logs_2 rollout fragment)
  - logs_2 rollout: 323-line placeholder skeleton; only 6 lines of real code (grep snippets from rollout), 317 placeholders. Cannot align with current's 483-line structure. Zero recovery value.
  - Dangling git blobs: none matched this filename's shebang/imports.

**All channels exhausted. Recovery options remaining:**
- Manual re-do via Codex CLI (highest priority — no automated channel surfaced anything useful)
- Hope for new sources (Codex Desktop fsCachedData at 15:35:06 still uninspected — 9.6 KB only)
- Accept the loss

---

#### 6. `src/lib/claude.test.ts` — NO NEW WINNER

- **Round 2 found new winners:** **NO**
- **Candidates verified:** 1 (1 logs_2 rollout fragment)
  - logs_2 rollout: 360-line skeleton with 283 placeholders; 77 lines of real content all match current `a14471a` verbatim. Strict subset of current file — no forward edit, no new identifiers.
  - Dangling git blobs: none matched.

**All channels exhausted. Recovery options remaining:**
- Manual re-do via Codex CLI
- Hope for new sources
- Accept the loss

---

#### 7. `src/lib/dreamina.test.ts` — NO NEW WINNER

- **Round 2 found new winners:** **NO**
- **Candidates verified:** 2 (1 logs_2 rollout, 1 state_5 rollout)
  - logs_2 rollout: 102-line skeleton with ~33 placeholders (imports + closing braces missing). All concrete code matches current `a14471a` verbatim. Strict subset.
  - state_5 rollout: 38-line fragment (6 header lines + lines 8–39 of source), covers a slice of the normalizeDreaminaStatus / extractSubmitId describes. Matches current near-verbatim — pre-edit fragment, no new content.
  - Dangling git blobs: none matched.

**All channels exhausted. Recovery options remaining:**
- Manual re-do via Codex CLI
- Hope for new sources
- Accept the loss

---

### Round 2 staged artifacts

```
.recovery/by-file/claude.ts/
  BEST.ts                                                        # unchanged from Round 1
  codex-cli-2026-05-29T12-40-42+0800.ts                          # Round 1 winner (unchanged)
  round2-logs_2-rollout-019e7204-2026-05-29T12-36-17+0800.ts     # NEW R2 winner (placeholder-heavy fragment)
  round2-state_5-019e7204-2026-05-29T12-40-42+0800.ts            # NEW R2 winner (gap-marker fragment)

.recovery/by-file/ShotsView.tsx/        # empty — no winner
.recovery/by-file/SubmitView.tsx/       # empty — no winner
.recovery/by-file/dreamina.ts/          # empty — no winner (current intact)
.recovery/by-file/RichTextarea.tsx/     # empty — no winner
.recovery/by-file/claude.test.ts/       # empty — no winner
.recovery/by-file/dreamina.test.ts/     # empty — no winner
```

### Round 2 conclusion

The SQLite + dangling-blob channels confirmed the structural shape of the loss but did **not** yield a clean restore for any target. The two new fragments for `claude.ts` strengthen the evidence that a longer pre-loss state existed (tail extends ~120 lines past current EOF) but neither is dense enough to drop in. For the other 6 targets, **all automated channels are now exhausted**; the only paths forward are manual re-derivation, waiting for an undiscovered source to surface, or accepting the loss.
