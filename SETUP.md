# Vellum Setup

Vellum 是一个 macOS 专用的个人项目。这份指引假定你有耐心改几处硬编码路径。

## 1. 系统要求

- **macOS**（Apple Silicon 或 Intel）
- **Rust** ≥ 1.95：`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Node 22 LTS**：`nvm install 22`（Vite 7 要求 ≥ 20.19；Node 21 会炸 `crypto.hash`）
- **Tauri CLI v2**：`cargo install tauri-cli --version "^2"`
- 跨架构 build（Intel Mac 二进制）：`rustup target add x86_64-apple-darwin`

## 2. 三个外部 CLI

Vellum 调用三个外部 CLI 做事；你需要**自己有访问权**：

| CLI | 用途 | 安装方式 |
|---|---|---|
| `dreamina` | 即梦 (Seedance 2.0) 视频生成，唯一发起视频的入口 | 字节官方发布；需要订阅 + 登录 |
| `codex` | OpenAI Codex CLI（默认 Pass 2 backend，订阅模式零额外费用） | `npm install -g @openai/codex` |
| `claude` | Claude Code CLI（可选 backend，订阅模式零额外费用） | `curl -fsSL https://claude.ai/install.sh \| bash` |

确认安装：

```bash
which dreamina codex claude
dreamina --help
codex --version
claude --version
```

## 3. 改硬编码路径（关键步骤）

`src-tauri/capabilities/default.json` 给 Tauri shell sandbox 列出**允许执行的 binary 绝对路径**。这些路径写死了作者机器的位置，你需要改成自己的。

**跑一遍 `scripts/setup.sh`，它会自动 `which` 出三个 binary 的实际路径，
渲染 `src-tauri/capabilities/default.json.template` 生成你本地能跑的
`src-tauri/capabilities/default.json`**（这个文件是 gitignored，每人本地一份）：

```bash
./scripts/setup.sh
```

setup.sh 优先查这些位置（按顺序）：
`$HOME/.local/bin/<name>` → `/opt/homebrew/bin/<name>` →
`/usr/local/bin/<name>` → `/usr/bin/<name>` → `which <name>` fallback。

如果你的 binary 在别处（比如 nvm 全局），setup.sh 会留 `__XXX_PATH__` 占位符；
手工编辑 `src-tauri/capabilities/default.json` 改成绝对路径，或者把 binary 软链
到 `/opt/homebrew/bin/` 再重跑 setup.sh。

> Tauri 2 capabilities **不支持** `$HOME` / `~` 占位符在 `shell:allow-execute.cmd`，
> 必须写绝对路径——这就是为什么要 setup.sh 而不是一份共享 default.json。

## 4. 安装与启动

```bash
git clone https://github.com/Cyborg9999/vellum.git
cd vellum
./scripts/setup.sh           # 生成本地 capabilities/default.json
npm install
npm run tauri dev            # 开发模式，端口 1420，热重载
```

第一次启动会跑 SQLite migration 001–006，在 console 应该看到 `applied migration 6 (add_submit_id_column)`。

## 5. Settings 配置（首次启动）

进 app 后点 ⚙ Settings，选一个 **Auth mode**：

| Mode | 速度 | 费用 |
|---|---|---|
| Claude API | 快（3-10s） | 按 token 计费，需 API key |
| Claude CLI | 慢（30-60s） | 零额外（走你的 Claude Code 订阅） |
| OpenAI API | 快（5-25s） | 按 token 计费，需 API key |
| Codex CLI | 中（10-30s） | 零额外（走你的 ChatGPT 订阅） |

API key 存在 SQLite `settings` 表（**明文** — 见 [Known caveats](#known-caveats)）。

## 6. 打包成 .app

```bash
npm run tauri build           # 生成 src-tauri/target/release/bundle/macos/Vellum.app
# 安装到 /Applications
rm -rf /Applications/Vellum.app
cp -R src-tauri/target/release/bundle/macos/Vellum.app /Applications/
open /Applications/Vellum.app

# Universal binary（Intel + ARM）
npm run tauri build -- --target universal-apple-darwin
```

`bundle_dmg.sh` 偶尔会因为 osascript/hdiutil 时序失败，**不影响 .app 生成**，重跑一次通常 OK。

## 7. 测试

```bash
npm test            # vitest run，纯函数单测
npm run test:watch  # 开发时 watch 模式
npx tsc --noEmit    # 类型检查
cargo test --manifest-path src-tauri/Cargo.toml   # Rust 端
```

## 8. 数据存放位置

```
~/Library/Application Support/studio.vellum.desktop/
├── vellum.db          ← 项目元数据、参考图引用、镜头本、提交记录
└── pasted/            ← Cmd+V 粘贴入库的图片副本
```

升级前**先备份** `vellum.db`。Migration 出错会让你后悔。

## Known caveats

- **API key 明文存 SQLite**（grill H5 已识别，未修） — 谨慎共享 DB 文件
- **fs:scope 较宽**（含 `/Volumes/**` 和 `$HOME/Projects/**` ，grill H6 已识别） — Renderer XSS 风险（小）
- **没有 Tauri updater**（grill 延后项） — 你需要手动 git pull + rebuild
- **没有签名**（无 Apple Developer ID） — 首次运行 Gatekeeper 会拦，右键 → 打开 一次绕过
