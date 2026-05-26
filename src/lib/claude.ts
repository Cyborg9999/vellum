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
  args.push(fullPrompt);

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
    }
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

const PASS_1_SYSTEM = `你是视频镜头本工程师。用户给你一段对动作/场景的自然语言描述（可能粗糙、有跳跃），你的任务是**拆分并大量细化**为一段连贯的分镜描述。

【输出格式（严格遵守）】
[标题行（保留用户原标题，如"激斗（分镜）10秒"）]
[空行]
镜头1，[镜头类型]镜头，[一整段 flowing prose 详细描述]。

镜头2，[镜头类型]镜头，[详细描述]。

镜头3，...

【写作要求】
1. **大量细化、加细节**，不是简单结构化
   - 角色动作：姿势/速度/张力/微表情（不止"格挡"，而是"身体压低，单手猛地拔刀向前突进"）
   - 物理反应：火花、裂痕、烟尘、气流、声波震荡（让画面有"重量感"）
   - 环境互动：衣摆翻飞、头发被风吹动、地面碎裂等
2. 用电影术语精确描述相机：平视/俯仰/侧面/正面/45度/近景/中景/全景/特写/超近景/反打/360度平摇/推进/拉远 等
3. 每个镜头一整段（2-5 句）, 80-180 字
4. 镜头编号用"镜头1，"格式（中文逗号，不是冒号）
5. **不要**引用 (图N)，这一步纯粹细化镜头描述
6. **不要**加风格化提示词（3d、blur、胡金铨等），留给下一步
7. flowing prose 散文体，禁用 slot 标签
8. 保留用户原描述里的人物关系、动作顺序、节奏感

只输出标题+分镜内容，不要前言、后语、解释。`;

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

const PASS_2_USER_INSTRUCTION = `帮我优化细化镜头描述，总的来说需要细腻的质感呈现，同时要加上风格提示词，画面风格采用3d风格，blur公司顶级cg，史诗级cg，再加上一些胡金铨电影的质感和色彩，但注意风格化的表达，注意描绘角色的服化道、场景、动态特效等等的细节，着重表现真实光影，每个镜头一整段中文即可，注意，如果我在某角色之后加了背面、侧面、正面、45度侧面等等描述，就需要在角色后面加上背面、侧面、正面、45度侧面等等，不要删除。总字数保持在1800字以内。`;

const PASS_2_SYSTEM = `你是视频镜头本最终强化专家。

【用户给你的固定指令（必须严格遵守）】
${PASS_2_USER_INSTRUCTION}

【绑定约定】
原稿中如果出现这些组合：
- **主角(图N) / 男主(图N) / 女主(图N) / 反派(图N) / 角色(图N)** —— 该图是角色视觉定义
- **场景(图N) / 背景(图N) / 环境(图N)** —— 该图是场景视觉定义
- **道具(图N) / 物品(图N) / 武器(图N) / 法器(图N)** —— 该图是道具视觉定义

执行强化时：
1. 完全采用图中视觉信息描述对应实体（服装/外形/材质/配色/形态）
2. 后续提到该实体继续 (图N) 引用，保持视觉一致
3. 不要编造跟图不符的细节
4. **保留所有 "背面/侧面/正面/45度侧面" 这类视角修饰词，不要删**
5. 总字数 1800 字内

只输出最终强化版的分镜描述本身（标题 + 镜头段落）。不要前言、不要解释、不要 markdown 标题。`;

export async function finalizeFirstPassToFinal(
  firstPassText: string,
  refImages: RefImage[]
): Promise<string> {
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
    }
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
  for (const n of usedIndices) {
    const ref = refImages.find((r) => r.image_index === n);
    if (!ref) continue;
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
