# Round 3 验证 Checklist

写于 2026-05-28，对应 commit `37e916c` 之后的状态。

Round 1 / Round 2 已落地：grill C1-C3 + H1-H4 + H9 + M1-M4 + M6-M7 + M10 部分
(vitest 基线)。剩下需要你**亲自跑一次** Vellum 真实路径来验收，以及决定
几个架构方向。

---

## A. 端到端发即梦视频（B 路线核心）

### 前置检查

- [ ] `claude --version` 跑通
- [ ] `codex --version` 跑通（Pass 2 默认 backend）
- [ ] `dreamina --help` 跑通，binary 仍在 `/Users/chengyue/.local/bin/dreamina`
- [ ] 即梦 CLI 已登录 / cookie 有效（跑一条 `dreamina query_result --submit_id=任意旧 id` 看响应）
- [ ] DB 已备份：`~/Library/Application Support/studio.vellum.desktop/vellum.db.backup-before-commits-20260528-084043` 存在

### 启动

```bash
cd ~/Projects/vellum && npm run tauri dev
```

第一次启动会跑 migration 003-006，看 console 应该有 "applied migration 6
(add_submit_id_column)"。

### 测试项目

1. 新建项目 `test-round-3`
2. Library 导入 3 张图（任意角色 / 场景 / 道具素材），验证：
   - [ ] 自动编号 1、2、3
   - [ ] 缩略图显示正常
3. **H1 验证**：先去 ShotsView 写点 `主角(图1) 站在(图2)山顶持(图3)挥剑`，
   blur 保存；再切回 Library 删除"图2"，再切回 ShotsView：
   - [ ] 编辑器里的 `(图2)` 应该自动消失或重编号到 `(图N)` 新值
   - [ ] **不应该**看到 `(图3)` 还指向已被重编号到 (图2) 的图
   - [ ] 重新 blur 保存后，DB 里 prompt_entries 文本与编辑器一致（不写回陈旧版本）

### Stage 1 → Pass 1（codex）

4. 写 Draft（推荐含 `5秒` 这种字样让 parseDurationSeconds 抓到）
5. 点 "First Pass"：
   - [ ] 进度条 / "X 秒..." 实时刷新
   - [ ] 完成后输出保留所有 `(图N)` 引用
   - [ ] **H2 验证**（可选恶意测试）：手工 `kill -STOP <codex pid>` 模拟挂死 →
         180s 后 Vellum 应弹"超时，子进程已 kill"，**且** 老 codex 进程
         在 `ps aux` 里不见了（不是只 reject Promise）

### Stage 2 → Pass 2

6. 编辑 Pass 1 文本，确认 (图N) badge 可正常拖拽
7. 点 "Finalize"：
   - [ ] 输出 Pass 2 最终文本
   - [ ] 不带 markdown 标题（你 prompt 里禁了）
   - [ ] flowing prose，不带 slot 标签（feedback_prose_not_template）

### Submit 闭环（M2 + H3 + H4 验证）

8. 切到 SubmitView
9. 点 "Submit One" 任意一个 shot：
   - [ ] devtools console 应有 `[dreamina] cmd: dreamina multimodal2video --prompt <前 80 字>…[truncated]` —— 完整 prompt 不再 dump 到 log（M6）
   - [ ] DB 检查（sqlite3 cli）：
     ```bash
     sqlite3 ~/Library/Application\ Support/studio.vellum.desktop/vellum.db \
       "SELECT id, submit_id, cli_command FROM submissions ORDER BY id DESC LIMIT 1"
     ```
     - [ ] `submit_id` 列**有值**（新行走新路径，M2）
     - [ ] `cli_command` 列**不再包含** `# submit_id=` 注释
10. UI 显示 "queued"
11. 点 "Refresh"：
    - [ ] 状态正确映射（不会因 "missing" / "pending_*" 字符串误判，H4）
    - [ ] dreamina query_result 60s 超时正常工作
12. 等到 status = success：
    - [ ] video_url 出现
    - [ ] 外部播放可看

### 异常场景

13. **强制超时**：在 Stage 1 / Stage 2 进行中 force-quit Vellum，重启 → 数据库不应处于
    "active row 在 -1000 临时槽" 状态（C1 transaction 保证；下次启动 compactImageIndices
    应该幂等地恢复正常）
14. **并发删除**：Library 同时多选多张图删除（bulk delete）→ 不应触发 UNIQUE 冲突
    错误（C2 mutex 保证）

---

## B. Tauri updater + v0.2.0 release

我能写代码，但有几个**只能你决定**的事：

| 决策项 | 选项 | 影响 |
|---|---|---|
| **GitHub repo 可见性** | public / private | updater 的 manifest endpoint 要 token 才能拉 private 内容 |
| **Apple Developer ID** | $99/年订 / 不订 | 不订的话每次首次启动用户要右键 "打开" 绕 Gatekeeper |
| **Release 流程** | GitHub Releases + Actions / 自托管 manifest.json / 手动 | 自动化程度 |
| **Updater 签名 key 存哪** | 本机 keychain / 1Password / 加密文件 | private key 丢了再没法发更新 |

接入步骤（我做的部分，等你拍板上面 4 项后开干）：

1. `npm install --save-dev @tauri-apps/plugin-updater @tauri-apps/plugin-process`
2. Rust `Cargo.toml` 加 `tauri-plugin-updater = "2"`
3. `tauri.conf.json` 加 `plugins.updater` 块（endpoint + pubkey）
4. `lib.rs` 注册 updater plugin
5. `App.tsx` 启动时调 `check()` → 有更新弹"下载 + 重启"对话框
6. 配 GitHub Actions workflow，tag push 时打包 + 上传 release + 更新 manifest.json

完成后流程：

```bash
# 发版
git tag v0.2.0 && git push --tags
# GitHub Actions 自动 build + upload + 写 manifest
# 用户下次启动 Vellum，自动检测到 v0.2.0 → 提示下载
```

告诉我上面 4 个决策的答案，我开干。

---

## C. 已识别但延后的 grill findings

下面这些不在今天 fix 范围内 —— 都需要你拍板架构方向。

| ID | 内容 | 为什么没动 |
|---|---|---|
| **H5** | API key 明文存 SQLite，应迁 macOS Keychain | 需要装 `tauri-plugin-stronghold` 或 `keyring` crate；要决定怎么迁移已有 row |
| **H6** | `fs:scope` / asset protocol 含 `/Volumes/**` + `$HOME/Projects/**` 较宽 | 收紧会影响你从外接盘导入图的工作流，要你决定 |
| **H7** | 4-LLM-mode dispatcher 在 `optimizeDraftToFirstPass` / `finalizeFirstPassToFinal` 重复 | 大重构（抽 `LLMTransport` interface），ROI 高但工程量大 |
| **M5** | Zero observability（32 个 `console.log`，无 in-app log 面板） | 需要新建 log 模块 + UI 面板，独立 feature |
| **M8** | `db.ts` / `claude.ts` 混了多种职责（DB CRUD + 提示词 + 文本工具混在一起） | 大重构，触及面广 |
| **M9** | CLAUDE.md 文档里写的 capability scope 跟 `capabilities/default.json` 实际值有漂移 | 我可以对一对，但需要你 confirm 哪份是 truth source |

每一项都可以做，但都建议**作为下一个独立 PR / commit 分批进行**，不要再合一起做。

---

## D. 我做过但你应该亲自抽检的 commit

按时间倒序：

| Commit | 主题 |
|---|---|
| `37e916c` | test: vitest 基线 + 25 个 unit test (M10) |
| `229854d` | fix: H1 ShotsView event + M1/M3/M4/M7 |
| `35cab1b` | fix(transport): subprocess 真 kill child + dreamina 超时 (H2 + M6) |
| `bb79556` | fix(submit): submit_id 列 + status 白名单 + extractSubmitId 严格化 (H3/H4/M2) |
| `1dc1a42` | fix(library): compactImageIndices 原子 + 互斥 + 幂等 (C1/C2/C3) |
| `45ff030` | chore: 字体 + theme + identifier 改名 |
| `78c2fe2` | feat: 软删除图库 + Submit/dreamina 闭环 + director rules |

建议抽检：commit `1dc1a42` 和 `229854d` — 这两个动了 DB 写路径和编辑器同步，
回归风险最高。
