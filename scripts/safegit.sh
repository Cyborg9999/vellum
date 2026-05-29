#!/usr/bin/env bash
# safegit.sh — project-local guard against accidental data loss.
# Intercepts destructive git subcommands when the working tree is dirty.
# Pass --i-mean-it anywhere in the argv to override.
#
# Trade-offs (read scripts/SAFEGIT.md):
#   - Only active when `git` resolves to this script (alias or PATH shim).
#   - Does not run for IDE/GUI git calls that bypass the alias.
#   - Checks "dirty" via `git status --porcelain` on the CURRENT repo only.

set -u

# Resolve the real git binary. Prefer /usr/bin/git, fall back to `command git`
# minus our own alias. Avoid infinite recursion at all costs.
REAL_GIT=""
for candidate in /usr/bin/git /opt/homebrew/bin/git /usr/local/bin/git; do
  if [ -x "$candidate" ]; then
    REAL_GIT="$candidate"
    break
  fi
done
if [ -z "$REAL_GIT" ]; then
  # Last resort: ask the shell, but strip aliases/functions.
  REAL_GIT="$(unalias git 2>/dev/null; unset -f git 2>/dev/null; command -v git)"
fi
if [ -z "$REAL_GIT" ] || [ "$REAL_GIT" = "$0" ]; then
  echo "safegit: cannot locate real git binary" >&2
  exit 127
fi

# --- helpers -----------------------------------------------------------------

has_flag() {
  local needle="$1"; shift
  for a in "$@"; do
    [ "$a" = "$needle" ] && return 0
  done
  return 1
}

strip_flag() {
  local needle="$1"; shift
  local out=()
  for a in "$@"; do
    [ "$a" = "$needle" ] || out+=("$a")
  done
  printf '%s\n' "${out[@]}"
}

is_dirty() {
  # Non-empty porcelain output = dirty (tracked changes OR untracked files).
  local out
  out="$("$REAL_GIT" status --porcelain 2>/dev/null)" || return 1
  [ -n "$out" ]
}

refuse() {
  local what="$1"
  cat >&2 <<EOF
🚫 safegit: refusing '$what' — working tree is dirty.
   You would lose uncommitted changes (and possibly untracked files).

   Safe options:
     • git stash -u        # stash tracked + untracked, then retry
     • git status          # see what's at risk
     • git add -A && git commit -m wip   # snapshot first

   If you really mean it, re-run with --i-mean-it:
     git $* --i-mean-it
EOF
  exit 1
}

# --- dispatch ----------------------------------------------------------------

# Find the first non-flag arg = the subcommand. Git allows global flags like
# -C <path> or -c key=val before the subcommand; skip those.
SUBCMD=""
i=1
argv=("$@")
while [ $i -le $# ]; do
  tok="${argv[$((i-1))]}"
  case "$tok" in
    -C|-c|--git-dir|--work-tree|--namespace|--exec-path)
      i=$((i+2)); continue ;;
    -*)
      i=$((i+1)); continue ;;
    *)
      SUBCMD="$tok"; break ;;
  esac
done

OVERRIDE=0
if has_flag --i-mean-it "$@"; then
  OVERRIDE=1
fi

# Build a clean argv (without --i-mean-it) to forward to real git.
CLEAN_ARGV=()
for a in "$@"; do
  [ "$a" = "--i-mean-it" ] || CLEAN_ARGV+=("$a")
done

guard() {
  local label="$1"
  if [ "$OVERRIDE" -eq 1 ]; then
    return 0
  fi
  if is_dirty; then
    refuse "$label" "${CLEAN_ARGV[@]}"
  fi
}

case "$SUBCMD" in
  reset)
    # Only --hard is destructive to working tree.
    if has_flag --hard "$@"; then
      guard "reset --hard"
    fi
    ;;
  checkout)
    # `git checkout -- <path>` or `git checkout .` discards working-tree changes.
    # Branch switches without -- are not blocked (git already protects them).
    for a in "$@"; do
      if [ "$a" = "--" ] || [ "$a" = "." ]; then
        guard "checkout (discard working tree)"
        break
      fi
    done
    ;;
  restore)
    # `git restore .` / `git restore <path>` is the modern destructive form.
    if ! has_flag --staged "$@" && ! has_flag -S "$@"; then
      # Any restore that touches the working tree without --staged is risky.
      guard "restore (discard working tree)"
    fi
    ;;
  clean)
    # -f / -fd / -fdx all delete untracked files.
    for a in "$@"; do
      case "$a" in
        -f|-fd|-fdx|-fdX|--force) guard "clean (delete untracked)"; break ;;
      esac
    done
    ;;
  stash)
    # `git stash drop` and `git stash clear` destroy stashed work.
    for a in "$@"; do
      case "$a" in
        drop|clear) guard "stash $a"; break ;;
      esac
    done
    ;;
  branch)
    # -D force-deletes a branch even if unmerged.
    if has_flag -D "$@"; then
      # Dirty check is less relevant here, but unmerged-branch loss is the risk.
      # We still gate on --i-mean-it to force a pause.
      if [ "$OVERRIDE" -ne 1 ]; then
        cat >&2 <<EOF
🚫 safegit: refusing 'branch -D' — this force-deletes an unmerged branch.
   Safer: 'git branch -d <name>' (refuses if unmerged).
   Re-run with --i-mean-it to override.
EOF
        exit 1
      fi
    fi
    ;;
esac

exec "$REAL_GIT" "${CLEAN_ARGV[@]}"

# ─── docs (sourced into SAFEGIT.md) ─────────────────────────────────────────
# Refuses destructive git subcommands when the working tree is dirty:
# `reset --hard`, `checkout -- / .`, `restore` (working-tree), `clean -f*`,
# `stash drop|clear`, `branch -D`.
#
# Bypass when intentional: append `--i-mean-it` to the same command
# (e.g. `git reset --hard HEAD~1 --i-mean-it`).
#
# Limits — be honest:
# - Only active in shells where `git` resolves to this script (the alias).
#   VSCode's git panel, JetBrains, Tower, and any tool that calls
#   /usr/bin/git directly will bypass it.
# - Dirty-check is per-repo via `git status --porcelain`; submodules with
#   their own dirt are not inspected.
# - Git has no native `pre-reset` hook, so `core.hooksPath` cannot replace
#   this wrapper.
