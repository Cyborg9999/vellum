## 改了什么

<!-- 一两句话。不解释 what（diff 自己说），说 why。 -->

## 关联 issue

<!-- Closes #N / Refs #N，无关写 N/A -->

## 怎么测的

- [ ] `npx tsc --noEmit` 0 错误
- [ ] `npm test` 全绿
- [ ] `npm run tauri dev` 跑过，关键路径手测：
  - [ ] Library 导入 / 重命名 / 删除
  - [ ] Shots 三段编辑 + LLM 调用（Pass 1 + Pass 2）
  - [ ] Submit 闭环（如果触及）

## 影响范围

- [ ] 涉及 DB schema → 新增 migration 文件，**没改老 migration**
- [ ] 涉及 `compactImageIndices` → 已读 grill C1/C2/C3 修复 commit + 加了对应回归测试
- [ ] 涉及 subprocess (claude/codex/dreamina) → 走 `runTracked`，没绕开 timeout
- [ ] 涉及 capabilities → 改 `default.json.template`，**没改本地 default.json**

## 截图（UI 改动必须）

<!-- 拖图或粘贴 -->
