import { useCallback, useEffect, useState } from "react";
import {
  Sparkles,
  AlertCircle,
  ChevronRight,
  Copy,
  Check,
  ArrowDown,
} from "lucide-react";
import { useApp } from "@/lib/store";
import {
  optimizeDraftToFirstPass,
  finalizeFirstPassToFinal,
  buildSubmitPayload,
  stripOrphanImageRefs,
} from "@/lib/claude";
import {
  STYLE_PRESETS,
  matchStylePreset,
  type StylePreset,
} from "@/lib/stylePresets";
import { cn } from "@/lib/utils";
import { RichTextarea } from "./editor/RichTextarea";

type Stage = 1 | 2 | 3;

export function ShotsView() {
  const project = useApp((s) => s.currentProject);
  const patchProject = useApp((s) => s.patchCurrentProject);
  const refImages = useApp((s) => s.refImages);
  const currentStyle = project?.style_prompt ?? "";
  const activePreset = matchStylePreset(currentStyle);

  // Local working state mirrors project fields, persisted on blur
  const [draft, setDraft] = useState("");
  const [firstPass, setFirstPass] = useState("");
  const [finalPass, setFinalPass] = useState("");

  const [optimizing, setOptimizing] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Elapsed timers
  const [optimizeElapsed, setOptimizeElapsed] = useState(0);
  const [finalizeElapsed, setFinalizeElapsed] = useState(0);

  useEffect(() => {
    if (!optimizing) {
      setOptimizeElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(
      () => setOptimizeElapsed(Math.floor((Date.now() - start) / 1000)),
      250
    );
    return () => clearInterval(id);
  }, [optimizing]);

  useEffect(() => {
    if (!finalizing) {
      setFinalizeElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(
      () => setFinalizeElapsed(Math.floor((Date.now() - start) / 1000)),
      250
    );
    return () => clearInterval(id);
  }, [finalizing]);

  // Load project's saved text into local state on project change
  useEffect(() => {
    if (!project) return;
    setDraft(project.draft_text ?? "");
    setFirstPass(project.first_pass_text ?? "");
    setFinalPass(project.final_pass_text ?? "");
  }, [project?.id]);

  // Persist helpers
  const persist = useCallback(
    async (
      patch: Partial<{
        draft_text: string;
        first_pass_text: string;
        final_pass_text: string;
      }>
    ) => {
      try {
        await patchProject(patch);
      } catch (e) {
        console.error("[ShotsView] persist failed:", e);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [patchProject]
  );

  async function handleOptimize() {
    if (!draft.trim()) return;
    setOptimizing(true);
    setError(null);
    try {
      const result = await optimizeDraftToFirstPass(draft.trim());
      setFirstPass(result);
      await persist({ draft_text: draft, first_pass_text: result });
    } catch (e) {
      console.error("[ShotsView] optimize failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOptimizing(false);
    }
  }

  async function handleFinalize() {
    if (!firstPass.trim()) return;
    setFinalizing(true);
    setError(null);
    try {
      const result = await finalizeFirstPassToFinal(
        firstPass.trim(),
        refImages,
        currentStyle
      );
      setFinalPass(result);
      await persist({ first_pass_text: firstPass, final_pass_text: result });
    } catch (e) {
      console.error("[ShotsView] finalize failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFinalizing(false);
    }
  }

  async function applyPreset(preset: StylePreset, alsoFinalize: boolean) {
    setError(null);
    try {
      await patchProject({ style_prompt: preset.prompt });
      if (alsoFinalize && firstPass.trim()) {
        // small delay so persist resolves before re-reading style
        await new Promise((r) => setTimeout(r, 50));
        await handleFinalize();
      }
    } catch (e) {
      console.error("[ShotsView] applyPreset failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function clearPreset() {
    setError(null);
    try {
      await patchProject({ style_prompt: "" });
    } catch (e) {
      console.error("[ShotsView] clearPreset failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Compute stage completion
  const stage1Done = draft.trim().length > 0;
  const stage2Done = firstPass.trim().length > 0;
  const stage3Done = finalPass.trim().length > 0;

  return (
    <div>
      <div className="border-b border-vellum-border px-8 py-7 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-vellum-accent text-3xl font-medium tracking-[0.18em] uppercase">
            Shots
          </h1>
          <div className="text-[11px] text-vellum-muted mt-3 uppercase tracking-wider flex items-center gap-1">
            <StageDot done={stage1Done} active={!stage1Done} />
            <span>draft</span>
            <Sep />
            <StageDot done={stage2Done} active={stage1Done && !stage2Done} />
            <span>first pass</span>
            <Sep />
            <StageDot done={stage3Done} active={stage2Done && !stage3Done} />
            <span>final</span>
            <Sep />
            <span>{refImages.length} ref imgs available</span>
          </div>
        </div>
      </div>

      <div className="p-8 space-y-6">
        {error && (
          <div className="border border-red-900/60 bg-red-950/20 text-red-300 rounded p-3 text-xs flex items-start gap-2">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <div className="font-mono break-all">{error}</div>
          </div>
        )}

        {/* STAGE 1: Rough draft */}
        <Stage
          n={1}
          title="Rough Draft"
          subtitle="一段自然语言粗稿 · 笼统描述就行"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void persist({ draft_text: draft })}
            placeholder={`粘贴你的粗稿，例如：\n\n激斗（分镜）10秒\n先是平视侧面近景镜头，少年和武士拔刀相互格挡...`}
            rows={6}
            className="w-full bg-vellum-bg border border-vellum-border rounded px-3.5 py-3 text-[13px] leading-relaxed text-vellum-text placeholder:text-vellum-dim font-mono focus:border-vellum-accent-border transition resize-y outline-none"
          />
          <StageAction
            label="Optimize → 生成第一版"
            shortLabel="Optimize"
            running={optimizing}
            runningLabel={`Optimizing… ${optimizeElapsed}s`}
            disabled={!draft.trim()}
            onClick={() => void handleOptimize()}
            hint={optimizing ? "Claude Sonnet 拆+细化中" : "细化每个镜头，加物理反应/动作/相机"}
          />
        </Stage>

        <Arrow active={stage1Done} />

        {/* STAGE 2: First pass + bindings */}
        <Stage
          n={2}
          title="First Pass · 第一版分镜"
          subtitle="编辑器：用 @ 给角色/场景/道具绑图，留给下一步用"
        >
          <div className="text-[10px] text-vellum-faint flex items-center gap-3">
            <span>提示：</span>
            <span>
              在 主角 / 场景 / 道具 后面打{" "}
              <kbd className="px-1 py-0.5 bg-vellum-elevated rounded text-vellum-accent font-bold">@</kbd>{" "}
              → 弹出图片选择器 → popup 顶会显示「绑定」横条
            </span>
          </div>
          <RichTextarea
            value={firstPass}
            onChange={setFirstPass}
            minRows={10}
            placeholder="点 Optimize 自动生成，或自己粘贴已有第一版分镜"
          />

          {/* Style preset row — clicking a preset writes to project.style_prompt
              and (optionally) auto-triggers Finalize with the new style */}
          <div className="border border-vellum-border rounded p-3 bg-vellum-bg/40 space-y-2">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-vellum-faint">
              <span>Style preset</span>
              {activePreset ? (
                <span className="text-vellum-accent normal-case tracking-normal text-[11px] font-bold">
                  · {activePreset.label} · {activePreset.subtitle}
                </span>
              ) : currentStyle.trim() ? (
                <span className="text-vellum-muted normal-case tracking-normal text-[11px]">
                  · custom ({currentStyle.length} 字)
                </span>
              ) : (
                <span className="text-vellum-dim normal-case tracking-normal text-[11px]">
                  · 未设置，将用 Pass 2 默认风格段
                </span>
              )}
              {activePreset || currentStyle.trim() ? (
                <button
                  onClick={() => void clearPreset()}
                  disabled={finalizing}
                  className="ml-auto text-[10px] text-vellum-faint hover:text-vellum-text transition normal-case tracking-normal disabled:opacity-40"
                >
                  clear
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {STYLE_PRESETS.map((p) => {
                const isActive = activePreset?.id === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => void applyPreset(p, !!firstPass.trim())}
                    disabled={finalizing}
                    title={`${p.scenarios}\n\n点击：套用并立即 Finalize（如有第一版）`}
                    className={cn(
                      "text-left p-2.5 rounded border transition group",
                      isActive
                        ? "border-vellum-accent bg-vellum-accent-soft"
                        : "border-vellum-border bg-vellum-card hover:border-vellum-border-strong",
                      finalizing && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div
                      className={cn(
                        "text-[12px] font-bold tracking-wider mb-0.5",
                        isActive ? "text-vellum-accent" : "text-vellum-text"
                      )}
                    >
                      {p.label}
                    </div>
                    <div className="text-[10px] text-vellum-faint leading-snug">
                      {p.subtitle}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void persist({ first_pass_text: firstPass })}
              className="px-3 py-1.5 rounded text-[11px] text-vellum-muted hover:text-vellum-text hover:bg-vellum-elevated flex items-center gap-1.5 transition"
              title="save edits to project"
            >
              <Check size={11} /> Save edits
            </button>
            <StageAction
              label="Finalize → 最终强化"
              shortLabel="Finalize"
              running={finalizing}
              runningLabel={`Finalizing… ${finalizeElapsed}s`}
              disabled={!firstPass.trim()}
              onClick={() => void handleFinalize()}
              hint={
                finalizing
                  ? "Claude 视觉理解 + 套当前风格预设 + 1800 字内"
                  : activePreset
                  ? `当前 style: ${activePreset.label} · 点击或选预设按钮一键套用`
                  : `当前 style: 默认（无预设）· 选 A/B 预设可一键套用`
              }
            />
          </div>
        </Stage>

        <Arrow active={stage2Done} />

        {/* STAGE 3: Final + submit */}
        <Stage
          n={3}
          title="Final · 即梦 CLI 可吃格式"
          subtitle="自动扫 (图N) 绑定 → 拼 人物=图片1 / 场景=图片2 → 全文"
        >
          <FinalStageContent
            finalPass={finalPass}
            setFinalPass={(v) => {
              setFinalPass(v);
              void persist({ final_pass_text: v });
            }}
            refImages={refImages}
          />
        </Stage>
      </div>
    </div>
  );
}

function Stage({
  n,
  title,
  subtitle,
  children,
}: {
  n: Stage;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-vellum-border rounded bg-vellum-card overflow-hidden">
      <div className="px-5 py-3 border-b border-vellum-border flex items-center gap-2">
        <div className="w-5 h-5 rounded-full bg-vellum-accent-soft border border-vellum-accent-border text-vellum-accent text-[10px] font-bold flex items-center justify-center">
          {n}
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-vellum-faint">
          stage {n}
        </div>
        <div className="text-[12px] text-vellum-text font-semibold">{title}</div>
        <div className="text-[10px] text-vellum-faint ml-auto">{subtitle}</div>
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </section>
  );
}

function StageAction({
  label,
  shortLabel: _shortLabel,
  running,
  runningLabel,
  disabled,
  onClick,
  hint,
}: {
  label: string;
  shortLabel: string;
  running: boolean;
  runningLabel: string;
  disabled: boolean;
  onClick: () => void;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onClick}
        disabled={disabled || running}
        className="px-4 py-2 rounded text-[12px] bg-vellum-accent hover:bg-vellum-accent-hover text-black font-bold flex items-center gap-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Sparkles size={12} className={running ? "animate-spin" : ""} />
        {running ? runningLabel : label}
        {!running && <ChevronRight size={12} />}
      </button>
      <span className="text-[11px] text-vellum-faint">{hint}</span>
    </div>
  );
}

function FinalStageContent({
  finalPass,
  setFinalPass,
  refImages,
}: {
  finalPass: string;
  setFinalPass: (v: string) => void;
  refImages: import("@/lib/types").RefImage[];
}) {
  const payload = buildSubmitPayload(finalPass, refImages);
  const [copied, setCopied] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  const fullOutput =
    payload.header.length > 0
      ? `${payload.header}\n\n${payload.body}`
      : payload.body;

  function handleCopyAll() {
    void navigator.clipboard.writeText(fullOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleSubmit() {
    setSubmitMsg(
      "即梦 CLI 接入未完成（等用户给 --help 输出）。当前已生成可粘贴格式 → 你可以 Copy all 后手动用。"
    );
  }

  function handleStripOrphans() {
    const cleaned = stripOrphanImageRefs(finalPass, refImages);
    setFinalPass(cleaned);
  }

  return (
    <>
      {/* C1: orphan (图N) warning — references in final text that no longer
          have a matching ref image (deleted / renumbered) */}
      {payload.orphanIndices.length > 0 && (
        <div className="border border-red-900/60 bg-red-950/20 rounded p-3 text-xs">
          <div className="text-red-300 font-bold mb-1.5 flex items-center gap-1.5">
            <AlertCircle size={13} /> 检测到 {payload.orphanIndices.length} 个野引用
          </div>
          <div className="text-red-300 mb-2">
            正文里有{" "}
            {payload.orphanIndices.map((n) => `(图${n})`).join("、")}{" "}
            ，但 Library 已经没有对应图。提交即梦时这些 (图N) 没文件附件，AI 会瞎编。
          </div>
          <button
            onClick={handleStripOrphans}
            className="px-2.5 py-1 rounded text-[11px] bg-red-900/40 hover:bg-red-900/70 text-red-200 font-bold transition"
          >
            一键 strip 野引用文本
          </button>
        </div>
      )}

      {/* Bindings header preview */}
      {payload.header && (
        <div className="border border-vellum-accent-border bg-vellum-accent-soft/40 rounded p-3 font-mono text-[12px] text-vellum-accent leading-relaxed">
          {payload.header.split("\n").map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
      {!payload.header && finalPass.trim() && payload.orphanIndices.length === 0 && (
        <div className="text-[11px] text-vellum-faint">
          没有检测到 (图N) 引用 · 回上一阶段加图绑定再 Finalize 一次能拿到完整 header
        </div>
      )}

      <RichTextarea
        value={finalPass}
        onChange={setFinalPass}
        minRows={12}
        placeholder="Finalize 后这里会有最终强化稿"
      />

      <div className="flex items-center gap-2">
        <button
          onClick={handleCopyAll}
          disabled={!finalPass.trim()}
          className="px-3 py-1.5 rounded text-[11px] bg-vellum-elevated hover:bg-vellum-card-hi text-vellum-text flex items-center gap-1.5 transition disabled:opacity-40"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied all" : "Copy header + body"}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!finalPass.trim()}
          className="px-3 py-1.5 rounded text-[11px] bg-vellum-accent hover:bg-vellum-accent-hover text-black font-bold flex items-center gap-1.5 transition disabled:opacity-40"
          title="即梦 CLI 接入待实现"
        >
          <ChevronRight size={11} />
          Submit → 即梦 CLI
        </button>
        <span className="text-[10px] text-vellum-faint">Seedance 1080p VIP 批处理</span>
      </div>

      {submitMsg && (
        <div className="text-[11px] text-vellum-warning bg-vellum-elevated rounded p-2.5">
          {submitMsg}
        </div>
      )}
    </>
  );
}

function StageDot({ done, active }: { done: boolean; active: boolean }) {
  return (
    <div
      className={cn(
        "w-1.5 h-1.5 rounded-full",
        done
          ? "bg-vellum-accent"
          : active
          ? "bg-vellum-warning animate-pulse"
          : "bg-vellum-dim"
      )}
    />
  );
}

function Arrow({ active }: { active: boolean }) {
  return (
    <div className="flex justify-center">
      <ArrowDown
        size={16}
        className={cn(
          "transition-colors",
          active ? "text-vellum-accent" : "text-vellum-dim"
        )}
      />
    </div>
  );
}

function Sep() {
  return <span className="mx-2 text-vellum-dim">·</span>;
}
