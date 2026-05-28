<div align="center">

# Vellum

**即梦 (Seedance 2.0) 视频提示词工作流的桌面 IDE**

Tauri 2 + React 19 + TipTap · macOS · 单人个人项目

</div>

---

## 它解决什么

一套四镜头视频，手工流程要 1-2 小时：

```
Midjourney 出图 → 散落桌面，没有项目归档
↓
手写镜头本，靠记忆记每张图位置
↓
粘到 GPT 强化，挨个告诉它 "图1=角色，图2=场景..."
↓
拿到强化稿，肉眼对齐 (图N) ↔ 实际文件
↓
在即梦 web 里手动拖 9 张图到对应位置
```

Vellum 把这套流程压到 5-10 分钟，**且支持批量**。

## 核心功能

- **项目级图库**：拖拽 / 粘贴 / 文件夹批量导入，自动 `(图N)` 编号，角色/场景/道具标签
- **三段式编辑器**：Draft → First Pass（拆镜头 + 物理细化）→ Final Pass（套风格、加 `(图N)` 引用、≤1800 字）
- **TipTap 富文本 + @图选择**：编辑时输入 "主角" 自动弹图选，所选图变 `(图N)` 圆头像 chip
- **多 LLM transport**：Anthropic API · Claude CLI · OpenAI API · Codex CLI （订阅模式零额外费用）
- **即梦 CLI 一键提交**：扫文本里的 `(图N)` 自动绑图，批量发起 `multimodal2video` 任务，轮询状态拿视频地址
- **软删除 + 自动重编号**：删图后 `(图N)` 在所有 shot / project / segment 文本中原子化重写

## 截图

> TODO：补 4 张截图：Library / Shots 三段 / Submit / 风格预设

## 状态

**Alpha · macOS only · 非 turnkey 产品**。

- 这是一个**个人工具**，不是给所有人开箱即用的应用。
- 所有 CLI 路径（dreamina / codex / claude）硬编码到当前作者机器，fork 后需手动调整 — 见 [SETUP.md](SETUP.md)。
- 即梦 CLI 是字节官方发的，但需要你**自己有访问权**（订阅 + 登录）。
- 风格预设默认 "西游 + 胡金铨 + Mielgo + Blur Studio + UE5"，可在 UI 改成任何风格。

## 开始

详见 [SETUP.md](SETUP.md)。简版（假设你已经有 dreamina / codex CLI）：

```bash
git clone https://github.com/Cyborg9999/vellum.git
cd vellum
npm install
# 改 src-tauri/capabilities/default.json 里 claude / dreamina 的 cmd 路径为你本机的
npm run tauri dev
```

## 技术栈

| 层 | 选型 |
|---|---|
| Shell | Tauri 2.0 + Rust |
| UI | React 19 + TypeScript + Vite 7 + TailwindCSS 4 |
| 富文本 | TipTap 3（自定义 `ImageBadge` inline node + `@` 触发 createPortal popup） |
| 状态 | Zustand 5 |
| 持久化 | SQLite via `tauri-plugin-sql` |
| LLM | Anthropic / OpenAI fetch + Claude CLI / Codex CLI subprocess |
| 视频 | dreamina (Seedance 2.0) 即梦 CLI |
| 字体 | UI: monospace · Logo: DM Serif Display Italic · 衬线: Bodoni Moda / Cormorant / Newsreader Italic |
| 测试 | Vitest（纯函数单测） |

## 文档

- [SETUP.md](SETUP.md) — 一次性安装步骤
- [CLAUDE.md](CLAUDE.md) — 项目架构、绑定规则、数据库 schema、已知陷阱（也给 Claude Code 自动加载）
- [docs/methodology.md](docs/methodology.md) — 提示词工程方法论（Pass 1 / Pass 2 设计）
- [CONTRIBUTING.md](CONTRIBUTING.md) — 提 issue / PR 之前

## License

[GNU AGPL-3.0](LICENSE) · 简版："你可以拿去用、改、商用，但**分发或做 SaaS 必须公开源码**，且衍生品也必须 AGPL"。

## Acknowledgements

- 即梦 (Seedance 2.0) — 字节跳动 / ByteDance 的视频生成模型与 CLI
- 工作流参考来自实际手工制作 4 镜头视频时被折磨的若干小时
- 命名取自中世纪羊皮纸手稿
