# Vellum

> 桌面 app · 即梦视频提示词工作流全自动化 · Tauri 2 + React 19 + TipTap
>
> **Goal**: 把"Midjourney 出图 → 手写镜头 → GPT 强化 → 即梦 CLI 发起视频"这套流程从 1-2 小时人力 → 5-10 分钟自动。
>
> **GitHub**: https://github.com/Cyborg9999/vellum  (private)

## 当前实现状态（2026-05-26）

| 模块 | 状态 | 备注 |
|---|---|---|
| Project create / switch | ✅ | SQLite 持久化 |
| Library: import / drag-drop / 角色场景道具标签 / (图N) 编号 | ✅ | Tauri fs + asset protocol |
| Library 3 布局切换 (Grid / Masonry / List) + localStorage 记忆 | ✅ | `vellum.libraryLayout` key |
| Library 双击大图 Lightbox + 箭头翻页 + Esc/点空白关 | ✅ | `src/components/ImageLightbox.tsx` |
| Sidebar: 可展开 Library + 3 列缩略图 + 荧光绿数字角标 | ✅ | 缩略图可拖到任意 RichTextarea |
| Shots: **3 阶段垂直流** (Draft → First Pass 第一版详细 → Final 带 (图N)+风格) | ✅ | 替代了旧的 shot list 设计 |
| Pass 1 prompt: 拆镜头+大量细化（80-180字/镜头，物理反应、衣摆翻飞、火花裂痕） | ✅ | `镜头N，[镜头类型]，...` 中文逗号格式 |
| Pass 2 prompt: 用户给的固定指令 + 1800 字内 + 3D/Blur/胡金铨 + 保留视角修饰词 | ✅ | 见 `src/lib/claude.ts` PASS_2_USER_INSTRUCTION |
| Submit stage: 自动扫 (图N) 引用 → 拼 `人物=图片1,图片4` `场景=图片2` header | ✅ | `buildSubmitPayload` in claude.ts |
| Settings: 4 个 Auth mode (Claude API / Claude CLI / OpenAI API / Codex CLI) | ✅ | 2×2 grid 卡片切换；Codex CLI 走提示词优化专用 wrapper |
| TipTap rich editor + @ 触发 image picker | ✅ | 手写 keydown + createPortal，绕开 TipTap Mention |
| 绑定规则: 主角/场景/道具@图 → role-aware popup (banner + 排序) | ✅ | 见下文「绑定规则」 |
| Logo: DM Serif Display Italic + 纯荧光绿 + glow（去渐变） | ✅ | 之前是 Orbitron 渐变，已换 |
| 即梦 CLI 提交 | ⏳ TODO | 等用户给 CLI --help 输出 |
| Tauri updater 自动更新 | ⏳ TODO | 待用户提供 GitHub repo 后接入 |

## AI 接力协议（HANDOFF）

> 多个 AI（Claude Code / Codex CLI / Cursor）轮流接手本仓库。下面规则**强制**，违反一次就可能把上一个 AI 的活儿冲掉。

**会话开始**
- 第一步：`Read /Users/chengyue/Projects/vellum/HANDOFF.md`
- 文件不存在 → 你来建第一份，再开工
- 文件存在 → 接上次的「下一步」继续，别另起炉灶

**会话结束前（含 token 耗尽 / 用户中断 / 任务完成）**
- 必须 `Edit` 或 `Write` HANDOFF.md，三段：`## <ISO 时间戳> · <agent-name>` / `### 刚做了什么` / `### 下一步`
- token 快没了也要留 30 秒写 handoff，比留个烂尾摊强

**Git 安全（红线）**
- 工作区脏（有 unstaged / untracked）时，**禁止**：`git reset --hard` / `git clean -fd` / `git checkout -- <path>` / `git stash drop`
- 真要清理：先 `git stash push -u -m "before <op> by <agent>"`
- **禁止** `git commit --amend` 你不是作者的 commit（看 `git log -1 --format=%an`）

**遇到别人的 WIP**
- 工作区有你没写的改动 = 上一个 AI 留的活 → **不要清掉**
- 三选一：① 问用户 ② 在它基础上继续 ③ 先 stash 再干自己的

**End-of-session WIP 兜底**
```bash
# 有未完成改动又不能合进当前分支时：
git checkout -b "wip/$(date +%Y%m%d-%H%M)-<topic>"
git add -A && git commit -m "wip: <一句话上下文> [by <agent-name>]"
# 然后在 HANDOFF.md 里记下分支名
```

## 环境准备

- **Rust**：`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Node 22 LTS**：`nvm install 22`（Vite 7 要求 ≥20.19，Node 21 会炸 `crypto.hash`）
- **Tauri CLI v2**：`cargo install tauri-cli --version "^2"`
- 跨架构目标（Intel Mac）：`rustup target add x86_64-apple-darwin`

## 测试

```bash
# Rust 单元测试
cargo test --manifest-path src-tauri/Cargo.toml

# 前端类型检查（暂无 vitest，用 tsc 代替）
npx tsc --noEmit
```

暂无 E2E 自动化测试 — 关键路径（Library 导入、@ 绑定、Claude API/CLI 调用）需人工验证后再交付。

## 启动方式

```bash
# 开发模式（热重载，端口 1420）
cd ~/Projects/vellum && npm run tauri dev

# 打包成 .app（生成 ~/Projects/vellum/src-tauri/target/release/bundle/macos/Vellum.app）
cd ~/Projects/vellum && npm run tauri build
# 装到 /Applications:
rm -rf /Applications/Vellum.app && cp -R src-tauri/target/release/bundle/macos/Vellum.app /Applications/
# 启动: open /Applications/Vellum.app  (或 Cmd+Space "vellum")

# 跨架构 build (Intel Mac 用)
rustup target add x86_64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```

DMG 偶尔会 `bundle_dmg.sh` 失败（osascript/hdiutil 时序），不影响 .app 生成。再跑一遍通常就好。

## 技术栈

- **Tauri 2.0** + Rust，binary 18MB
- **React 19 + TypeScript + Vite 7 + TailwindCSS 4**
- **TipTap** 富文本（自定义 ImageBadge inline node）
- **SQLite** via `tauri-plugin-sql` (sqlite feature)
- **Zustand** 状态管理
- **lucide-react** 图标
- **sharp** 给 icon-source.png 加 squircle 圆角（macOS-style，22.37% 圆角率）
- **Node 22 LTS**（Vite 7 要求 ≥20.19，21 会炸 `crypto.hash`）
- 字体：UI 全 monospace（SF Mono / JetBrains Mono），VELLUM logo 用 **DM Serif Display Italic** 纯荧光绿 + 24px/60px 双层 glow（之前是 Orbitron 渐变，已换）
- **Tauri devtools**: 现为 opt-in feature flag（`features = []` 默认），release build 默认无 inspect element。如需开调试，build 加 `--features devtools`

## 关键文件结构

```
src/
  App.tsx                          - 主壳：TopBar + Sidebar (含可展开 Library) + StatusBar
  components/
    ProjectPicker.tsx              - 工作区首屏（项目列表 + 新建）
    LibraryView.tsx                - 图片库（import / drag-drop / role tags）
    ShotsView.tsx                  - 镜头编辑器（Draft + 每镜头双栏 Raw↔Enhanced）
    SettingsModal.tsx              - ⚙ 弹窗：Auth mode + API key
    editor/
      RichTextarea.tsx             - TipTap 编辑器，手写 @ 触发 + createPortal 弹窗
      ImageBadge.ts                - 自定义 inline node：[圆头像] 图片N chip
      MentionList.tsx              - @ 弹窗 React 组件，竖向列表 + binding banner
  lib/
    db.ts                          - SQL 包装 + project/refImage/shot/setting CRUD
    store.ts                       - Zustand：currentProject + refImages + actions
    claude.ts                      - Claude API 调用（API mode = fetch；CLI mode = subprocess to $HOME/.local/bin/claude）
    types.ts                       - 镜像 schema 的 TS 类型
    utils.ts                       - cn() helper
src-tauri/
  src/lib.rs                       - Tauri 启动 + 注册插件 + SQL migrations (v1 + v2)
  migrations/001_init.sql          - 6 张表
  migrations/002_workflow_fields.sql - ALTER projects 加 draft/first_pass/final_pass text
  capabilities/default.json        - 精细权限：fs:scope 已收紧到 $APPDATA/$PICTURE/$DOWNLOAD/$DESKTOP/$DOCUMENT/$HOME/Projects/**（不再 "**" 放行全盘）；shell:allow-execute 双白名单 (claude + codex 绝对路径)
  tauri.conf.json                  - assetProtocol scope ["**"]
  Cargo.toml                       - tauri = features ["protocol-asset"]，devtools 改为 opt-in feature flag
  icons/                           - 由 npm run tauri icon 从 public/icon-source.png 生成
public/
  workspace.png                    - 工作区右侧封面（816×1456 红/品红霓虹少女全身）
  icon-source.png                  - 图标源图（1024×1024 红/橙霓虹脸部）
scripts/
  round-icon.mjs                   - 给 icon-source 加 squircle 圆角，输出 /tmp/vellum-icon-rounded-1024.png
```

## 绑定规则（核心约定）

**用户在 @ 前打 "主角/场景/道具" 这类词，选图后即绑定**。三层实现：

```typescript
// 1. UI 检测 (RichTextarea.tsx)
const BINDING_PATTERNS = [
  { re: /(主角|男主|女主|反派|角色)$/, role: "character" },
  { re: /(场景|背景|环境)$/, role: "scene" },
  { re: /(道具|物品|武器|法器)$/, role: "prop" },
];

// 2. Popup 顶部 binding banner + 对应 role 的图自动置顶

// 3. Claude system prompt 已写入约定:
//    "看到 X(图N) → 完全用图N视觉信息描述该实体，后续保持 (图N) 引用"
```

**序列化**：编辑器里看到 `主角[图片1] 站在山巅` → 发给 Claude 时变 `主角(图1) 站在山巅`。

扩展触发词：改 `BINDING_PATTERNS` + 同步更新 `src/lib/claude.ts` 两段 system prompt 里的绑定约定列表。

## LLM 集成 4 个模式

`claude_auth_mode` setting key (历史名沿用)：

```
"api"     → Anthropic fetch · 快 3-10s · 要 API key
"cli"     → claude --print subprocess · 走 Claude Code 订阅 · 慢 30-60s
"openai"  → OpenAI fetch (Chat Completions) · 快 5-25s · 要 OpenAI key · Vision via image_url base64
"codex"   → codex exec subprocess · 走 ChatGPT 订阅 · 原生 -i 附图 · --sandbox read-only · --ephemeral · 纯文本提示词优化 wrapper
```

settings keys: `claude_auth_mode`（未设置时默认 codex） / `claude_api_key` / `openai_api_key` / `openai_model` (默认 gpt-5) / `codex_model` (默认 gpt-5.5)。

加速可选：未来接 `@anthropic-ai/claude-agent-sdk`（同订阅，Node 进程内调，零启动开销）。

## 数据库 schema

6 张表（`001_init.sql` + `002_workflow_fields.sql`）：
- **projects** — 项目元数据 + style_prompt（跨镜头共享风格）+ `draft_text` / `first_pass_text` / `final_pass_text`（三阶段工作流文本，002 迁移新增）
- **ref_images** — 项目级，按导入顺序自动 `image_index`（即 (图N) 的 N）
- **shots** — `{raw_prompt, enhanced_prompt, status: draft|enhanced|submitted|completed}`
- **samples** — 用户改写过的好样本，RAG 用（暂未启用）
- **submissions** — 即梦 CLI 提交记录（status: queued|running|success|failed）
- **settings** — key-value 存 `claude_api_key`, `claude_auth_mode` 等

DB 位置: `~/Library/Application Support/studio.vellum.desktop/vellum.db`

## 已知陷阱

1. **Vite 7 要 Node ≥20.19** — Node 21 会报 `crypto.hash is not a function`
2. **Tauri 2 SQL plugin 权限要明确** — `sql:default` **不包含** `sql:execute`，必须列出 `sql:allow-execute/select/load/close`
3. **TipTap 的 Mention 在 Tauri WebKit release build 不稳** — 我们抛弃 Mention，手写 `handleKeyDown` + `createPortal`
4. **macOS Dock 缓存图标** — 改 icon 后要 `killall Dock` 才看到新的
5. **`tauri build` 的 bundle_dmg.sh 偶尔崩** — 不影响 .app，重跑一次通常 OK
6. **MJ 文件改名用逐个 `mv` 代替 `rm -f glob`** — MJ 文件名带空格 + 数字后缀，glob 可能跳过，逐个 mv 更稳
7. **codex CLI 必须用 `--sandbox read-only`** — 不能用 `--dangerously-bypass`；codex-cli ≥0.133 已移除旧 `--ask-for-approval never`
8. **fs:scope 已收紧** — 只放行 `$APPDATA / $APPLOCALDATA / $PICTURE / $DOWNLOAD / $DESKTOP / $DOCUMENT / $HOME/Projects/**`。Library import 选别处图会被拒
9. **release build 默认无 devtools** — Cargo.toml 已改 opt-in feature flag。需要调试加 `--features devtools`

## 资源

- 工作流原始描述 + 截图：见 `~/.claude/projects/-Users-chengyue/memory/project_vellum.md`
- Signature 风格栈：见 `~/.claude/projects/-Users-chengyue/memory/project_jimeng_video.md`
- 提示词必须 flowing prose 不带 slot 标签：`~/.claude/projects/-Users-chengyue/memory/feedback_prose_not_template.md`

## 用户偏好（重要）

- **autonomous execution** — 拒绝过度澄清，倾向直接动手
- **持续视觉反馈** — 操作中长时间无反应必加可见进度指示器
- **测过再交付** — 之前因为没自测推上崩按钮被批评过，凡涉及关键路径必须验证
- **fluorescent green #39ff14** 是品牌主色，logo 用 **DM Serif Display Italic 纯绿 + glow**（替换了原 Orbitron 渐变）
- **安全 hardening 倾向** — capabilities 倾向收紧而非放宽（fs:scope 精确路径而非 `**`，shell 命令绝对路径白名单，codex 用 read-only sandbox 而非 --dangerously-bypass）
- **Claude Code plugin marketplace 偏好**：用户主用 **xiaolai 的第三方 marketplace**（`github.com/xiaolai/claude-plugin-marketplace`）而非 Anthropic 官方 curated。已装 nlpm。需要推荐别的 plugin 时优先建议 xiaolai 源，找不到再 fallback 到 `anthropics/claude-plugins-community`。Anthropic 官方 `claude-plugins-official`（~203 个）无公开申请通道，仅 Anthropic 员工筛选。

## Claude Code plugin marketplace 速查

```bash
# 注册 marketplace（一次性）
/plugin marketplace add xiaolai/claude-plugin-marketplace
/plugin marketplace add anthropics/claude-plugins-community

# 浏览某个 marketplace 的清单
/plugin marketplace browse xiaolai-claude-plugin-marketplace

# 装
/plugin install <name>@xiaolai-claude-plugin-marketplace

# 卸
/plugin uninstall <name>
```

"Plugin submissions" 页面（claude.ai 内）= 自助提交门户。"Published" 状态 = **进了 community 池**，**不等于**进官方 curated 池。Anthropic 官方原话："submission form does not add plugins to the official marketplace"。
