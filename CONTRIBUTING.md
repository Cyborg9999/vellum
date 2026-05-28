# Contributing to Vellum (Internal)

Vellum 是一个**私人协作**项目。这份文档是给 collaborator 看的内部约定，
不是开源 contributor guide。

## 第一次 setup

```bash
git clone https://github.com/Cyborg9999/vellum.git
cd vellum
./scripts/setup.sh        # 自动检测你机器上的 dreamina / codex / claude 路径
npm install
npm run tauri dev
```

`scripts/setup.sh` 会基于 `src-tauri/capabilities/default.json.template` 生成
你本地能跑的 `src-tauri/capabilities/default.json`（**本地文件，gitignored**）。

如果你的 dreamina / codex / claude 不在 `~/.local/bin/` / `/opt/homebrew/bin/`
/ `/usr/local/bin/`，setup.sh 会留占位符，自己手动编辑 `default.json` 把
对应 cmd 改成你机器的真实路径。

## 工作流

**Repo 是 protected main**——你不能直接 push 到 main。所有改动走 PR：

```bash
git checkout main && git pull
git checkout -b feat/your-thing       # 或 fix/xxx / chore/xxx
# 改代码
npm test                              # 必须全绿
npx tsc --noEmit                      # 必须 0 错误
git add ... && git commit -m "..."
git push -u origin feat/your-thing
gh pr create --title "..." --body "..."   # 或者 GitHub web UI 开 PR
```

Owner（@Cyborg9999）审完 → merge → 你 `git checkout main && git pull` 同步。

## Commit message 风格

中文标题 + 类别前缀（feat / fix / chore / test / docs / refactor / perf）+ 简短描述：

```
feat: 软删除图库 + Submit/dreamina 提交闭环
fix(library): compactImageIndices 原子 + 并发互斥
fix(submit): submit_id 单独列 + status 白名单
test: vitest 基线 + 25 个纯函数 unit test
docs: 更新 SETUP.md 加 Apple Silicon 路径示例
```

正文（可选）解释 **why**，不解释 what。不需要 `Co-Authored-By` trailer。

## Pre-PR checklist

```bash
npx tsc --noEmit          # 类型 0 错误
npm test                  # vitest 全绿
cargo build --manifest-path src-tauri/Cargo.toml    # Rust 编译通过
```

UI 改动还要：

- 跑一遍 `npm run tauri dev`，亲眼看一遍改的功能能用
- 关键路径（Library / Shots / Submit / DB 写）一定要手测，不要只看 build 过

## 代码风格

- TypeScript strict（`tsc --noEmit` 必须 0 错误）
- 注释只写 **why**，不写 what / 不引用当前 PR / 不带 "TODO 等下个 PR 修"
- 别动 `compactImageIndices` —— grill 修过 3 个 critical bug，再改先开 issue 讨论
- 别加 try-catch 掩盖错误。错误就让它 throw 到 ErrorBoundary

## DB migration 协议（重要）

migration 文件**已应用到所有人的本地 DB**，**永远不要改老的 migration**。新加字段就**新写一个 migration**：

```
src-tauri/migrations/00X_<name>.sql      ← 新增，编号递增
src-tauri/src/lib.rs                     ← 注册新 migration
src/lib/types.ts                         ← 同步 TS 类型
src/lib/db.ts                            ← 加 CRUD
```

**多人并行风险**：你写了 migration 007，我同时也写了 migration 007，谁先 merge 谁占编号，后者必须 rebase 把自己的改成 008。

## 不要 commit 的东西

- `src-tauri/capabilities/default.json`（gitignored，每人本地生成）
- `.claude/notes.local.md`（本地 scratch 笔记）
- API keys、`.env` 文件、`vellum.db`
- `grill-report-*.md`、`coverage/` 之类的工具产出

## 沟通

- **Bug / feature 讨论 / 重构提议**：开 GitHub Issue
- **同步聊**：飞书 / 微信（具体群链接 owner 发你）
- **PR 评论**：在 PR 文件 diff 上点评，不要在群里讨论代码细节（不可追溯）

## 已知技术陷阱（避免踩坑）

参考 [CLAUDE.md](CLAUDE.md) "已知陷阱" 一节。常见的：

- Vite 7 要 Node ≥ 20.19（Node 21 会炸 `crypto.hash`）
- Tauri 2 SQL plugin 权限必须列出 `sql:allow-execute / select / load / close`
- TipTap Mention 在 Tauri WebKit release build 不稳，已用手写 `handleKeyDown` 替换
- macOS Dock 缓存图标，改 icon 要 `killall Dock`
- `tauri build` 的 `bundle_dmg.sh` 偶尔崩，重跑一次就行
- codex CLI 必须用 `--sandbox read-only`，**不能**用 `--dangerously-bypass`

## License

私人 repo，no LICENSE file = all rights reserved。你提交的代码版权归 owner
（@Cyborg9999）所有，仅用于本 repo 内部协作。
