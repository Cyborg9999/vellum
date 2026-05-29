# Vellum · AGENTS.md

> Codex CLI / Cursor / cc-suite 读这份，Claude Code 读 `CLAUDE.md`。两份内容语义对齐。
> 项目背景、技术栈、绑定规则等见 `CLAUDE.md`，本文件只放跨 AI 的接力协议。

## AI 接力协议（HANDOFF）

> 多个 AI（Claude Code / Codex CLI / Cursor）轮流接手本仓库。下面规则**强制**，违反一次就可能把上一个 AI 的活儿冲掉。

**会话开始**
- 第一步：读 `/Users/chengyue/Projects/vellum/HANDOFF.md`
- 文件不存在 → 你来建第一份，再开工
- 文件存在 → 接上次的「下一步」继续，别另起炉灶

**会话结束前（含 token 耗尽 / 用户中断 / 任务完成）**
- 必须更新 HANDOFF.md，三段：`## <ISO 时间戳> · <agent-name>` / `### 刚做了什么` / `### 下一步`
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
