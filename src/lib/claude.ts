import { readFile } from "@tauri-apps/plugin-fs";
import { Command } from "@tauri-apps/plugin-shell";
import { getSetting } from "./db";
import type { RefImage } from "./types";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

const MODEL_OPUS = "claude-opus-4-7";
const MODEL_SONNET = "claude-sonnet-4-6";

export type AuthMode = "api" | "cli" | "openai" | "codex";

type TextBlock = { type: "text"; text: string };
type ImageBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    data: string;
  };
};
type ContentBlock = TextBlock | ImageBlock;

interface ApiRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string | ContentBlock[];
  }>;
}

interface ApiResponse {
  content: TextBlock[];
  stop_reason: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

async function getAuthMode(): Promise<AuthMode> {
  const v = await getSetting("claude_auth_mode");
  if (v === "cli") return "cli";
  if (v === "openai") return "openai";
  if (v === "codex") return "codex";
  return "api";
}

// ─── Codex CLI mode (uses user's ChatGPT subscription via local codex) ─

const DEFAULT_CODEX_MODEL = "gpt-5.5";

async function callViaCodex(
  systemPrompt: string,
  userText: string,
  imagePaths: string[]
): Promise<string> {
  const model = (await getSetting("codex_model")) || DEFAULT_CODEX_MODEL;

  // codex exec takes prompt as positional arg (or stdin).
  // No separate system/user split — concatenate with clear marker.
  const fullPrompt = `${systemPrompt}\n\n---\n\n${userText}`;

  const args = ["exec", "-m", model];
  for (const p of imagePaths) {
    args.push("-i", p);
  }
  // Non-interactive, read-only sandbox: prevent prompt-injection RCE while
  // keeping no-approval flow. We only need text generation, no tool calls.
  args.push("--sandbox", "read-only");
  args.push("--ask-for-approval", "never");
  // `--` ensures any user-controlled content in fullPrompt that starts with `-`
  // is treated as a positional argument, not a flag (C3 hardening).
  args.push("--", fullPrompt);

  const cmd = Command.create("codex", args);
  const result = await cmd.execute();

  if (result.code !== 0) {
    throw new Error(
      `Codex CLI exit ${result.code}: ${result.stderr || "(no stderr)"}`
    );
  }
  // codex exec output may contain progress preamble; we return raw stdout
  // (the model's text answer dominates). Trim trailing whitespace.
  return (result.stdout || "").trim();
}

// ─── OpenAI mode (chat completions API, vision via image_url) ───────

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_OPENAI_MODEL = "gpt-5";

interface OpenAIContentText { type: "text"; text: string }
interface OpenAIContentImage {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
}
type OpenAIContent = OpenAIContentText | OpenAIContentImage;

interface OpenAIChoice {
  message: { role: string; content: string };
  finish_reason: string;
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number };
  model: string;
}

async function callViaOpenAI(
  systemPrompt: string,
  userText: string,
  imagePaths: string[]
): Promise<string> {
  const apiKey = await getSetting("openai_api_key");
  if (!apiKey) {
    throw new Error(
      "OpenAI mode selected but no OpenAI API key. ⚙ Settings → enter key."
    );
  }
  const model = (await getSetting("openai_model")) || DEFAULT_OPENAI_MODEL;

  const imageBlocks: OpenAIContentImage[] = [];
  const failedImagePaths: string[] = [];
  for (const p of imagePaths) {
    try {
      const bytes = await readFile(p);
      const mime = mediaTypeFromPath(p);
      const b64 = bytesToBase64(bytes);
      imageBlocks.push({
        type: "image_url",
        image_url: { url: `data:${mime};base64,${b64}`, detail: "auto" },
      });
    } catch (e) {
      console.warn("[openai] read image failed:", p, e);
      failedImagePaths.push(p);
    }
  }
  // H7: surface image-read failures to the UI instead of silently degrading
  // the request. If every image failed, hard-fail; if some failed but caller
  // expected images, fail loudly so user knows visual binding broke.
  if (failedImagePaths.length > 0 && imagePaths.length > 0) {
    if (imageBlocks.length === 0) {
      throw new Error(
        `Unable to read any of the ${imagePaths.length} reference image(s). Check Library file paths and Tauri fs:scope. First failure: ${failedImagePaths[0]}`
      );
    }
    throw new Error(
      `${failedImagePaths.length}/${imagePaths.length} reference image(s) failed to read; aborting before sending an incomplete request to OpenAI. Failed: ${failedImagePaths
        .slice(0, 3)
        .join(", ")}${failedImagePaths.length > 3 ? ", …" : ""}`
    );
  }

  const userContent: string | OpenAIContent[] =
    imageBlocks.length > 0
      ? [...imageBlocks, { type: "text", text: userText }]
      : userText;

  const r = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: 4096,
    }),
  });

  if (!r.ok) {
    const body = await r.text();
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      detail = parsed?.error?.message ?? body;
    } catch {
      /* keep raw */
    }
    throw new Error(`OpenAI ${r.status}: ${detail}`);
  }

  const data = (await r.json()) as OpenAIResponse;
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI returned empty response");
  }
  return text.trim();
}

// ─── API mode ───────────────────────────────────────────────────────

async function callViaAPI(req: ApiRequest): Promise<string> {
  const apiKey = await getSetting("claude_api_key");
  if (!apiKey) {
    throw new Error(
      "API mode is selected but no Claude API key set. ⚙ Settings → enter key, or switch to Claude Code CLI mode."
    );
  }

  const r = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": API_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify(req),
  });

  if (!r.ok) {
    const body = await r.text();
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      detail = parsed?.error?.message ?? body;
    } catch {
      /* keep raw */
    }
    throw new Error(`Claude API ${r.status}: ${detail}`);
  }

  const data = (await r.json()) as ApiResponse;
  const block = data.content?.[0];
  if (!block || block.type !== "text") {
    throw new Error("Claude returned non-text response");
  }
  return block.text.trim();
}

// ─── CLI mode ───────────────────────────────────────────────────────

async function callViaCLI(
  systemPrompt: string,
  userText: string,
  imagePaths: string[]
): Promise<string> {
  const imageDirective =
    imagePaths.length > 0
      ? `[系统指令] 请先用 Read 工具读取以下本地参考图作为视觉上下文（不要复述图片内容，理解后直接进入任务）：\n${imagePaths
          .map((p, i) => `${i + 1}. ${p}`)
          .join("\n")}\n\n`
      : "";

  const fullPrompt = `[系统人设]
${systemPrompt}

${imageDirective}[任务]
${userText}`;

  const cmd = Command.create("claude", [
    "--print",
    "--output-format",
    "text",
    // `--` separator: any leading `-` in the user-controlled prompt would
    // otherwise be parsed as a CLI flag (e.g. `--mcp-config /tmp/evil`).
    // C3 hardening — prevents prompt-injection-to-CLI-flag escalation.
    "--",
    fullPrompt,
  ]);

  const result = await cmd.execute();

  if (result.code !== 0) {
    throw new Error(
      `Claude CLI exit ${result.code}: ${result.stderr || "(no stderr)"}`
    );
  }
  return (result.stdout || "").trim();
}

export function resetClaudeClient() {
  /* no persistent state to reset */
}

// ─── Pass 1: rough draft → first pass (structured + detailed shots) ─
// 基于 docs/methodology.md 「标准镜头语法」+「四个必填参数」+「分镜头连续性规则」

const PASS_1_SYSTEM = `你是专业级视频分镜提示词工程师。用户给你一段对动作/场景的自然语言粗稿，你的任务是**拆分并细化**为符合即梦视频生成模型理解的高精度分镜。

判定标准：同一段描述提交模型两次，画面差异应 <20%。差异越小越好。

【输出格式（严格遵守）】
[保留用户原标题，如"激斗（分镜）10秒"]
[空行]
镜头1，[景别][运镜][角度][方向]镜头，[详细描述]。

镜头2，...

【硬性规则】

## 1. 四个必填参数（缺一个 = 不合格）

每个镜头第一句必须显式包含：

- **景别**：极远景 / 远景 / 全景 / 中景 / 中近景 / 近景 / 特写 / 大特写 / 微距特写 之一
- **运镜**：固定 / 缓慢推进 / 快速推进 / 推近 / 横移 / 跟拍 / 摇拍 / 环绕 / 上摇 / 下摇 / 平摇 / 跟焦 / 变焦 / 子弹时间 / 缓动晃推近 之一
- **角度**：平视 / 仰拍 / 俯拍 / 广角仰拍 / 广角俯拍 / 鸟瞰 / 上帝视角 / 倾斜镜头 / 过肩镜头 之一
- **方向**：正面 / 背影 / 侧面 / 45度侧面 / 正侧面对峙 / 过肩背影 / 低头面向镜头 之一

参数缺失 → 模型在该维度自由发挥 → 输出与你的初稿无关。

## 2. 一节一画面

一个镜头编号下面**只能描述一个连续镜头**。视频模型按段落生成，一段卡两个画面会要么只生成第一个，要么生成混合错乱。

## 3. 必须拆开的五种情况（无运镜连接时强制拆）

| 情况 | 不拆的后果 |
|---|---|
| 脸部特写突然变手部特写 | 模型只生成其一或位置错乱 |
| 正面突然变背影 | 模型生成中间 180° 旋转，像 bug |
| 远景突然进入微视角 | 输出糊在一起 |
| 一镜叠加 >3 个动作节点 | 抓不住主线，每个动作半成断 |
| 角度大跳（平视突然鸟瞰） | 相机突然飞起来，像穿模 |

## 4. 镜头内部转换的三种合法连接

如果同一镜头内必须有画面变化，必须明确写运镜连接：
- 运镜过渡："镜头从脸部特写缓慢下摇到手部特写"
- 分屏构图："手机在画面右边缘，脸部位于左边，二者同构图"
- 跟焦虚实切换："焦点先落在眼神，跟焦到前景手机，再回脸部"

无连接 = 必须拆成两个镜头。

## 5. 一镜到底（如用户粗稿明确要求长镜头才用）

必须写清五要素：**起幅 + 路径（运镜动词明确）+ 主体连续性 + 落幅 + 剪辑声明（"整个过程不剪镜头"）**。

## 6. 其他

- 每个镜头一整段（80-180 字），flowing prose 散文体，禁用 slot 标签
- 镜头编号用"镜头1，"格式（中文逗号，不是冒号）
- 每个镜头必须说明**画面同时存在什么**（前景、背景、环境元素），不要只写动作
- **不要**引用 (图N)，这一步纯结构 + 细化
- **不要**加风格化提示词（3D、Mielgo、胡金铨等），留给 Pass 2
- 保留用户原描述里的人物关系、对白、关键动作、节奏感

只输出 [标题] + [镜头段落]，不要前言、后语、解释。`;

export async function optimizeDraftToFirstPass(draft: string): Promise<string> {
  const mode = await getAuthMode();
  if (mode === "cli") {
    return callViaCLI(PASS_1_SYSTEM, draft, []);
  }
  if (mode === "openai") {
    return callViaOpenAI(PASS_1_SYSTEM, draft, []);
  }
  if (mode === "codex") {
    return callViaCodex(PASS_1_SYSTEM, draft, []);
  }
  return callViaAPI({
    model: MODEL_SONNET,
    max_tokens: 4096,
    system: PASS_1_SYSTEM,
    messages: [{ role: "user", content: draft }],
  });
}

// ─── Pass 2: first pass + bindings + images → final enhanced ────────
// 基于 docs/methodology.md 「分镜固定规则」+「风格提示词的位置（写两层 + 三层结构）」

const DEFAULT_STYLE_LAYER = `三渲二电影级风格，blur 公司顶级 CG，史诗级 CG，融入胡金铨电影的质感与色彩；重质感光影，强调真实光影；色彩饱和度高，画面带电影质感与肌理。`;

function buildPass2System(style: string): string {
  const styleBlock = style.trim() || DEFAULT_STYLE_LAYER;
  return `你是专业级视频分镜提示词最终强化专家。任务是把第一版分镜（已含景别/运镜/角度/方向）强化为可直接喂给即梦视频生成模型的高精度成片提示词。

【用户固定指令】
帮我优化细化镜头描述，总的来说需要细腻的质感呈现，同时要加上风格提示词。注重描绘角色的服化道、场景、动态特效等的细节，着重表现真实光影；每个镜头一整段中文。如果用户在某角色之后加了"背面/侧面/正面/45度侧面"等描述，必须保留在角色后面，不要删除。总字数保持在 1800 字以内。

## 风格提示词（写两层）

### 第一层：全局风格段（必写）
在标题下方、第一个镜头前，单独成段输出"整体风格提示词"，按以下**三层结构**严格拼接（顺序固定，模型按这个顺序读，画面层次也按这个顺序生成）：

1. **渲染基调**（画面"流派"）
2. **光影氛围**（画面"情绪"）
3. **色彩肌理**（画面"质感"）

把下面这段作为第一层全局风格段（用户选择的预设或自定义）：

\`\`\`
${styleBlock}
\`\`\`

### 第二层：每镜头局部补强（按需）
每个镜头描述里只加**与该镜头有关的**局部风格重点（如：本镜的光影、本镜的粒子、本镜的速度感）。不要重复全局段的形容词。

## 分镜固定（绑定约定）

原稿中出现以下组合时，对应图就是该实体的**视觉定义**：
- **主角(图N) / 男主(图N) / 女主(图N) / 反派(图N) / 角色(图N)** → 角色定义
- **场景(图N) / 背景(图N) / 环境(图N)** → 场景定义
- **道具(图N) / 物品(图N) / 武器(图N) / 法器(图N)** → 道具定义

执行规则：
1. 完全采用图中视觉信息描述实体（服装/外形/材质/配色/形态/空间结构/光源/天气/湿度/体积）
2. 后续提到同实体**继续 (图N) 引用**，保持视觉一致
3. 不要编造跟图不符的细节
4. **必须保留**"背面/侧面/正面/45度侧面"这类视角修饰词

## 其他

- 输出格式：**标题 → 全局风格段 → 镜头1 → 镜头2 → ...**
- 每镜头一整段，镜头之间空一行
- flowing prose 散文体，禁用 slot 标签
- 总字数 1800 字以内
- 对白或声音如果原稿有，直接写在对应镜头段落末尾

只输出最终强化版的分镜内容（标题 + 全局风格段 + 镜头段落）。不要前言、不要解释、不要 markdown 标题。`;
}

export async function finalizeFirstPassToFinal(
  firstPassText: string,
  refImages: RefImage[],
  style?: string
): Promise<string> {
  const PASS_2_SYSTEM = buildPass2System(style ?? "");
  const indexMap = refImages
    .map((img) => {
      const role = roleZH(img.role);
      const name = img.name ? `（${img.name}）` : "";
      return `图${img.image_index}: ${role}${name}`;
    })
    .join("\n");

  const userText =
    refImages.length > 0
      ? `【参考图编号映射】
${indexMap}

【第一版分镜描述（待强化）】
${firstPassText}

请按系统指令输出最终强化版。`
      : `【第一版分镜描述（待强化）】
${firstPassText}

（本项目未提供参考图，无需 (图N) 引用，按指令补全服化道/场景/动态/风格即可。）`;

  const mode = await getAuthMode();
  if (mode === "cli") {
    return callViaCLI(
      PASS_2_SYSTEM,
      userText,
      refImages.map((i) => i.file_path)
    );
  }
  if (mode === "openai") {
    return callViaOpenAI(
      PASS_2_SYSTEM,
      userText,
      refImages.map((i) => i.file_path)
    );
  }
  if (mode === "codex") {
    return callViaCodex(
      PASS_2_SYSTEM,
      userText,
      refImages.map((i) => i.file_path)
    );
  }

  const imageBlocks: ImageBlock[] = [];
  const failedImages: string[] = [];
  for (const img of refImages) {
    try {
      const bytes = await readFile(img.file_path);
      imageBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaTypeFromPath(img.file_path),
          data: bytesToBase64(bytes),
        },
      });
    } catch (e) {
      console.warn("[claude] read image failed:", img.file_path, e);
      failedImages.push(img.file_path);
    }
  }
  // H7: hard-fail when image reads break, instead of silently sending text-only.
  if (failedImages.length > 0 && refImages.length > 0) {
    if (imageBlocks.length === 0) {
      throw new Error(
        `Unable to read any of the ${refImages.length} reference image(s). Check Library file paths and Tauri fs:scope. First failure: ${failedImages[0]}`
      );
    }
    throw new Error(
      `${failedImages.length}/${refImages.length} reference image(s) failed to read; aborting to avoid sending an incomplete request. Failed: ${failedImages
        .slice(0, 3)
        .join(", ")}${failedImages.length > 3 ? ", …" : ""}`
    );
  }

  return callViaAPI({
    model: MODEL_OPUS,
    max_tokens: 4096,
    system: PASS_2_SYSTEM,
    messages: [
      {
        role: "user",
        content: [...imageBlocks, { type: "text", text: userText }],
      },
    ],
  });
}

// ─── Submit format: extract used (图N) refs and produce 即梦 header ──

const ROLE_LABEL_ZH: Record<string, string> = {
  character: "人物",
  scene: "场景",
  prop: "道具",
};

export interface SubmitPayload {
  header: string;            // "人物 = 图片1\n场景 = 图片2"
  body: string;              // final text
  imageBindings: {           // for CLI submission later
    role: string;
    label: string;
    indices: number[];
    files: string[];
  }[];
  /** C1: (图N) markers in body that no longer have a matching ref image. */
  orphanIndices: number[];
}

/** C1 helper: strip orphan (图N) markers from text. */
export function stripOrphanImageRefs(
  text: string,
  refImages: RefImage[]
): string {
  const validIndices = new Set(refImages.map((r) => r.image_index));
  return text.replace(/\(图\s*(\d+)\)/g, (m, n) =>
    validIndices.has(Number(n)) ? m : ""
  );
}

/** C1 helper: find (图N) markers in a text that don't match any ref image. */
export function findOrphanImageRefs(
  text: string,
  refImages: RefImage[]
): number[] {
  const validIndices = new Set(refImages.map((r) => r.image_index));
  const orphans = new Set<number>();
  const re = /\(图\s*(\d+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (!validIndices.has(n)) orphans.add(n);
  }
  return Array.from(orphans).sort((a, b) => a - b);
}

export function buildSubmitPayload(
  finalText: string,
  refImages: RefImage[]
): SubmitPayload {
  // find all (图N) markers in finalText, dedupe in order of appearance
  const usedIndices: number[] = [];
  const re = /\(图\s*(\d+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(finalText)) !== null) {
    const n = Number(m[1]);
    if (!usedIndices.includes(n)) usedIndices.push(n);
  }

  // map indices to ref images and group by role
  const byRole = new Map<
    string,
    { label: string; indices: number[]; files: string[] }
  >();
  const orphanIndices: number[] = [];
  for (const n of usedIndices) {
    const ref = refImages.find((r) => r.image_index === n);
    if (!ref) {
      orphanIndices.push(n);
      continue;
    }
    const label = ROLE_LABEL_ZH[ref.role] || ref.role;
    if (!byRole.has(ref.role)) {
      byRole.set(ref.role, { label, indices: [], files: [] });
    }
    const g = byRole.get(ref.role)!;
    g.indices.push(n);
    g.files.push(ref.file_path);
  }

  // header in canonical order: 人物, 场景, 道具
  const order = ["character", "scene", "prop"];
  const headerLines: string[] = [];
  for (const role of order) {
    const g = byRole.get(role);
    if (!g) continue;
    headerLines.push(`${g.label} = ${g.indices.map((i) => `图片${i}`).join("、")}`);
  }
  // any roles not in canonical order
  for (const [role, g] of byRole) {
    if (order.includes(role)) continue;
    headerLines.push(`${g.label} = ${g.indices.map((i) => `图片${i}`).join("、")}`);
  }

  return {
    header: headerLines.join("\n"),
    body: finalText,
    imageBindings: Array.from(byRole.entries()).map(([role, g]) => ({
      role,
      label: g.label,
      indices: g.indices,
      files: g.files,
    })),
    orphanIndices,
  };
}

// ─── helpers ────────────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(
      ...(bytes.subarray(i, i + chunk) as unknown as number[])
    );
  }
  return btoa(binary);
}

function mediaTypeFromPath(
  p: string
): "image/png" | "image/jpeg" | "image/webp" | "image/gif" {
  const lower = p.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function roleZH(role: string): string {
  if (role === "character") return "角色";
  if (role === "scene") return "场景";
  if (role === "prop") return "道具";
  return role;
}
