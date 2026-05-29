// === Codex audit session capture (R2) ===
// Source rollout: /Users/chengyue/.codex/sessions/2026/05/29/rollout-2026-05-29T12-36-12-019e7204-b9fc-7e00-a9b4-e68f81fbcee7.jsonl
// Captured ranges: [(80, 170), (209, 390), (400, 470), (1840, 1975), (2220, 2285), (2680, 2735), (2735, 2808)]
// Captured lines: 675 (min=80, max=2808)
// NOTE: Pre-edit snapshot at 2026-05-29 12:36 BJT. Partial — captured tail (2735-2808) proves file extended past current EOF.

      return runCodexExec(FALLBACK_CODEX_MODEL, fullPrompt, imagePaths);
    }
    throw e;
  }
}

async function runCodexExec(
  model: string,
  fullPrompt: string,
  imagePaths: string[]
): Promise<string> {
  const args = [
    "exec",
    "--json",
    "-m",
    model,
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
  ];
  for (const p of imagePaths) {
    args.push("-i", p);
  }
  // `--` ensures any user-controlled content in fullPrompt that starts with `-`
  // is treated as a positional argument, not a flag (C3 hardening).
  args.push("--", fullPrompt);

  // codex is a Node script (#!/usr/bin/env node). When Vellum.app is launched
  // from Finder/Dock, the inherited PATH lacks /opt/homebrew/bin (Apple Silicon
  // Homebrew default), so `env node` exits 127. We splice a PATH override that
  // covers both /opt/homebrew/bin (Apple Silicon) and /usr/local/bin (Intel /
  // legacy) plus the standard system paths.
  const cmd = Command.create("codex", args, {
    env: {
      PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    },
  });
  const result = await runTracked(cmd, {
    timeoutMs: CLI_TIMEOUT_MS,
    label: "codex exec",
  });

  if (result.code !== 0) {
    throw new Error(
      `Codex CLI exit ${result.code}: ${
        result.stderr || result.stdout || "(no output)"
      }`
    );
  }
  return cleanCodexOutput(result.stdout || "");
}

function buildCodexPrompt(
  systemPrompt: string,
  userText: string,
  imagePaths: string[]
): string {
  const imageNote =
    imagePaths.length > 0
      ? `\n\n【视觉输入】本次调用已通过 codex exec -i 附上 ${imagePaths.length} 张参考图。请直接理解图像视觉信息，用于参考图绑定和镜头细节；不要在输出里解释你看到了图片。`
      : "";

  return `你正在 Vellum 桌面应用内部作为“提示词优化引擎”运行。

硬性约束：
- 这是纯文本改写任务，不要修改文件、不要运行命令、不要提出计划。
- 不要输出解释、分析过程、道歉、Markdown 标题或代码块。
- 只输出可以直接粘贴回 Vellum 的最终文本。
- 严格遵守下方系统指令里的格式、字数、风格和禁用项。
${imageNote}

【系统指令】
${systemPrompt}

【用户输入】
${userText}

【最终输出】
`;
}

function cleanCodexOutput(stdout: string): string {
  const text = parseCodexJsonOutput(stdout) ?? stdout.trim();
  // Strip a tiny final-answer label if a model ever emits it despite the
  // prompt contract. Keeps Dreamina-facing text clean.
  return text.replace(/^(?:final answer|final)\s*[:：]\s*/i, "").trim();
}

// ... [GAP: lines 171..208 not captured] ...
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_OPENAI_MODEL = "gpt-5";

interface OpenAIContentText { type: "text"; text: string }
interface OpenAIContentImage {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
}
type OpenAIContent = OpenAIContentText | OpenAIContentImage;


async function callViaOpenAI(
  systemPrompt: string,
  userText: string,
  imagePaths: string[],
  onChunk?: (fullText: string) => void
): Promise<string> {
  const apiKey = await getSetting("openai_api_key");
  if (!apiKey) {
    throw new Error(
      "OpenAI mode selected but no OpenAI API key. ⚙ Settings → enter key."
    );
  }
  const model = (await getSetting("openai_model")) || DEFAULT_OPENAI_MODEL;
  const isReasoningModel = /^(gpt-5|o1|o3)/.test(model);

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
      stream: true,
      ...(isReasoningModel
        ? {
            // low > minimal: minimal 模式下模型会跳过格式校对，导致 (图N) 引用被简写成"图N"
            // 失去 UI 缩略图渲染。low 多花 2-3s 但保住格式合规
            max_completion_tokens: 8192,
            reasoning_effort: "low",
          }
        : { max_tokens: 8192 }),
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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

  if (!r.body) {
    throw new Error("OpenAI returned no response body");
  }

  // SSE 流式解析：每行 `data: {...}`，[DONE] 收尾；忽略 keepalive 注释
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload);
          const delta: unknown = event?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            fullText += delta;
            onChunk?.(fullText);
          }
        } catch {
          /* skip non-JSON SSE event */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!fullText.trim()) {
    throw new Error("OpenAI returned empty response");
  }
  return fullText.trim();
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
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
// ... [GAP: lines 391..399 not captured] ...
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

  const result = await runTracked(cmd, {
    timeoutMs: CLI_TIMEOUT_MS,
    label: "Claude CLI",
  });

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

export async function getPromptBackendLabel(): Promise<string> {
  const mode = await getAuthMode();
  if (mode === "cli") return "Claude CLI";
  if (mode === "openai") {
    return `OpenAI API · ${(await getSetting("openai_model")) || DEFAULT_OPENAI_MODEL}`;
  }
  if (mode === "codex") {
    return `Codex CLI · ${(await getSetting("codex_model")) || DEFAULT_CODEX_MODEL}`;
  }
  return "Claude API";
}

// ─── Pass 0: rough draft → beat sheet (导演骨架，只解决导演问题) ──
// 把"拆镜 / 定轴线 / 定机位 / 定 A B 位置 / 定动作向量"从 Pass 1 里剥离出来。
// Pass 1 之前先让模型做导演调度，这样 Pass 1 只负责按骨架扩写细节，
// 不再同时承担"拆镜 + 定参数 + 扩写"三件事。

const PASS_0_BEAT_SHEET_SYSTEM = `你是专业级视频导演兼分镜师。用户给你一段笼统的故事/动作粗稿，可能只有一两句话。你的任务**不是写画面**，而是先做导演调度——把粗稿拆成几个连续镜头骨架，每个镜头骨架只解决导演问题，不写服化道、风格、光影、画面细节。

${VELLUM_DIRECTOR_WORKFLOW}

【输出严格遵守这种格式（机器要解析）】

镜头1
目的：建立空间 / 角色出手 / 目标反应 / 接触打击 / 重建规模 / 情绪特写 / 道具操作（七选一，只能写一个）
机位：摄影机站在哪里。例如「站在两人侧面，画面左低机位」「站在 A 身后右肩」「贴近 B 正前方」「远处高位俯瞰」。必须是可演示的物理站位。
A：A 的名字 / 画面位置（左前景/右前景/左中景/右中景/左后景/右后景/画面中央）/ 身体取景（全身入镜/腰部以上/胸口以上/肩部以上/头部特写/手部特写/背部肩胛/后脑勺与肩背 等）/ 朝向（正面/背影/侧面/45度侧面/过肩背影 等）
B：B 的名字 / 画面位置 / 身体取景 / 朝向（如果只有一个主体，写「B：无」）
距离：两人之间空间关系。例如「贴身接触」「一臂距离」「三到五米潮湿空地」「隔着雾气和管线」「远处虚化」「同一焦平面」「A 前景遮挡 B 后景」。如果只有一个主体，写场景到主体的空间关系。
// ... [GAP: lines 471..1839 not captured] ...
  if (fixedShots.length > 1) {
    issues.push("最终稿固定镜头超过一个。动作段落必须优先推、拉、跟、摇、环绕或一镜到底。");
  }

  return issues.slice(0, 18);
}

async function callFinalPromptModel(
  systemPrompt: string,
  userText: string,
  usedRefImages: RefImage[],
  onChunk?: (fullText: string) => void
): Promise<string> {
  const imagePaths = usedRefImages.map((i) => i.file_path);
  const mode = await getAuthMode();
  if (mode === "cli") {
    return callViaCLI(systemPrompt, userText, imagePaths);
  }
  if (mode === "openai") {
    return callViaOpenAI(systemPrompt, userText, imagePaths, onChunk);
  }
  if (mode === "codex") {
    return callViaCodex(systemPrompt, userText, imagePaths);
  }

  const imageBlocks: ImageBlock[] = [];
  const failedImages: string[] = [];
  for (const img of usedRefImages) {
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
  if (failedImages.length > 0 && usedRefImages.length > 0) {
    if (imageBlocks.length === 0) {
      throw new Error(
        `Unable to read any of the ${usedRefImages.length} reference image(s). Check Library file paths and Tauri fs:scope. First failure: ${failedImages[0]}`
      );
    }
    throw new Error(
      `${failedImages.length}/${usedRefImages.length} reference image(s) failed to read; aborting to avoid sending an incomplete request. Failed: ${failedImages
        .slice(0, 3)
        .join(", ")}${failedImages.length > 3 ? ", …" : ""}`
    );
  }

  return callViaAPI({
    model: MODEL_OPUS,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [...imageBlocks, { type: "text", text: userText }],
      },
    ],
  });
}

async function callPromptModel(
  systemPrompt: string,
  userText: string,
  imagePaths: string[] = [],
  onChunk?: (fullText: string) => void
): Promise<string> {
  const mode = await getAuthMode();
  if (mode === "cli") {
    return callViaCLI(systemPrompt, userText, imagePaths);
  }
  if (mode === "openai") {
    return callViaOpenAI(systemPrompt, userText, imagePaths, onChunk);
  }
  if (mode === "codex") {
    return callViaCodex(systemPrompt, userText, imagePaths);
  }
  if (imagePaths.length > 0) {
    const imageBlocks = await readImageBlocksOrThrow(imagePaths);
    return callViaAPI({
      model: MODEL_SONNET,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [...imageBlocks, { type: "text", text: userText }],
        },
      ],
    });
  }
  return callViaAPI({
    model: MODEL_SONNET,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userText }],
  });
}

async function readImageBlocksOrThrow(imagePaths: string[]): Promise<ImageBlock[]> {
  const imageBlocks: ImageBlock[] = [];
  const failedImages: string[] = [];

  for (const path of imagePaths) {
    try {
      const bytes = await readFile(path);
      imageBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaTypeFromPath(path),
          data: bytesToBase64(bytes),
        },
      });
    } catch (e) {
      console.warn("[claude] read image failed:", path, e);
      failedImages.push(path);
    }
  }

  if (failedImages.length > 0) {
    if (imageBlocks.length === 0) {
      throw new Error(
        `Unable to read any of the ${imagePaths.length} reference image(s). First failure: ${failedImages[0]}`
      );
    }
    throw new Error(
      `${failedImages.length}/${imagePaths.length} reference image(s) failed to read; aborting to avoid incomplete visual context. Failed: ${failedImages
// ... [GAP: lines 1976..2219 not captured] ...
  // still trigger a full rewrite.
  const { shotLocal, hasGlobalIssue } = extractBadShotIndices(issues);
  console.warn("[vellum] first pass failed validation; repairing", {
    issues,
    surgicalTargets: shotLocal,
    fullRewrite: hasGlobalIssue || shotLocal.length === 0,
  });
  const surgical = !hasGlobalIssue && shotLocal.length > 0;
  const partialOrFull = await repairFirstPassOutput(
    draft,
    first,
    issues,
    usedRefImages,
    {
      badShotIndices: surgical ? shotLocal : [],
      beatSheet,
    }
  );
  const merged = surgical ? mergeFirstPassShots(first, partialOrFull) : partialOrFull;
  const repairedIssues = validateFirstPassOutput(merged, {
    expectedImageIndices,
    expectedSceneIndices,
  });
  if (repairedIssues.length > 0) {
    console.warn("[vellum] repaired first pass still has issues", repairedIssues);
  }
  return merged;
}

// ─── Pass 2: first pass + bindings + images → final enhanced ────────
// 基于 docs/methodology.md 「分镜固定规则」+「风格提示词的位置（写两层 + 三层结构）」

/**
 * Wrap a Promise with a hard JS-side timeout that rejects after `ms` ms.
 * Orphans the underlying operation (subprocess keeps running until OS kills it),
 * but unblocks the UI so the user can retry / cancel. Defends against grill
 * H2: CLI subprocess wrappers have no timeout / no cancel.
 */
const CLI_TIMEOUT_MS = 180_000; // 3 min hard cap for Claude/Codex subprocess
const FETCH_TIMEOUT_MS = 300_000; // 5 min cap — gpt-5 reasoning models 思考阶段没字节流出，90s 会被 abort

/**
 * Extract video duration (in seconds) from a draft / first-pass / shot title.
 * Matches patterns like "激斗15秒", "追逐10s", "5秒". Clamped to dreamina's
 * 4-15 second range. Returns null if no match. Used by SubmitView to pre-fill
 * the --duration option so the user doesn't have to retype it.
 */
export function parseDurationSeconds(text: string): number | null {
  if (!text) return null;
  // Prefer the first match (typically in the title line)
  const m = text.match(/(\d{1,2})\s*(?:秒|s\b)/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(4, Math.min(15, n));
}

const DEFAULT_STYLE_LAYER = `虚幻5引擎实时渲染，Blur 公司顶级 CG 质感，史诗级 3D 写实画面，融入胡金铨电影的凌厉节奏、东方色彩与禅意氛围；重质感光影：真实太阳光与体积云散射，运动模糊只作用于高速边缘，人物脸部、武器、服化道与关键材质保持锐利；色调以东方暖金、墨绿、赭红、烟灰为主，色彩饱和度高但带胶片褪色感；环境带电影粒子感与油画肌理；全程无配乐，只保留环境风声、刀剑碰撞、能量电弧与空气冲击声。`;

function isLiveActionStyle(style: string): boolean {
  return /真人|实拍|真实演员|现场摄影|非CG|非 CG|电影级写实|动作电影|废土生存者|live[-\s]?action/i.test(style);
}

function buildStylePriorityBlock(liveAction: boolean): string {
  if (!liveAction) {
    return `【风格优先级】
// ... [GAP: lines 2286..2679 not captured] ...
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
  // find all image refs in finalText, dedupe in order of FIRST appearance.
  // Supports both editable badge syntax "(图N)" and finalized binding syntax
  // "参考图绑定：图1=..." where Pass 2 removes badge nodes from shot bodies.
  const usedIndices: number[] = [];
  const re = /\(图\s*(\d+)\)|图\s*(\d+)\s*[=＝:：]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(finalText)) !== null) {
    const n = Number(m[1] ?? m[2]);
    if (!usedIndices.includes(n)) usedIndices.push(n);
  }

  // Resolve each index to a RefImage, preserving first-appearance order.
  // This matters because dreamina sees images positionally — the Nth uploaded
  // image is "第N张" to the model, and the prompt's "第N张=图M" header tells
  // the model how to map positions back to (图M) text refs.
  const orderedFiles: string[] = [];
  const orderedIndices: number[] = [];
  const orphanIndices: number[] = [];
  const orderedRefs: { ref: RefImage; index: number }[] = [];
  for (const n of usedIndices) {
    const ref = refImages.find((r) => r.image_index === n);
    if (!ref) {
      orphanIndices.push(n);
      continue;
    }
    orderedFiles.push(ref.file_path);
    orderedIndices.push(n);
    orderedRefs.push({ ref, index: n });
  }

  // Upload-order header in dreamina's expected shape. Keeps per-image role
  // labels (人物/场景/道具) as a short hint; user's body text supplies the
  // detailed binding descriptions.
  const uploadOrderParts = orderedRefs.map(
    ({ index }, i) => `第${i + 1}张=图${index}`
  );
  const uploadOrderHeader =
    uploadOrderParts.length > 0
      ? `本条任务参考图上传顺序：${uploadOrderParts.join("；")}。`
      : "";

  // Per-role grouping (kept for UI breakdown chips, not for prompt header)
  const byRole = new Map<
    string,
    { role: string; label: string; indices: number[]; files: string[] }
  >();
  for (const { ref, index } of orderedRefs) {
    const label = ROLE_LABEL_ZH[ref.role] || ref.role;
    if (!byRole.has(ref.role)) {
      byRole.set(ref.role, { role: ref.role, label, indices: [], files: [] });
    }
    const g = byRole.get(ref.role)!;
    g.indices.push(index);
    g.files.push(ref.file_path);
  }

  return {
    uploadOrderHeader,
    body: finalText,
    orderedFiles,
    orderedIndices,
    imageBindings: Array.from(byRole.values()),
    orphanIndices,
  };
}

// ─── helpers ────────────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  // Prefer the modern native API where available — it's ~10× faster and
  // doesn't risk RangeError from String.fromCharCode arg-cap (grill M7).
  const proto = Uint8Array.prototype as unknown as {
    toBase64?: () => string;
  };
  if (typeof proto.toBase64 === "function") {
    return (bytes as unknown as { toBase64: () => string }).toBase64();
  }
  // Fallback: chunked apply() — safer than spread because apply takes an
  // array argument rather than spreading into discrete function args.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
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
