import { readFile } from "@tauri-apps/plugin-fs";
import { Command } from "@tauri-apps/plugin-shell";
// <<MISSING_LINE_3>>
// <<MISSING_LINE_4>>
// <<MISSING_LINE_5>>
// <<MISSING_LINE_6>>
// <<MISSING_LINE_7>>
// <<MISSING_LINE_8>>
// <<MISSING_LINE_9>>
// <<MISSING_LINE_10>>
// <<MISSING_LINE_11>>
// <<MISSING_LINE_12>>
// <<MISSING_LINE_13>>
// <<MISSING_LINE_14>>
// <<MISSING_LINE_15>>
// <<MISSING_LINE_16>>
// <<MISSING_LINE_17>>
// <<MISSING_LINE_18>>
// <<MISSING_LINE_19>>
// <<MISSING_LINE_20>>
// <<MISSING_LINE_21>>
// <<MISSING_LINE_22>>
// <<MISSING_LINE_23>>
// <<MISSING_LINE_24>>
// <<MISSING_LINE_25>>
// <<MISSING_LINE_26>>
// <<MISSING_LINE_27>>
// <<MISSING_LINE_28>>
  max_tokens: number;
// <<MISSING_LINE_30>>
// <<MISSING_LINE_31>>
// <<MISSING_LINE_32>>
// <<MISSING_LINE_33>>
// <<MISSING_LINE_34>>
// <<MISSING_LINE_35>>
// <<MISSING_LINE_36>>
// <<MISSING_LINE_37>>
// <<MISSING_LINE_38>>
// <<MISSING_LINE_39>>
// <<MISSING_LINE_40>>
  usage: { input_tokens: number; output_tokens: number };
// <<MISSING_LINE_42>>
// <<MISSING_LINE_43>>
// <<MISSING_LINE_44>>
// <<MISSING_LINE_45>>
// <<MISSING_LINE_46>>
// <<MISSING_LINE_47>>
// <<MISSING_LINE_48>>
// <<MISSING_LINE_49>>
// <<MISSING_LINE_50>>
// <<MISSING_LINE_51>>
// <<MISSING_LINE_52>>
// <<MISSING_LINE_53>>
// <<MISSING_LINE_54>>
// <<MISSING_LINE_55>>
// <<MISSING_LINE_56>>
// <<MISSING_LINE_57>>
// <<MISSING_LINE_58>>
// <<MISSING_LINE_59>>
// <<MISSING_LINE_60>>
// <<MISSING_LINE_61>>
// <<MISSING_LINE_62>>
// <<MISSING_LINE_63>>
// <<MISSING_LINE_64>>
// <<MISSING_LINE_65>>
// <<MISSING_LINE_66>>
// <<MISSING_LINE_67>>
// <<MISSING_LINE_68>>
// <<MISSING_LINE_69>>
// <<MISSING_LINE_70>>
// <<MISSING_LINE_71>>
// <<MISSING_LINE_72>>
// <<MISSING_LINE_73>>
// <<MISSING_LINE_74>>
// <<MISSING_LINE_75>>
// <<MISSING_LINE_76>>
// <<MISSING_LINE_77>>
// <<MISSING_LINE_78>>
// <<MISSING_LINE_79>>
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

// <<MISSING_LINE_171>>
// <<MISSING_LINE_172>>
// <<MISSING_LINE_173>>
// <<MISSING_LINE_174>>
// <<MISSING_LINE_175>>
// <<MISSING_LINE_176>>
// <<MISSING_LINE_177>>
// <<MISSING_LINE_178>>
// <<MISSING_LINE_179>>
// <<MISSING_LINE_180>>
// <<MISSING_LINE_181>>
// <<MISSING_LINE_182>>
// <<MISSING_LINE_183>>
// <<MISSING_LINE_184>>
// <<MISSING_LINE_185>>
// <<MISSING_LINE_186>>
// <<MISSING_LINE_187>>
// <<MISSING_LINE_188>>
// <<MISSING_LINE_189>>
// <<MISSING_LINE_190>>
// <<MISSING_LINE_191>>
// <<MISSING_LINE_192>>
// <<MISSING_LINE_193>>
// <<MISSING_LINE_194>>
// <<MISSING_LINE_195>>
// <<MISSING_LINE_196>>
// <<MISSING_LINE_197>>
// <<MISSING_LINE_198>>
// <<MISSING_LINE_199>>
// <<MISSING_LINE_200>>
// <<MISSING_LINE_201>>
// <<MISSING_LINE_202>>
// <<MISSING_LINE_203>>
// <<MISSING_LINE_204>>
// <<MISSING_LINE_205>>
// <<MISSING_LINE_206>>
// <<MISSING_LINE_207>>
// <<MISSING_LINE_208>>
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
// <<MISSING_LINE_391>>
// <<MISSING_LINE_392>>
// <<MISSING_LINE_393>>
// <<MISSING_LINE_394>>
// <<MISSING_LINE_395>>
// <<MISSING_LINE_396>>
// <<MISSING_LINE_397>>
// <<MISSING_LINE_398>>
// <<MISSING_LINE_399>>
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
// <<MISSING_LINE_471>>
// <<MISSING_LINE_472>>
// <<MISSING_LINE_473>>
// <<MISSING_LINE_474>>
// <<MISSING_LINE_475>>
// <<MISSING_LINE_476>>
// <<MISSING_LINE_477>>
// <<MISSING_LINE_478>>
// <<MISSING_LINE_479>>
// <<MISSING_LINE_480>>
// <<MISSING_LINE_481>>
// <<MISSING_LINE_482>>
// <<MISSING_LINE_483>>
// <<MISSING_LINE_484>>
// <<MISSING_LINE_485>>
// <<MISSING_LINE_486>>
// <<MISSING_LINE_487>>
// <<MISSING_LINE_488>>
// <<MISSING_LINE_489>>
// <<MISSING_LINE_490>>
// <<MISSING_LINE_491>>
// <<MISSING_LINE_492>>
// <<MISSING_LINE_493>>
// <<MISSING_LINE_494>>
// <<MISSING_LINE_495>>
// <<MISSING_LINE_496>>
// <<MISSING_LINE_497>>
// <<MISSING_LINE_498>>
// <<MISSING_LINE_499>>
// <<MISSING_LINE_500>>
// <<MISSING_LINE_501>>
// <<MISSING_LINE_502>>
// <<MISSING_LINE_503>>
// <<MISSING_LINE_504>>
// <<MISSING_LINE_505>>
// <<MISSING_LINE_506>>
// <<MISSING_LINE_507>>
// <<MISSING_LINE_508>>
// <<MISSING_LINE_509>>
// <<MISSING_LINE_510>>
// <<MISSING_LINE_511>>
// <<MISSING_LINE_512>>
// <<MISSING_LINE_513>>
// <<MISSING_LINE_514>>
// <<MISSING_LINE_515>>
// <<MISSING_LINE_516>>
// <<MISSING_LINE_517>>
// <<MISSING_LINE_518>>
// <<MISSING_LINE_519>>
// <<MISSING_LINE_520>>
// <<MISSING_LINE_521>>
// <<MISSING_LINE_522>>
// <<MISSING_LINE_523>>
// <<MISSING_LINE_524>>
// <<MISSING_LINE_525>>
// <<MISSING_LINE_526>>
// <<MISSING_LINE_527>>
// <<MISSING_LINE_528>>
// <<MISSING_LINE_529>>
// <<MISSING_LINE_530>>
// <<MISSING_LINE_531>>
// <<MISSING_LINE_532>>
// <<MISSING_LINE_533>>
// <<MISSING_LINE_534>>
// <<MISSING_LINE_535>>
// <<MISSING_LINE_536>>
// <<MISSING_LINE_537>>
// <<MISSING_LINE_538>>
// <<MISSING_LINE_539>>
// <<MISSING_LINE_540>>
// <<MISSING_LINE_541>>
// <<MISSING_LINE_542>>
// <<MISSING_LINE_543>>
// <<MISSING_LINE_544>>
// <<MISSING_LINE_545>>
// <<MISSING_LINE_546>>
// <<MISSING_LINE_547>>
// <<MISSING_LINE_548>>
// <<MISSING_LINE_549>>
// <<MISSING_LINE_550>>
// <<MISSING_LINE_551>>
// <<MISSING_LINE_552>>
// <<MISSING_LINE_553>>
// <<MISSING_LINE_554>>
// <<MISSING_LINE_555>>
// <<MISSING_LINE_556>>
// <<MISSING_LINE_557>>
// <<MISSING_LINE_558>>
// <<MISSING_LINE_559>>
// <<MISSING_LINE_560>>
// <<MISSING_LINE_561>>
// <<MISSING_LINE_562>>
// <<MISSING_LINE_563>>
// <<MISSING_LINE_564>>
// <<MISSING_LINE_565>>
// <<MISSING_LINE_566>>
// <<MISSING_LINE_567>>
// <<MISSING_LINE_568>>
// <<MISSING_LINE_569>>
// <<MISSING_LINE_570>>
// <<MISSING_LINE_571>>
// <<MISSING_LINE_572>>
// <<MISSING_LINE_573>>
// <<MISSING_LINE_574>>
// <<MISSING_LINE_575>>
// <<MISSING_LINE_576>>
// <<MISSING_LINE_577>>
// <<MISSING_LINE_578>>
// <<MISSING_LINE_579>>
// <<MISSING_LINE_580>>
// <<MISSING_LINE_581>>
// <<MISSING_LINE_582>>
// <<MISSING_LINE_583>>
// <<MISSING_LINE_584>>
// <<MISSING_LINE_585>>
// <<MISSING_LINE_586>>
// <<MISSING_LINE_587>>
// <<MISSING_LINE_588>>
// <<MISSING_LINE_589>>
// <<MISSING_LINE_590>>
// <<MISSING_LINE_591>>
// <<MISSING_LINE_592>>
// <<MISSING_LINE_593>>
// <<MISSING_LINE_594>>
// <<MISSING_LINE_595>>
// <<MISSING_LINE_596>>
// <<MISSING_LINE_597>>
// <<MISSING_LINE_598>>
// <<MISSING_LINE_599>>
// <<MISSING_LINE_600>>
// <<MISSING_LINE_601>>
// <<MISSING_LINE_602>>
// <<MISSING_LINE_603>>
// <<MISSING_LINE_604>>
// <<MISSING_LINE_605>>
// <<MISSING_LINE_606>>
// <<MISSING_LINE_607>>
// <<MISSING_LINE_608>>
// <<MISSING_LINE_609>>
// <<MISSING_LINE_610>>
// <<MISSING_LINE_611>>
// <<MISSING_LINE_612>>
// <<MISSING_LINE_613>>
// <<MISSING_LINE_614>>
// <<MISSING_LINE_615>>
// <<MISSING_LINE_616>>
// <<MISSING_LINE_617>>
// <<MISSING_LINE_618>>
// <<MISSING_LINE_619>>
// <<MISSING_LINE_620>>
// <<MISSING_LINE_621>>
// <<MISSING_LINE_622>>
// <<MISSING_LINE_623>>
// <<MISSING_LINE_624>>
// <<MISSING_LINE_625>>
// <<MISSING_LINE_626>>
// <<MISSING_LINE_627>>
// <<MISSING_LINE_628>>
// <<MISSING_LINE_629>>
// <<MISSING_LINE_630>>
// <<MISSING_LINE_631>>
// <<MISSING_LINE_632>>
// <<MISSING_LINE_633>>
// <<MISSING_LINE_634>>
// <<MISSING_LINE_635>>
// <<MISSING_LINE_636>>
// <<MISSING_LINE_637>>
// <<MISSING_LINE_638>>
// <<MISSING_LINE_639>>
// <<MISSING_LINE_640>>
// <<MISSING_LINE_641>>
// <<MISSING_LINE_642>>
// <<MISSING_LINE_643>>
// <<MISSING_LINE_644>>
// <<MISSING_LINE_645>>
// <<MISSING_LINE_646>>
// <<MISSING_LINE_647>>
// <<MISSING_LINE_648>>
// <<MISSING_LINE_649>>
// <<MISSING_LINE_650>>
// <<MISSING_LINE_651>>
// <<MISSING_LINE_652>>
// <<MISSING_LINE_653>>
// <<MISSING_LINE_654>>
// <<MISSING_LINE_655>>
// <<MISSING_LINE_656>>
// <<MISSING_LINE_657>>
// <<MISSING_LINE_658>>
// <<MISSING_LINE_659>>
// <<MISSING_LINE_660>>
// <<MISSING_LINE_661>>
// <<MISSING_LINE_662>>
// <<MISSING_LINE_663>>
// <<MISSING_LINE_664>>
// <<MISSING_LINE_665>>
// <<MISSING_LINE_666>>
// <<MISSING_LINE_667>>
// <<MISSING_LINE_668>>
// <<MISSING_LINE_669>>
// <<MISSING_LINE_670>>
// <<MISSING_LINE_671>>
// <<MISSING_LINE_672>>
// <<MISSING_LINE_673>>
// <<MISSING_LINE_674>>
// <<MISSING_LINE_675>>
// <<MISSING_LINE_676>>
// <<MISSING_LINE_677>>
// <<MISSING_LINE_678>>
// <<MISSING_LINE_679>>
// <<MISSING_LINE_680>>
// <<MISSING_LINE_681>>
// <<MISSING_LINE_682>>
// <<MISSING_LINE_683>>
// <<MISSING_LINE_684>>
// <<MISSING_LINE_685>>
// <<MISSING_LINE_686>>
// <<MISSING_LINE_687>>
// <<MISSING_LINE_688>>
// <<MISSING_LINE_689>>
// <<MISSING_LINE_690>>
// <<MISSING_LINE_691>>
// <<MISSING_LINE_692>>
// <<MISSING_LINE_693>>
// <<MISSING_LINE_694>>
// <<MISSING_LINE_695>>
// <<MISSING_LINE_696>>
// <<MISSING_LINE_697>>
// <<MISSING_LINE_698>>
// <<MISSING_LINE_699>>
// <<MISSING_LINE_700>>
// <<MISSING_LINE_701>>
// <<MISSING_LINE_702>>
// <<MISSING_LINE_703>>
// <<MISSING_LINE_704>>
// <<MISSING_LINE_705>>
// <<MISSING_LINE_706>>
// <<MISSING_LINE_707>>
// <<MISSING_LINE_708>>
// <<MISSING_LINE_709>>
// <<MISSING_LINE_710>>
// <<MISSING_LINE_711>>
// <<MISSING_LINE_712>>
// <<MISSING_LINE_713>>
// <<MISSING_LINE_714>>
// <<MISSING_LINE_715>>
// <<MISSING_LINE_716>>
// <<MISSING_LINE_717>>
// <<MISSING_LINE_718>>
// <<MISSING_LINE_719>>
// <<MISSING_LINE_720>>
// <<MISSING_LINE_721>>
// <<MISSING_LINE_722>>
// <<MISSING_LINE_723>>
// <<MISSING_LINE_724>>
// <<MISSING_LINE_725>>
// <<MISSING_LINE_726>>
// <<MISSING_LINE_727>>
// <<MISSING_LINE_728>>
// <<MISSING_LINE_729>>
// <<MISSING_LINE_730>>
// <<MISSING_LINE_731>>
// <<MISSING_LINE_732>>
// <<MISSING_LINE_733>>
// <<MISSING_LINE_734>>
// <<MISSING_LINE_735>>
// <<MISSING_LINE_736>>
// <<MISSING_LINE_737>>
// <<MISSING_LINE_738>>
// <<MISSING_LINE_739>>
// <<MISSING_LINE_740>>
// <<MISSING_LINE_741>>
// <<MISSING_LINE_742>>
// <<MISSING_LINE_743>>
// <<MISSING_LINE_744>>
// <<MISSING_LINE_745>>
// <<MISSING_LINE_746>>
// <<MISSING_LINE_747>>
// <<MISSING_LINE_748>>
// <<MISSING_LINE_749>>
// <<MISSING_LINE_750>>
// <<MISSING_LINE_751>>
// <<MISSING_LINE_752>>
// <<MISSING_LINE_753>>
// <<MISSING_LINE_754>>
// <<MISSING_LINE_755>>
// <<MISSING_LINE_756>>
// <<MISSING_LINE_757>>
// <<MISSING_LINE_758>>
// <<MISSING_LINE_759>>
// <<MISSING_LINE_760>>
// <<MISSING_LINE_761>>
// <<MISSING_LINE_762>>
// <<MISSING_LINE_763>>
// <<MISSING_LINE_764>>
// <<MISSING_LINE_765>>
// <<MISSING_LINE_766>>
// <<MISSING_LINE_767>>
// <<MISSING_LINE_768>>
// <<MISSING_LINE_769>>
// <<MISSING_LINE_770>>
// <<MISSING_LINE_771>>
// <<MISSING_LINE_772>>
// <<MISSING_LINE_773>>
// <<MISSING_LINE_774>>
// <<MISSING_LINE_775>>
// <<MISSING_LINE_776>>
// <<MISSING_LINE_777>>
// <<MISSING_LINE_778>>
// <<MISSING_LINE_779>>
// <<MISSING_LINE_780>>
// <<MISSING_LINE_781>>
// <<MISSING_LINE_782>>
// <<MISSING_LINE_783>>
// <<MISSING_LINE_784>>
// <<MISSING_LINE_785>>
// <<MISSING_LINE_786>>
// <<MISSING_LINE_787>>
// <<MISSING_LINE_788>>
// <<MISSING_LINE_789>>
// <<MISSING_LINE_790>>
// <<MISSING_LINE_791>>
// <<MISSING_LINE_792>>
// <<MISSING_LINE_793>>
// <<MISSING_LINE_794>>
// <<MISSING_LINE_795>>
// <<MISSING_LINE_796>>
// <<MISSING_LINE_797>>
// <<MISSING_LINE_798>>
// <<MISSING_LINE_799>>
// <<MISSING_LINE_800>>
// <<MISSING_LINE_801>>
// <<MISSING_LINE_802>>
// <<MISSING_LINE_803>>
// <<MISSING_LINE_804>>
// <<MISSING_LINE_805>>
// <<MISSING_LINE_806>>
// <<MISSING_LINE_807>>
// <<MISSING_LINE_808>>
// <<MISSING_LINE_809>>
// <<MISSING_LINE_810>>
// <<MISSING_LINE_811>>
// <<MISSING_LINE_812>>
// <<MISSING_LINE_813>>
// <<MISSING_LINE_814>>
// <<MISSING_LINE_815>>
// <<MISSING_LINE_816>>
// <<MISSING_LINE_817>>
// <<MISSING_LINE_818>>
// <<MISSING_LINE_819>>
// <<MISSING_LINE_820>>
// <<MISSING_LINE_821>>
// <<MISSING_LINE_822>>
// <<MISSING_LINE_823>>
// <<MISSING_LINE_824>>
// <<MISSING_LINE_825>>
// <<MISSING_LINE_826>>
// <<MISSING_LINE_827>>
// <<MISSING_LINE_828>>
// <<MISSING_LINE_829>>
// <<MISSING_LINE_830>>
// <<MISSING_LINE_831>>
// <<MISSING_LINE_832>>
// <<MISSING_LINE_833>>
// <<MISSING_LINE_834>>
// <<MISSING_LINE_835>>
// <<MISSING_LINE_836>>
// <<MISSING_LINE_837>>
// <<MISSING_LINE_838>>
// <<MISSING_LINE_839>>
// <<MISSING_LINE_840>>
// <<MISSING_LINE_841>>
// <<MISSING_LINE_842>>
// <<MISSING_LINE_843>>
// <<MISSING_LINE_844>>
// <<MISSING_LINE_845>>
// <<MISSING_LINE_846>>
// <<MISSING_LINE_847>>
// <<MISSING_LINE_848>>
// <<MISSING_LINE_849>>
// <<MISSING_LINE_850>>
// <<MISSING_LINE_851>>
// <<MISSING_LINE_852>>
// <<MISSING_LINE_853>>
// <<MISSING_LINE_854>>
// <<MISSING_LINE_855>>
// <<MISSING_LINE_856>>
// <<MISSING_LINE_857>>
// <<MISSING_LINE_858>>
// <<MISSING_LINE_859>>
// <<MISSING_LINE_860>>
// <<MISSING_LINE_861>>
// <<MISSING_LINE_862>>
// <<MISSING_LINE_863>>
// <<MISSING_LINE_864>>
// <<MISSING_LINE_865>>
// <<MISSING_LINE_866>>
// <<MISSING_LINE_867>>
// <<MISSING_LINE_868>>
// <<MISSING_LINE_869>>
// <<MISSING_LINE_870>>
// <<MISSING_LINE_871>>
// <<MISSING_LINE_872>>
// <<MISSING_LINE_873>>
// <<MISSING_LINE_874>>
// <<MISSING_LINE_875>>
// <<MISSING_LINE_876>>
// <<MISSING_LINE_877>>
// <<MISSING_LINE_878>>
// <<MISSING_LINE_879>>
// <<MISSING_LINE_880>>
// <<MISSING_LINE_881>>
// <<MISSING_LINE_882>>
// <<MISSING_LINE_883>>
// <<MISSING_LINE_884>>
// <<MISSING_LINE_885>>
// <<MISSING_LINE_886>>
// <<MISSING_LINE_887>>
// <<MISSING_LINE_888>>
// <<MISSING_LINE_889>>
// <<MISSING_LINE_890>>
// <<MISSING_LINE_891>>
// <<MISSING_LINE_892>>
// <<MISSING_LINE_893>>
// <<MISSING_LINE_894>>
// <<MISSING_LINE_895>>
// <<MISSING_LINE_896>>
// <<MISSING_LINE_897>>
// <<MISSING_LINE_898>>
// <<MISSING_LINE_899>>
// <<MISSING_LINE_900>>
// <<MISSING_LINE_901>>
// <<MISSING_LINE_902>>
// <<MISSING_LINE_903>>
// <<MISSING_LINE_904>>
// <<MISSING_LINE_905>>
// <<MISSING_LINE_906>>
// <<MISSING_LINE_907>>
// <<MISSING_LINE_908>>
// <<MISSING_LINE_909>>
// <<MISSING_LINE_910>>
// <<MISSING_LINE_911>>
// <<MISSING_LINE_912>>
// <<MISSING_LINE_913>>
// <<MISSING_LINE_914>>
// <<MISSING_LINE_915>>
// <<MISSING_LINE_916>>
// <<MISSING_LINE_917>>
// <<MISSING_LINE_918>>
// <<MISSING_LINE_919>>
// <<MISSING_LINE_920>>
// <<MISSING_LINE_921>>
// <<MISSING_LINE_922>>
// <<MISSING_LINE_923>>
// <<MISSING_LINE_924>>
// <<MISSING_LINE_925>>
// <<MISSING_LINE_926>>
// <<MISSING_LINE_927>>
// <<MISSING_LINE_928>>
// <<MISSING_LINE_929>>
// <<MISSING_LINE_930>>
// <<MISSING_LINE_931>>
// <<MISSING_LINE_932>>
// <<MISSING_LINE_933>>
// <<MISSING_LINE_934>>
// <<MISSING_LINE_935>>
// <<MISSING_LINE_936>>
// <<MISSING_LINE_937>>
// <<MISSING_LINE_938>>
// <<MISSING_LINE_939>>
// <<MISSING_LINE_940>>
// <<MISSING_LINE_941>>
// <<MISSING_LINE_942>>
// <<MISSING_LINE_943>>
// <<MISSING_LINE_944>>
// <<MISSING_LINE_945>>
// <<MISSING_LINE_946>>
// <<MISSING_LINE_947>>
// <<MISSING_LINE_948>>
// <<MISSING_LINE_949>>
// <<MISSING_LINE_950>>
// <<MISSING_LINE_951>>
// <<MISSING_LINE_952>>
// <<MISSING_LINE_953>>
// <<MISSING_LINE_954>>
// <<MISSING_LINE_955>>
// <<MISSING_LINE_956>>
// <<MISSING_LINE_957>>
// <<MISSING_LINE_958>>
// <<MISSING_LINE_959>>
// <<MISSING_LINE_960>>
// <<MISSING_LINE_961>>
// <<MISSING_LINE_962>>
// <<MISSING_LINE_963>>
// <<MISSING_LINE_964>>
// <<MISSING_LINE_965>>
// <<MISSING_LINE_966>>
// <<MISSING_LINE_967>>
// <<MISSING_LINE_968>>
// <<MISSING_LINE_969>>
// <<MISSING_LINE_970>>
// <<MISSING_LINE_971>>
// <<MISSING_LINE_972>>
// <<MISSING_LINE_973>>
// <<MISSING_LINE_974>>
// <<MISSING_LINE_975>>
// <<MISSING_LINE_976>>
// <<MISSING_LINE_977>>
// <<MISSING_LINE_978>>
// <<MISSING_LINE_979>>
// <<MISSING_LINE_980>>
// <<MISSING_LINE_981>>
// <<MISSING_LINE_982>>
// <<MISSING_LINE_983>>
// <<MISSING_LINE_984>>
// <<MISSING_LINE_985>>
// <<MISSING_LINE_986>>
// <<MISSING_LINE_987>>
// <<MISSING_LINE_988>>
// <<MISSING_LINE_989>>
// <<MISSING_LINE_990>>
// <<MISSING_LINE_991>>
// <<MISSING_LINE_992>>
// <<MISSING_LINE_993>>
// <<MISSING_LINE_994>>
// <<MISSING_LINE_995>>
// <<MISSING_LINE_996>>
// <<MISSING_LINE_997>>
// <<MISSING_LINE_998>>
// <<MISSING_LINE_999>>
// <<MISSING_LINE_1000>>
// <<MISSING_LINE_1001>>
// <<MISSING_LINE_1002>>
// <<MISSING_LINE_1003>>
// <<MISSING_LINE_1004>>
// <<MISSING_LINE_1005>>
// <<MISSING_LINE_1006>>
// <<MISSING_LINE_1007>>
// <<MISSING_LINE_1008>>
// <<MISSING_LINE_1009>>
// <<MISSING_LINE_1010>>
// <<MISSING_LINE_1011>>
// <<MISSING_LINE_1012>>
// <<MISSING_LINE_1013>>
// <<MISSING_LINE_1014>>
// <<MISSING_LINE_1015>>
// <<MISSING_LINE_1016>>
// <<MISSING_LINE_1017>>
// <<MISSING_LINE_1018>>
// <<MISSING_LINE_1019>>
// <<MISSING_LINE_1020>>
// <<MISSING_LINE_1021>>
// <<MISSING_LINE_1022>>
// <<MISSING_LINE_1023>>
// <<MISSING_LINE_1024>>
// <<MISSING_LINE_1025>>
// <<MISSING_LINE_1026>>
// <<MISSING_LINE_1027>>
// <<MISSING_LINE_1028>>
// <<MISSING_LINE_1029>>
// <<MISSING_LINE_1030>>
// <<MISSING_LINE_1031>>
// <<MISSING_LINE_1032>>
// <<MISSING_LINE_1033>>
// <<MISSING_LINE_1034>>
// <<MISSING_LINE_1035>>
// <<MISSING_LINE_1036>>
// <<MISSING_LINE_1037>>
// <<MISSING_LINE_1038>>
// <<MISSING_LINE_1039>>
// <<MISSING_LINE_1040>>
// <<MISSING_LINE_1041>>
// <<MISSING_LINE_1042>>
// <<MISSING_LINE_1043>>
// <<MISSING_LINE_1044>>
// <<MISSING_LINE_1045>>
// <<MISSING_LINE_1046>>
// <<MISSING_LINE_1047>>
// <<MISSING_LINE_1048>>
// <<MISSING_LINE_1049>>
// <<MISSING_LINE_1050>>
// <<MISSING_LINE_1051>>
// <<MISSING_LINE_1052>>
// <<MISSING_LINE_1053>>
// <<MISSING_LINE_1054>>
// <<MISSING_LINE_1055>>
// <<MISSING_LINE_1056>>
// <<MISSING_LINE_1057>>
// <<MISSING_LINE_1058>>
// <<MISSING_LINE_1059>>
// <<MISSING_LINE_1060>>
// <<MISSING_LINE_1061>>
// <<MISSING_LINE_1062>>
// <<MISSING_LINE_1063>>
// <<MISSING_LINE_1064>>
// <<MISSING_LINE_1065>>
// <<MISSING_LINE_1066>>
// <<MISSING_LINE_1067>>
// <<MISSING_LINE_1068>>
// <<MISSING_LINE_1069>>
// <<MISSING_LINE_1070>>
// <<MISSING_LINE_1071>>
// <<MISSING_LINE_1072>>
// <<MISSING_LINE_1073>>
// <<MISSING_LINE_1074>>
// <<MISSING_LINE_1075>>
// <<MISSING_LINE_1076>>
// <<MISSING_LINE_1077>>
// <<MISSING_LINE_1078>>
// <<MISSING_LINE_1079>>
// <<MISSING_LINE_1080>>
// <<MISSING_LINE_1081>>
// <<MISSING_LINE_1082>>
// <<MISSING_LINE_1083>>
// <<MISSING_LINE_1084>>
// <<MISSING_LINE_1085>>
// <<MISSING_LINE_1086>>
// <<MISSING_LINE_1087>>
// <<MISSING_LINE_1088>>
// <<MISSING_LINE_1089>>
// <<MISSING_LINE_1090>>
// <<MISSING_LINE_1091>>
// <<MISSING_LINE_1092>>
// <<MISSING_LINE_1093>>
// <<MISSING_LINE_1094>>
// <<MISSING_LINE_1095>>
// <<MISSING_LINE_1096>>
// <<MISSING_LINE_1097>>
// <<MISSING_LINE_1098>>
// <<MISSING_LINE_1099>>
// <<MISSING_LINE_1100>>
// <<MISSING_LINE_1101>>
// <<MISSING_LINE_1102>>
// <<MISSING_LINE_1103>>
// <<MISSING_LINE_1104>>
// <<MISSING_LINE_1105>>
// <<MISSING_LINE_1106>>
// <<MISSING_LINE_1107>>
// <<MISSING_LINE_1108>>
// <<MISSING_LINE_1109>>
// <<MISSING_LINE_1110>>
// <<MISSING_LINE_1111>>
// <<MISSING_LINE_1112>>
// <<MISSING_LINE_1113>>
// <<MISSING_LINE_1114>>
// <<MISSING_LINE_1115>>
// <<MISSING_LINE_1116>>
// <<MISSING_LINE_1117>>
// <<MISSING_LINE_1118>>
// <<MISSING_LINE_1119>>
// <<MISSING_LINE_1120>>
// <<MISSING_LINE_1121>>
// <<MISSING_LINE_1122>>
// <<MISSING_LINE_1123>>
// <<MISSING_LINE_1124>>
// <<MISSING_LINE_1125>>
// <<MISSING_LINE_1126>>
// <<MISSING_LINE_1127>>
// <<MISSING_LINE_1128>>
// <<MISSING_LINE_1129>>
// <<MISSING_LINE_1130>>
// <<MISSING_LINE_1131>>
// <<MISSING_LINE_1132>>
// <<MISSING_LINE_1133>>
// <<MISSING_LINE_1134>>
// <<MISSING_LINE_1135>>
// <<MISSING_LINE_1136>>
// <<MISSING_LINE_1137>>
// <<MISSING_LINE_1138>>
// <<MISSING_LINE_1139>>
// <<MISSING_LINE_1140>>
// <<MISSING_LINE_1141>>
// <<MISSING_LINE_1142>>
// <<MISSING_LINE_1143>>
// <<MISSING_LINE_1144>>
// <<MISSING_LINE_1145>>
// <<MISSING_LINE_1146>>
// <<MISSING_LINE_1147>>
// <<MISSING_LINE_1148>>
// <<MISSING_LINE_1149>>
// <<MISSING_LINE_1150>>
// <<MISSING_LINE_1151>>
// <<MISSING_LINE_1152>>
// <<MISSING_LINE_1153>>
// <<MISSING_LINE_1154>>
// <<MISSING_LINE_1155>>
// <<MISSING_LINE_1156>>
// <<MISSING_LINE_1157>>
// <<MISSING_LINE_1158>>
// <<MISSING_LINE_1159>>
// <<MISSING_LINE_1160>>
// <<MISSING_LINE_1161>>
// <<MISSING_LINE_1162>>
// <<MISSING_LINE_1163>>
// <<MISSING_LINE_1164>>
// <<MISSING_LINE_1165>>
// <<MISSING_LINE_1166>>
// <<MISSING_LINE_1167>>
// <<MISSING_LINE_1168>>
// <<MISSING_LINE_1169>>
// <<MISSING_LINE_1170>>
// <<MISSING_LINE_1171>>
// <<MISSING_LINE_1172>>
// <<MISSING_LINE_1173>>
// <<MISSING_LINE_1174>>
// <<MISSING_LINE_1175>>
// <<MISSING_LINE_1176>>
// <<MISSING_LINE_1177>>
// <<MISSING_LINE_1178>>
// <<MISSING_LINE_1179>>
// <<MISSING_LINE_1180>>
// <<MISSING_LINE_1181>>
// <<MISSING_LINE_1182>>
// <<MISSING_LINE_1183>>
// <<MISSING_LINE_1184>>
// <<MISSING_LINE_1185>>
// <<MISSING_LINE_1186>>
// <<MISSING_LINE_1187>>
// <<MISSING_LINE_1188>>
// <<MISSING_LINE_1189>>
// <<MISSING_LINE_1190>>
// <<MISSING_LINE_1191>>
// <<MISSING_LINE_1192>>
// <<MISSING_LINE_1193>>
// <<MISSING_LINE_1194>>
// <<MISSING_LINE_1195>>
// <<MISSING_LINE_1196>>
// <<MISSING_LINE_1197>>
// <<MISSING_LINE_1198>>
// <<MISSING_LINE_1199>>
// <<MISSING_LINE_1200>>
// <<MISSING_LINE_1201>>
// <<MISSING_LINE_1202>>
// <<MISSING_LINE_1203>>
// <<MISSING_LINE_1204>>
// <<MISSING_LINE_1205>>
// <<MISSING_LINE_1206>>
// <<MISSING_LINE_1207>>
// <<MISSING_LINE_1208>>
// <<MISSING_LINE_1209>>
// <<MISSING_LINE_1210>>
// <<MISSING_LINE_1211>>
// <<MISSING_LINE_1212>>
// <<MISSING_LINE_1213>>
// <<MISSING_LINE_1214>>
// <<MISSING_LINE_1215>>
// <<MISSING_LINE_1216>>
// <<MISSING_LINE_1217>>
// <<MISSING_LINE_1218>>
// <<MISSING_LINE_1219>>
// <<MISSING_LINE_1220>>
// <<MISSING_LINE_1221>>
// <<MISSING_LINE_1222>>
// <<MISSING_LINE_1223>>
// <<MISSING_LINE_1224>>
// <<MISSING_LINE_1225>>
// <<MISSING_LINE_1226>>
// <<MISSING_LINE_1227>>
// <<MISSING_LINE_1228>>
// <<MISSING_LINE_1229>>
// <<MISSING_LINE_1230>>
// <<MISSING_LINE_1231>>
// <<MISSING_LINE_1232>>
// <<MISSING_LINE_1233>>
// <<MISSING_LINE_1234>>
// <<MISSING_LINE_1235>>
// <<MISSING_LINE_1236>>
// <<MISSING_LINE_1237>>
// <<MISSING_LINE_1238>>
// <<MISSING_LINE_1239>>
// <<MISSING_LINE_1240>>
// <<MISSING_LINE_1241>>
// <<MISSING_LINE_1242>>
// <<MISSING_LINE_1243>>
// <<MISSING_LINE_1244>>
// <<MISSING_LINE_1245>>
// <<MISSING_LINE_1246>>
// <<MISSING_LINE_1247>>
// <<MISSING_LINE_1248>>
// <<MISSING_LINE_1249>>
// <<MISSING_LINE_1250>>
// <<MISSING_LINE_1251>>
// <<MISSING_LINE_1252>>
// <<MISSING_LINE_1253>>
// <<MISSING_LINE_1254>>
// <<MISSING_LINE_1255>>
// <<MISSING_LINE_1256>>
// <<MISSING_LINE_1257>>
// <<MISSING_LINE_1258>>
// <<MISSING_LINE_1259>>
// <<MISSING_LINE_1260>>
// <<MISSING_LINE_1261>>
// <<MISSING_LINE_1262>>
// <<MISSING_LINE_1263>>
// <<MISSING_LINE_1264>>
// <<MISSING_LINE_1265>>
// <<MISSING_LINE_1266>>
// <<MISSING_LINE_1267>>
// <<MISSING_LINE_1268>>
// <<MISSING_LINE_1269>>
// <<MISSING_LINE_1270>>
// <<MISSING_LINE_1271>>
// <<MISSING_LINE_1272>>
// <<MISSING_LINE_1273>>
// <<MISSING_LINE_1274>>
// <<MISSING_LINE_1275>>
// <<MISSING_LINE_1276>>
// <<MISSING_LINE_1277>>
// <<MISSING_LINE_1278>>
// <<MISSING_LINE_1279>>
// <<MISSING_LINE_1280>>
// <<MISSING_LINE_1281>>
// <<MISSING_LINE_1282>>
// <<MISSING_LINE_1283>>
// <<MISSING_LINE_1284>>
// <<MISSING_LINE_1285>>
// <<MISSING_LINE_1286>>
// <<MISSING_LINE_1287>>
// <<MISSING_LINE_1288>>
// <<MISSING_LINE_1289>>
// <<MISSING_LINE_1290>>
// <<MISSING_LINE_1291>>
// <<MISSING_LINE_1292>>
// <<MISSING_LINE_1293>>
// <<MISSING_LINE_1294>>
// <<MISSING_LINE_1295>>
// <<MISSING_LINE_1296>>
// <<MISSING_LINE_1297>>
// <<MISSING_LINE_1298>>
// <<MISSING_LINE_1299>>
// <<MISSING_LINE_1300>>
// <<MISSING_LINE_1301>>
// <<MISSING_LINE_1302>>
// <<MISSING_LINE_1303>>
// <<MISSING_LINE_1304>>
// <<MISSING_LINE_1305>>
// <<MISSING_LINE_1306>>
// <<MISSING_LINE_1307>>
// <<MISSING_LINE_1308>>
// <<MISSING_LINE_1309>>
// <<MISSING_LINE_1310>>
// <<MISSING_LINE_1311>>
// <<MISSING_LINE_1312>>
// <<MISSING_LINE_1313>>
// <<MISSING_LINE_1314>>
// <<MISSING_LINE_1315>>
// <<MISSING_LINE_1316>>
// <<MISSING_LINE_1317>>
// <<MISSING_LINE_1318>>
// <<MISSING_LINE_1319>>
// <<MISSING_LINE_1320>>
// <<MISSING_LINE_1321>>
// <<MISSING_LINE_1322>>
// <<MISSING_LINE_1323>>
// <<MISSING_LINE_1324>>
// <<MISSING_LINE_1325>>
// <<MISSING_LINE_1326>>
// <<MISSING_LINE_1327>>
// <<MISSING_LINE_1328>>
// <<MISSING_LINE_1329>>
// <<MISSING_LINE_1330>>
// <<MISSING_LINE_1331>>
// <<MISSING_LINE_1332>>
// <<MISSING_LINE_1333>>
// <<MISSING_LINE_1334>>
// <<MISSING_LINE_1335>>
// <<MISSING_LINE_1336>>
// <<MISSING_LINE_1337>>
// <<MISSING_LINE_1338>>
// <<MISSING_LINE_1339>>
// <<MISSING_LINE_1340>>
// <<MISSING_LINE_1341>>
// <<MISSING_LINE_1342>>
// <<MISSING_LINE_1343>>
// <<MISSING_LINE_1344>>
// <<MISSING_LINE_1345>>
// <<MISSING_LINE_1346>>
// <<MISSING_LINE_1347>>
// <<MISSING_LINE_1348>>
// <<MISSING_LINE_1349>>
// <<MISSING_LINE_1350>>
// <<MISSING_LINE_1351>>
// <<MISSING_LINE_1352>>
// <<MISSING_LINE_1353>>
// <<MISSING_LINE_1354>>
// <<MISSING_LINE_1355>>
// <<MISSING_LINE_1356>>
// <<MISSING_LINE_1357>>
// <<MISSING_LINE_1358>>
// <<MISSING_LINE_1359>>
// <<MISSING_LINE_1360>>
// <<MISSING_LINE_1361>>
// <<MISSING_LINE_1362>>
// <<MISSING_LINE_1363>>
// <<MISSING_LINE_1364>>
// <<MISSING_LINE_1365>>
// <<MISSING_LINE_1366>>
// <<MISSING_LINE_1367>>
// <<MISSING_LINE_1368>>
// <<MISSING_LINE_1369>>
// <<MISSING_LINE_1370>>
// <<MISSING_LINE_1371>>
// <<MISSING_LINE_1372>>
// <<MISSING_LINE_1373>>
// <<MISSING_LINE_1374>>
// <<MISSING_LINE_1375>>
// <<MISSING_LINE_1376>>
// <<MISSING_LINE_1377>>
// <<MISSING_LINE_1378>>
// <<MISSING_LINE_1379>>
// <<MISSING_LINE_1380>>
// <<MISSING_LINE_1381>>
// <<MISSING_LINE_1382>>
// <<MISSING_LINE_1383>>
// <<MISSING_LINE_1384>>
// <<MISSING_LINE_1385>>
// <<MISSING_LINE_1386>>
// <<MISSING_LINE_1387>>
// <<MISSING_LINE_1388>>
// <<MISSING_LINE_1389>>
// <<MISSING_LINE_1390>>
// <<MISSING_LINE_1391>>
// <<MISSING_LINE_1392>>
// <<MISSING_LINE_1393>>
// <<MISSING_LINE_1394>>
// <<MISSING_LINE_1395>>
// <<MISSING_LINE_1396>>
// <<MISSING_LINE_1397>>
// <<MISSING_LINE_1398>>
// <<MISSING_LINE_1399>>
// <<MISSING_LINE_1400>>
// <<MISSING_LINE_1401>>
// <<MISSING_LINE_1402>>
// <<MISSING_LINE_1403>>
// <<MISSING_LINE_1404>>
// <<MISSING_LINE_1405>>
// <<MISSING_LINE_1406>>
// <<MISSING_LINE_1407>>
// <<MISSING_LINE_1408>>
// <<MISSING_LINE_1409>>
// <<MISSING_LINE_1410>>
// <<MISSING_LINE_1411>>
// <<MISSING_LINE_1412>>
// <<MISSING_LINE_1413>>
// <<MISSING_LINE_1414>>
// <<MISSING_LINE_1415>>
// <<MISSING_LINE_1416>>
// <<MISSING_LINE_1417>>
// <<MISSING_LINE_1418>>
// <<MISSING_LINE_1419>>
// <<MISSING_LINE_1420>>
// <<MISSING_LINE_1421>>
// <<MISSING_LINE_1422>>
// <<MISSING_LINE_1423>>
// <<MISSING_LINE_1424>>
// <<MISSING_LINE_1425>>
// <<MISSING_LINE_1426>>
// <<MISSING_LINE_1427>>
// <<MISSING_LINE_1428>>
// <<MISSING_LINE_1429>>
// <<MISSING_LINE_1430>>
 * literal tokens <<<BEAT_SHEET>>> and <<<FIRST_PASS>>>. To stay robust against
 * the model wrapping the tokens in punctuation or whitespace, we match a
// <<MISSING_LINE_1433>>
// <<MISSING_LINE_1434>>
// <<MISSING_LINE_1435>>
// <<MISSING_LINE_1436>>
// <<MISSING_LINE_1437>>
// <<MISSING_LINE_1438>>
// <<MISSING_LINE_1439>>
// <<MISSING_LINE_1440>>
// <<MISSING_LINE_1441>>
// <<MISSING_LINE_1442>>
// <<MISSING_LINE_1443>>
// <<MISSING_LINE_1444>>
// <<MISSING_LINE_1445>>
// <<MISSING_LINE_1446>>
// <<MISSING_LINE_1447>>
// <<MISSING_LINE_1448>>
// <<MISSING_LINE_1449>>
// <<MISSING_LINE_1450>>
// <<MISSING_LINE_1451>>
// <<MISSING_LINE_1452>>
// <<MISSING_LINE_1453>>
// <<MISSING_LINE_1454>>
// <<MISSING_LINE_1455>>
// <<MISSING_LINE_1456>>
// <<MISSING_LINE_1457>>
// <<MISSING_LINE_1458>>
// <<MISSING_LINE_1459>>
// <<MISSING_LINE_1460>>
// <<MISSING_LINE_1461>>
// <<MISSING_LINE_1462>>
// <<MISSING_LINE_1463>>
// <<MISSING_LINE_1464>>
// <<MISSING_LINE_1465>>
// <<MISSING_LINE_1466>>
// <<MISSING_LINE_1467>>
// <<MISSING_LINE_1468>>
// <<MISSING_LINE_1469>>
// <<MISSING_LINE_1470>>
// <<MISSING_LINE_1471>>
// <<MISSING_LINE_1472>>
// <<MISSING_LINE_1473>>
// <<MISSING_LINE_1474>>
// <<MISSING_LINE_1475>>
// <<MISSING_LINE_1476>>
// <<MISSING_LINE_1477>>
// <<MISSING_LINE_1478>>
// <<MISSING_LINE_1479>>
// <<MISSING_LINE_1480>>
// <<MISSING_LINE_1481>>
// <<MISSING_LINE_1482>>
// <<MISSING_LINE_1483>>
// <<MISSING_LINE_1484>>
// <<MISSING_LINE_1485>>
// <<MISSING_LINE_1486>>
// <<MISSING_LINE_1487>>
// <<MISSING_LINE_1488>>
// <<MISSING_LINE_1489>>
// <<MISSING_LINE_1490>>
// <<MISSING_LINE_1491>>
// <<MISSING_LINE_1492>>
// <<MISSING_LINE_1493>>
// <<MISSING_LINE_1494>>
// <<MISSING_LINE_1495>>
// <<MISSING_LINE_1496>>
// <<MISSING_LINE_1497>>
// <<MISSING_LINE_1498>>
// <<MISSING_LINE_1499>>
// <<MISSING_LINE_1500>>
// <<MISSING_LINE_1501>>
// <<MISSING_LINE_1502>>
// <<MISSING_LINE_1503>>
// <<MISSING_LINE_1504>>
// <<MISSING_LINE_1505>>
// <<MISSING_LINE_1506>>
// <<MISSING_LINE_1507>>
// <<MISSING_LINE_1508>>
// <<MISSING_LINE_1509>>
// <<MISSING_LINE_1510>>
// <<MISSING_LINE_1511>>
// <<MISSING_LINE_1512>>
// <<MISSING_LINE_1513>>
// <<MISSING_LINE_1514>>
// <<MISSING_LINE_1515>>
// <<MISSING_LINE_1516>>
// <<MISSING_LINE_1517>>
// <<MISSING_LINE_1518>>
// <<MISSING_LINE_1519>>
// <<MISSING_LINE_1520>>
// <<MISSING_LINE_1521>>
// <<MISSING_LINE_1522>>
// <<MISSING_LINE_1523>>
// <<MISSING_LINE_1524>>
// <<MISSING_LINE_1525>>
// <<MISSING_LINE_1526>>
// <<MISSING_LINE_1527>>
// <<MISSING_LINE_1528>>
// <<MISSING_LINE_1529>>
// <<MISSING_LINE_1530>>
// <<MISSING_LINE_1531>>
// <<MISSING_LINE_1532>>
// <<MISSING_LINE_1533>>
// <<MISSING_LINE_1534>>
// <<MISSING_LINE_1535>>
// <<MISSING_LINE_1536>>
// <<MISSING_LINE_1537>>
// <<MISSING_LINE_1538>>
// <<MISSING_LINE_1539>>
// <<MISSING_LINE_1540>>
// <<MISSING_LINE_1541>>
// <<MISSING_LINE_1542>>
// <<MISSING_LINE_1543>>
// <<MISSING_LINE_1544>>
// <<MISSING_LINE_1545>>
// <<MISSING_LINE_1546>>
// <<MISSING_LINE_1547>>
// <<MISSING_LINE_1548>>
// <<MISSING_LINE_1549>>
// <<MISSING_LINE_1550>>
// <<MISSING_LINE_1551>>
// <<MISSING_LINE_1552>>
// <<MISSING_LINE_1553>>
// <<MISSING_LINE_1554>>
// <<MISSING_LINE_1555>>
// <<MISSING_LINE_1556>>
// <<MISSING_LINE_1557>>
// <<MISSING_LINE_1558>>
// <<MISSING_LINE_1559>>
// <<MISSING_LINE_1560>>
// <<MISSING_LINE_1561>>
// <<MISSING_LINE_1562>>
// <<MISSING_LINE_1563>>
// <<MISSING_LINE_1564>>
// <<MISSING_LINE_1565>>
// <<MISSING_LINE_1566>>
// <<MISSING_LINE_1567>>
// <<MISSING_LINE_1568>>
// <<MISSING_LINE_1569>>
// <<MISSING_LINE_1570>>
// <<MISSING_LINE_1571>>
// <<MISSING_LINE_1572>>
// <<MISSING_LINE_1573>>
// <<MISSING_LINE_1574>>
// <<MISSING_LINE_1575>>
// <<MISSING_LINE_1576>>
// <<MISSING_LINE_1577>>
// <<MISSING_LINE_1578>>
// <<MISSING_LINE_1579>>
// <<MISSING_LINE_1580>>
// <<MISSING_LINE_1581>>
// <<MISSING_LINE_1582>>
// <<MISSING_LINE_1583>>
// <<MISSING_LINE_1584>>
// <<MISSING_LINE_1585>>
// <<MISSING_LINE_1586>>
// <<MISSING_LINE_1587>>
// <<MISSING_LINE_1588>>
// <<MISSING_LINE_1589>>
// <<MISSING_LINE_1590>>
// <<MISSING_LINE_1591>>
// <<MISSING_LINE_1592>>
// <<MISSING_LINE_1593>>
// <<MISSING_LINE_1594>>
// <<MISSING_LINE_1595>>
// <<MISSING_LINE_1596>>
// <<MISSING_LINE_1597>>
// <<MISSING_LINE_1598>>
// <<MISSING_LINE_1599>>
// <<MISSING_LINE_1600>>
// <<MISSING_LINE_1601>>
// <<MISSING_LINE_1602>>
// <<MISSING_LINE_1603>>
// <<MISSING_LINE_1604>>
// <<MISSING_LINE_1605>>
// <<MISSING_LINE_1606>>
// <<MISSING_LINE_1607>>
// <<MISSING_LINE_1608>>
// <<MISSING_LINE_1609>>
// <<MISSING_LINE_1610>>
// <<MISSING_LINE_1611>>
// <<MISSING_LINE_1612>>
// <<MISSING_LINE_1613>>
// <<MISSING_LINE_1614>>
// <<MISSING_LINE_1615>>
// <<MISSING_LINE_1616>>
// <<MISSING_LINE_1617>>
// <<MISSING_LINE_1618>>
// <<MISSING_LINE_1619>>
// <<MISSING_LINE_1620>>
// <<MISSING_LINE_1621>>
// <<MISSING_LINE_1622>>
// <<MISSING_LINE_1623>>
// <<MISSING_LINE_1624>>
// <<MISSING_LINE_1625>>
// <<MISSING_LINE_1626>>
// <<MISSING_LINE_1627>>
// <<MISSING_LINE_1628>>
// <<MISSING_LINE_1629>>
// <<MISSING_LINE_1630>>
// <<MISSING_LINE_1631>>
// <<MISSING_LINE_1632>>
// <<MISSING_LINE_1633>>
// <<MISSING_LINE_1634>>
// <<MISSING_LINE_1635>>
// <<MISSING_LINE_1636>>
// <<MISSING_LINE_1637>>
// <<MISSING_LINE_1638>>
// <<MISSING_LINE_1639>>
// <<MISSING_LINE_1640>>
// <<MISSING_LINE_1641>>
// <<MISSING_LINE_1642>>
// <<MISSING_LINE_1643>>
// <<MISSING_LINE_1644>>
// <<MISSING_LINE_1645>>
// <<MISSING_LINE_1646>>
// <<MISSING_LINE_1647>>
// <<MISSING_LINE_1648>>
// <<MISSING_LINE_1649>>
// <<MISSING_LINE_1650>>
// <<MISSING_LINE_1651>>
// <<MISSING_LINE_1652>>
// <<MISSING_LINE_1653>>
// <<MISSING_LINE_1654>>
// <<MISSING_LINE_1655>>
// <<MISSING_LINE_1656>>
// <<MISSING_LINE_1657>>
// <<MISSING_LINE_1658>>
// <<MISSING_LINE_1659>>
// <<MISSING_LINE_1660>>
// <<MISSING_LINE_1661>>
// <<MISSING_LINE_1662>>
// <<MISSING_LINE_1663>>
// <<MISSING_LINE_1664>>
// <<MISSING_LINE_1665>>
// <<MISSING_LINE_1666>>
// <<MISSING_LINE_1667>>
// <<MISSING_LINE_1668>>
// <<MISSING_LINE_1669>>
// <<MISSING_LINE_1670>>
// <<MISSING_LINE_1671>>
// <<MISSING_LINE_1672>>
// <<MISSING_LINE_1673>>
// <<MISSING_LINE_1674>>
// <<MISSING_LINE_1675>>
// <<MISSING_LINE_1676>>
// <<MISSING_LINE_1677>>
// <<MISSING_LINE_1678>>
// <<MISSING_LINE_1679>>
// <<MISSING_LINE_1680>>
// <<MISSING_LINE_1681>>
// <<MISSING_LINE_1682>>
// <<MISSING_LINE_1683>>
// <<MISSING_LINE_1684>>
// <<MISSING_LINE_1685>>
// <<MISSING_LINE_1686>>
// <<MISSING_LINE_1687>>
// <<MISSING_LINE_1688>>
// <<MISSING_LINE_1689>>
// <<MISSING_LINE_1690>>
// <<MISSING_LINE_1691>>
// <<MISSING_LINE_1692>>
// <<MISSING_LINE_1693>>
// <<MISSING_LINE_1694>>
// <<MISSING_LINE_1695>>
// <<MISSING_LINE_1696>>
// <<MISSING_LINE_1697>>
// <<MISSING_LINE_1698>>
// <<MISSING_LINE_1699>>
// <<MISSING_LINE_1700>>
// <<MISSING_LINE_1701>>
// <<MISSING_LINE_1702>>
// <<MISSING_LINE_1703>>
// <<MISSING_LINE_1704>>
// <<MISSING_LINE_1705>>
// <<MISSING_LINE_1706>>
// <<MISSING_LINE_1707>>
// <<MISSING_LINE_1708>>
// <<MISSING_LINE_1709>>
// <<MISSING_LINE_1710>>
// <<MISSING_LINE_1711>>
// <<MISSING_LINE_1712>>
// <<MISSING_LINE_1713>>
  // Count distinct token strings of the shape `<2-4 CJK char name><direction>`
// <<MISSING_LINE_1715>>
  // count distinct prefixes that immediately precede the `direction` token.
// <<MISSING_LINE_1717>>
// <<MISSING_LINE_1718>>
// <<MISSING_LINE_1719>>
// <<MISSING_LINE_1720>>
// <<MISSING_LINE_1721>>
// <<MISSING_LINE_1722>>
// <<MISSING_LINE_1723>>
// <<MISSING_LINE_1724>>
// <<MISSING_LINE_1725>>
// <<MISSING_LINE_1726>>
// <<MISSING_LINE_1727>>
// <<MISSING_LINE_1728>>
// <<MISSING_LINE_1729>>
// <<MISSING_LINE_1730>>
// <<MISSING_LINE_1731>>
// <<MISSING_LINE_1732>>
// <<MISSING_LINE_1733>>
// <<MISSING_LINE_1734>>
// <<MISSING_LINE_1735>>
// <<MISSING_LINE_1736>>
// <<MISSING_LINE_1737>>
// <<MISSING_LINE_1738>>
// <<MISSING_LINE_1739>>
// <<MISSING_LINE_1740>>
// <<MISSING_LINE_1741>>
// <<MISSING_LINE_1742>>
// <<MISSING_LINE_1743>>
// <<MISSING_LINE_1744>>
// <<MISSING_LINE_1745>>
// <<MISSING_LINE_1746>>
// <<MISSING_LINE_1747>>
// <<MISSING_LINE_1748>>
// <<MISSING_LINE_1749>>
// <<MISSING_LINE_1750>>
// <<MISSING_LINE_1751>>
// <<MISSING_LINE_1752>>
// <<MISSING_LINE_1753>>
// <<MISSING_LINE_1754>>
// <<MISSING_LINE_1755>>
// <<MISSING_LINE_1756>>
// <<MISSING_LINE_1757>>
// <<MISSING_LINE_1758>>
// <<MISSING_LINE_1759>>
// <<MISSING_LINE_1760>>
// <<MISSING_LINE_1761>>
// <<MISSING_LINE_1762>>
// <<MISSING_LINE_1763>>
// <<MISSING_LINE_1764>>
// <<MISSING_LINE_1765>>
// <<MISSING_LINE_1766>>
// <<MISSING_LINE_1767>>
// <<MISSING_LINE_1768>>
// <<MISSING_LINE_1769>>
// <<MISSING_LINE_1770>>
// <<MISSING_LINE_1771>>
// <<MISSING_LINE_1772>>
// <<MISSING_LINE_1773>>
// <<MISSING_LINE_1774>>
// <<MISSING_LINE_1775>>
// <<MISSING_LINE_1776>>
// <<MISSING_LINE_1777>>
// <<MISSING_LINE_1778>>
// <<MISSING_LINE_1779>>
// <<MISSING_LINE_1780>>
// <<MISSING_LINE_1781>>
// <<MISSING_LINE_1782>>
// <<MISSING_LINE_1783>>
// <<MISSING_LINE_1784>>
// <<MISSING_LINE_1785>>
// <<MISSING_LINE_1786>>
// <<MISSING_LINE_1787>>
// <<MISSING_LINE_1788>>
// <<MISSING_LINE_1789>>
// <<MISSING_LINE_1790>>
// <<MISSING_LINE_1791>>
// <<MISSING_LINE_1792>>
// <<MISSING_LINE_1793>>
// <<MISSING_LINE_1794>>
// <<MISSING_LINE_1795>>
// <<MISSING_LINE_1796>>
// <<MISSING_LINE_1797>>
// <<MISSING_LINE_1798>>
// <<MISSING_LINE_1799>>
// <<MISSING_LINE_1800>>
// <<MISSING_LINE_1801>>
// <<MISSING_LINE_1802>>
// <<MISSING_LINE_1803>>
// <<MISSING_LINE_1804>>
// <<MISSING_LINE_1805>>
// <<MISSING_LINE_1806>>
// <<MISSING_LINE_1807>>
// <<MISSING_LINE_1808>>
// <<MISSING_LINE_1809>>
// <<MISSING_LINE_1810>>
// <<MISSING_LINE_1811>>
// <<MISSING_LINE_1812>>
// <<MISSING_LINE_1813>>
// <<MISSING_LINE_1814>>
// <<MISSING_LINE_1815>>
// <<MISSING_LINE_1816>>
// <<MISSING_LINE_1817>>
// <<MISSING_LINE_1818>>
// <<MISSING_LINE_1819>>
// <<MISSING_LINE_1820>>
// <<MISSING_LINE_1821>>
// <<MISSING_LINE_1822>>
// <<MISSING_LINE_1823>>
// <<MISSING_LINE_1824>>
// <<MISSING_LINE_1825>>
// <<MISSING_LINE_1826>>
// <<MISSING_LINE_1827>>
// <<MISSING_LINE_1828>>
// <<MISSING_LINE_1829>>
// <<MISSING_LINE_1830>>
// <<MISSING_LINE_1831>>
// <<MISSING_LINE_1832>>
// <<MISSING_LINE_1833>>
// <<MISSING_LINE_1834>>
// <<MISSING_LINE_1835>>
// <<MISSING_LINE_1836>>
// <<MISSING_LINE_1837>>
// <<MISSING_LINE_1838>>
// <<MISSING_LINE_1839>>
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
// <<MISSING_LINE_1976>>
// <<MISSING_LINE_1977>>
// <<MISSING_LINE_1978>>
// <<MISSING_LINE_1979>>
// <<MISSING_LINE_1980>>
// <<MISSING_LINE_1981>>
// <<MISSING_LINE_1982>>
// <<MISSING_LINE_1983>>
// <<MISSING_LINE_1984>>
// <<MISSING_LINE_1985>>
// <<MISSING_LINE_1986>>
// <<MISSING_LINE_1987>>
// <<MISSING_LINE_1988>>
// <<MISSING_LINE_1989>>
// <<MISSING_LINE_1990>>
// <<MISSING_LINE_1991>>
// <<MISSING_LINE_1992>>
// <<MISSING_LINE_1993>>
// <<MISSING_LINE_1994>>
// <<MISSING_LINE_1995>>
// <<MISSING_LINE_1996>>
// <<MISSING_LINE_1997>>
// <<MISSING_LINE_1998>>
// <<MISSING_LINE_1999>>
// <<MISSING_LINE_2000>>
// <<MISSING_LINE_2001>>
// <<MISSING_LINE_2002>>
// <<MISSING_LINE_2003>>
// <<MISSING_LINE_2004>>
// <<MISSING_LINE_2005>>
// <<MISSING_LINE_2006>>
// <<MISSING_LINE_2007>>
// <<MISSING_LINE_2008>>
// <<MISSING_LINE_2009>>
// <<MISSING_LINE_2010>>
// <<MISSING_LINE_2011>>
// <<MISSING_LINE_2012>>
// <<MISSING_LINE_2013>>
// <<MISSING_LINE_2014>>
// <<MISSING_LINE_2015>>
// <<MISSING_LINE_2016>>
// <<MISSING_LINE_2017>>
// <<MISSING_LINE_2018>>
// <<MISSING_LINE_2019>>
// <<MISSING_LINE_2020>>
// <<MISSING_LINE_2021>>
// <<MISSING_LINE_2022>>
// <<MISSING_LINE_2023>>
// <<MISSING_LINE_2024>>
// <<MISSING_LINE_2025>>
// <<MISSING_LINE_2026>>
// <<MISSING_LINE_2027>>
// <<MISSING_LINE_2028>>
// <<MISSING_LINE_2029>>
// <<MISSING_LINE_2030>>
// <<MISSING_LINE_2031>>
// <<MISSING_LINE_2032>>
// <<MISSING_LINE_2033>>
// <<MISSING_LINE_2034>>
// <<MISSING_LINE_2035>>
// <<MISSING_LINE_2036>>
// <<MISSING_LINE_2037>>
// <<MISSING_LINE_2038>>
// <<MISSING_LINE_2039>>
// <<MISSING_LINE_2040>>
// <<MISSING_LINE_2041>>
// <<MISSING_LINE_2042>>
// <<MISSING_LINE_2043>>
// <<MISSING_LINE_2044>>
// <<MISSING_LINE_2045>>
// <<MISSING_LINE_2046>>
// <<MISSING_LINE_2047>>
// <<MISSING_LINE_2048>>
// <<MISSING_LINE_2049>>
// <<MISSING_LINE_2050>>
// <<MISSING_LINE_2051>>
// <<MISSING_LINE_2052>>
// <<MISSING_LINE_2053>>
// <<MISSING_LINE_2054>>
// <<MISSING_LINE_2055>>
// <<MISSING_LINE_2056>>
// <<MISSING_LINE_2057>>
// <<MISSING_LINE_2058>>
// <<MISSING_LINE_2059>>
// <<MISSING_LINE_2060>>
// <<MISSING_LINE_2061>>
// <<MISSING_LINE_2062>>
// <<MISSING_LINE_2063>>
// <<MISSING_LINE_2064>>
// <<MISSING_LINE_2065>>
// <<MISSING_LINE_2066>>
// <<MISSING_LINE_2067>>
// <<MISSING_LINE_2068>>
// <<MISSING_LINE_2069>>
// <<MISSING_LINE_2070>>
// <<MISSING_LINE_2071>>
// <<MISSING_LINE_2072>>
// <<MISSING_LINE_2073>>
// <<MISSING_LINE_2074>>
// <<MISSING_LINE_2075>>
// <<MISSING_LINE_2076>>
// <<MISSING_LINE_2077>>
// <<MISSING_LINE_2078>>
// <<MISSING_LINE_2079>>
// <<MISSING_LINE_2080>>
// <<MISSING_LINE_2081>>
// <<MISSING_LINE_2082>>
// <<MISSING_LINE_2083>>
// <<MISSING_LINE_2084>>
// <<MISSING_LINE_2085>>
// <<MISSING_LINE_2086>>
// <<MISSING_LINE_2087>>
// <<MISSING_LINE_2088>>
// <<MISSING_LINE_2089>>
// <<MISSING_LINE_2090>>
// <<MISSING_LINE_2091>>
// <<MISSING_LINE_2092>>
// <<MISSING_LINE_2093>>
// <<MISSING_LINE_2094>>
// <<MISSING_LINE_2095>>
// <<MISSING_LINE_2096>>
// <<MISSING_LINE_2097>>
// <<MISSING_LINE_2098>>
// <<MISSING_LINE_2099>>
// <<MISSING_LINE_2100>>
// <<MISSING_LINE_2101>>
// <<MISSING_LINE_2102>>
// <<MISSING_LINE_2103>>
// <<MISSING_LINE_2104>>
// <<MISSING_LINE_2105>>
// <<MISSING_LINE_2106>>
// <<MISSING_LINE_2107>>
// <<MISSING_LINE_2108>>
// <<MISSING_LINE_2109>>
// <<MISSING_LINE_2110>>
// <<MISSING_LINE_2111>>
// <<MISSING_LINE_2112>>
// <<MISSING_LINE_2113>>
// <<MISSING_LINE_2114>>
// <<MISSING_LINE_2115>>
// <<MISSING_LINE_2116>>
// <<MISSING_LINE_2117>>
// <<MISSING_LINE_2118>>
// <<MISSING_LINE_2119>>
// <<MISSING_LINE_2120>>
// <<MISSING_LINE_2121>>
// <<MISSING_LINE_2122>>
// <<MISSING_LINE_2123>>
// <<MISSING_LINE_2124>>
// <<MISSING_LINE_2125>>
// <<MISSING_LINE_2126>>
// <<MISSING_LINE_2127>>
// <<MISSING_LINE_2128>>
// <<MISSING_LINE_2129>>
// <<MISSING_LINE_2130>>
// <<MISSING_LINE_2131>>
// <<MISSING_LINE_2132>>
// <<MISSING_LINE_2133>>
// <<MISSING_LINE_2134>>
// <<MISSING_LINE_2135>>
// <<MISSING_LINE_2136>>
// <<MISSING_LINE_2137>>
// <<MISSING_LINE_2138>>
// <<MISSING_LINE_2139>>
// <<MISSING_LINE_2140>>
  // 比 combined call 少一半 output tokens，没有 BEAT 阶段遮挡，首字 5-10s 就开始流。
// <<MISSING_LINE_2142>>
// <<MISSING_LINE_2143>>
// <<MISSING_LINE_2144>>
// <<MISSING_LINE_2145>>
// <<MISSING_LINE_2146>>
// <<MISSING_LINE_2147>>
// <<MISSING_LINE_2148>>
// <<MISSING_LINE_2149>>
// <<MISSING_LINE_2150>>
// <<MISSING_LINE_2151>>
// <<MISSING_LINE_2152>>
// <<MISSING_LINE_2153>>
// <<MISSING_LINE_2154>>
// <<MISSING_LINE_2155>>
// <<MISSING_LINE_2156>>
// <<MISSING_LINE_2157>>
// <<MISSING_LINE_2158>>
// <<MISSING_LINE_2159>>
// <<MISSING_LINE_2160>>
// <<MISSING_LINE_2161>>
// <<MISSING_LINE_2162>>
// <<MISSING_LINE_2163>>
// <<MISSING_LINE_2164>>
// <<MISSING_LINE_2165>>
// <<MISSING_LINE_2166>>
// <<MISSING_LINE_2167>>
// <<MISSING_LINE_2168>>
// <<MISSING_LINE_2169>>
// <<MISSING_LINE_2170>>
// <<MISSING_LINE_2171>>
// <<MISSING_LINE_2172>>
// <<MISSING_LINE_2173>>
// <<MISSING_LINE_2174>>
// <<MISSING_LINE_2175>>
// <<MISSING_LINE_2176>>
// <<MISSING_LINE_2177>>
// <<MISSING_LINE_2178>>
// <<MISSING_LINE_2179>>
// <<MISSING_LINE_2180>>
// <<MISSING_LINE_2181>>
// <<MISSING_LINE_2182>>
// <<MISSING_LINE_2183>>
// <<MISSING_LINE_2184>>
// <<MISSING_LINE_2185>>
// <<MISSING_LINE_2186>>
// <<MISSING_LINE_2187>>
// <<MISSING_LINE_2188>>
// <<MISSING_LINE_2189>>
// <<MISSING_LINE_2190>>
// <<MISSING_LINE_2191>>
// <<MISSING_LINE_2192>>
// <<MISSING_LINE_2193>>
// <<MISSING_LINE_2194>>
// <<MISSING_LINE_2195>>
// <<MISSING_LINE_2196>>
// <<MISSING_LINE_2197>>
// <<MISSING_LINE_2198>>
// <<MISSING_LINE_2199>>
// <<MISSING_LINE_2200>>
// <<MISSING_LINE_2201>>
// <<MISSING_LINE_2202>>
// <<MISSING_LINE_2203>>
// <<MISSING_LINE_2204>>
// <<MISSING_LINE_2205>>
// <<MISSING_LINE_2206>>
// <<MISSING_LINE_2207>>
// <<MISSING_LINE_2208>>
// <<MISSING_LINE_2209>>
// <<MISSING_LINE_2210>>
// <<MISSING_LINE_2211>>
// <<MISSING_LINE_2212>>
// <<MISSING_LINE_2213>>
// <<MISSING_LINE_2214>>
// <<MISSING_LINE_2215>>
// <<MISSING_LINE_2216>>
// <<MISSING_LINE_2217>>
// <<MISSING_LINE_2218>>
// <<MISSING_LINE_2219>>
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
// <<MISSING_LINE_2286>>
// <<MISSING_LINE_2287>>
// <<MISSING_LINE_2288>>
// <<MISSING_LINE_2289>>
// <<MISSING_LINE_2290>>
// <<MISSING_LINE_2291>>
// <<MISSING_LINE_2292>>
// <<MISSING_LINE_2293>>
// <<MISSING_LINE_2294>>
// <<MISSING_LINE_2295>>
// <<MISSING_LINE_2296>>
// <<MISSING_LINE_2297>>
// <<MISSING_LINE_2298>>
// <<MISSING_LINE_2299>>
// <<MISSING_LINE_2300>>
// <<MISSING_LINE_2301>>
// <<MISSING_LINE_2302>>
// <<MISSING_LINE_2303>>
// <<MISSING_LINE_2304>>
// <<MISSING_LINE_2305>>
// <<MISSING_LINE_2306>>
// <<MISSING_LINE_2307>>
// <<MISSING_LINE_2308>>
// <<MISSING_LINE_2309>>
// <<MISSING_LINE_2310>>
// <<MISSING_LINE_2311>>
// <<MISSING_LINE_2312>>
// <<MISSING_LINE_2313>>
// <<MISSING_LINE_2314>>
// <<MISSING_LINE_2315>>
// <<MISSING_LINE_2316>>
// <<MISSING_LINE_2317>>
// <<MISSING_LINE_2318>>
// <<MISSING_LINE_2319>>
// <<MISSING_LINE_2320>>
// <<MISSING_LINE_2321>>
// <<MISSING_LINE_2322>>
// <<MISSING_LINE_2323>>
// <<MISSING_LINE_2324>>
// <<MISSING_LINE_2325>>
// <<MISSING_LINE_2326>>
// <<MISSING_LINE_2327>>
// <<MISSING_LINE_2328>>
// <<MISSING_LINE_2329>>
// <<MISSING_LINE_2330>>
// <<MISSING_LINE_2331>>
// <<MISSING_LINE_2332>>
// <<MISSING_LINE_2333>>
// <<MISSING_LINE_2334>>
// <<MISSING_LINE_2335>>
// <<MISSING_LINE_2336>>
// <<MISSING_LINE_2337>>
// <<MISSING_LINE_2338>>
// <<MISSING_LINE_2339>>
// <<MISSING_LINE_2340>>
// <<MISSING_LINE_2341>>
// <<MISSING_LINE_2342>>
// <<MISSING_LINE_2343>>
// <<MISSING_LINE_2344>>
// <<MISSING_LINE_2345>>
// <<MISSING_LINE_2346>>
// <<MISSING_LINE_2347>>
// <<MISSING_LINE_2348>>
// <<MISSING_LINE_2349>>
// <<MISSING_LINE_2350>>
// <<MISSING_LINE_2351>>
// <<MISSING_LINE_2352>>
// <<MISSING_LINE_2353>>
// <<MISSING_LINE_2354>>
// <<MISSING_LINE_2355>>
// <<MISSING_LINE_2356>>
// <<MISSING_LINE_2357>>
// <<MISSING_LINE_2358>>
// <<MISSING_LINE_2359>>
// <<MISSING_LINE_2360>>
// <<MISSING_LINE_2361>>
// <<MISSING_LINE_2362>>
// <<MISSING_LINE_2363>>
// <<MISSING_LINE_2364>>
// <<MISSING_LINE_2365>>
// <<MISSING_LINE_2366>>
// <<MISSING_LINE_2367>>
// <<MISSING_LINE_2368>>
// <<MISSING_LINE_2369>>
// <<MISSING_LINE_2370>>
// <<MISSING_LINE_2371>>
// <<MISSING_LINE_2372>>
// <<MISSING_LINE_2373>>
// <<MISSING_LINE_2374>>
// <<MISSING_LINE_2375>>
// <<MISSING_LINE_2376>>
// <<MISSING_LINE_2377>>
// <<MISSING_LINE_2378>>
// <<MISSING_LINE_2379>>
// <<MISSING_LINE_2380>>
// <<MISSING_LINE_2381>>
// <<MISSING_LINE_2382>>
// <<MISSING_LINE_2383>>
// <<MISSING_LINE_2384>>
// <<MISSING_LINE_2385>>
// <<MISSING_LINE_2386>>
// <<MISSING_LINE_2387>>
// <<MISSING_LINE_2388>>
// <<MISSING_LINE_2389>>
// <<MISSING_LINE_2390>>
// <<MISSING_LINE_2391>>
// <<MISSING_LINE_2392>>
// <<MISSING_LINE_2393>>
// <<MISSING_LINE_2394>>
// <<MISSING_LINE_2395>>
// <<MISSING_LINE_2396>>
// <<MISSING_LINE_2397>>
// <<MISSING_LINE_2398>>
// <<MISSING_LINE_2399>>
// <<MISSING_LINE_2400>>
// <<MISSING_LINE_2401>>
// <<MISSING_LINE_2402>>
// <<MISSING_LINE_2403>>
// <<MISSING_LINE_2404>>
// <<MISSING_LINE_2405>>
// <<MISSING_LINE_2406>>
// <<MISSING_LINE_2407>>
// <<MISSING_LINE_2408>>
// <<MISSING_LINE_2409>>
// <<MISSING_LINE_2410>>
// <<MISSING_LINE_2411>>
// <<MISSING_LINE_2412>>
// <<MISSING_LINE_2413>>
// <<MISSING_LINE_2414>>
// <<MISSING_LINE_2415>>
// <<MISSING_LINE_2416>>
// <<MISSING_LINE_2417>>
// <<MISSING_LINE_2418>>
// <<MISSING_LINE_2419>>
// <<MISSING_LINE_2420>>
// <<MISSING_LINE_2421>>
// <<MISSING_LINE_2422>>
// <<MISSING_LINE_2423>>
// <<MISSING_LINE_2424>>
// <<MISSING_LINE_2425>>
// <<MISSING_LINE_2426>>
// <<MISSING_LINE_2427>>
// <<MISSING_LINE_2428>>
// <<MISSING_LINE_2429>>
// <<MISSING_LINE_2430>>
// <<MISSING_LINE_2431>>
// <<MISSING_LINE_2432>>
// <<MISSING_LINE_2433>>
// <<MISSING_LINE_2434>>
// <<MISSING_LINE_2435>>
// <<MISSING_LINE_2436>>
// <<MISSING_LINE_2437>>
// <<MISSING_LINE_2438>>
// <<MISSING_LINE_2439>>
// <<MISSING_LINE_2440>>
// <<MISSING_LINE_2441>>
// <<MISSING_LINE_2442>>
// <<MISSING_LINE_2443>>
// <<MISSING_LINE_2444>>
// <<MISSING_LINE_2445>>
// <<MISSING_LINE_2446>>
// <<MISSING_LINE_2447>>
// <<MISSING_LINE_2448>>
// <<MISSING_LINE_2449>>
// <<MISSING_LINE_2450>>
// <<MISSING_LINE_2451>>
// <<MISSING_LINE_2452>>
// <<MISSING_LINE_2453>>
// <<MISSING_LINE_2454>>
// <<MISSING_LINE_2455>>
// <<MISSING_LINE_2456>>
// <<MISSING_LINE_2457>>
// <<MISSING_LINE_2458>>
// <<MISSING_LINE_2459>>
// <<MISSING_LINE_2460>>
// <<MISSING_LINE_2461>>
// <<MISSING_LINE_2462>>
// <<MISSING_LINE_2463>>
// <<MISSING_LINE_2464>>
// <<MISSING_LINE_2465>>
// <<MISSING_LINE_2466>>
// <<MISSING_LINE_2467>>
// <<MISSING_LINE_2468>>
// <<MISSING_LINE_2469>>
// <<MISSING_LINE_2470>>
// <<MISSING_LINE_2471>>
// <<MISSING_LINE_2472>>
// <<MISSING_LINE_2473>>
// <<MISSING_LINE_2474>>
// <<MISSING_LINE_2475>>
// <<MISSING_LINE_2476>>
// <<MISSING_LINE_2477>>
// <<MISSING_LINE_2478>>
// <<MISSING_LINE_2479>>
// <<MISSING_LINE_2480>>
// <<MISSING_LINE_2481>>
// <<MISSING_LINE_2482>>
// <<MISSING_LINE_2483>>
// <<MISSING_LINE_2484>>
// <<MISSING_LINE_2485>>
// <<MISSING_LINE_2486>>
// <<MISSING_LINE_2487>>
// <<MISSING_LINE_2488>>
// <<MISSING_LINE_2489>>
// <<MISSING_LINE_2490>>
// <<MISSING_LINE_2491>>
// <<MISSING_LINE_2492>>
// <<MISSING_LINE_2493>>
// <<MISSING_LINE_2494>>
// <<MISSING_LINE_2495>>
// <<MISSING_LINE_2496>>
// <<MISSING_LINE_2497>>
// <<MISSING_LINE_2498>>
// <<MISSING_LINE_2499>>
// <<MISSING_LINE_2500>>
// <<MISSING_LINE_2501>>
// <<MISSING_LINE_2502>>
// <<MISSING_LINE_2503>>
// <<MISSING_LINE_2504>>
// <<MISSING_LINE_2505>>
// <<MISSING_LINE_2506>>
// <<MISSING_LINE_2507>>
// <<MISSING_LINE_2508>>
// <<MISSING_LINE_2509>>
// <<MISSING_LINE_2510>>
// <<MISSING_LINE_2511>>
// <<MISSING_LINE_2512>>
// <<MISSING_LINE_2513>>
// <<MISSING_LINE_2514>>
// <<MISSING_LINE_2515>>
// <<MISSING_LINE_2516>>
// <<MISSING_LINE_2517>>
// <<MISSING_LINE_2518>>
// <<MISSING_LINE_2519>>
// <<MISSING_LINE_2520>>
// <<MISSING_LINE_2521>>
// <<MISSING_LINE_2522>>
// <<MISSING_LINE_2523>>
// <<MISSING_LINE_2524>>
// <<MISSING_LINE_2525>>
// <<MISSING_LINE_2526>>
// <<MISSING_LINE_2527>>
// <<MISSING_LINE_2528>>
// <<MISSING_LINE_2529>>
// <<MISSING_LINE_2530>>
// <<MISSING_LINE_2531>>
// <<MISSING_LINE_2532>>
// <<MISSING_LINE_2533>>
// <<MISSING_LINE_2534>>
// <<MISSING_LINE_2535>>
// <<MISSING_LINE_2536>>
// <<MISSING_LINE_2537>>
// <<MISSING_LINE_2538>>
// <<MISSING_LINE_2539>>
// <<MISSING_LINE_2540>>
// <<MISSING_LINE_2541>>
// <<MISSING_LINE_2542>>
// <<MISSING_LINE_2543>>
// <<MISSING_LINE_2544>>
// <<MISSING_LINE_2545>>
// <<MISSING_LINE_2546>>
// <<MISSING_LINE_2547>>
// <<MISSING_LINE_2548>>
// <<MISSING_LINE_2549>>
// <<MISSING_LINE_2550>>
// <<MISSING_LINE_2551>>
// <<MISSING_LINE_2552>>
// <<MISSING_LINE_2553>>
// <<MISSING_LINE_2554>>
// <<MISSING_LINE_2555>>
// <<MISSING_LINE_2556>>
// <<MISSING_LINE_2557>>
// <<MISSING_LINE_2558>>
// <<MISSING_LINE_2559>>
// <<MISSING_LINE_2560>>
// <<MISSING_LINE_2561>>
// <<MISSING_LINE_2562>>
// <<MISSING_LINE_2563>>
// <<MISSING_LINE_2564>>
// <<MISSING_LINE_2565>>
// <<MISSING_LINE_2566>>
// <<MISSING_LINE_2567>>
// <<MISSING_LINE_2568>>
// <<MISSING_LINE_2569>>
// <<MISSING_LINE_2570>>
// <<MISSING_LINE_2571>>
// <<MISSING_LINE_2572>>
// <<MISSING_LINE_2573>>
// <<MISSING_LINE_2574>>
// <<MISSING_LINE_2575>>
// <<MISSING_LINE_2576>>
// <<MISSING_LINE_2577>>
// <<MISSING_LINE_2578>>
// <<MISSING_LINE_2579>>
// <<MISSING_LINE_2580>>
// <<MISSING_LINE_2581>>
// <<MISSING_LINE_2582>>
// <<MISSING_LINE_2583>>
// <<MISSING_LINE_2584>>
// <<MISSING_LINE_2585>>
// <<MISSING_LINE_2586>>
// <<MISSING_LINE_2587>>
// <<MISSING_LINE_2588>>
// <<MISSING_LINE_2589>>
// <<MISSING_LINE_2590>>
// <<MISSING_LINE_2591>>
// <<MISSING_LINE_2592>>
// <<MISSING_LINE_2593>>
// <<MISSING_LINE_2594>>
// <<MISSING_LINE_2595>>
// <<MISSING_LINE_2596>>
// <<MISSING_LINE_2597>>
// <<MISSING_LINE_2598>>
// <<MISSING_LINE_2599>>
// <<MISSING_LINE_2600>>
// <<MISSING_LINE_2601>>
// <<MISSING_LINE_2602>>
// <<MISSING_LINE_2603>>
// <<MISSING_LINE_2604>>
// <<MISSING_LINE_2605>>
// <<MISSING_LINE_2606>>
// <<MISSING_LINE_2607>>
// <<MISSING_LINE_2608>>
// <<MISSING_LINE_2609>>
// <<MISSING_LINE_2610>>
// <<MISSING_LINE_2611>>
// <<MISSING_LINE_2612>>
// <<MISSING_LINE_2613>>
// <<MISSING_LINE_2614>>
// <<MISSING_LINE_2615>>
// <<MISSING_LINE_2616>>
// <<MISSING_LINE_2617>>
// <<MISSING_LINE_2618>>
// <<MISSING_LINE_2619>>
// <<MISSING_LINE_2620>>
// <<MISSING_LINE_2621>>
// <<MISSING_LINE_2622>>
// <<MISSING_LINE_2623>>
// <<MISSING_LINE_2624>>
// <<MISSING_LINE_2625>>
// <<MISSING_LINE_2626>>
// <<MISSING_LINE_2627>>
// <<MISSING_LINE_2628>>
// <<MISSING_LINE_2629>>
// <<MISSING_LINE_2630>>
// <<MISSING_LINE_2631>>
// <<MISSING_LINE_2632>>
// <<MISSING_LINE_2633>>
// <<MISSING_LINE_2634>>
// <<MISSING_LINE_2635>>
// <<MISSING_LINE_2636>>
// <<MISSING_LINE_2637>>
// <<MISSING_LINE_2638>>
// <<MISSING_LINE_2639>>
// <<MISSING_LINE_2640>>
// <<MISSING_LINE_2641>>
// <<MISSING_LINE_2642>>
// <<MISSING_LINE_2643>>
// <<MISSING_LINE_2644>>
// <<MISSING_LINE_2645>>
// <<MISSING_LINE_2646>>
// <<MISSING_LINE_2647>>
// <<MISSING_LINE_2648>>
// <<MISSING_LINE_2649>>
// <<MISSING_LINE_2650>>
// <<MISSING_LINE_2651>>
// <<MISSING_LINE_2652>>
// <<MISSING_LINE_2653>>
// <<MISSING_LINE_2654>>
// <<MISSING_LINE_2655>>
// <<MISSING_LINE_2656>>
// <<MISSING_LINE_2657>>
// <<MISSING_LINE_2658>>
// <<MISSING_LINE_2659>>
// <<MISSING_LINE_2660>>
// <<MISSING_LINE_2661>>
// <<MISSING_LINE_2662>>
// <<MISSING_LINE_2663>>
// <<MISSING_LINE_2664>>
// <<MISSING_LINE_2665>>
// <<MISSING_LINE_2666>>
// <<MISSING_LINE_2667>>
// <<MISSING_LINE_2668>>
// <<MISSING_LINE_2669>>
// <<MISSING_LINE_2670>>
// <<MISSING_LINE_2671>>
// <<MISSING_LINE_2672>>
// <<MISSING_LINE_2673>>
// <<MISSING_LINE_2674>>
// <<MISSING_LINE_2675>>
// <<MISSING_LINE_2676>>
// <<MISSING_LINE_2677>>
// <<MISSING_LINE_2678>>
// <<MISSING_LINE_2679>>
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