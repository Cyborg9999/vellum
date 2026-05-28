// Dreamina (即梦) CLI subprocess wrapper.
// Binary: /Users/chengyue/.local/bin/dreamina  (whitelisted in capabilities/default.json as "dreamina")
//
// Flagship video mode: multimodal2video (formerly ref2video, "全能参考")
//   - Seedance 2.0 family
//   - --image (repeatable), --prompt, --duration, --ratio, --video_resolution, --model_version
//   - async by default; --poll=0 fires-and-forgets, returns submit_id
//
// Status polling: query_result --submit_id=<id>

import { Command } from "@tauri-apps/plugin-shell";
import { runTracked } from "./subprocess";

const SUBMIT_TIMEOUT_MS = 180_000; // 3 min — dreamina submit is async (poll=0) but TLS handshake / queueing can stall
const QUERY_TIMEOUT_MS = 60_000;   // 1 min — query_result is a single API call

export type DreaminaModel =
  | "seedance2.0"
  | "seedance2.0fast"
  | "seedance2.0_vip"
  | "seedance2.0fast_vip";

export type DreaminaRatio = "1:1" | "3:4" | "16:9" | "4:3" | "9:16" | "21:9";
export type DreaminaResolution = "720p" | "1080p";

export interface DreaminaSubmitOptions {
  model_version?: DreaminaModel;
  duration?: number; // 4-15
  ratio?: DreaminaRatio;
  video_resolution?: DreaminaResolution;
}

export interface DreaminaSubmitResult {
  submit_id: string;
  raw_response: string;
  cli_command: string; // for debugging / DB persistence
}

// Defaults intentionally conservative: 5s minimum-credit budget so new projects
// don't accidentally burn max-duration credits before the user dials it up.
// SubmitView's parseDurationSeconds will lift this to whatever the draft text
// declares (e.g. "激斗15秒" → 15s).
const DEFAULT_OPTS: Required<DreaminaSubmitOptions> = {
  model_version: "seedance2.0_vip",
  duration: 5,
  ratio: "16:9",
  video_resolution: "1080p",
};

/**
 * Submit a multimodal2video task. Returns the submit_id immediately
 * (async submission with --poll=0).
 */
export async function submitMultimodal2Video(
  prompt: string,
  imagePaths: string[],
  opts: DreaminaSubmitOptions = {}
): Promise<DreaminaSubmitResult> {
  if (imagePaths.length === 0) {
    throw new Error("dreamina multimodal2video 至少需要 1 张图片");
  }
  if (imagePaths.length > 9) {
    throw new Error(`dreamina multimodal2video 最多 9 张图片，当前 ${imagePaths.length}`);
  }

  const o = { ...DEFAULT_OPTS, ...opts };

  // Lower-tier models can only do 720p; only _vip supports 1080p
  const isVip = o.model_version.endsWith("_vip");
  const resolution = isVip ? o.video_resolution : "720p";

  const args: string[] = ["multimodal2video"];
  args.push("--prompt", prompt);
  for (const p of imagePaths) {
    args.push("--image", p);
  }
  args.push("--model_version", o.model_version);
  args.push("--duration", String(o.duration));
  args.push("--ratio", o.ratio);
  args.push("--video_resolution", resolution);
  args.push("--poll", "0");

  console.log("[dreamina] cmd:", "dreamina", redactArgs(args));

  const cmd = Command.create("dreamina", args);
  const output = await runTracked(cmd, {
    timeoutMs: SUBMIT_TIMEOUT_MS,
    label: "dreamina multimodal2video",
  });

  if (output.code !== 0) {
    throw new Error(
      `dreamina multimodal2video exit ${output.code}\nstderr: ${output.stderr}\nstdout: ${output.stdout}`
    );
  }

  const submit_id = extractSubmitId(output.stdout);
  if (!submit_id) {
    throw new Error(
      `dreamina 输出里没找到 submit_id：\n${output.stdout}`
    );
  }

  return {
    submit_id,
    raw_response: output.stdout,
    cli_command: `dreamina ${args.map(quoteArg).join(" ")}`,
  };
}

export interface DreaminaQueryResult {
  status: string; // "pending" / "running" / "success" / "failed" / dreamina-specific values
  video_url?: string;
  video_urls?: string[];
  error?: string;
  raw: unknown;
}

/**
 * Poll a previously-submitted task by id. Returns parsed JSON if dreamina
 * outputs JSON (it does for most commands).
 */
export async function queryResult(submit_id: string): Promise<DreaminaQueryResult> {
  const args = ["query_result", `--submit_id=${submit_id}`];
  console.log("[dreamina] cmd:", "dreamina", args.join(" "));

  const cmd = Command.create("dreamina", args);
  const output = await runTracked(cmd, {
    timeoutMs: QUERY_TIMEOUT_MS,
    label: "dreamina query_result",
  });

  if (output.code !== 0) {
    throw new Error(
      `dreamina query_result exit ${output.code}\nstderr: ${output.stderr}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(output.stdout);
  } catch {
    return {
      status: "unknown",
      raw: output.stdout,
    };
  }

  const p = parsed as Record<string, unknown>;
  const status =
    (p.gen_status as string) ||
    (p.status as string) ||
    (p.task_status as string) ||
    "unknown";

  // dreamina may return video URLs in different shapes; gather best-effort
  const videoUrls: string[] = [];
  const tryAdd = (v: unknown) => {
    if (typeof v === "string" && v.startsWith("http")) videoUrls.push(v);
  };
  tryAdd(p.video_url);
  tryAdd((p.result as Record<string, unknown> | undefined)?.video_url);
  if (Array.isArray(p.video_urls)) {
    for (const u of p.video_urls) tryAdd(u);
  }
  if (Array.isArray(p.videos)) {
    for (const v of p.videos as unknown[]) {
      tryAdd((v as Record<string, unknown>)?.video_url);
      tryAdd((v as Record<string, unknown>)?.url);
    }
  }

  return {
    status,
    video_url: videoUrls[0],
    video_urls: videoUrls.length > 0 ? videoUrls : undefined,
    error: (p.error as string) || (p.fail_msg as string),
    raw: parsed,
  };
}

/**
 * Map dreamina's various status strings to our normalized SubmissionStatus.
 * Allowlist-based (grill H4): substring matching previously coerced any
 * "*ing" / "*fail*" string into running / failed, which corrupted UI for
 * statuses like "missing", "validation_failed_retrying", "limit_exceeded".
 *
 * Unknown strings stay "queued" so the poll loop keeps checking instead of
 * silently flipping a paid job to a terminal state.
 */
export function normalizeDreaminaStatus(
  s: string
): "queued" | "running" | "success" | "failed" {
  const map: Record<string, "queued" | "running" | "success" | "failed"> = {
    queued: "queued",
    pending: "queued",
    waiting: "queued",
    submitted: "queued",
    not_start: "queued",
    in_queue: "queued",
    accepted: "queued",
    running: "running",
    processing: "running",
    in_progress: "running",
    generating: "running",
    success: "success",
    completed: "success",
    done: "success",
    finished: "success",
    failed: "failed",
    error: "failed",
    failure: "failed",
    canceled: "failed",
    cancelled: "failed",
    timeout: "failed",
    expired: "failed",
    rejected: "failed",
  };
  return map[s.toLowerCase().trim()] ?? "queued";
}

/**
 * Pull dreamina's submit_id out of CLI stdout. Strict order: parsed JSON,
 * then scoped regex looking for a labeled key. We deliberately do NOT fall
 * back to a bare UUID search (grill H3) — a stack-trace ID or request_id
 * elsewhere in stdout could otherwise be persisted as the submit_id and
 * orphan the actual paid job.
 */
export function extractSubmitId(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed.submit_id === "string") return parsed.submit_id;
    if (typeof parsed.task_id === "string") return parsed.task_id;
    if (typeof parsed.id === "string") return parsed.id;
  } catch {
    /* JSON parse failed; fall through to scoped regex */
  }
  const m =
    stdout.match(/"submit_id"\s*:\s*"([^"]+)"/) ||
    stdout.match(/"task_id"\s*:\s*"([^"]+)"/);
  return m?.[1] ?? null;
}

function quoteArg(a: string): string {
  // Light shell-escape only for display purposes (CLI command string saved to DB)
  if (/^[a-zA-Z0-9_./@:=+-]+$/.test(a)) return a;
  return `"${a.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Truncate `--prompt` body in console logs so we don't leak full prompt
 * text (potentially user-pasted PII/tokens) to devtools / terminal (grill M6).
 */
function redactArgs(args: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--prompt" && i + 1 < args.length) {
      const v = args[i + 1];
      out.push(a, v.length > 80 ? v.slice(0, 80) + "…[truncated]" : v);
      i++;
    } else {
      out.push(a);
    }
  }
  return out.join(" ");
}
