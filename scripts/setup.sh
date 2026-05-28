#!/usr/bin/env bash
# Vellum 本地 setup —— 检测 dreamina / codex / claude CLI 实际路径，
# 把 src-tauri/capabilities/default.json.template 渲染成本机能用的
# src-tauri/capabilities/default.json（本地版，gitignored）。
#
# 每个 collaborator clone 后跑一次这个脚本即可。

set -euo pipefail

cd "$(dirname "$0")/.."

TEMPLATE="src-tauri/capabilities/default.json.template"
OUTPUT="src-tauri/capabilities/default.json"

if [ ! -f "$TEMPLATE" ]; then
  echo "❌ 找不到 $TEMPLATE — 请确认你 clone 的是完整 repo" >&2
  exit 1
fi

detect_path() {
  local name="$1"
  # 优先查常见 bin 路径，确保是 executable file 而非目录或 alias
  local candidates=(
    "$HOME/.local/bin/$name"
    "/opt/homebrew/bin/$name"
    "/usr/local/bin/$name"
    "/usr/bin/$name"
  )
  local c
  for c in "${candidates[@]}"; do
    if [ -f "$c" ] && [ -x "$c" ]; then
      echo "$c"
      return
    fi
  done
  # Fallback: $PATH lookup, 但必须是真实 executable file
  local p
  p=$(which "$name" 2>/dev/null || true)
  if [ -n "$p" ] && [ -f "$p" ] && [ -x "$p" ]; then
    echo "$p"
    return
  fi
  echo ""
}

CLAUDE_PATH=$(detect_path claude)
CODEX_PATH=$(detect_path codex)
DREAMINA_PATH=$(detect_path dreamina)

missing=()
[ -z "$CLAUDE_PATH" ]   && missing+=("claude")
[ -z "$CODEX_PATH" ]    && missing+=("codex")
[ -z "$DREAMINA_PATH" ] && missing+=("dreamina")

if [ ${#missing[@]} -gt 0 ]; then
  echo "⚠️  以下 CLI 在 \$PATH 里没找到："
  for n in "${missing[@]}"; do
    echo "   - $n"
  done
  echo
  echo "继续生成 capabilities，对应字段会留占位符 __XXX_PATH__；"
  echo "等你装好对应 CLI 后再跑一次 scripts/setup.sh。"
  echo
fi

# 用 sed 替换占位符。-i '' 是 macOS BSD sed 的语法
cp "$TEMPLATE" "$OUTPUT"

# 用 | 作为分隔符避免路径里的 / 冲突
[ -n "$CLAUDE_PATH" ]   && sed -i '' "s|__CLAUDE_PATH__|$CLAUDE_PATH|g"     "$OUTPUT"
[ -n "$CODEX_PATH" ]    && sed -i '' "s|__CODEX_PATH__|$CODEX_PATH|g"       "$OUTPUT"
[ -n "$DREAMINA_PATH" ] && sed -i '' "s|__DREAMINA_PATH__|$DREAMINA_PATH|g" "$OUTPUT"

echo "✅ 生成 $OUTPUT"
echo
echo "  claude   → ${CLAUDE_PATH:-（未找到，占位符保留）}"
echo "  codex    → ${CODEX_PATH:-（未找到，占位符保留）}"
echo "  dreamina → ${DREAMINA_PATH:-（未找到，占位符保留）}"
echo
echo "下一步：npm install && npm run tauri dev"
