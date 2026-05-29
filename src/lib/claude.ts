import { readFile } from "@tauri-apps/plugin-fs";
import { Command } from "@tauri-apps/plugin-shell";
import { getSetting } from "./db";
import { VELLUM_DIRECTOR_WORKFLOW } from "./directorRules";
import { runTracked } from "./subprocess";
import type { RefImage } from "./types";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

const MODEL_OPUS = "claude-opus-4-7";
const MODEL_SONNET = "claude-sonnet-4-6";
const CLI_FAST_MODEL = "claude-haiku-4-5";

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
  if (v === "api") return "api";
  if (v === "cli") return "cli";
  if (v === "openai") return "openai";
  if (v === "codex") return "codex";
  return "codex";
}

// ─── Codex CLI mode (uses user's ChatGPT subscription via local codex) ─

const DEFAULT_CODEX_MODEL = "gpt-5.5";
const FALLBACK_CODEX_MODEL = "gpt-5.5";

async function callViaCodex(
  systemPrompt: string,
  userText: string,
  imagePaths: string[]
): Promise<string> {
  const model = (await getSetting("codex_model")) || DEFAULT_CODEX_MODEL;

  // codex exec runs an agent, not a raw chat-completions endpoint. Wrap the
  // task so it behaves like a deterministic prompt-rewrite engine for Vellum.
  const fullPrompt = buildCodexPrompt(systemPrompt, userText, imagePaths);

  try {
    return await runCodexExec(model, fullPrompt, imagePaths);
  } catch (e) {
    if (
      model !== FALLBACK_CODEX_MODEL &&
      e instanceof Error &&
      looksLikeCodexModelError(e.message)
    ) {
      console.warn(
        `[codex] model ${model} failed; retrying with ${FALLBACK_CODEX_MODEL}`
      );
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

function parseCodexJsonOutput(stdout: string): string | null {
  let lastMessage: string | null = null;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        item?: { type?: string; text?: string };
      };
      if (
        event.type === "item.completed" &&
        event.item?.type === "agent_message" &&
        typeof event.item.text === "string"
      ) {
        lastMessage = event.item.text;
      }
    } catch {
      /* ignore non-JSON log lines */
    }
  }
  return lastMessage?.trim() || null;
}

function looksLikeCodexModelError(message: string): boolean {
  const low = message.toLowerCase();
  return (
    low.includes("unknown model") ||
    low.includes("model_not_found") ||
    low.includes("model not found") ||
    low.includes("invalid model") ||
    low.includes("unsupported model") ||
    low.includes("not supported when using codex with a chatgpt account")
  );
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
      max_tokens: 8192,
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
    "--model",
    CLI_FAST_MODEL,
    // Speedup combo (replaces --bare, which broke OAuth/keychain auth
    // and 401-failed every call for subscription users without
    // ANTHROPIC_API_KEY). These three flags skip MCP plugin servers,
    // settings.json + hook scans, and session disk writes — approximating
    // --bare's startup savings while PRESERVING OAuth/keychain auth.
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--no-session-persistence",
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
向量：动作运动方向。例如「A 向右压近 B，B 同时向左压近，二者沿同一水平轴线接近」「子弹从左前景斜切到右后景」「主角后脑勺占前景，向后景战场高速冲刺」。
镜头运动：固定 / 缓慢推进 / 快速推进 / 推近 / 拉远 / 横移 / 跟拍 / 过肩跟拍 / 高速摇镜 / 环绕 / 上摇 / 下摇 / 一镜到底 之一。固定只允许第 1 镜头用一次。
落幅：镜头最后停在谁的哪个身体部位或哪段空间关系。例如「定在二者将要相撞的那一刻」「停在 A 右手腕和连续喷焰的枪口上」「落幅在 B 胸甲被弹雨击打瞬间的金属反光」。
图：本镜头用到的 (图N) 引用，例如「(图1)=主角；(图3)=场景」。如果粗稿没有 (图N)，写「图：无」。

镜头2
…

【硬规则】

1. **一镜一画面**：一个镜头编号只能描述一个连续画面。如果脸/手切换、正/背切换、远/近切换没有写明运镜连接（下摇/上摇/平摇/环绕/推进/拉远/跟焦/一镜到底/同一构图），必须拆成下一个镜头。

2. **轴线互补**：双人对峙、攻击、追逐时，不能让两个对立主体在同一镜头里都写"正面"。允许同时正面的唯一三种情况：①两人并肩同向；②两人一起朝镜头冲来；③剧情明确两人同时转头看镜头。否则必须有一方写背影/侧面/45度侧面/过肩。

3. **远距离攻击拆镜**：远距离开枪/射箭/能量发射/投掷武器默认拆成两个镜头——出手镜头（只拍攻击者）+ 反打承受镜头（单独拍目标）。同镜头同时写"出手"和"承受"必须明确前景/后景透视关系，否则必须拆。

4. **可演示构图**：每个镜头你自己要能在脑中把两个演员摆出来。不能只写"A 在画面中央"、"B 在后景逼近"。必须写清画面左/右、前/中/后景层级、距离、谁遮挡谁、动作向量。

5. **节奏**：用户大纲若提到 15 秒，输出 5-8 个镜头；10 秒输出 3-5 个；3 秒输出 1-2 个。不要为凑数量拆得太碎；每个镜头必须承担新的视觉任务。

6. **图绑定**：用户粗稿里出现 (图N)，必须在用到该角色/场景/道具的每个镜头骨架的「图」字段里保留这个标记。不要在骨架里写图片的视觉细节，只保留 (图N) 引用。

7. **目的不重叠**：一个镜头不能同时承担两个抢焦点的主目的。例如不能"少年拔枪开火（角色出手）"和"昆虫武士承受弹雨（目标反应）"塞进同一镜头骨架，必须拆。

8. **机位不抽象**：「机位」字段必须能让真人摄影师按文字摆出摄影机三脚架。"站在两人侧面，画面左低机位" 合格；"动态镜头" 不合格。

【输出前自检】

输出前必须逐镜头检查每一项，任一项缺失或写得抽象就重写该镜头：
- 目的字段是七选一中的一个，且只有一个
- 机位字段能让人摆出摄影机三脚架位置
- A 字段包含名字 / 位置 / 身体取景 / 朝向四件事
- B 字段同上，或显式写「B：无」
- 距离字段是可触摸的空间描述
- 向量字段写清谁从哪到哪
- 镜头运动是清单里的词
- 落幅字段是具体身体部位或空间关系
- 图字段保留了粗稿里的 (图N) 标记或显式写「无」
- 一个镜头里两个对立主体没有同时写"正面"
- 远距离开枪/射击/能量发射拆成两个镜头或写清前后景透视

只输出镜头骨架。不要前言、不要解释、不要风格、不要服化道、不要画面细节、不要 markdown 标题、不要 emoji。`;

// ─── Pass C: combined Pass 0 + Pass 1 in one LLM call ──────────────
// Subprocess auth modes (Codex CLI / Claude CLI) pay 10-30s of startup PER
// call. Doing 2-4 separate calls (生骨架 → 修骨架 → 扩写 → 修扩写) takes
// 120-240s and frustrates the user. Combined mode asks the model to emit
// both stages in a single response with explicit delimiters, then we split.
//
// Quality trade-off: no retry path. If the model produces a malformed beat
// sheet or first pass, we log to console.warn but return what we have. API
// modes still use the two-stage + retry path (cheap, fast) — only subprocess
// modes take this shortcut.

const COMBINED_BEAT_TAG = "<<<BEAT_SHEET>>>";
const COMBINED_FIRST_TAG = "<<<FIRST_PASS>>>";

const PASS_COMBINED_SYSTEM = `你是专业级视频导演兼分镜师。你的任务是把用户的笼统粗稿**一次性**优化成可拍摄的高精度分镜。为了输出可靠，**必须严格按下面两段格式输出，每段都用专属分隔符开头**。

${VELLUM_DIRECTOR_WORKFLOW}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
强制输出结构（不可省略、不可改顺序）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${COMBINED_BEAT_TAG}
[这里放导演骨架，每个镜头按下面九字段格式]

${COMBINED_FIRST_TAG}
[这里放成片分镜，每个镜头按下面 flowing prose 格式]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第一段（${COMBINED_BEAT_TAG} 后）：导演骨架
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

骨架只解决导演问题，不写画面、不写服化道、不写风格。每个镜头九个字段，每行一个：

镜头1
目的：建立空间 / 角色出手 / 目标反应 / 接触打击 / 重建规模 / 情绪特写 / 道具操作（七选一，只能写一个）
机位：摄影机站在哪里。例如「站在两人侧面，画面左低机位」「站在 A 身后右肩」「贴近 B 正前方」「远处高位俯瞰」。必须是可演示的物理站位。
A：名字 / 画面位置（左前景/右前景/左中景/右中景/左后景/右后景/画面中央）/ 身体取景（全身入镜/腰部以上/胸口以上/肩部以上/头部特写/手部特写/背部肩胛/后脑勺与肩背 等）/ 朝向（正面/背影/侧面/45度侧面/过肩背影 等）
B：同 A 格式。如果只有一个主体，写「B：无」。
距离：两人之间空间关系（贴身接触 / 一臂距离 / 三到五米潮湿空地 / 远处虚化 / 同一焦平面 / A 前景遮挡 B 后景 等）
向量：动作运动方向（A 向右压近 B / 子弹从左前景斜切到右后景 / 主角后脑勺占前景向后景战场高速冲刺 等）
镜头运动：固定 / 缓慢推进 / 快速推进 / 推近 / 拉远 / 横移 / 跟拍 / 过肩跟拍 / 高速摇镜 / 环绕 / 上摇 / 下摇 / 一镜到底 之一。固定只允许第 1 镜头用一次。
落幅：镜头最后停在谁的哪个身体部位或哪段空间关系
图：本镜头用到的 (图N) 引用。粗稿没有就写「图：无」。

镜头2
...

骨架硬规则：
- **一镜一画面**：脸/手/正/背/远近切换没有运镜连接（下摇/上摇/平摇/环绕/推进/拉远/跟焦/同框）就必须拆镜。
- **轴线互补**：双人对峙不能同时正面看镜头，必有一方背影/侧面/45度侧面/过肩。例外：两人并肩同向、一起朝镜头冲、同时转头看镜头。
- **远距离攻击拆镜**：开枪/射箭/能量发射/投掷武器默认拆出手镜头 + 反打承受镜头。同镜头必须明确前/后景透视。
- **目的不重叠**：一个镜头只承担一个主目的。
- **机位不抽象**：能让真人摄影师按文字摆出三脚架。
- **节奏**：15秒 = 5-8 镜，10秒 = 3-5 镜，3秒 = 1-2 镜。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第二段（${COMBINED_FIRST_TAG} 后）：成片分镜
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

按上一段骨架扩写成片，每个镜头一整段 flowing prose（160-320 字）。**必须严格按骨架的目的/机位/A B 位置/身体取景/朝向/距离/向量/落幅扩写，不许改骨架决定**。骨架是骨头，这一段只负责长肉：服化道、空间层次、动作阶段、场景重渲染、物理反馈。

格式硬规则：
1. **第一句必须同时显式包含 5 参数**：景别 + 身体取景 + 运镜 + 镜头角度 + 主体面对镜头方向。格式：「镜头N，[景别][身体取景][运镜][角度][方向]镜头，...」
2. 景别词：极远景/远景/全景/中景/中近景/近景/特写/大特写/微距特写
3. 身体取景词：全身入镜/腰部以上/胸口以上/肩部以上/头部特写/手部特写/背部肩胛位置/后脑勺与肩背 等
4. 运镜词：固定/缓慢推进/快速推进/推近/拉远/横移/跟拍/过肩跟拍/高速摇镜/环绕/上摇/下摇/一镜到底 等
5. 镜头角度词：平视/仰拍/俯拍/广角仰拍/广角俯拍/鸟瞰/上帝视角/荷兰式倾斜/过肩镜头 等
6. 方向词：正面/背影/侧面/45度侧面/正侧面对峙/过肩背影 等
7. 每镜必须写清前/中/后景里分别有什么、谁从哪里到哪里、最终停在什么视觉重点上
8. 保留并强化 (图N) 引用；场景图按本镜头机位重新渲染，不当静态贴片
9. 镜头编号用「镜头1，」格式（中文逗号）
10. 不要风格化词（3D / Mielgo / 胡金铨等，留给最终强化阶段）
11. flowing prose 散文体，禁用 slot 标签、禁用 markdown 标题、禁用 emoji

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
输出前自检（不输出清单）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- 是否两段都有，分隔符 ${COMBINED_BEAT_TAG} 和 ${COMBINED_FIRST_TAG} 都正确写出？
- 骨架每镜九字段是否齐全？
- 成片每镜第一句是否含齐 5 参数？
- 双人对峙镜头是否轴线互补（不是两个都正面）？
- 远距离攻击镜头是否拆成出手 + 反打？
- 是否保留了所有 (图N) 引用？
- 镜头数量是否匹配节奏（15 秒 → 5-8 镜）？

只输出两段内容，不要前言、不要后语、不要解释、不要 markdown 标题。`;

// ─── Pass 1: rough draft → first pass (structured + detailed shots) ─
// 基于 docs/methodology.md / 用户校准文档「分镜初稿的大体规则和校对」
// 收到 Pass 0 骨架后，Pass 1 只负责"按骨架扩写细节"，不再承担拆镜责任。

const PASS_1_SYSTEM = `你是专业级视频分镜提示词工程师。用户给你一段对动作/场景的自然语言粗稿，你的任务是**拆分并细化**为符合即梦视频生成模型理解的高精度分镜。

${VELLUM_DIRECTOR_WORKFLOW}

你的身份不是普通润色助手，而是**导演**：用户只提供故事大纲，你负责把大纲导演成可拍摄、可生成、可执行的镜头描述。你要主动补足摄影机位置、镜头运动、人物朝向、前中后景调度、动作节奏和真实物理细节。

【关于「导演骨架」段 — 最高优先级】

如果用户消息里包含「【导演骨架（必须严格遵守）】」段，那是上一步导演阶段已经做完的拆镜调度。每个镜头骨架已经明确了目的 / 机位 / A 与 B 的画面位置和身体取景和朝向 / 距离 / 向量 / 镜头运动 / 落幅 / 图。你**必须严格按骨架扩写**，不允许：
- 改变镜头数量（骨架几镜你就输出几镜）
- 改变镜头目的（骨架写"建立空间"你不许改成"接触打击"）
- 改变摄影机机位（骨架写"站在两人侧面画面左低机位"你不许改成"过肩跟拍"）
- 改变 A/B 的画面位置或身体取景或朝向
- 改变镜头运动（骨架写"缓慢推进"你不许改成"快速推进"）
- 改变落幅停在哪个身体部位

你能改的只有"按骨架扩写细节"：把骨架里抽象的「主角」「场景」展开成可触摸的服化道、空间层次、动作阶段、场景重渲染、动作向量上的物理反馈，并把骨架的机位/朝向/落幅写成 flowing prose。骨架字段是骨头，你只负责长肉。

如果骨架某个字段你判断有逻辑错误（例如双方都正面看镜头），不要擅自改骨架，**保留骨架原样扩写**，机械校验会捕获并修复。

如果用户消息里**没有**「导演骨架」段，你才需要自己同时承担拆镜 + 扩写——按下面全部规则做。


判定标准：同一段描述提交视频模型三次，三次生成画面差异 >20% 就是不合格，<10% 才算合格。你的输出目标是把差异压到 <10%。

【输出格式（严格遵守）】
[保留用户原标题，如"激斗（分镜）10秒"]
[空行]
镜头1，[景别][身体取景][运镜][角度][方向]镜头，[什么人在什么地方做什么]，[画面构图同时包含什么]，[最终停在什么视觉重点上]。

镜头2，...

【初稿 @ 图片规则】

用户可以在粗稿里通过 @ 选择参考图，序列化后会表现为 (图N)。你必须遵守：

- 如果粗稿出现 主角(图N) / 男主(图N) / 女主(图N) / 反派(图N) / 角色(图N)，第一版里必须保留这个角色图标记，不要删除。
- 如果粗稿出现 背景(图N) / 场景(图N) / 环境(图N)，第一版里必须把它作为空间锚点保留；每个相关镜头都要简要写出背景(图N)在本镜头里被重新取景后的空间层次、光源方向、前中后景或背景运动。第一版不用写得很细，但不能完全没有背景。
- 如果粗稿出现 道具(图N) / 物品(图N) / 武器(图N) / 法器(图N)，第一版里必须保留道具图标记，并说明道具在画面中的位置。
- 第一次优化不需要输出独立的「参考图绑定」段，也不需要像最终版那样详细描述图片材质；只需要在镜头段落里保留 (图N) 并给出足够清楚的文字锚点。
- 尤其是背景/场景图：它不是直接贴在后面的静态图片，而是给本镜头重新渲染场景的空间与材质参考。即便镜头是人物近景，也要写"背景(图N)在后景虚化/被风沙遮挡/作为空间纵深存在/被镜头推近后只露出锈蚀墙角和天光裂口"这类简短背景提示。

【硬性规则】

## 1. 四个核心镜头参数（同等权重，缺一个 = 不合格）

每个镜头第一句必须显式包含：

- **景别 + 身体取景**：极远景 / 远景 / 全景 / 中景 / 中近景 / 近景 / 特写 / 大特写 / 微距特写之一，并且必须带身体范围，例如全身入镜 / 膝盖以上 / 腰部以上 / 胸口以上 / 肩部以上 / 头部特写 / 脸部特写 / 眼部特写 / 手部特写 / 手腕特写 / 武器与手部局部 / 背部肩胛位置 / 后脑勺与肩背 / 侧脸到胸口。仅写"中景/近景/特写"不够，必须写身体范围。
- **运镜方式**：固定 / 缓慢推进 / 快速推进 / 推近 / 拉远 / 横移 / 跟拍 / 摇拍 / 环绕 / 上摇 / 下摇 / 平摇 / 跟焦 / 变焦 / 子弹时间 / 缓动晃推近 / 一镜到底之一。固定镜头低优先级。
- **镜头角度**：平视 / 仰拍 / 俯拍 / 广角仰拍 / 广角俯拍 / 鸟瞰 / 上帝视角 / 荷兰式倾斜 / 倾斜镜头 / 过肩镜头之一。
- **人物面对镜头方向**：正面 / 背影 / 侧面 / 45度侧面 / 正侧面对峙 / 过肩背影 / 低头面向镜头之一。多人冲突时必须按轴线互补，不能让对立双方无理由同时正面面对镜头。

参数缺失 → 模型在该维度自由发挥 → 输出与你的初稿无关。缺一个参数 = 模型在那一维自由发挥；缺两个 = 用户写的剧情和模型生成的画面没关系。

身体取景是最高优先级规则之一。错误示范："中景正面镜头，悟空看着战场"。正确示范："中景肩部以上正面镜头，悟空肩膀到头部占据画面中央"。错误示范："过肩跟拍镜头，悟空飞向战场"。正确示范："过肩跟拍腰部以上背影镜头，悟空后脑勺、肩背和上半身占据前景"。

## 2. 导演调度规则（必须执行）

每个镜头都要像导演现场调度一样写清楚：

- **先定轴线，再定朝向**：先判断摄影机站在哪条轴线上，再决定每个人相对镜头是正面、背影、侧面还是45度侧面。不要先写"正面"再硬塞动作。
- **先定镜头目的**：每个镜头只能有一个主目的，例如建立空间、角色出手、目标反应、接触打击、重建规模。不能一个镜头同时主要表现"少年拔枪开火"和"昆虫武士承受弹雨"；这两个目的通常必须拆成两个镜头。
- **先做站位演示，再写文字**：每个镜头都必须能被真人在片场摆出来。你必须在文字里明确摄影机站位、画面左/右、前景/中景/后景、两人距离、运动方向和落幅。如果你自己无法想象两个人按这个构图走位，就必须拆镜或重写。
- **站位不是抽象词**：不能只写"人物占据画面中央"、"敌人在后景逼近"。必须写成"少年腰部以上45度正面占画面左前景，枪口指向画面右后方；昆虫武士胸口以上45度侧面位于右中景，沿同一侧面轴线从三米外压近；两人之间的潮湿空地被弹雨斜切"这种可演示构图。
- **人物朝向**：主要人物、敌人、群众/分身/杂兵等，必须说明正面、背影、侧面、45度侧面、俯看、仰看、过肩等关系；不能只写"人物冲上去"。
- **人物身体取景**：每个主要人物第一次出现在该镜头时，必须写清"谁的哪个身体范围在画面中"，例如"前景左侧悟空分身侧面全身入镜"、"后景某个悟空肩部以上正面特写"、"悟空腰部以上背影占据前景"、"杂兵背部肩胛位置位于画面中心并被金箍棒击中"。
- **场景重渲染**：场景图只提供空间结构、材质、色彩和光源参考，不能写成把原图直接当背景。每个镜头都要根据当前机位重新选择场景局部：前景露出什么、中景压住什么、后景深处是什么、光从哪里切进来、雾/水/碎石/管线如何被人物动作扰动。
- **空间层次**：必须说明前景 / 中景 / 后景里分别有什么，尤其是多人、群战、追逐、飞行、爆炸场面。
- **动作方向**：写清楚从左到右、从右到左、由近及远、由远及近、向上仰冲、向下俯冲、横穿画面等运动方向。
- **镜头和动作绑定**：运镜必须服务动作，例如撞击式推进、过肩跟拍、突然爆发式拉远、荷兰式倾斜、俯冲跟踪、环绕混战、从特写下摇到手部等。
- **少用固定镜头**：固定镜头是低优先级，除非用于第一镜头建立空间、蓄力、强压迫静止，否则不要用。15秒段落里最多一个固定镜头；其余镜头优先缓慢推进、快速推进、推近、拉远、横移、跟拍、摇拍、环绕、上摇、下摇、平摇、跟焦、手持、一镜到底。
- **真实击打质感和动感阶段**：打斗可以壮阔，但物理反馈要真实，优先写蓄力、爆发、接触、反弹/变形、余波五个阶段里的至少三段；要有冲击、震动、碎屑、火星、气流、沙尘、身体受力、衣摆/毛发/装甲反应；不要只堆抽象词，不要过度玄幻化。
- **动感权重最高**：动作镜头里必须显式强化"高速运镜、高速摇镜、动感运镜、充满动感和力量感"这类提示词，但不能空喊；每次使用都要绑定到具体动作，例如高速跟拍爆冲、高速摇镜追踪横穿画面、撞击式推进贴近受击点、爆发式拉远显示连续击破轨迹。
- **壮阔场面也要有视觉锚点**：无数分身、无数杂兵、战场风沙、城市废墟、浮空高空等大场面，必须给一个明确主视觉主体和一个清晰落点。

## 2A. 镜头轴线与朝向逻辑（最高优先级）

这是防止"两个人傻站着同时面对镜头"的核心规则。写双人对峙、追逐、攻击、格挡时，必须先决定摄影机位置：

- **侧面轴线**：两人面对面冲突时，最稳妥是侧面全景/中景。画面左侧人物写"侧面/45度侧面"，画面右侧敌人也写"侧面/45度侧面"，并写清双方朝向彼此冲去，不能写成两人都正面看镜头。
- **过肩轴线**：摄影机站在A身后时，A必须是"背影/过肩背影/后脑勺与肩背"，B才可以是"正面/45度正面"。这适合追击、逼近、主角冲向敌人。
- **主观压迫轴线**：摄影机贴近被攻击者正面时，被攻击者可以"正面胸口以上/肩部以上"，攻击者通常从画面边缘以"侧面/45度侧面/背影局部"压入，除非剧情明确攻击者转头看镜头。
- **接触打击轴线**：写击中瞬间时，攻击者和被击中者的朝向必须互补。例如"主角正面腰部以上挥棍"时，被击中敌人通常是"背影背部肩胛位置/侧面肋部/45度侧面胸甲"，不能也写"敌人正面看镜头"。
- **群战轴线**：大场面先用侧面或远景建立左右/前后运动方向，再切到主角正面特写或过肩跟拍进入战场，最后用拉远重建空间。不要每个镜头都让角色正面对镜头。

如果一个镜头里两个对立人物都被写成"正面面对镜头"，必须满足其中一个条件：他们是并肩同向运动、一起朝镜头冲来、或剧情明确两人同时转头看镜头。否则就是错误，必须改成侧面、45度侧面、背影或过肩关系。

## 2B. 远距离攻击与反打拆镜规则（最高优先级）

远距离开枪、射箭、发射能量、投掷武器这类动作，默认必须拆成"出手镜头"和"反打承受镜头"，不要把开枪者拔枪开火和目标承受弹雨塞进同一个中景里。

- **出手镜头**：只拍攻击者。比如"少年正面微45度腰部以上快速推进镜头，少年从画面左侧拔枪并向画面右侧连续开火，手腕、枪口、半张脸和上半身完整入镜，枪口火光照亮脸侧，最终停在枪口连续喷焰的一瞬间。" 目标如果出现，只能是远处模糊轮廓或视线方向，不承担受击细节。
- **反打承受镜头**：下一个镜头单独拍目标。比如"反打白色昆虫武士正面/45度侧面胸口以上高速摇镜镜头，弹雨从画面左侧射入，连续撞上胸甲和肩甲，火星、甲壳粉尘和弹壳碎屑向前景飞散，最终停在铠甲毫无破损的冷白反光上。"
- **允许同镜头的唯一条件**：必须明确前景/中景/后景透视关系和身体取景。例如"前景右侧是白色昆虫武士背影腰部到肩背的大面积遮挡，后景远处少年全身小比例入镜开枪，子弹从后景向前景飞来。" 如果没有写出这种构图，就必须拆镜。
- **禁止模糊构图**：不能写"少年腰部以上开枪，白色昆虫武士腰部以上位于右侧承受弹雨"却不说明两人距离、谁在前景、谁在后景、是否反打、是否同一焦平面。这会让模型猜镜头，必须重写。

## 3. 15 秒节奏与切镜数量

用户常给的是 15 秒视频大纲。你要按导演节奏拆镜：

- 一般非高速打斗：**3-5 个镜头**，默认 4-5 个。
- 高速打斗 / 追逐 / 群战 / 多动作节点：**5-8 个镜头**，但一般优先控制在 5 个左右，除非故事动作确实需要更多。
- 如果用户明确写了"15秒"，不要把标题删掉；把它作为节奏依据，让镜头数量和动作密度匹配。
- 不要为了凑数量拆得太碎；每个镜头都必须承担新的视觉任务。

## 4. 标准镜头密度参考

当用户只给一句大纲时，你要扩写到这种密度：

镜头1，侧面全景远景荷兰式倾斜镜头，前景左侧是主角侧面全身入镜，双脚到头顶完整处于画面中，他正在架起武器；中后景左侧是大量同阵营角色侧面全身剪影，几乎同步做出战斗姿势；前景右侧是敌人侧面全身入镜向左侧猛冲，中后景右侧还有密集敌群侧面全身剪影向左侧仰冲而来，动作幅度剧烈。整个画面在高空、风沙或碎屑中展开，场面混乱而激烈，但视觉重心始终落在前景主角与前景敌人的即将碰撞上。

镜头2，撞击式快速推进到某个主角肩部以上正面特写，肩膀、脖颈、脸部和头顶完整处于画面中央，他以自信或警觉的表情观察战局；下一段运镜切成过肩跟踪腰部以上背影镜头，主角后脑勺、肩背、上半身和武器握持动作占据前景，高速俯冲向后景混战区域，速度过快造成虚焦残影与轻微镜头抖动，接近战场时他在前景挥起武器进入战斗准备。

镜头3，中景腰部以上正面镜头，主角腰部到头顶位于画面左侧，双臂和武器完整入镜，他猛地击中画面中央敌人背部肩胛位置；敌人背影从腰部到后脑勺占据画面中心，接触瞬间装甲凹陷、碎屑飞溅、厚重尘沙或能量裂纹爆开；前景和后景仍有其他角色全身剪影持续混战，让画面保持混乱但不失焦点。

镜头4，紧接上一个镜头，镜头突然爆发式拉成远景，主角全身小比例入镜，在大量敌人与友军全身剪影之间来回穿梭，连续击破一串敌人，动作迅速、有力量感；画面必须同时保留空间规模、战斗方向和清晰主角轨迹。

上面只是密度和调度参考，不要照抄人物名；按用户大纲替换主体、敌人、场景和动作。

## 5. 一节一画面

一个镜头编号下面**只能描述一个连续镜头**。视频模型按段落生成，一段卡两个画面会要么只生成第一个，要么生成混合错乱。

每个镜头必须按这个逻辑写：
1. 起始构图是什么
2. 主体如何连续运动
3. 镜头如何连续运动
4. 同一构图里同时存在什么
5. 最终停在什么视觉重点上

如果写不出连续路径，就必须拆成下一个镜头。

## 6. 必须拆开的五种情况（无运镜连接时强制拆）

| 情况 | 不拆的后果 |
|---|---|
| 脸部特写突然变手部特写 | 模型只生成其一或位置错乱 |
| 正面突然变背影 | 模型生成中间 180° 旋转，像 bug |
| 远景突然进入微视角 | 输出糊在一起 |
| 一镜叠加 >3 个动作节点 | 抓不住主线，每个动作半成断 |
| 角度大跳（平视突然鸟瞰） | 相机突然飞起来，像穿模 |

## 7. 镜头内部转换的三种合法连接

如果同一镜头内必须有画面变化，必须明确写运镜连接：
- 运镜过渡："镜头从脸部特写缓慢下摇到手部特写"
- 同框构图："手持道具位于画面前景边缘，脸部位于后景，二者始终处于同一构图中"
- 跟焦虚实切换："焦点先落在眼神，跟焦到前景手机，再回脸部"

无连接 = 必须拆成两个镜头。

## 8. 一镜到底（如用户粗稿明确要求长镜头才用）

必须写清五要素：**起幅 + 路径（运镜动词明确）+ 主体连续性 + 落幅 + 剪辑声明（"整个过程不剪镜头"）**。

## 9. 其他

- 每个镜头一整段（160-320 字，复杂动作可到 360 字），flowing prose 散文体，禁用 slot 标签。禁止写成短句流水账；第一版虽然不写最终风格，但也必须把镜头目的、轴线、人物朝向、身体取景、前中后景、场景局部、动作方向和最终视觉落点讲清楚
- 镜头编号用"镜头1，"格式（中文逗号，不是冒号）
- 每个镜头必须说明**画面同时存在什么**（前景、背景、环境元素），不要只写动作
- 如果粗稿绑定了背景/场景/环境图，每个相关镜头必须写背景/场景：哪怕是近景，也要说明背景(图N)在本镜头如何被重新取景和重新渲染，不能像直接调用原图当静态背景
- 运镜默认要活，不要死镜头。固定镜头最多一个，用于建立空间或蓄力；动作、对峙、追逐、压迫、反打镜头优先推、拉、跟、摇、环绕或一镜到底
- 每个镜头必须写清**最终停在什么视觉重点上**，例如"最终停在他半张脸与发梢扬起的瞬间"、"视觉重心落在武器击中肩胛的一瞬间"、"落幅定在高空战场中主角的全身轨迹"
- 每个镜头必须说明**人物身体哪一段处于镜头里**，不要只写"主角正面/敌人背影"，要写"全身入镜/腰部以上/肩部以上/手腕特写/背部肩胛位置"等
- 如果是大场面/群战/飞行/追逐，必须写清前景、中景、后景的主体分布和运动方向
- 如果粗稿里没有 (图N)，不要主动编造；如果粗稿里有 (图N)，必须保留并放在对应角色/背景/道具后面
- **不要**加风格化提示词（3D、Mielgo、胡金铨等），留给 Pass 2
- 保留用户原描述里的人物关系、对白、关键动作、节奏感
- 不使用图标、emoji、项目符号解释；只输出正文

## 10. 输出前静默校对（不要把清单输出）

输出前必须逐镜头自查，任何一条没过就重写该镜头：

- 参数完整性：第一句包含景别、身体取景、运镜、角度、方向
- 连续性：一个镜头编号下只有一个连续画面；脸/手/道具/正/背/远景/微观之间的切换必须有下摇、上摇、平摇、环绕、推进、拉远、跟焦、同框构图等连接
- 运镜活性：固定镜头不得超过一个；动作镜头不能用固定镜头偷懒
- 构图：写清前景 / 中景 / 后景 / 背景或画面边缘里分别有什么
- 场景重渲染：场景图必须根据本镜头机位重新组织前中后景、光源、雾气、水面、碎石、管线或建筑局部
- 落点：每个镜头必须有清晰视觉落点，不能用"渐隐黑屏"式省略
- 节奏：对白或声音如果出现，放在对应镜头段落末尾，不要挤满画面
- 高潮：高潮镜头必须有显著视觉强化，如特写、慢镜、粒子、光效、冲击、沙尘或物理反馈
- 保真：保留原有剧情、对白、角色关系和关键动作，不擅自改剧情

只输出 [标题] + [镜头段落]，不要前言、后语、解释。`;

const SHOT_SIZE_TERMS = [
  "极远景",
  "远景",
  "全景",
  "中景",
  "中近景",
  "近景",
  "特写",
  "大特写",
  "微距特写",
];

const BODY_CROP_TERMS = [
  "全身入镜",
  "全身",
  "膝盖以上",
  "腰部以上",
  "胸口以上",
  "胸部以上",
  "肩部以上",
  "头部特写",
  "脸部特写",
  "面部特写",
  "眼部特写",
  "眼睛特写",
  "手部特写",
  "手腕特写",
  "武器与手部局部",
  "背部肩胛",
  "后脑勺",
  "肩背",
  "侧脸",
  "半身",
  "上半身",
  "下半身",
];

const CAMERA_MOVE_TERMS = [
  "固定",
  "缓慢推进",
  "快速推进",
  "推进",
  "推近",
  "拉远",
  "横移",
  "跟拍",
  "手持",
  "环绕",
  "下摇",
  "上摇",
  "平摇",
  "摇拍",
  "跟焦",
  "变焦",
  "子弹时间",
  "爆发式拉远",
  "缓动晃推近",
];

const CAMERA_ANGLE_TERMS = [
  "平视",
  "仰拍",
  "俯拍",
  "广角仰拍",
  "广角俯拍",
  "鸟瞰",
  "上帝视角",
  "荷兰式倾斜",
  "倾斜镜头",
  "过肩镜头",
  "过肩",
];

const SUBJECT_DIRECTION_TERMS = [
  "正面",
  "背影",
  "侧面",
  "45度侧面",
  "45 度侧面",
  "正侧面对峙",
  "正侧面对坐",
  "过肩背影",
  "低头面向镜头",
  "低头面向道具",
];

const COMPOSITION_TERMS = [
  "前景",
  "中景",
  "后景",
  "背景",
  "画面左",
  "画面右",
  "左侧",
  "右侧",
  "中央",
  "边缘",
  "构图",
  "同一构图",
  "远处",
  "近处",
];

const VISUAL_ENDPOINT_TERMS = [
  "最终",
  "停在",
  "定在",
  "落在",
  "落幅",
  "视觉重点",
  "视觉重心",
  "收束",
  "画面落点",
  "镜头停住",
  "镜头结束",
];

const WARDROBE_DETAIL_TERMS = [
  "服",
  "衣",
  "战袍",
  "夹克",
  "布料",
  "皮革",
  "绑带",
  "护具",
  "盔甲",
  "肩甲",
  "胸甲",
  "甲壳",
  "装甲",
  "金属",
  "扣件",
  "发丝",
  "头发",
  "毛发",
  "皮肤",
  "毛孔",
  "汗",
  "尘土",
  "疤",
  "武器",
  "枪",
  "刀",
  "剑",
];

const SCENE_DETAIL_TERMS = [
  "前景",
  "中景",
  "后景",
  "远景",
  "地面",
  "水面",
  "废墟",
  "建筑",
  "墙",
  "管线",
  "桥架",
  "碎石",
  "尘雾",
  "沙尘",
  "体积雾",
  "烟尘",
  "天光",
  "逆光",
  "侧光",
  "光源",
  "反光",
  "空间",
];

const DYNAMIC_DETAIL_TERMS = [
  "高速",
  "摇镜",
  "运镜",
  "跟拍",
  "推进",
  "推近",
  "拉远",
  "横移",
  "环绕",
  "爆冲",
  "冲击",
  "弹雨",
  "火星",
  "碎屑",
  "震动",
  "抖动",
  "惯性",
  "受力",
  "余波",
  "拖影",
  "飞散",
  "掠过",
  "扰动",
];

const SCREEN_POSITION_TERMS = [
  "画面左",
  "画面右",
  "左前景",
  "右前景",
  "左中景",
  "右中景",
  "左后景",
  "右后景",
  "前景左",
  "前景右",
  "中景左",
  "中景右",
  "后景左",
  "后景右",
  "画面中央",
  "画面边缘",
  "前景",
  "中景",
  "后景",
];

const MOVEMENT_VECTOR_TERMS = [
  "从左到右",
  "从右到左",
  "由近及远",
  "由远及近",
  "向画面左",
  "向画面右",
  "向左",
  "向右",
  "向前景",
  "向后景",
  "压近",
  "逼近",
  "后撤",
  "横穿",
  "斜切",
  "冲向",
  "退向",
  "掠过",
  "穿过",
];

const CAMERA_BLOCKING_TERMS = [
  "摄影机站在",
  "摄影机贴在",
  "摄影机位于",
  "镜头贴在",
  "机位",
  "轴线",
  "侧面轴线",
  "过肩轴线",
  "反打",
  "同一轴线",
  "运动轴线",
  "距离",
  "相距",
];

const STYLE_DETAIL_TERMS = [
  "电影",
  "光影",
  "材质",
  "体积",
  "胶片",
  "色调",
  "胡金铨",
  "Blur",
  "UE5",
  "虚幻",
  "CG",
  "真实",
  "写实",
  "颗粒",
];

const MIN_FIRST_PASS_SHOT_CHARS = 150;
const MIN_FINAL_SHOT_CHARS = 260;

const CONTINUITY_CONNECTORS = [
  "下摇",
  "上摇",
  "平摇",
  "环绕",
  "推进",
  "推近",
  "拉远",
  "跟焦",
  "同一构图",
  "始终处于同一构图",
  "切成",
  "切到",
  "转为",
  "绕到",
  "整个过程不剪",
  "一镜到底",
  "过肩跟踪",
  "跟拍",
  "横移",
];

function hasAnyTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function compactCharLength(text: string): number {
  return text.replace(/\s/g, "").length;
}

function countAnyTerms(text: string, terms: string[]): number {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function extractShotBlocks(text: string): string[] {
  const matches = Array.from(text.matchAll(/镜头\s*\d+\s*[，:：]/g));
  if (matches.length === 0) return [];
  return matches.map((match, idx) => {
    const start = match.index ?? 0;
    const end =
      idx + 1 < matches.length ? matches[idx + 1].index ?? text.length : text.length;
    return text.slice(start, end).trim();
  });
}

function firstClause(shot: string): string {
  return shot.split(/[。；\n]/)[0]?.trim() || shot;
}

function shotName(shot: string, idx: number): string {
  return shot.match(/^镜头\s*\d+/)?.[0].replace(/\s+/g, "") || `镜头${idx + 1}`;
}

interface FirstPassValidationOptions {
  expectedImageIndices?: number[];
  expectedSceneIndices?: number[];
}

function extractImageRefIndices(text: string): number[] {
  const used: number[] = [];
  const re = /\(图\s*(\d+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (!used.includes(n)) used.push(n);
  }
  return used;
}

function selectReferencedRefImages(text: string, refImages: RefImage[]): RefImage[] {
  const indices = extractImageRefIndices(text);
  return indices
    .map((n) => refImages.find((img) => img.image_index === n))
    .filter((img): img is RefImage => Boolean(img));
}

function imageMarkerRe(index: number): RegExp {
  return new RegExp(`\\(图\\s*${index}\\)`);
}

function buildRefImageIndexMap(refImages: RefImage[]): string {
  return refImages
    .map((img, i) => {
      const role = roleZH(img.role);
      const name = img.name ? `（${img.name}）` : "";
      return `${i + 1}. 图${img.image_index}: ${role}${name}，文件：${img.file_path}`;
    })
    .join("\n");
}

function buildDraftOptimizeInput(
  draft: string,
  refImages: RefImage[],
  beatSheet?: string
): string {
  const hasRefs = refImages.length > 0;
  const hasSceneRef = refImages.some((img) => img.role === "scene");
  const sceneLine = hasSceneRef
    ? `\n【背景/场景特别要求】\n粗稿里已经选择了背景/场景图。第一次优化不需要写最终版那种超细材质，但必须在每个相关镜头中保留背景/场景(图N)，并用一句话说明它在前景/中景/后景/背景中的存在方式、空间纵深、光源方向或背景运动。人物近景也不能完全丢背景。`
    : "";

  const refBlock = hasRefs
    ? `【初稿中通过 @ 选择的参考图】
${buildRefImageIndexMap(refImages)}
${sceneLine}

`
    : "";

  const beatBlock = beatSheet?.trim()
    ? `【导演骨架（必须严格遵守）】
${beatSheet.trim()}

`
    : "";

  return `${refBlock}${beatBlock}【粗稿】
${draft}`;
}

// ─── Beat Sheet (Pass 0) parsing + validation ──────────────────────

const BEAT_PURPOSES = [
  "建立空间",
  "角色出手",
  "目标反应",
  "接触打击",
  "重建规模",
  "情绪特写",
  "道具操作",
];

const BEAT_CAMERA_MOTIONS = [
  "固定",
  "缓慢推进",
  "快速推进",
  "推近",
  "拉远",
  "横移",
  "跟拍",
  "过肩跟拍",
  "高速摇镜",
  "环绕",
  "上摇",
  "下摇",
  "一镜到底",
  "撞击式推进",
  "爆发式拉远",
  "手持",
];

interface BeatSheetShot {
  /** 1-indexed shot number, parsed from "镜头N" header line. */
  index: number;
  /** Original full text block (header + fields). */
  raw: string;
  fields: {
    目的?: string;
    机位?: string;
    A?: string;
    B?: string;
    距离?: string;
    向量?: string;
    镜头运动?: string;
    落幅?: string;
    图?: string;
  };
}

export function parseBeatSheet(text: string): BeatSheetShot[] {
  const lines = text.split("\n");
  const shots: BeatSheetShot[] = [];
  let current: BeatSheetShot | null = null;

  const headerRe = /^镜头\s*(\d+)\s*$/;
  // Field line allows `字段：值` or `字段:值`, both Chinese and ASCII colons.
  const fieldRe = /^(目的|机位|A|B|距离|向量|镜头运动|落幅|图)\s*[:：]\s*(.*)$/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const h = line.match(headerRe);
    if (h) {
      if (current) shots.push(current);
      current = { index: Number(h[1]), raw: line, fields: {} };
      continue;
    }
    if (!current) continue;
    const f = line.match(fieldRe);
    if (f) {
      const key = f[1] as keyof BeatSheetShot["fields"];
      const value = f[2].trim();
      current.fields[key] = value;
      current.raw += "\n" + line;
    }
  }
  if (current) shots.push(current);
  return shots;
}

interface BeatSheetValidationOptions {
  expectedImageIndices?: number[];
}

interface BeatSheetValidationResult {
  issues: string[];
  /** 1-indexed shot numbers that have any issue — used for surgical repair. */
  badShotIndices: number[];
}

export function validateBeatSheet(
  text: string,
  options: BeatSheetValidationOptions = {}
): BeatSheetValidationResult {
  const issues: string[] = [];
  const bad = new Set<number>();
  const shots = parseBeatSheet(text);
  if (shots.length === 0) {
    return {
      issues: ["骨架没有检测到「镜头N」格式的镜头块。"],
      badShotIndices: [],
    };
  }

  // Check expected (图N) refs survived into at least one shot's 图 field.
  const allFigText = shots.map((s) => s.fields.图 ?? "").join(" ");
  for (const n of options.expectedImageIndices ?? []) {
    if (!new RegExp(`\\(图\\s*${n}\\)`).test(allFigText)) {
      issues.push(`骨架里所有镜头的「图」字段都没有保留 (图${n}) 引用。`);
    }
  }

  let fixedCount = 0;
  for (const shot of shots) {
    const tag = `镜头${shot.index}`;
    const f = shot.fields;
    const flag = (msg: string) => {
      issues.push(`${tag} ${msg}`);
      bad.add(shot.index);
    };

    // Field completeness.
    if (!f.目的) flag("缺「目的」字段。");
    else if (!BEAT_PURPOSES.includes(f.目的.trim())) {
      flag(`「目的」字段必须是七选一之一（${BEAT_PURPOSES.join("/")}），现在是「${f.目的}」。`);
    }
    if (!f.机位) flag("缺「机位」字段。");
    else if (f.机位.length < 6) {
      flag(`「机位」字段太抽象（「${f.机位}」）。必须能让真人摄影师按文字摆出三脚架位置。`);
    }
    if (!f.A) flag("缺「A」字段。");
    if (!f.B) flag("缺「B」字段（如果只有一个主体写「B：无」）。");
    if (!f.距离) flag("缺「距离」字段。");
    if (!f.向量) flag("缺「向量」字段。");
    if (!f.镜头运动) flag("缺「镜头运动」字段。");
    else {
      const motion = f.镜头运动.trim();
      const ok = BEAT_CAMERA_MOTIONS.some((term) => motion.includes(term));
      if (!ok) {
        flag(`「镜头运动」字段必须包含清单词（${BEAT_CAMERA_MOTIONS.join("/")}），现在是「${motion}」。`);
      }
      if (motion.includes("固定")) {
        fixedCount += 1;
        if (shot.index > 1 || fixedCount > 1) {
          flag(`「镜头运动」是固定。固定镜头只允许第 1 镜头用一次，必须改成推进/拉远/跟拍/摇镜/环绕/一镜到底之一。`);
        }
      }
    }
    if (!f.落幅) flag("缺「落幅」字段。");
    if (!f.图) flag("缺「图」字段（如果没有参考图写「图：无」）。");

    // Two-front check: both A and B contain 正面 → almost always wrong.
    if (f.A && f.B && /正面/.test(f.A) && /正面/.test(f.B) && !/无/.test(f.B)) {
      const vector = f.向量 ?? "";
      const allowed = /并肩同向|一起朝镜头|同时转头|同向冲|并排冲/.test(vector);
      if (!allowed) {
        flag("A 和 B 同时写「正面」面对镜头，但「向量」没有写并肩同向/一起冲镜头/同时转头看镜头。对立双方必须按轴线互补：一个正面，另一个背影/侧面/45度侧面/过肩。");
      }
    }

    // Ranged-attack-without-cut: 向量 contains both ranged-attack verb and
    // impact verb without 反打/前景/后景 cue.
    const vec = f.向量 ?? "";
    const purposeRanged = f.目的 === "角色出手" || f.目的 === "目标反应";
    if (hasRangedAttack(vec) && hasImpactReception(vec) && !purposeRanged) {
      const depth = /反打|前景|后景|远处|近处|从画面[左右]/.test(vec);
      if (!depth) {
        flag("「向量」字段同时写出手（开枪/射击/发射）和承受（中弹/受弹），但没有标明前景/后景/反打透视。默认必须拆成「角色出手」和「目标反应」两个独立镜头。");
      }
    }

    // Purpose overlap check: 目的=接触打击 but 向量 only describes 推进/移动
    // (without 击中/相撞/碰撞/接触/砸/砍/劈/穿透/命中) — almost always wrong.
    if (f.目的 === "接触打击" && f.向量) {
      const hasImpactWord = /击中|相撞|碰撞|接触|砸|砍|劈|穿透|命中|挥棍|挥刀|挥剑|爆开|凹陷|崩裂/.test(f.向量);
      if (!hasImpactWord) {
        flag("「目的」是接触打击，但「向量」没有写明击中/相撞/砸/砍/劈/命中等接触动作。要么改目的，要么补充打击动作向量。");
      }
    }
  }

  return { issues: issues.slice(0, 18), badShotIndices: Array.from(bad).sort((a, b) => a - b) };
}

// ─── Beat Sheet generation + repair ────────────────────────────────

function buildBeatSheetInput(draft: string, refImages: RefImage[]): string {
  if (refImages.length === 0) return `【粗稿】\n${draft}`;
  const hasSceneRef = refImages.some((img) => img.role === "scene");
  const sceneLine = hasSceneRef
    ? `\n【背景/场景特别要求】\n粗稿绑定了背景/场景图。每个相关镜头骨架的「图」字段必须保留 (图N) 引用。骨架阶段不展开图片视觉细节，只保留 (图N) 标记。`
    : "";
  return `【粗稿中通过 @ 选择的参考图】
${buildRefImageIndexMap(refImages)}
${sceneLine}

【粗稿】
${draft}`;
}

async function generateBeatSheet(
  draft: string,
  refImages: RefImage[]
): Promise<string> {
  return callPromptModel(
    PASS_0_BEAT_SHEET_SYSTEM,
    buildBeatSheetInput(draft, refImages),
    refImages.map((img) => img.file_path)
  );
}

// ─── Combined-mode split helper ────────────────────────────────────

export interface CombinedSplit {
  /** Text between BEAT_SHEET tag and FIRST_PASS tag — empty if not found. */
  beatSheet: string;
  /** Text after FIRST_PASS tag — falls back to the full input if not found. */
  firstPass: string;
}

/**
 * Split the combined Pass-C output into beat sheet + first pass sections.
 *
 * The model is instructed to emit exactly two sections delimited by the
 * literal tokens <<<BEAT_SHEET>>> and <<<FIRST_PASS>>>. To stay robust against
 * the model wrapping the tokens in punctuation or whitespace, we match a
 * regex rather than an exact literal.
 *
 * Failure modes:
 * - No FIRST_PASS tag → return full output as firstPass, beatSheet empty.
 * - BEAT_SHEET tag missing but FIRST_PASS present → take the prefix before
 *   FIRST_PASS as beat sheet.
 * - Tags swapped or repeated → take last FIRST_PASS occurrence.
 */
export function splitCombinedOutput(raw: string): CombinedSplit {
  if (!raw) return { beatSheet: "", firstPass: "" };

  const beatRe = /<<<\s*BEAT[_\s-]?SHEET\s*>>>/i;
  const firstRe = /<<<\s*FIRST[_\s-]?PASS\s*>>>/i;

  const firstMatch = raw.match(firstRe);
  if (!firstMatch || firstMatch.index === undefined) {
    // No FIRST_PASS tag — model ignored the two-stage format. Return whole
    // output as the first pass so downstream still has something to use.
    return { beatSheet: "", firstPass: raw.trim() };
  }

  const firstStart = firstMatch.index;
  const firstEnd = firstStart + firstMatch[0].length;
  const afterFirst = raw.slice(firstEnd).trim();

  const beforeFirst = raw.slice(0, firstStart);
  const beatMatch = beforeFirst.match(beatRe);
  const beatStart =
    beatMatch && beatMatch.index !== undefined
      ? beatMatch.index + beatMatch[0].length
      : 0;
  const beatSheet = beforeFirst.slice(beatStart).trim();

  return { beatSheet, firstPass: afterFirst };
}

/**
 * Subprocess-mode fast path: one LLM call returns both stages, code splits.
 * Skips all retry/repair passes — we tolerate occasional sub-optimal output
 * in exchange for ~2-4× speedup. Validation still runs, but only logs.
 */
async function optimizeViaCombinedCall(
  draft: string,
  usedRefImages: RefImage[],
  expectedImageIndices: number[],
  expectedSceneIndices: number[]
): Promise<string> {
  const raw = await callPromptModel(
    PASS_COMBINED_SYSTEM,
    buildBeatSheetInput(draft, usedRefImages),
    usedRefImages.map((img) => img.file_path)
  );
  const { beatSheet, firstPass } = splitCombinedOutput(raw);

  if (beatSheet) {
    const beatVal = validateBeatSheet(beatSheet, { expectedImageIndices });
    if (beatVal.issues.length > 0) {
      console.warn("[vellum] combined: beat sheet issues (no retry)", {
        issues: beatVal.issues,
        bad: beatVal.badShotIndices,
      });
    }
    console.info("[vellum] combined beat sheet:\n" + beatSheet);
  } else {
    console.warn(
      "[vellum] combined: no BEAT_SHEET section detected — model returned single-stage output"
    );
  }

  if (!firstPass) {
    console.warn("[vellum] combined: no FIRST_PASS section detected; returning raw output");
    return raw;
  }

  const issues = validateFirstPassOutput(firstPass, {
    expectedImageIndices,
    expectedSceneIndices,
  });
  if (issues.length > 0) {
    console.warn("[vellum] combined: first pass validation issues (no retry)", issues);
  }
  return firstPass;
}

async function repairBeatSheetShots(
  draft: string,
  refImages: RefImage[],
  previousBeatSheet: string,
  validation: BeatSheetValidationResult
): Promise<string> {
  if (validation.badShotIndices.length === 0) return previousBeatSheet;

  // Issues table grouped so the model can see which shots need surgery.
  const issuesText = validation.issues.map((i) => `- ${i}`).join("\n");
  const targetShots = validation.badShotIndices.map((n) => `镜头${n}`).join("、");

  const repairPrompt = `【原始粗稿】
${draft}

【上一次导演骨架（部分镜头不合格）】
${previousBeatSheet}

【机械校对发现的问题】
${issuesText}

【需要重写的镜头】
${targetShots}

请只重新输出**这些镜头**的骨架（保持原编号，仍是「镜头N + 九个字段」格式），其余镜头不要重写、不要输出。修复要点：
1. 字段完整：目的（七选一）/ 机位（可摆三脚架）/ A（名字+位置+身体取景+朝向）/ B（同上或写「无」）/ 距离 / 向量 / 镜头运动（清单内）/ 落幅 / 图（保留 (图N) 或写「无」）。
2. 轴线互补：双人对峙不能两个都「正面」，除非并肩同向冲镜头。
3. 拆镜：远距离开枪/射箭/能量发射的「出手」和「承受」必须分两个镜头。如果上一次塞进一个镜头，请按需在原编号上调整为「角色出手」目的，并提示我后续应再插入一个「目标反应」镜头（但本次仍只重写问题镜头编号）。
4. 不要输出风格、服化道、画面细节；骨架只解决导演问题。

输出格式：直接输出修订后的镜头骨架块，不要前言、不要解释。`;

  return callPromptModel(
    PASS_0_BEAT_SHEET_SYSTEM,
    repairPrompt,
    refImages.map((img) => img.file_path)
  );
}

/**
 * Splice a partial-rewrite beat sheet back into the original full beat sheet,
 * keeping unchanged shots intact. The model is asked to output only problem
 * shots; this merges them back by 镜头N index.
 */
export function mergeBeatSheetShots(
  original: string,
  partial: string
): string {
  const origShots = parseBeatSheet(original);
  const partialShots = parseBeatSheet(partial);
  if (partialShots.length === 0) return original;

  const byIndex = new Map<number, string>();
  for (const s of origShots) byIndex.set(s.index, s.raw);
  for (const s of partialShots) byIndex.set(s.index, s.raw);

  const indices = Array.from(byIndex.keys()).sort((a, b) => a - b);
  return indices.map((i) => byIndex.get(i)!).join("\n\n");
}

function validateFirstPassOutput(
  text: string,
  options: FirstPassValidationOptions = {}
): string[] {
  const issues: string[] = [];
  const shots = extractShotBlocks(text);
  if (shots.length === 0) {
    return ["没有检测到“镜头1，”这种镜头段落格式。"];
  }

  for (const index of options.expectedImageIndices ?? []) {
    if (!imageMarkerRe(index).test(text)) {
      issues.push(`输出丢失了粗稿里绑定的 (图${index}) 参考图标记。`);
    }
  }

  const sceneIndices = options.expectedSceneIndices ?? [];
  const sceneMarkerRes = sceneIndices.map(imageMarkerRe);

  for (const [idx, shot] of shots.entries()) {
    const name = shotName(shot, idx);
    const lead = firstClause(shot);

    if (compactCharLength(shot) < MIN_FIRST_PASS_SHOT_CHARS) {
      issues.push(
        `${name}太短，像流水账。第一版也必须至少写清镜头目的、轴线、前中后景、场景局部、动作方向和视觉落点。`
      );
    }

    // Lead clause: the 4 most-essential framing params (景别/运镜/角度/方向)
    // must appear in the first sentence — that's the convention 即梦/Seedance
    // expects. 身体取景 is the new 5th param but models tend to slot it in
    // sentence 2, so scan the whole shot block for it.
    if (!hasAnyTerm(lead, SHOT_SIZE_TERMS)) {
      issues.push(`${name}第一句缺少景别。`);
    }
    if (!hasAnyTerm(shot, BODY_CROP_TERMS)) {
      issues.push(`${name}缺少身体取景/画幅裁切（"腰部以上/全身入镜/肩部以上/手部特写"等）。`);
    }
    if (!hasAnyTerm(lead, CAMERA_MOVE_TERMS)) {
      issues.push(`${name}第一句缺少运镜。`);
    }
    if (!hasAnyTerm(lead, CAMERA_ANGLE_TERMS)) {
      issues.push(`${name}第一句缺少镜头角度。`);
    }
    if (!hasAnyTerm(lead, SUBJECT_DIRECTION_TERMS)) {
      issues.push(`${name}第一句缺少主体面对镜头的方向。`);
    }
    if (!hasAnyTerm(shot, COMPOSITION_TERMS)) {
      issues.push(`${name}缺少前景/中景/后景/背景等构图信息。`);
    }
    if (!hasAnyTerm(shot, VISUAL_ENDPOINT_TERMS)) {
      issues.push(`${name}缺少最终视觉落点。`);
    }
    if (countAnyTerms(shot, SCREEN_POSITION_TERMS) < 3) {
      issues.push(
        `${name}站位太抽象：必须写清画面左/右、前景/中景/后景里人物和空间分别在哪里。`
      );
    }
    if (!hasAnyTerm(shot, MOVEMENT_VECTOR_TERMS)) {
      issues.push(`${name}缺少可演示的运动方向（从哪到哪、向画面左/右/前景/后景等）。`);
    }
    if (!hasAnyTerm(shot, CAMERA_BLOCKING_TERMS)) {
      issues.push(`${name}缺少摄影机站位/轴线/距离关系，无法按片场走位复现。`);
    }
    if (
      sceneMarkerRes.length > 0 &&
      !sceneMarkerRes.some((re) => re.test(shot))
    ) {
      issues.push(`${name}没有保留背景/场景参考图标记，需写背景(图N)在画面中的存在方式。`);
    }

    const hasFaceOrHead = /脸|面部|眼|头部|肩部以上/.test(shot);
    const hasHandOrProp = /手部|手腕|道具|武器|按钮|枪|剑|刀|金箍棒/.test(shot);
    if (
      hasFaceOrHead &&
      hasHandOrProp &&
      !hasAnyTerm(shot, CONTINUITY_CONNECTORS)
    ) {
      issues.push(`${name}同时写脸/头和手/道具/武器，但缺少下摇、跟焦、同框构图等连接方式。`);
    }

    // 2A — Axis logic check: if two distinct named subjects both appear with
    // "正面", flag as suspect ("两人都正面看镜头" — almost always wrong).
    // We can't tell whether they're parallel-charging the camera (legitimate),
    // so we only flag, leaving the model to confirm during repair.
    const frontTwoSubjects = countSubjectsWithDirection(shot, "正面");
    if (frontTwoSubjects >= 2) {
      issues.push(
        `${name}里有 ${frontTwoSubjects} 个主体同时标"正面"。两人对峙/攻击场景必须按轴线互补（一个正面 / 另一个背影/侧面/45度侧面/过肩）。如果是并肩同向冲镜头才允许都正面。`
      );
    }

    // 2B — Ranged-attack split: same shot contains a "fire/shoot" verb AND a
    // "受弹/承受" verb without explicit 前景/后景/反打 transparency cue.
    if (hasRangedAttack(shot) && hasImpactReception(shot)) {
      const hasDepthCue =
        /反打|前景|后景|远处|近处|从画面[左右][侧上下]|从镜头外/.test(shot);
      if (!hasDepthCue) {
        issues.push(
          `${name}同一镜头同时写"开枪/射击/发射"与"承受弹雨/中弹"，但没有写清前景/后景/反打透视。默认应当拆成"出手镜头"+"反打承受镜头"两段，或在本镜头里明确双方透视关系。`
        );
      }
    }
  }

  // Fixed-camera over-use: the FIRST shot is allowed to be fixed (used to
  // establish space / pre-action hold). Beyond shot 1 it's a smell.
  const fixedShots: number[] = [];
  shots.forEach((shot, i) => {
    if (/镜头\s*\d+[^。；\n]*固定/.test(firstClause(shot))) fixedShots.push(i);
  });
  const offendingFixed = fixedShots.filter((i) => i > 0);
  if (offendingFixed.length > 0) {
    issues.push(
      `固定镜头过多（除第 1 镜头外还有 ${offendingFixed.length} 个固定镜头）。除建立空间/蓄力外，应改成推进、拉远、跟拍、摇拍、环绕或一镜到底。`
    );
  }

  return issues.slice(0, 14);
}

// Helpers for 2A/2B axis + ranged-attack checks.
function countSubjectsWithDirection(shot: string, direction: string): number {
  // Count distinct token strings of the shape `<2-4 CJK char name><direction>`
  // appearing in this shot. We don't need to enumerate every name — we just
  // count distinct prefixes that immediately precede the `direction` token.
  const re = new RegExp(`([\\u4e00-\\u9fff]{1,4})${direction}`, "g");
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(shot)) !== null) {
    const name = m[1];
    // Filter out grammatical/noise prefixes that aren't real subject names.
    if (/^(从|向|朝|对|面|正|侧|背|的|和|与|及|是|在|让|被|有|无|过)$/.test(name)) continue;
    seen.add(name);
  }
  return seen.size;
}

function hasRangedAttack(shot: string): boolean {
  return /开枪|射击|射出|发射|开火|拔枪|连射|连发|抛出|投掷|放箭|射箭|射穿/.test(shot);
}

function hasImpactReception(shot: string): boolean {
  return /承受弹雨|中弹|挨[一]?[枪击炮]|弹雨[拍打击中]|被击中|被打中|被命中|被穿透/.test(shot);
}

interface FinalPassValidationOptions {
  refImages: RefImage[];
  liveActionMode: boolean;
}

function firstShotStart(text: string): number {
  return text.search(/镜头\s*1\s*[，:：]/);
}

function validateFinalPassOutput(
  text: string,
  options: FinalPassValidationOptions
): string[] {
  const issues: string[] = [];
  const shots = extractShotBlocks(text);
  if (shots.length === 0) {
    return ["最终稿没有检测到“镜头1，”这种镜头段落格式。"];
  }

  const shotStart = firstShotStart(text);
  const beforeShots = shotStart >= 0 ? text.slice(0, shotStart) : "";
  const shotBody = shotStart >= 0 ? text.slice(shotStart) : text;

  if (options.refImages.length > 0 && !/参考图绑定\s*[：:]/.test(beforeShots)) {
    issues.push("最终稿缺少开头的“参考图绑定：”集中声明。");
  }
  if (/\(图\s*\d+\)/.test(shotBody)) {
    issues.push(
      "最终稿镜头正文里仍然出现了 (图N)。最终稿必须只在“参考图绑定”段集中声明，镜头里改用角色/场景/道具名字。"
    );
  }

  for (const [idx, shot] of shots.entries()) {
    const name = shotName(shot, idx);
    const lead = firstClause(shot);

    if (compactCharLength(shot) < MIN_FINAL_SHOT_CHARS) {
      issues.push(
        `${name}太短，仍是摘要式分镜。最终稿每镜头必须厚写服化道、场景重渲染、动作阶段、受力反馈、光影材质和风格。`
      );
    }
    if (!hasAnyTerm(lead, SHOT_SIZE_TERMS)) {
      issues.push(`${name}第一句缺少景别。`);
    }
    if (!hasAnyTerm(shot, BODY_CROP_TERMS)) {
      issues.push(`${name}缺少身体取景/画幅裁切。`);
    }
    if (!hasAnyTerm(lead, CAMERA_MOVE_TERMS)) {
      issues.push(`${name}第一句缺少运镜。`);
    }
    if (!hasAnyTerm(lead, CAMERA_ANGLE_TERMS)) {
      issues.push(`${name}第一句缺少镜头角度。`);
    }
    if (!hasAnyTerm(lead, SUBJECT_DIRECTION_TERMS)) {
      issues.push(`${name}第一句缺少主体面对镜头方向。`);
    }
    if (countAnyTerms(shot, SCREEN_POSITION_TERMS) < 4) {
      issues.push(
        `${name}站位构图仍然抽象：必须写清画面左/右、前景/中景/后景里 A/B 分别在哪里。`
      );
    }
    if (!hasAnyTerm(shot, MOVEMENT_VECTOR_TERMS)) {
      issues.push(`${name}缺少动作向量：谁从哪里到哪里、向画面哪一侧运动不明确。`);
    }
    if (!hasAnyTerm(shot, CAMERA_BLOCKING_TERMS)) {
      issues.push(`${name}缺少摄影机站位/轴线/距离关系，无法按片场调度复现。`);
    }
    if (!hasAnyTerm(shot, WARDROBE_DETAIL_TERMS)) {
      issues.push(`${name}缺少服化道/人物材质细节。`);
    }
    if (!hasAnyTerm(shot, SCENE_DETAIL_TERMS)) {
      issues.push(`${name}缺少场景重渲染细节。`);
    }
    if (!hasAnyTerm(shot, DYNAMIC_DETAIL_TERMS)) {
      issues.push(`${name}缺少动感运镜、受力反馈或环境扰动。`);
    }
    if (options.liveActionMode) {
      if (!/(真人|真实演员|真人演员|现场摄影|实拍摄影机|真人电影实拍)/.test(shot)) {
        issues.push(`${name}真人片模式下没有明确真人电影实拍/真实演员/现场摄影。`);
      }
    } else if (!hasAnyTerm(shot, STYLE_DETAIL_TERMS)) {
      issues.push(`${name}缺少镜头内风格/光影/材质提示词。`);
    }

    const frontTwoSubjects = countSubjectsWithDirection(shot, "正面");
    if (frontTwoSubjects >= 2) {
      issues.push(
        `${name}里有 ${frontTwoSubjects} 个主体同时标“正面”。对立双方必须按轴线互补，除非明确并肩同向冲镜头。`
      );
    }

    if (hasRangedAttack(shot) && hasImpactReception(shot)) {
      const hasDepthCue =
        /反打|前景|后景|远处|近处|从画面[左右][侧上下]|从镜头外/.test(shot);
      if (!hasDepthCue) {
        issues.push(
          `${name}同一镜头同时写出手和承受弹雨，但没有明确反打或前后景透视；默认应拆成出手镜头 + 反打承受镜头。`
        );
      }
    }
  }

  const fixedShots = shots.filter((shot) => /固定/.test(firstClause(shot)));
  if (fixedShots.length > 1) {
    issues.push("最终稿固定镜头超过一个。动作段落必须优先推、拉、跟、摇、环绕或一镜到底。");
  }

  return issues.slice(0, 18);
}

async function callFinalPromptModel(
  systemPrompt: string,
  userText: string,
  usedRefImages: RefImage[]
): Promise<string> {
  const imagePaths = usedRefImages.map((i) => i.file_path);
  const mode = await getAuthMode();
  if (mode === "cli") {
    return callViaCLI(systemPrompt, userText, imagePaths);
  }
  if (mode === "openai") {
    return callViaOpenAI(systemPrompt, userText, imagePaths);
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
  imagePaths: string[] = []
): Promise<string> {
  const mode = await getAuthMode();
  if (mode === "cli") {
    return callViaCLI(systemPrompt, userText, imagePaths);
  }
  if (mode === "openai") {
    return callViaOpenAI(systemPrompt, userText, imagePaths);
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
        .slice(0, 3)
        .join(", ")}${failedImages.length > 3 ? ", …" : ""}`
    );
  }

  return imageBlocks;
}

/**
 * Pull 1-indexed shot numbers out of validateFirstPassOutput's issue strings.
 * Issues that start with "镜头N" are shot-local; ones without a 镜头N prefix
 * (e.g. "固定镜头过多", "输出丢失了…") are global and trigger full rewrite.
 */
export function extractBadShotIndices(issues: string[]): {
  shotLocal: number[];
  hasGlobalIssue: boolean;
} {
  const set = new Set<number>();
  let hasGlobal = false;
  for (const i of issues) {
    const m = i.match(/^镜头\s*(\d+)/);
    if (m) set.add(Number(m[1]));
    else hasGlobal = true;
  }
  return {
    shotLocal: Array.from(set).sort((a, b) => a - b),
    hasGlobalIssue: hasGlobal,
  };
}

interface IndexedShotBlock {
  index: number;
  body: string;
}

function extractShotBlocksIndexed(text: string): IndexedShotBlock[] {
  const matches = Array.from(text.matchAll(/镜头\s*(\d+)\s*[，:：]/g));
  if (matches.length === 0) return [];
  return matches.map((match, idx) => {
    const start = match.index ?? 0;
    const end =
      idx + 1 < matches.length ? matches[idx + 1].index ?? text.length : text.length;
    return { index: Number(match[1]), body: text.slice(start, end).trim() };
  });
}

/**
 * Splice a partial rewrite back into the original First Pass prose. Preserves
 * any preamble (title, intro line) before 镜头1, and replaces only shots whose
 * 镜头N number is present in `partial`.
 */
export function mergeFirstPassShots(original: string, partial: string): string {
  const origIdx = extractShotBlocksIndexed(original);
  const partIdx = extractShotBlocksIndexed(partial);
  if (partIdx.length === 0) return original;
  if (origIdx.length === 0) return partial;

  const firstStart = original.search(/镜头\s*\d+\s*[，:：]/);
  const preamble = firstStart > 0 ? original.slice(0, firstStart).trimEnd() : "";

  const byIndex = new Map<number, string>();
  for (const s of origIdx) byIndex.set(s.index, s.body);
  for (const s of partIdx) byIndex.set(s.index, s.body);

  const indices = Array.from(byIndex.keys()).sort((a, b) => a - b);
  const shotsText = indices.map((i) => byIndex.get(i)!).join("\n\n");
  return preamble ? `${preamble}\n\n${shotsText}` : shotsText;
}

async function repairFirstPassOutput(
  draft: string,
  previousOutput: string,
  issues: string[],
  refImages: RefImage[],
  options: {
    /** If non-empty AND there's no global issue, only these shot numbers are
     *  rewritten and merged back into previousOutput. Empty/global → full rewrite. */
    badShotIndices?: number[];
    /** Beat sheet from Pass 0 (导演骨架) — re-injected so repair shots stay aligned. */
    beatSheet?: string;
  } = {}
): Promise<string> {
  const imageContext =
    refImages.length > 0
      ? `【初稿中通过 @ 选择的参考图】
${buildRefImageIndexMap(refImages)}

`
      : "";

  const beatBlock = options.beatSheet?.trim()
    ? `【导演骨架（最高优先级，扩写必须遵守）】
${options.beatSheet.trim()}

`
    : "";

  const surgical =
    options.badShotIndices && options.badShotIndices.length > 0;
  const targetText = surgical
    ? options.badShotIndices!.map((n) => `镜头${n}`).join("、")
    : "";

  const repairPrompt = surgical
    ? `【原始粗稿】
${draft}

【上一次输出（部分镜头不合格）】
${previousOutput}

【机械校对发现的问题】
${issues.map((issue) => `- ${issue}`).join("\n")}

【需要重写的镜头】
${targetText}

请只重写**这些镜头编号**对应的段落，保留原编号，使用「镜头N，」格式。**不要**输出其他镜头、标题、前言。修复要点：
1. 第一句必须同时包含：景别 + 身体取景 + 运镜 + 镜头角度 + 主体面对镜头方向。
2. 必须是一段连续画面；脸/手/道具/正/背/远近切换必须有运镜连接（下摇/上摇/平摇/环绕/推进/拉远/跟焦/同框）。
3. 必须可被真人站位复现：摄影机站位、画面左/右、前/中/后景、两人距离、动作向量、最终落幅身体部位都要写清。
4. 必须有前/中/后景构图与视觉落点。
5. (图N) 标记必须保留；场景图不能当静态背景，必须按本镜头机位重新组织前中后景、光源、环境扰动。
6. 固定镜头要换成推进/拉远/跟拍/摇拍/环绕/一镜到底。
7. 保留原始粗稿的剧情、对白、动作；如有导演骨架，必须严格按骨架的目的/机位/A 与 B 位置/朝向/距离/向量/落幅扩写。
8. 不要解释、不要 markdown。`
    : `【原始粗稿】
${draft}

【上一次输出（不合格，需要返工）】
${previousOutput}

【机械校对发现的问题】
${issues.map((issue) => `- ${issue}`).join("\n")}

请重写完整合格版本。必须逐镜头修复上述问题：
1. 每个镜头第一句必须同时包含：景别 + 身体取景/画幅裁切 + 运镜 + 镜头角度 + 主体面对镜头方向。
2. 每个镜头必须是一段连续画面；如果脸/手/道具/正/背/远景/微观发生变化，必须写清运镜连接或拆镜。
3. 每个镜头必须先能被真人站位复现：写清摄影机站位/轴线、画面左/右、前景/中景/后景、两人距离、谁从哪里移动到哪里、镜头如何跟着移动、最终落幅停在哪个身体部位。
4. 每个镜头必须写清前景/中景/后景/背景构图，并写出最终视觉落点。
5. 如果原始粗稿包含 (图N)，必须保留这些图标记；如果是背景/场景图，每个相关镜头都要写出背景(图N)在画面中的存在方式。
6. 固定镜头最多保留一个，其余镜头改成推进、拉远、跟拍、摇拍、环绕或一镜到底。
7. 场景/背景图不能当静态贴图背景；每个镜头必须按本镜头机位重新组织场景局部、光源、前中后景和环境运动。
8. 保留原始粗稿的剧情、角色关系、对白和关键动作，不要解释。`;

  return callPromptModel(
    PASS_1_SYSTEM,
    `${imageContext}${beatBlock}${repairPrompt}`,
    refImages.map((img) => img.file_path)
  );
}

export async function optimizeDraftToFirstPass(
  draft: string,
  refImages: RefImage[] = []
): Promise<string> {
  const usedRefImages = selectReferencedRefImages(draft, refImages);
  const expectedImageIndices = usedRefImages.map((img) => img.image_index);
  const expectedSceneIndices = usedRefImages
    .filter((img) => img.role === "scene")
    .map((img) => img.image_index);

  // ─── Subprocess fast path ─────────────────────────────
  // Codex CLI / Claude CLI: 10-30s startup × 4 calls = 120-240s. Collapse to
  // one call that emits both stages with delimiters. No retry — we live with
  // occasional sub-optimal output to keep the user iterating fast.
  const mode = await getAuthMode();
  if (mode === "cli" || mode === "codex") {
    return optimizeViaCombinedCall(
      draft,
      usedRefImages,
      expectedImageIndices,
      expectedSceneIndices
    );
  }

  // ─── API fast path (separate stages + retry, since each call is 3-10s) ──

  // ─── Pass 0: 导演骨架 ──────────────────────────────────
  // First make the model commit to camera blocking before writing any prose.
  // The beat sheet is short structured text — easier to validate mechanically
  // and easier for the model to reason about than 7000+ chars of free-form rules.
  let beatSheet = await generateBeatSheet(draft, usedRefImages);
  const beatVal = validateBeatSheet(beatSheet, { expectedImageIndices });
  if (beatVal.badShotIndices.length > 0 || beatVal.issues.length > 0) {
    console.warn("[vellum] beat sheet validation failed", {
      issues: beatVal.issues,
      bad: beatVal.badShotIndices,
    });
    if (beatVal.badShotIndices.length > 0) {
      try {
        const partial = await repairBeatSheetShots(
          draft,
          usedRefImages,
          beatSheet,
          beatVal
        );
        beatSheet = mergeBeatSheetShots(beatSheet, partial);
      } catch (e) {
        console.warn("[vellum] beat sheet repair failed; continuing with original", e);
      }
    }
  }
  console.info("[vellum] beat sheet ready:\n" + beatSheet);

  // ─── Pass 1: 按骨架扩写 ────────────────────────────────
  const first = await callPromptModel(
    PASS_1_SYSTEM,
    buildDraftOptimizeInput(draft, usedRefImages, beatSheet),
    usedRefImages.map((img) => img.file_path)
  );
  const issues = validateFirstPassOutput(first, {
    expectedImageIndices,
    expectedSceneIndices,
  });
  if (issues.length === 0) return first;

  // ─── Pass 1b: 精准修复 ─────────────────────────────────
  // Surgical repair: only rewrite shots whose 镜头N is flagged. Global issues
  // (missing format, missing global image markers, fixed-camera overuse)
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
// Pass 1 / Pass 2 outputs can run 3000-5000 tokens; even Haiku 4.5
// needs 30-90s to stream that much, plus subprocess startup overhead.
// 60s was too aggressive — was timing out before the model finished.
const CLI_TIMEOUT_MS = 180_000; // 3 min
const FETCH_TIMEOUT_MS = 90_000; // 90s hard cap for Anthropic/OpenAI fetch

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

如果用户在界面里选择了风格预设，用户选择的风格主线优先于默认样板。样板只提供密度和镜头描述方式，不代表必须使用样板里的具体风格词。`;
  }

  return `【真人片模式硬规则 — 最高优先级】

当前项目选择的是真人电影实拍 / LIVE-ACTION MOVIE 风格。你必须把所有镜头写成真实演员、真实摄影机、真实服装道具、真实置景、现场拍摄、实拍动作电影的提示词。最高原则：宁可朴素真实，也不能滑向高品质 CG 动画或游戏渲染。

强制要求：
- 参考图即使是二次元、CG、游戏角色、概念图，也必须转译成真人演员可拍的角色造型、服装、妆发、特效化妆、假体、实体护具、真实道具和真实场景，不允许保留动画感。
- 每个镜头里的风格段必须明确写"真人电影实拍、真实演员、真实摄影机、现场摄影、实拍服化道、真实皮肤毛孔/汗渍/尘土/疤痕、真实布料皮革金属、电影硬光/侧逆光/胶片颗粒"这类实拍语言。
- 每个主要人物都要被描述成"真实演员/真人替身穿戴实体服装或实体盔甲"，怪物、虫甲、机械肢体也要写成"可穿戴实体特效服、假体妆效、实物盔甲、现场烟尘与实拍合成"。
- 禁止在输出中出现或暗示：UE5、虚幻引擎、Blur Studio、顶级 3D CG、三渲二、卡通、二次元、动漫、动画电影、游戏引擎渲染、概念图感、虚拟摄影机、塑料皮肤、廉价游戏感、过度科幻霓虹。
- 可以有 VFX 或奇观，但描述基准必须是"真人动作电影里的实拍合成效果"，不是 3D CG 渲染；禁止把画面写成 CG 动画短片。`;
}

function buildStyleDimensionGuide(liveAction: boolean): string {
  if (!liveAction) {
    return `- 渲染基调：UE5 / Blur Studio / 顶级 3D 电影 CG / 三渲二等
- 光影：真实太阳光、体积云散射、逆光、侧光、低亮度高对比、运动模糊边缘控制
- 材质模拟：真实毛发、布料、金属、甲壳、皮革、沙尘、粒子、水汽、碎屑
- 色彩：焦黄、暗金、乌青、墨绿、赭红、紫色雷电、胶片褪色感等
- 电影气质：胡金铨式东方神怪、灾难级高空氛围、手持压迫感、史诗空间感`;
  }

  return `- 拍摄基调：LIVE-ACTION MOVIE、真人电影实拍、真实演员、真人替身、实拍摄影机、现场摄影、现场置景、动作电影镜头质感，不是 CG 动画
- 光影：电影级硬光、侧逆光、强轮廓光、高对比明暗、真实焦外虚化、胶片颗粒、手持摄影呼吸
- 材质：真实皮肤毛孔、皱纹、汗渍、尘土、疤痕、特效化妆、假体、可穿戴实体盔甲、破损皮革、旧布料、金属扣件、绑带、磨损护具、锈蚀道具
- 色彩：低饱和沙土色、铁锈红、暗棕、灰黑、旧金属色，避免过度霓虹和干净新衣
- 电影气质：荒漠废土生存者美学、冷酷野性、危险、压迫、史诗真人动作片`;
}

function buildHighDensitySample(liveAction: boolean): string {
  if (liveAction) {
    return `【高密度真人片样板 — 必须对标这种实拍细腻程度】

镜头1，低角度胸口以上手持快速推进45度正面镜头，摄影机贴着风沙从废弃公路残骸之间逼近真实演员饰演的主角45度正面。画面前景是被轮胎碾碎的干裂柏油、锈蚀铁片和随风滚动的塑料布，中景主角胸口以上入镜，脸上不是干净的美颜皮肤，也不是 CG 角色皮肤，而是被烈日晒红的真人粗粝皮肤、毛孔、汗渍、灰尘和旧伤疤；他的短发被沙尘压得凌乱，颈侧有干裂血痕，身上穿褪色棕色旧布内衬、破损皮革护肩、磨花金属扣件和缠绕到手腕的脏绷带，腰间挂着沉重的旧金属工具和裂开的水壶。后景是一排被风蚀掏空的实拍混凝土废墟置景，侧逆光从建筑缺口打进来，让尘雾和热浪在空气里形成真实的层次。镜头推进时手持呼吸感明显，主角肩膀先微微下沉，随后抬眼盯向镜头右侧敌人方向，嘴角压紧，手指摸向磨损枪套；衣料、皮革绑带和金属扣件被风吹得轻微颤动，脚边细沙被他的重心移动推开。整体必须是真人动作电影实拍，真实演员、现场摄影、破损服化道、可触摸置景、荒漠废土生存者美学、电影硬光、侧逆光、高对比明暗、低饱和沙土色和铁锈红，胶片颗粒、尘雾、热浪和焦外虚化都保持真实，明确不是高品质 CG 动画。

镜头2，一镜到底过肩跟拍腰部以上背影转反打镜头，摄影机先贴在主角右后肩，主角后脑勺、脏乱短发、磨损皮革肩带和腰部枪套占据前景左侧，镜头跟着他向废墟深处快速横移。中景敌人不是卡通怪物，也不是 CG 生物，而是可由真人演员、特效妆、假体和实体盔甲完成的废土武士：胸口以上45度侧面入镜，脸部有粗糙假体疤痕和汗泥，肩甲是旧金属片、皮革绑带和手工焊接护具拼成，布料边缘有砂砾磨损、油污和撕裂线头。主角拔枪瞬间，镜头高速摇向枪口和手腕局部，火光短促照亮手背汗毛、枪身划痕和指节上的泥，随后立刻反打到敌人胸甲侧面承受冲击，弹壳从画面左下角飞出，火星、金属碎屑和尘土向前景喷散，但冲击反馈保持真实物理重量，没有廉价光效或游戏特效。后景破墙、铁丝网和远处沙尘在跟拍中形成横向拖影，地面碎石被脚步踢开，最终镜头停在敌人被冲击逼退半步、肩带猛烈震动、尘雾吞没两人之间距离的一瞬间。整体必须保持真人电影实拍质感：真实摄影机、真实演员、真实服装道具、可触摸场景、电影硬光、侧逆光、胶片颗粒和废土动作片的冷酷压迫感，明确排除 CG 动画和游戏渲染。`;
  }

  return `【高密度样板 — 必须对标这种细腻程度】

镜头1，仰拍胸口以上手持荷兰式倾斜正面镜头，镜头在剧烈晃动的高空风暴中逼近主角正面。整个天空被浓厚稠密的法力沙尘暴吞没，黄金沙流、乌黑风云与紫色雷电在空间中翻卷，脚下看不到地面，只有无边无际的黄沙深渊。主角正面浮空悬停于风暴中央，身穿暗金与乌黑交织的东方战袍，肩部披着被狂风吹得猎猎作响的金色长布，长棍或武器斜背于身后，毛发边缘在真实体积光下泛着暖金光泽。主角弓背探头，脸上带着危险而顽皮的微笑，双眼灵动发亮，手指缓缓抬到耳旁准备扯下毛发。镜头外不断有浮空杂兵侧面高速掠过，他们披着破旧羽毛道袍与符咒，像秃鹫妖兵般盘旋于风暴深处。整体采用 Blur Studio 级顶级 3D 电影 CG 风格，真实毛发、布料与风沙粒子模拟，融合胡金铨电影中焦黄、暗金、乌青色调与东方神怪气质，强调真实光影、手持压迫感与灾难级高空氛围。

镜头2，一镜到底环绕45度侧面特写镜头，镜头从主角45度侧面左脸特写开始，缓慢贴近后脑勺。狂风吹得毛发与金色披布不断抽打空气，细碎金沙高速擦过镜头；主角左手放在头侧耳旁，灵活手指轻轻一捻，从毛发中扯下几根细腻柔软的金色毛发，逆光下呈现半透明纤维质感。镜头不停机继续环绕到嘴部特写，构图中只有侧面嘴部与左手指尖捏着的毛发，气息吹出后没有廉价光效，而是让毛发边缘先产生柔软金色微光，随后纤维像流沙般缓慢崩散，化成细小金色粒子与半透明能量丝线，粒子拉伸、缠绕、聚合，仿佛拥有生命。镜头高速跟踪这些粒子大特写，粒子在空中形成数个模糊人形轮廓，随后骤然实体化，多个分身正面随机分布地浮空出现，高低前后并不规则，形成真实空间层次。远景则是大量浮空准备冲锋的杂兵侧面，更远处隐约可见由厚重沙暴构成的巨大敌影正面，在雷电与沙流中若隐若现。

这两个样板说明的是密度，不要照抄人物名；按用户项目里的角色、场景和图像绑定替换。`;
}

function buildPass2System(style: string): string {
  const styleBlock = style.trim() || DEFAULT_STYLE_LAYER;
  const liveActionMode = isLiveActionStyle(styleBlock);
  const stylePriorityBlock = buildStylePriorityBlock(liveActionMode);
  const styleDimensionGuide = buildStyleDimensionGuide(liveActionMode);
  const highDensitySample = buildHighDensitySample(liveActionMode);
  return `你是专业级视频分镜提示词最终强化专家。把第一版分镜（已含景别/身体取景/运镜/角度/方向）强化为可直接喂给即梦 Seedance 2.0 视频生成模型的高精度成片提示词。

${VELLUM_DIRECTOR_WORKFLOW}

【核心目标：成片级高密度提示词】

不要再输出短摘要式分镜。最终稿必须像导演给视频生成模型的成片提示词，每个镜头都要有足够密度，让模型能读到服化道、场景、动态效果、真实光影与风格。宁可镜头段落更长，也不要压缩成干瘪的 180 字描述。

${stylePriorityBlock}

输出长度目标：
- 参考图绑定段：每张图 60-110 字，必须讲清视觉身份、服装/材质/配色、空间或道具结构。
- 每个镜头：**至少 320 字，复杂动作镜头 420-650 字**。如果镜头需要毛发、布料、风沙、粒子转化、攻击反馈，就写满，不要省。
- 如果整段过长，优先保留每个镜头的细节密度；不要为了总长度把服化道、场景和动态效果删掉。

【每个镜头必须覆盖的 12 个维度】

  1. **镜头类型行**：景别 + 身体取景/画幅裁切 + 运镜 + 角度 + 方向（沿用 Pass 1 的）
  2. **人物身体取景**：每个主要人物第一次出现在本镜头时，必须写清哪个身体部位在画面里，例如全身入镜、腰部以上、胸口以上、肩部以上、头部特写、眼部特写、手腕特写、武器与手部局部、背部肩胛位置、后脑勺与肩背。只写"正面/背影/侧面"不合格。
  3. **片场站位必须可演示**：先在脑中把演员摆出来。必须写清摄影机站在谁的哪一侧、A 在画面左/右/前景/中景/后景哪一层、B 在哪一层、两人相距多远或隔着什么空间、谁从哪里移动到哪里、镜头如何跟随、最终落幅停在谁的哪个部位。只写"画面中央"或"后景逼近"不合格。
  4. **服化道必须细腻**：人物服装、毛发/发丝、皮肤/甲壳/装甲、布料、披风、符咒、饰物、武器、磨损、污渍、反光、材质纹理都要写。每个主要角色至少写 3-5 个可见服化道细节。
  5. **场景必须细腻且重新渲染**：天空/地面/建筑/废墟/山林/水面/云层/沙尘/体积雾/远景主体/空间深渊/光源方向都要写。不能只写"背景是战场"。场景参考图只是空间结构、材质、色彩和光源锚点，不是把原图直接贴到镜头后面；每个镜头必须根据当前机位、景别、焦段、运镜和人物动作重新组织场景局部，写清本镜头看见的是场景哪一块，前景/中景/后景如何变化，光、雾、水面、碎石、管线、建筑边缘如何响应动作。
  6. **动态效果必须有阶段**：至少写出蓄力/起动、爆发位移、接触/变形、反弹/惯性、余波扩散中的三段；风如何吹动毛发和布料，粒子如何生成、扩散、拉伸、聚合或爆开，能量如何从微光变成裂纹、气流或冲击波。要写速度方向、身体重心、衣物拖拽、镜头抖动和环境反应；不要写廉价光效，写真实物理过渡。
  7. **镜头轴线 + 朝向关系**：先说明摄影机站在侧面轴线、过肩轴线、主观压迫轴线、接触打击轴线还是远景空间轴线上，再写人物朝向。对立双方不能无理由同时正面看镜头；正面、背影、侧面、45度侧面必须按空间关系互补。
  8. **镜头自身运动 + 画面压迫感**：固定镜头是低优先级，除非是唯一的建立空间或蓄力镜头，否则不要用。优先使用高速运镜、高速摇镜、动感运镜、手持晃动、推近、拉远、横移、跟拍、环绕、贴近、突然拉远、穿过粒子、贴地滑行、一镜到底等，并且必须和动作绑定。动作镜头必须把"高速运镜 / 高速摇镜 / 动感运镜 / 充满动感和力量感"视为高权重词反复强化，但每次都要落到具体运动路径、速度方向、镜头抖动和受力反馈上。
  9. **主体动作 + 表情/姿态**：角色怎么弓背、探头、低头、抬手、侧脸、咬牙、轻笑、后撤、爆冲，要有身体状态和情绪。
  10. **反应主体的状态**：被动方/旁观者/杂兵/分身等要写方向、身体取景、受力、衣袍头发和装甲反应；受击者和攻击者的朝向不能机械相同。
  11. **风格提示词要细腻嵌入**：每个镜头都必须写完整风格层，${liveActionMode ? "不能只写\"真人电影级写实\"几个词，要落到真人电影实拍、真实演员、现场摄影、皮肤毛孔、服化道、道具、场景置景、硬光侧逆光、胶片颗粒和废土色彩，并明确排除 CG 动画、游戏渲染、三渲二和虚拟角色质感" : "不只是\"UE5 + Blur\"几个词。要包含渲染基调、真实光影、材质模拟、色彩倾向、电影气质"}。
  12. **气场尾韵**：镜头末尾必须有余波、沙尘、风声、碎屑、光痕、气流或空间震动，作为视觉落点的一部分。

${highDensitySample}

【绑定规则 — 一次集中声明 + 镜头里只用名字】

原稿出现"主角(图N) / 男主(图N) / 女主(图N) / 反派(图N) / 角色(图N) / 场景(图N) / 背景(图N) / 道具(图N) / 物品(图N) / 法器(图N)"等组合时：

**Step A — 必须输出一段独立的「参考图绑定」段**（**作为整篇第一段**，放在第一个镜头之前），把所有用到的 (图N) 一次性集中声明，格式如下：

\`\`\`
参考图绑定：图3=反派武士（赛博东方武士，长黑发，机械面罩与发光呼吸孔，紫黑破损长袍、厚重肩甲、腰间骷髅符牌、右臂粉紫符文、背后发光半环机械装置）；图5=浮空石块战场近景（破碎石板、机械石块、锁链、金色铭文、红色能量裂缝、云雾，碎块密集悬浮）；图6=巨像残骸高空全景（云层上方超大尺度巨像手掌头部光环碎裂悬浮，远处漂浮城市）。
\`\`\`

每张图给 **50-90 字视觉定义**：核心身份 + 服装/外形 + 材质/配色 + 空间结构。不能省略、不能合并、不能只给一句话。

${liveActionMode ? "真人片模式下，参考图绑定段也必须按真人电影实拍重写：图里的角色要被定义为真实演员/真人替身可穿戴的服装、妆发、特效化妆、假体、实体护具和真实道具；图里的场景要被定义为真实置景、外景、废墟、沙尘、实拍光源和可触摸材质。禁止在绑定段里写二次元、CG、游戏角色、三渲二、UE5、Blur Studio；不要把角色定义成高品质 CG 模型。" : ""}

**Step B — 镜头段落里只用名字，不再写 (图N)**

参考图绑定段写完后，所有 (图N) 标记**禁止在镜头段落里再次出现**。一律用名字（反派武士 / 少年 / 主角 / 祭坛 / 巨像残骸 / 浮空战场 等），让 Seedance 自动联想到绑定段里的定义。

**例外**：用户在角色后面加了"背面/侧面/正面/45度侧面"等方向词必须保留在名字后面。

【镜头轴线与朝向逻辑 — 必须强制执行】

不要把"方向"理解成让所有人同方向面对镜头。方向是摄影机与主体的空间关系，双人/多人动作戏必须先定轴线，再写每个人相对镜头的朝向。

每个镜头还必须先确定一个主目的：建立空间、角色出手、目标反应、接触打击、重建规模、情绪特写或道具操作。一个镜头不能同时承担两个彼此抢焦点的主目的；如果读者会问"这个镜头到底想表现什么"，就必须拆镜。

参考拆法：
- **镜头1 建立空间**：侧面全景/远景/荷兰式倾斜最适合对峙或群战。画面左侧阵营侧面全身入镜，画面右侧敌方侧面全身入镜，双方沿同一条水平或斜向运动轴线冲向彼此。这个镜头不能写成双方都正面看镜头。
- **镜头2 进入主角**：可以快速推进到主角肩部以上正面特写，这是主角的情绪/决心镜头；如果下一秒主角冲进战场，必须明确"切到/转为过肩跟拍腰部以上背影镜头"，让主角后脑勺、肩背和武器占据前景，战场位于后景。
- **镜头3 接触打击**：攻击者可以正面或45度侧面，受击者通常是背影背部肩胛、侧面肋部或45度侧面胸甲。写清打击落点和身体部位，不能让受击者也正面看镜头。
- **镜头4 重建规模**：打完局部后，用爆发式拉远/远景跟拍/高空俯拍重新交代主角在战场里的运动轨迹，人物可以变成小比例全身剪影，重点是轨迹、速度和空间。

双人对峙与攻击的朝向规则：
- 摄影机在两人侧面：A侧面/45度侧面，B侧面/45度侧面，二者朝向彼此。
- 摄影机在A身后：A过肩背影或后脑勺与肩背，B正面/45度正面。
- 摄影机贴近A正面：A正面胸口以上/肩部以上，B只能从画面边缘以侧面/45度侧面/背影局部压入，除非剧情明确B转头看镜头。
- 攻击接触瞬间：攻击者和受击者的朝向必须互补，受击部位必须明确，例如背部肩胛、侧肋、胸甲、手腕、武器与手部局部。
- 只有当两人并肩同向、一起朝镜头冲来、或剧情明确同时转头看镜头时，才允许两个对立人物同时正面面对镜头。否则这种写法必须重写。

每个镜头第一次写到主要角色时，仍然必须带本镜的方向修饰和身体取景，但不同角色的方向要按轴线互补，而不是机械一致。

【片场站位与构图演示规则 — 最高优先级】

不要写抽象构图。每个镜头写完后，必须能让两个真人演员按你的文字在片场站出来、走出来、被摄影机拍出来。你必须在镜头段落里回答这六件事：
- 摄影机站在哪里：站在 A 身后、两人侧面、B 的正前方、贴近地面、左侧低机位、右后方过肩、还是远处高位。
- 主体 A 在画面哪里：左前景、右前景、画面中央中景、左后景、右后景，身体取景到哪里，朝向哪里。
- 主体 B 在画面哪里：和 A 的前后景层级、左右关系、身体取景、朝向，以及是否被 A 遮挡。
- 两人的空间距离：贴身接触、一臂距离、三到五米空地、远处虚化、隔着水面/碎石/管线/护罩。
- 动作向量：谁从画面哪边向哪边运动，谁后退，谁压近，子弹/刀锋/能量从哪条路径斜切。
- 落幅：镜头最后停在谁的脸、手腕、枪口、肩胛、胸甲、背影、脚步、还是两人之间的空间。

错误写法："少年在画面中央开枪，昆虫武士在后景逼近。" 这无法摆位。
正确写法："摄影机站在少年右前方的低机位，少年腰部以上45度正面占画面左前景，枪口从左前景指向画面右中景；昆虫武士胸口以上45度侧面位于右中景，沿同一侧面轴线从三到五米外压近，二者之间的潮湿空地被弹道从左前景斜切到右中景；镜头高速摇跟枪口后停在少年右手手腕和连续喷焰的枪口上。"

【远距离攻击与反打拆镜规则 — 必须强制执行】

远距离开枪、射箭、能量发射、投掷武器这类动作，默认拆成两个镜头：出手镜头 + 反打承受镜头。不要在一个中景里同时写"少年拔枪开火"和"昆虫武士腰部以上承受弹雨"，除非你明确写出前景/后景透视关系。

正确拆法：
- **出手镜头**：只表现攻击者。少年正面微45度腰部以上快速推进或高速摇镜镜头，少年拔枪并向画面右侧连续开火，手腕、枪口、半张脸和上半身完整入镜，枪口火光照亮脸侧，目标只作为远处虚化轮廓或视线方向存在，不写受击细节。
- **反打承受镜头**：下一个镜头单独表现目标。白色昆虫武士正面/45度侧面胸口以上反打镜头，弹雨从画面左侧射入，连续撞上胸甲、肩甲或侧肋，火星、甲壳粉尘、弹头碎屑和冲击震动向前景散开，最终停在铠甲毫无破损的反光上。
- **同镜头例外**：如果必须同镜头，必须写成明确透视构图：前景右侧白色昆虫武士背影腰部到肩背大面积遮挡，后景远处少年全身小比例入镜开枪，子弹从后景飞向前景。没有这种前后景关系就必须拆镜。

错误写法要重写："少年腰部以上从画面左侧拔枪连射，白色昆虫武士腰部以上位于右侧承受弹雨。" 这句话没有说明两人距离、谁是前景、谁是后景、是否反打、是否同一焦平面，会让 Seedance 猜画面。

(图N) 在镜头段落里反复出现会让 Seedance 误以为是多个不同对象，绑定段集中一次定义 + 镜头用名字 = 模型最容易理解的格式。

【场景参考图重渲染规则 — 必须强制执行】

场景图不是静态背景贴片，不要让模型感觉"直接调用原图"。场景图只提供空间结构、建筑材质、色彩倾向、光源方向、天气/烟雾/水面等参考；每个镜头都必须按本镜头机位重新渲染场景。

每个镜头写场景时必须回答四件事：
- 本镜头看见的是场景的哪一块：低处积水、巨构墙脚、倒悬建筑底部、远处天光裂口、管线桥架、狭窄街谷、雾中深处等。
- 本镜头的前景/中景/后景如何重新组织：前景遮挡物、中景人物脚下或身体周围空间、后景深层建筑或光源。
- 本镜头的运镜如何改变场景：推进时墙体压迫变强，拉远时空间尺度展开，跟拍时管线和墙面向后掠过，摇镜时灯带和雾气形成方向性拖影，一镜到底时场景局部连续过渡。
- 本镜头的动作如何扰动场景：水面震纹、碎石滚动、尘雾被冲开、管线摆动、反光被枪火切亮、体积光被护罩折射、墙面火星投影。

禁止写法："场景在后景虚化"、"背景是巨构废墟"之后不再展开。每个镜头至少写 4-6 个和当前镜头相关的场景细节，并且这些细节要服务当前镜头，而不是复述参考图。

【运镜活性规则 — 尽量不用死镜头】

最终稿要让画面有呼吸和运动，固定镜头只允许在极少数建立空间、蓄力、压迫静止时使用，15秒段落最多一个固定镜头。其余镜头优先改成：缓慢推进、快速推进、撞击式推进、推近、拉远、爆发式拉远、横移、跟拍、过肩跟拍、高速摇镜、手持晃动、环绕、上摇、下摇、平摇、跟焦、一镜到底。

如果第一版里写了"固定镜头"，Finalize 时默认要判断是否能改成更有生命力的运镜。例如：
- 固定对峙 → 缓慢横移 / 缓慢推进 / 手持微晃推进，保留压迫静止但让空间有张力。
- 固定受击 → 高速摇镜反打 / 撞击式推进到受击点 / 跟焦到火星和甲壳反弹。
- 固定防御 → 环绕护罩 / 缓动晃推近裂纹 / 下摇到手腕再推回脸部。

【风格主线 — 每个镜头都要完整嵌入】

原始风格主线（用户原意，约 150-200 字）：
\`\`\`
${styleBlock}
\`\`\`

**你的任务**：不要把风格主线压成几个词。每个镜头都要把风格主线改写成 90-160 字的镜头内风格段，明确包含：
${styleDimensionGuide}

每个镜头里的风格段可以相似，但必须结合该镜头独有的场景和动作微调，不能只写${liveActionMode ? "\"整体真人电影级写实\"这种短句，要落到真实演员、皮肤、服化道、场景、摄影机、光影和胶片质感" : "\"整体虚幻5+Blur 顶级CG\"这种短句"}。

${liveActionMode ? "真人片模式下，镜头内风格段必须明确写成真人电影实拍动作片，而不是 CG 渲染。每个镜头至少出现一次\"真实演员\"或\"真人演员\"，并至少出现一次\"现场摄影\"或\"实拍摄影机\"。任何参考图里的夸张发光边缘、卡通皮肤、游戏装甲，都要被转译为可真实制作的服装、妆效、假体、磨损金属、皮革、布料和现场烟尘；同时明确排除 CG 动画、游戏渲染、三渲二和塑料皮肤。" : ""}

注意：**不要单独输出一段独立的全局风格段** — 风格主线已经分散嵌入到每个镜头里了。整篇就是「参考图绑定段 + 镜头段们」，没有第三段。

【关于原稿标题/时长】

原稿首行常有标题 + 时长标注（如「激斗15秒」、「追逐10秒」）。这是给**你**的节奏提示：
- 把数字理解为视频目标总时长
- 用它指导整体节奏与镜头数量分配（15秒 = 大约 5-8 个镜头，3 秒 = 1-2 个镜头，明白节奏密度）
- **不要把标题或"X秒"字样写进输出** — 即梦 CLI 在提交时通过 \`--duration\` 旗标传递时长，提示词正文里不需要冗余

【输出格式】
- 第一段：参考图绑定段（必须包含，50-90 字 × N 张图，分号分隔）
- 空行
- 镜头1 [景别][身体取景][运镜][角度][方向]镜头，[高密度服化道 + 场景 + 动态效果 + 风格段 + 视觉落点]。
- 空行
- 镜头2 [景别][身体取景][运镜][角度][方向]镜头，[高密度服化道 + 场景 + 动态效果 + 风格段 + 视觉落点]。
- ……

格式硬性要求：
- flowing prose 散文体，禁用 slot 标签和 markdown
- 镜头之间空一行
- 每个镜头必须保留并强化 Pass 1 的身体取景，不得把"肩部以上/腰部以上/全身入镜/手部特写/背部肩胛位置"删成泛泛的"近景/特写"
- 每个镜头必须写成可演示站位：摄影机位置、画面左/右、前景/中景/后景、两人距离、动作向量、落幅身体部位都要明确
- 每个镜头都必须显式写出服化道、场景、动态效果和风格提示词；缺其中任意一类都要重写
- 场景参考图必须按本镜头重新渲染，不能像静态背景贴片；每个镜头必须写本镜头看到的场景局部、前中后景、光源变化和动作扰动
- 固定镜头最多一个；除建立空间/蓄力外，优先推、拉、跟、摇、环绕、一镜到底
- 每个镜头不要少于 320 字；复杂镜头可以 420-650 字
- **不要单独输出全局风格段** — 已嵌入每个镜头
- **不要标题、不要"X秒"字样** — 时长由 dreamina --duration 旗标传
- 不要前言、不要解释、不要 markdown

【输出前静默校对】

你输出前逐镜头检查，下面任一项缺失就重写该镜头：
- 是否写了角色服化道/材质细节：服装、毛发、布料、装甲、饰物、武器至少三项
- 是否写了场景空间细节：前景/中景/后景/远景、光源方向、天气/沙尘/雾气/建筑/地面至少三项
- 是否按当前机位重新渲染场景：本镜头看到的场景局部、前中后景重组、运镜造成的空间变化、动作造成的环境扰动
- 是否写了动态效果阶段：风、粒子、能量、碎屑、冲击波、布料/毛发受力至少两项，并有发生过程
- 动作镜头是否明确高权重强化高速运镜、高速摇镜、动感运镜、动感和力量感，并绑定具体运动路径
- 是否避免死镜头：固定镜头是否不超过一个，动作/反打/防御镜头是否使用推拉跟摇、环绕或一镜到底
- 是否写了细腻风格提示词：${liveActionMode ? "真人实拍基调 + 真实皮肤/服化道/场景/道具 + 电影硬光/侧逆光 + 低饱和废土色彩 + 胶片颗粒；并且没有 UE5/Blur/3D CG/二次元/游戏感" : "渲染基调 + 光影 + 材质模拟 + 色彩 + 电影气质"}
- 是否保留并强化身体取景和主体方向
- 是否能被真人站位复现：摄影机站位、A/B 的画面左/右和前中后景层级、两人距离、运动方向、最终落幅是否明确
- 是否先定轴线再写朝向：对立双方是否避免无理由同时正面面对镜头，攻击者/受击者朝向是否互补
- 远距离开枪/射击/能量发射是否拆成出手镜头 + 反打承受镜头；如果同镜头，是否明确前景/后景和距离透视
- 是否保留参考图绑定后的角色/场景/道具名字，不重新写 (图N)

只输出参考图绑定段 + 镜头段落。`;
}

async function repairFinalPassOutput(
  systemPrompt: string,
  userText: string,
  previousOutput: string,
  issues: string[],
  usedRefImages: RefImage[]
): Promise<string> {
  const repairPrompt = `【第一次最终稿输出（不合格，需要按导演调度返工）】
${previousOutput}

【机械校对发现的问题】
${issues.map((issue) => `- ${issue}`).join("\n")}

【原始任务上下文】
${userText}

请只输出返工后的最终稿。重点不是变长，而是每个镜头必须能被真人站位复现：
1. 每个镜头先写清摄影机站在哪里、站在哪条轴线上、贴近谁或远离谁。
2. 写清 A/B 两个主体分别位于画面左/右、前景/中景/后景哪一层，身体取景到哪里，朝向哪里。
3. 写清两人之间的距离或隔着什么空间，谁遮挡谁，谁压近谁，谁后撤。
4. 写清动作向量：从画面哪边到哪边，子弹/刀锋/身体/冲击沿什么路径运动。
5. 写清落幅：镜头最后停在谁的哪个身体部位或哪段空间关系。
6. 镜头正文禁止出现 (图N)，只在开头参考图绑定段集中声明。
7. 保持高密度服化道、场景重渲染、动态受力、风格提示，不要解释。`;

  return callFinalPromptModel(systemPrompt, repairPrompt, usedRefImages);
}

export async function finalizeFirstPassToFinal(
  firstPassText: string,
  refImages: RefImage[],
  style?: string
): Promise<string> {
  const usedRefImages = selectReferencedRefImages(firstPassText, refImages);
  const PASS_2_SYSTEM = buildPass2System(style ?? "");
  const liveActionMode = isLiveActionStyle(style ?? "");
  const indexMap = usedRefImages
    .map((img) => {
      const role = roleZH(img.role);
      const name = img.name ? `（${img.name}）` : "";
      return `图${img.image_index}: ${role}${name}`;
    })
    .join("\n");

  const userText =
    usedRefImages.length > 0
      ? `【参考图编号映射】
${indexMap}

【第一版分镜描述（待强化）】
${firstPassText}

请按系统指令输出最终强化版。`
      : `【第一版分镜描述（待强化）】
${firstPassText}

（本项目未提供参考图，无需 (图N) 引用，按指令补全服化道/场景/动态/风格即可。）`;

  const first = await callFinalPromptModel(
    PASS_2_SYSTEM,
    userText,
    usedRefImages
  );
  const issues = validateFinalPassOutput(first, {
    refImages: usedRefImages,
    liveActionMode,
  });
  if (issues.length === 0) return first;

  console.warn("[vellum] final pass failed validation; repairing", issues);
  const repaired = await repairFinalPassOutput(
    PASS_2_SYSTEM,
    userText,
    first,
    issues,
    usedRefImages
  );
  const repairedIssues = validateFinalPassOutput(repaired, {
    refImages: usedRefImages,
    liveActionMode,
  });
  if (repairedIssues.length > 0) {
    console.warn("[vellum] repaired final pass still has issues", repairedIssues);
  }
  return repaired;
}

// ─── Submit format: extract used (图N) refs and produce 即梦 header ──

const ROLE_LABEL_ZH: Record<string, string> = {
  character: "人物",
  scene: "场景",
  prop: "道具",
};

export interface SubmitPayload {
  /** Upload-order mapping line: "本条任务参考图上传顺序：第1张=图3 角色；第2张=图5 场景；..." */
  uploadOrderHeader: string;
  /** Original final text. */
  body: string;
  /** Ref images in first-appearance order — pass these to dreamina --image
   *  in this exact sequence so (图N) refs in body align with upload positions. */
  orderedFiles: string[];
  orderedIndices: number[];
  /** Per-role breakdown (still useful for UI display of bindings). */
  imageBindings: {
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
}

function roleZH(role: string): string {
  if (role === "character") return "角色";
  if (role === "scene") return "场景";
  if (role === "prop") return "道具";
  return role;
}
