# Vellum

桌面 app · 即梦视频提示词工作流全自动化 · Tauri 2 + React 19 + TipTap

把"Midjourney 出图 → 手写镜头 → GPT 强化 → 即梦 CLI 发起视频"这套流程从 1-2 小时人力压缩到 5-10 分钟自动。

## 快速开始

环境准备和启动命令见 [CLAUDE.md](./CLAUDE.md)。

```bash
cd ~/Projects/vellum && npm run tauri dev
```

## 技术栈

- **Tauri 2.0** + Rust — 原生桌面，binary 18MB
- **React 19 + TypeScript + Vite 7 + TailwindCSS 4**
- **TipTap** 富文本编辑器（自定义 @ 图片绑定）
- **SQLite** 本地持久化
- **Zustand** 状态管理

## 核心功能

- 图片库管理：导入 / drag-drop / 角色场景道具标签
- 镜头编辑器：Draft → Raw → Enhanced 双栏对比
- `@` 绑定规则：输入"主角/场景/道具"触发 role-aware 图片选择器
- Claude 双模式集成：API key 模式（快）或 Claude Code CLI 模式（零额外费用）
- 即梦 CLI 一键提交（开发中）

## 文档

完整开发文档、数据库 schema、已知陷阱见 [CLAUDE.md](./CLAUDE.md)。
