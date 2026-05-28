// Submit view — batch submit completed shots to Dreamina (即梦 CLI) and
// poll for results. Lives at the bottom of the 1 → 2 → 3 workflow:
// Draft → First Pass → Final → SUBMIT.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Send,
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader,
  AlertCircle,
  Clock,
  ExternalLink,
  Trash2,
} from "lucide-react";
import { useApp } from "@/lib/store";
import {
  listShots,
  listSubmissions,
  createSubmission,
  updateSubmission,
  deleteSubmission,
  getSubmitIdFromRow,
} from "@/lib/db";
import {
  submitMultimodal2Video,
  queryResult,
  normalizeDreaminaStatus,
  type DreaminaModel,
  type DreaminaRatio,
  type DreaminaResolution,
} from "@/lib/dreamina";
import {
  buildSubmitPayload,
  findOrphanImageRefs,
  parseDurationSeconds,
} from "@/lib/claude";
import type { Shot, Submission } from "@/lib/types";
import { cn } from "@/lib/utils";

type Opts = {
  model_version: DreaminaModel;
  duration: number;
  ratio: DreaminaRatio;
  video_resolution: DreaminaResolution;
};

// 5s default keeps a fresh project from accidentally burning max-duration
// credits. parseDurationSeconds(draft_text) lifts this to whatever the user
// declared (e.g. "激斗15秒" → 15s) on project load.
const DEFAULT_OPTS: Opts = {
  model_version: "seedance2.0_vip",
  duration: 5,
  ratio: "16:9",
  video_resolution: "1080p",
};

export function SubmitView() {
  const project = useApp((s) => s.currentProject);
  const refImages = useApp((s) => s.refImages);
  const [shots, setShots] = useState<Shot[]>([]);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [opts, setOpts] = useState<Opts>(DEFAULT_OPTS);

  const load = useCallback(async () => {
    if (!project) return;
    try {
      const [s, sub] = await Promise.all([
        listShots(project.id),
        listSubmissions(project.id),
      ]);
      setShots(s);
      setSubs(sub);
    } catch (e) {
      console.error("[SubmitView] load:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [project]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-detect video duration from project's draft text (e.g. "激斗15秒" → 15s).
  // Updates `opts.duration` once per project switch. User can still override.
  const detectedDuration = useMemo(() => {
    if (!project) return null;
    return (
      parseDurationSeconds(project.draft_text || "") ??
      parseDurationSeconds(project.first_pass_text || "") ??
      parseDurationSeconds(project.final_pass_text || "")
    );
  }, [project]);

  useEffect(() => {
    if (detectedDuration !== null) {
      setOpts((o) =>
        o.duration === detectedDuration ? o : { ...o, duration: detectedDuration }
      );
    }
  }, [detectedDuration]);

  // shot.id → latest Submission (descending id is already DESC from query)
  const latestSubByShot = useMemo(() => {
    const map = new Map<number, Submission>();
    for (const s of subs) {
      if (!map.has(s.shot_id)) map.set(s.shot_id, s);
    }
    return map;
  }, [subs]);

  // Only shots with final_pass-style text (we store final per-shot in `enhanced_prompt`)
  // Actually our schema: shots.raw_prompt = user draft, shots.enhanced_prompt = final.
  // A shot is "ready to submit" when enhanced_prompt is non-empty.
  const readyShots = useMemo(
    () => shots.filter((s) => s.enhanced_prompt && s.enhanced_prompt.trim()),
    [shots]
  );

  async function handleSubmitOne(shot: Shot) {
    if (!project) return;
    setError(null);
    setBusyIds((prev) => new Set(prev).add(shot.id));
    try {
      const text = shot.enhanced_prompt.trim();
      const payload = buildSubmitPayload(text, refImages);

      // Refuse to submit if there are orphan (图N) refs — better to fail fast
      if (payload.orphanIndices.length > 0) {
        throw new Error(
          `提示词里有 (图${payload.orphanIndices.join(", 图")}) 但库里没找到对应图，先去 Shots 里清理`
        );
      }
      const imagePaths = payload.orderedFiles;
      if (imagePaths.length === 0) {
        throw new Error(
          "提示词里没有 (图N) 引用 — multimodal2video 至少要 1 张图。" +
            "如果是纯文生视频，应当用 text2video（暂未接入）"
        );
      }

      // Build prompt that goes to dreamina. Prepend the upload-order header
      // unless the user's body text already starts with one (avoid duplication).
      const bodyHasOrderHeader = /参考图上传顺序/.test(payload.body);
      const fullPrompt =
        payload.uploadOrderHeader && !bodyHasOrderHeader
          ? `${payload.uploadOrderHeader}\n\n${payload.body}`
          : payload.body;

      const res = await submitMultimodal2Video(fullPrompt, imagePaths, opts);

      await createSubmission({
        project_id: project.id,
        shot_id: shot.id,
        cli_command: res.cli_command,
        submit_id: res.submit_id,
        status: "running",
      });
      await load();
    } catch (e) {
      console.error("[SubmitView] submitOne:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(shot.id);
        return next;
      });
    }
  }

  async function handleRefreshOne(sub: Submission) {
    setError(null);
    const submitId = getSubmitIdFromRow(sub);
    if (!submitId) {
      setError(`row #${sub.id} 没有保存 submit_id — 无法查询状态`);
      return;
    }
    try {
      const r = await queryResult(submitId);
      const normalized = normalizeDreaminaStatus(r.status);
      await updateSubmission(sub.id, {
        status: normalized,
        video_path: r.video_url ?? sub.video_path,
        error: r.error ?? null,
        completed_at:
          normalized === "success" || normalized === "failed"
            ? Math.floor(Date.now() / 1000)
            : null,
      });
      await load();
    } catch (e) {
      console.error("[SubmitView] refreshOne:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSubmitAll() {
    for (const shot of readyShots) {
      // Skip shots that already have a non-failed submission
      const last = latestSubByShot.get(shot.id);
      if (last && last.status !== "failed") continue;
      await handleSubmitOne(shot);
    }
  }

  async function handleRefreshAll() {
    const pending = subs.filter(
      (s) => s.status === "queued" || s.status === "running"
    );
    for (const s of pending) {
      await handleRefreshOne(s);
    }
  }

  async function handleDeleteSubmission(s: Submission) {
    if (!confirm("删除这条提交记录？(dreamina 那边的任务仍会继续)")) return;
    await deleteSubmission(s.id);
    await load();
  }

  const queueStats = useMemo(() => {
    const queued = subs.filter((s) => s.status === "queued" || s.status === "running").length;
    const ok = subs.filter((s) => s.status === "success").length;
    const fail = subs.filter((s) => s.status === "failed").length;
    return { queued, ok, fail };
  }, [subs]);

  if (!project) return null;

  return (
    <div className="relative">
      <div className="border-b border-vellum-border px-8 py-7 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-vellum-accent text-3xl font-medium uppercase">
            Submit
          </h1>
          <div className="text-[11px] text-vellum-muted mt-3 uppercase flex items-center gap-1">
            <span>{readyShots.length} ready</span>
            <Sep />
            <span>
              {queueStats.queued} <span className="text-vellum-faint">in queue</span>
            </span>
            <Sep />
            <span className="text-vellum-success">{queueStats.ok} ok</span>
            <Sep />
            <span className={queueStats.fail ? "text-red-400" : "text-vellum-faint"}>
              {queueStats.fail} failed
            </span>
            <Sep />
            <span className="text-vellum-faint">
              dreamina · {opts.model_version}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleRefreshAll()}
            disabled={queueStats.queued === 0}
            title="poll dreamina for status on all pending submissions"
            className="px-3 py-1.5 rounded text-xs text-vellum-muted hover:text-vellum-text hover:bg-vellum-elevated disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5 transition"
          >
            <RefreshCw size={11} /> Refresh status
          </button>
          <button
            onClick={() => void handleSubmitAll()}
            disabled={readyShots.length === 0}
            className="px-4 py-1.5 rounded text-xs bg-vellum-accent hover:bg-vellum-accent-hover text-vellum-bg font-bold disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5 transition"
          >
            <Send size={11} /> Submit all
          </button>
        </div>
      </div>

      <div className="p-8 space-y-5">
        {error && (
          <div className="border border-red-900/60 bg-red-950/20 text-red-300 rounded p-3 text-xs flex items-start gap-2">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <div className="font-mono break-all whitespace-pre-wrap">{error}</div>
          </div>
        )}

        <SubmitOptions opts={opts} setOpts={setOpts} />

        {readyShots.length === 0 ? (
          <div className="border border-dashed border-vellum-border rounded p-12 text-center">
            <div className="text-sm text-vellum-muted">
              没有可提交的镜头
            </div>
            <div className="text-[11px] text-vellum-faint mt-2">
              去 Shots 里把镜头跑到 Final（enhanced_prompt 非空）之后回来
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {readyShots.map((shot) => (
              <ShotRow
                key={shot.id}
                shot={shot}
                sub={latestSubByShot.get(shot.id)}
                busy={busyIds.has(shot.id)}
                onSubmit={() => void handleSubmitOne(shot)}
                onRefresh={(s) => void handleRefreshOne(s)}
                onDelete={(s) => void handleDeleteSubmission(s)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Per-shot row ──────────────────────────────────────────────────

function ShotRow({
  shot,
  sub,
  busy,
  onSubmit,
  onRefresh,
  onDelete,
}: {
  shot: Shot;
  sub: Submission | undefined;
  busy: boolean;
  onSubmit: () => void;
  onRefresh: (s: Submission) => void;
  onDelete: (s: Submission) => void;
}) {
  const refImages = useApp((s) => s.refImages);
  const text = shot.enhanced_prompt.trim();
  const preview = text.slice(0, 160) + (text.length > 160 ? "…" : "");

  // Detect (图N) and orphans for UI feedback
  const usedIndices = useMemo(() => {
    const re = /\(图\s*(\d+)\)/g;
    const out: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const n = Number(m[1]);
      if (!out.includes(n)) out.push(n);
    }
    return out;
  }, [text]);
  const orphans = useMemo(
    () => findOrphanImageRefs(text, refImages),
    [text, refImages]
  );

  const status = sub?.status ?? "未提交";
  const submitId = sub ? getSubmitIdFromRow(sub) : null;

  return (
    <div className="border border-vellum-border bg-vellum-card rounded-lg p-4 flex gap-4 items-start">
      <div className="text-vellum-accent shrink-0 w-12 text-center pt-1">
        <div className="text-[10px] uppercase text-vellum-faint">shot</div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontWeight: 700,
            fontSize: "28px",
            lineHeight: 1,
          }}
        >
          {shot.shot_number}
        </div>
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        <div className="text-[13px] text-vellum-text leading-relaxed whitespace-pre-wrap break-words">
          {preview || (
            <span className="text-vellum-dim italic">empty enhanced_prompt</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          {usedIndices.map((n) => {
            const ref = refImages.find((r) => r.image_index === n);
            const isOrphan = orphans.includes(n);
            return (
              <span
                key={n}
                className={cn(
                  "px-1.5 py-0.5 rounded font-mono",
                  isOrphan
                    ? "bg-red-950/40 text-red-300 border border-red-900/50"
                    : "bg-vellum-elevated text-vellum-muted"
                )}
                title={ref?.file_path}
              >
                图{n}
                {isOrphan && " ✗"}
              </span>
            );
          })}
          {usedIndices.length === 0 && (
            <span className="text-vellum-faint">无 (图N) 引用</span>
          )}
        </div>
      </div>

      <div className="shrink-0 w-56 flex flex-col items-end gap-1.5">
        <StatusPill status={status} />
        {submitId && (
          <div
            className="text-[10px] text-vellum-faint font-mono truncate max-w-full"
            title={submitId}
          >
            id: {submitId.slice(0, 12)}…
          </div>
        )}
        {sub?.error && (
          <div className="text-[10px] text-red-400 font-mono break-all line-clamp-2">
            {sub.error}
          </div>
        )}
        {sub?.video_path && (
          <a
            href={sub.video_path}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-vellum-accent hover:underline flex items-center gap-1"
          >
            <ExternalLink size={10} /> open video
          </a>
        )}
        <div className="flex items-center gap-1 mt-1">
          {sub && (sub.status === "queued" || sub.status === "running") && (
            <button
              onClick={() => onRefresh(sub)}
              title="poll dreamina"
              className="px-2 py-1 rounded text-[10px] text-vellum-muted hover:text-vellum-text hover:bg-vellum-elevated transition flex items-center gap-1"
            >
              <RefreshCw size={10} /> Refresh
            </button>
          )}
          {sub && (
            <button
              onClick={() => onDelete(sub)}
              title="forget this submission"
              className="w-7 h-6 flex items-center justify-center rounded text-vellum-faint hover:text-red-400 hover:bg-vellum-elevated transition"
            >
              <Trash2 size={10} />
            </button>
          )}
          <button
            onClick={onSubmit}
            disabled={busy || orphans.length > 0}
            className="px-3 py-1 rounded text-[11px] bg-vellum-accent hover:bg-vellum-accent-hover text-vellum-bg font-bold disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5 transition"
          >
            {busy ? (
              <>
                <Loader size={11} className="animate-spin" /> Submitting
              </>
            ) : (
              <>
                <Send size={11} /> {sub && sub.status === "failed" ? "Retry" : "Submit"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<
    string,
    { icon: React.ReactNode; cls: string; label: string }
  > = {
    success: {
      icon: <CheckCircle size={10} />,
      cls: "bg-emerald-950/40 text-emerald-300 border-emerald-900/50",
      label: "success",
    },
    failed: {
      icon: <XCircle size={10} />,
      cls: "bg-red-950/40 text-red-300 border-red-900/50",
      label: "failed",
    },
    running: {
      icon: <Loader size={10} className="animate-spin" />,
      cls: "bg-vellum-elevated text-vellum-text border-vellum-border-strong",
      label: "running",
    },
    queued: {
      icon: <Clock size={10} />,
      cls: "bg-vellum-elevated text-vellum-muted border-vellum-border",
      label: "queued",
    },
  };
  const cfg = map[status] ?? {
    icon: <Clock size={10} />,
    cls: "bg-vellum-elevated text-vellum-faint border-vellum-border",
    label: status,
  };
  return (
    <div
      className={cn(
        "px-2 py-1 rounded-full border text-[10px] uppercase flex items-center gap-1.5",
        cfg.cls
      )}
    >
      {cfg.icon} {cfg.label}
    </div>
  );
}

// ─── Options bar (model / duration / ratio / resolution) ────────────

function SubmitOptions({
  opts,
  setOpts,
}: {
  opts: Opts;
  setOpts: (o: Opts) => void;
}) {
  return (
    <div className="border border-vellum-border bg-vellum-card rounded p-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px]">
      <OptSelect
        label="Model"
        value={opts.model_version}
        options={[
          ["seedance2.0_vip", "v2.0 vip · 1080p capable"],
          ["seedance2.0fast_vip", "v2.0 fast vip"],
          ["seedance2.0", "v2.0 · 720p"],
          ["seedance2.0fast", "v2.0 fast · 720p"],
        ]}
        onChange={(v) => setOpts({ ...opts, model_version: v as DreaminaModel })}
      />
      <OptSelect
        label="Ratio"
        value={opts.ratio}
        options={[
          ["16:9", "16:9 横屏"],
          ["9:16", "9:16 竖屏"],
          ["1:1", "1:1 方形"],
          ["3:4", "3:4"],
          ["4:3", "4:3"],
          ["21:9", "21:9 宽屏"],
        ]}
        onChange={(v) => setOpts({ ...opts, ratio: v as DreaminaRatio })}
      />
      <OptSelect
        label="Resolution"
        value={opts.video_resolution}
        options={[
          ["1080p", "1080p (vip 模型有效)"],
          ["720p", "720p"],
        ]}
        onChange={(v) =>
          setOpts({ ...opts, video_resolution: v as DreaminaResolution })
        }
      />
      <OptNumber
        label="Duration"
        value={opts.duration}
        min={4}
        max={15}
        suffix="s"
        onChange={(v) => setOpts({ ...opts, duration: v })}
      />
    </div>
  );
}

function OptSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-vellum-faint uppercase text-[10px]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-vellum-elevated border border-vellum-border rounded px-2 py-1 text-vellum-text text-[11px] focus:border-vellum-border-strong outline-none"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function OptNumber({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-vellum-faint uppercase text-[10px]">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
        className="w-16 bg-vellum-elevated border border-vellum-border rounded px-2 py-1 text-vellum-text text-[11px] focus:border-vellum-border-strong outline-none"
      />
      {suffix && (
        <span className="text-vellum-faint text-[10px]">{suffix}</span>
      )}
    </label>
  );
}

function Sep() {
  return <span className="mx-4 text-vellum-dim">·</span>;
}
