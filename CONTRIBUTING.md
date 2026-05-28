# Contributing to Vellum

Vellum 是个**单人开发的 alpha 项目**。欢迎 issue 和 PR，但请先了解项目当前状态。

## 在提 issue / PR 之前

- **使用问题**先看 [SETUP.md](SETUP.md) 和 [README.md](README.md)
- **bug 报告**：贴清楚 macOS 版本、Tauri / Node / Rust 版本、复现步骤、控制台输出
- **feature request**：欢迎，但响应慢；如果是你立马要用、我没空做，建议直接 fork
- **架构性改动**（重构、依赖换、capabilities 调整）：先开 issue 讨论再写代码

## 代码风格

- TypeScript strict mode（`tsc --noEmit` 必须过）
- 注释只解释 **why**，不解释 what
- 不写 `// XXX added for the foo bug` 这类时间相关的注释，会随代码 rot
- 提交前跑 `npm test` 全绿

## 提 PR 前的 checklist

```bash
npx tsc --noEmit        # 0 错误
npm test                # 全绿
cargo build --manifest-path src-tauri/Cargo.toml   # Rust 编译通过
```

附简短的"做了什么、为什么"在 PR description。如果触及 DB schema，必须**新加一个 migration 文件**，不要改老的（migration 已应用到用户机器，回不去）。

## Commit message 风格

跟随项目历史风格：中文标题 + 类别前缀 + 短描述。

```
feat: 软删除图库 + Submit/dreamina 提交闭环 + director rules
fix(submit): submit_id 单独列 + status 白名单
fix(library): compactImageIndices 原子 + 并发互斥 + 幂等快路径
chore: 字体 + theme + identifier 改名
test: vitest 基线 + 25 个纯函数 unit test
docs: SETUP.md 加 Apple Silicon 路径示例
```

不需要 `Co-Authored-By` trailer。

## 已识别但延后的改动方向

参见 [docs/methodology.md](docs/methodology.md) 末尾和 git log 里的 grill 修复 commit message。如果你想做：

| 方向 | 工程量 | 状态 |
|---|---|---|
| API key 迁 macOS Keychain（H5） | 中 | 待拍板：用 `tauri-plugin-stronghold` 还是 `keyring` crate |
| 收紧 fs:scope（H6） | 小 | 待拍板：哪些路径必须保留 |
| 抽 `LLMTransport` interface 复用 4 模式 dispatcher（H7） | 大 | 欢迎 PR，先开 issue 讨论 |
| 接 Tauri updater | 中 | 欢迎 PR，需要协调 release 流程 |
| 加 in-app log panel + 结构化日志（M5） | 中 | 欢迎 PR |

## License

提交的代码默认按 [AGPL-3.0](LICENSE) 发布。如果你不同意，不要 PR。
