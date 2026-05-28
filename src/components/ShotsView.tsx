import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  AlertCircle,
  ChevronRight,
  Copy,
  Check,
  ArrowDown,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import { useApp } from "@/lib/store";
import type { PromptEntry } from "@/lib/types";
import {
  optimizeDraftToFirstPass,
  finalizeFirstPassToFinal,
  getPromptBackendLabel,
  buildSubmitPayload,
  stripOrphanImageRefs,
} from "@/lib/claude";
import {
  createPromptEntry,
  createSubmission,
  deletePromptEntry,
  ensureShot,
  listPromptEntries,
  updatePromptEntry,
  updateShot,
} from "@/lib/db";
import { submitMultimodal2Video, type DreaminaRatio } from "@/lib/dreamina";
import { DIRECTOR_RULE_VERSION } from "@/lib/directorRules";
import {
  STYLE_PRESETS,
  matchStylePreset,
  type StylePreset,
} from "@/lib/stylePresets";
import { cn } from "@/lib/utils";
import { RichTextarea } from "./editor/RichTextarea";
import { ContextMenu } from "./ContextMenu";
import { RenameDialog } from "./RenameDialog";

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
  const [promptEntries, setPromptEntries] = useState<PromptEntry[]>([]);
  const [activeEntryId, setActiveEntryId] = useState<number | null>(null);
  const [renameTarget, setRenameTarget] = useState<PromptEntry | null>(null);

  const [optimizing, setOptimizing] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendLabel, setBackendLabel] = useState("Prompt engine");

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

  useEffect(() => {
    void refreshBackendLabel();
  }, []);

  async function refreshBackendLabel() {
    try {
      setBackendLabel(await getPromptBackendLabel());
    } catch {
      setBackendLabel("Prompt engine");
    }
  }

  const activeEntry =
    promptEntries.find((entry) => entry.id === activeEntryId) ??
    promptEntries[0] ??
    null;
  const activeEntryTitle = getPromptSegmentTitle(activeEntry);
  const activeEntryNumber = activeEntry?.entry_number ?? 1;

  function applyEntryToEditors(entry: PromptEntry) {
    setActiveEntryId(entry.id);
    setDraft(entry.draft_text ?? "");
    setFirstPass(entry.first_pass_text ?? "");
    setFinalPass(entry.final_pass_text ?? "");
  }

  async function mirrorEntryToProject(entry: PromptEntry) {
    await patchProject({
      draft_text: entry.draft_text ?? "",
      first_pass_text: entry.first_pass_text ?? "",
      final_pass_text: entry.final_pass_text ?? "",
    });
  }

  // Load prompt segment entries into local state on project change.
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void (async () => {
      try {
        const entries = await listPromptEntries(project.id);
        if (cancelled) return;
        setPromptEntries(entries);
        const selected =
          entries.find((entry) => entry.id === activeEntryId) ?? entries[0];
        if (selected) {
          applyEntryToEditors(selected);
          await mirrorEntryToProject(selected);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("[ShotsView] load prompt entries failed:", e);
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        if (activeEntry) {
          await updatePromptEntry(activeEntry.id, patch);
          const updated = {
            ...activeEntry,
            ...patch,
            updated_at: Math.floor(Date.now() / 1000),
          };
          setPromptEntries((entries) =>
            entries.map((entry) => (entry.id === activeEntry.id ? updated : entry))
          );
        }
        await patchProject(patch);
      } catch (e) {
        console.error("[ShotsView] persist failed:", e);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [activeEntry, patchProject]
  );

  async function handleSelectEntry(entry: PromptEntry) {
    if (optimizing || finalizing) return;
    applyEntryToEditors(entry);
    await mirrorEntryToProject(entry);
  }

  async function handleAddEntry() {
    if (!project || optimizing || finalizing) return;
    setError(null);
    try {
      const entry = await createPromptEntry(project.id);
      setPromptEntries((entries) => [...entries, entry]);
      applyEntryToEditors(entry);
      await mirrorEntryToProject(entry);
    } catch (e) {
      console.error("[ShotsView] create prompt entry failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRenameEntry(entry: PromptEntry, next: string) {
    if (optimizing || finalizing) return;
    const current = getPromptSegmentTitle(entry);
    if (!next || next === current) return;
    await updatePromptEntry(entry.id, { title: next });
    setPromptEntries((entries) =>
      entries.map((item) =>
        item.id === entry.id
          ? {
              ...item,
              title: next,
              updated_at: Math.floor(Date.now() / 1000),
            }
          : item
      )
    );
  }

  async function handleDeleteEntry(entry: PromptEntry) {
    if (optimizing || finalizing || promptEntries.length <= 1) return;
    const ok = confirm(`删除「${getPromptSegmentTitle(entry)}」？`);
    if (!ok) return;
    try {
      await deletePromptEntry(entry.id);
      const remaining = promptEntries.filter((item) => item.id !== entry.id);
      setPromptEntries(remaining);
      if (entry.id === activeEntryId) {
        const fallback =
          remaining.find((item) => item.entry_number > entry.entry_number) ??
          remaining[remaining.length - 1];
        if (fallback) {
          applyEntryToEditors(fallback);
          await mirrorEntryToProject(fallback);
        }
      }
    } catch (e) {
      console.error("[ShotsView] delete prompt entry failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleOptimize() {
    if (!draft.trim()) return;
    setOptimizing(true);
    setError(null);
    try {
      await refreshBackendLabel();
      const result = await optimizeDraftToFirstPass(draft.trim(), refImages);
      setFirstPass(result);
      await persist({ draft_text: draft, first_pass_text: result });
    } catch (e) {
      console.error("[ShotsView] optimize failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOptimizing(false);
    }
  }

  async function handleFinalize(styleOverride?: string) {
    if (!firstPass.trim()) return;
    setFinalizing(true);
    setError(null);
    try {
      await refreshBackendLabel();
      const result = await finalizeFirstPassToFinal(
        firstPass.trim(),
        refImages,
        styleOverride ?? currentStyle
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
        await handleFinalize(preset.prompt);
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
      <div className="px-8 py-7 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-vellum-accent text-3xl font-medium uppercase">
            Shots
          </h1>
          <div className="text-[11px] text-vellum-muted mt-3 uppercase flex items-center gap-1">
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
            <Sep />
            <span>{backendLabel}</span>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] text-vellum-muted">
            <WorkflowPill n={1} title="导演拆镜" detail="景别 / 运镜 / 角度 / 朝向" />
            <WorkflowArrow />
            <WorkflowPill n={2} title="图像锚定" detail="角色 / 场景 / 道具" />
            <WorkflowArrow />
            <WorkflowPill n={3} title="成片厚写" detail="服化道 / 场景 / 动作 / 真人" />
            <span
              className="ml-1 h-8 px-3 rounded bg-vellum-elevated/70 text-vellum-faint inline-flex items-center"
              title={DIRECTOR_RULE_VERSION}
            >
              内置导演规则已启用
            </span>
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
          title="Director Cut · 导演拆镜"
          subtitle={`当前：${activeEntryTitle} · 粗稿`}
        >
          <div className="text-[10px] text-vellum-faint flex items-center gap-3">
            <span>提示：</span>
            <span>
              写 主角 / 背景 / 场景 / 道具 后面打{" "}
              <kbd className="px-1 py-0.5 bg-vellum-elevated rounded text-vellum-accent font-bold">@</kbd>{" "}
              选择图片；背景图会在第一版拆镜时作为空间锚点保留
            </span>
          </div>
          <PromptCatalogTabs
            entries={promptEntries}
            activeEntryId={activeEntryId}
            disabled={optimizing || finalizing}
            onSelect={(entry) => void handleSelectEntry(entry)}
            onAdd={() => void handleAddEntry()}
            onRename={(entry) => setRenameTarget(entry)}
            onDelete={(entry) => void handleDeleteEntry(entry)}
          />
          <RichTextarea
            value={draft}
            onChange={setDraft}
            onClear={() => {
              setDraft("");
              void persist({ draft_text: "" });
            }}
            onBlur={() => void persist({ draft_text: draft })}
            placeholder={`粘贴你的粗稿，例如：\n\n激斗（分镜）10秒\n主角@ 在背景@ 里被昆虫武士追杀，先是平视侧面近景镜头，少年和武士拔刀相互格挡...`}
            minRows={6}
          />
          <StageAction
            label="Optimize → 导演拆镜"
            shortLabel="Optimize"
            running={optimizing}
            runningLabel={`Optimizing… ${optimizeElapsed}s`}
            disabled={!draft.trim()}
            onClick={() => void handleOptimize()}
            hint={
              optimizing
                ? `${backendLabel} 正在编排镜头轴线和动作节奏`
                : "把笼统动作拆成景别 / 运镜 / 角度 / 朝向明确的镜头"
            }
          />
        </Stage>

        <Arrow active={stage1Done} />

        {/* STAGE 2: First pass + bindings */}
        <Stage
          n={2}
          title="Image Anchors · 图像锚定"
          subtitle={`当前：${activeEntryTitle} · 第一版`}
        >
          <div className="text-[10px] text-vellum-faint flex items-center gap-3">
            <span>提示：</span>
            <span>
              在 主角 / 场景 / 道具 后面打{" "}
              <kbd className="px-1 py-0.5 bg-vellum-elevated rounded text-vellum-accent font-bold">@</kbd>{" "}
              → 绑定图片作为角色 / 场景 / 道具锚点
            </span>
          </div>
          <RichTextarea
            value={firstPass}
            onChange={setFirstPass}
            onClear={() => {
              setFirstPass("");
              void persist({ first_pass_text: "" });
            }}
            minRows={10}
            placeholder="点 Optimize 自动生成，或自己粘贴已有第一版分镜"
          />

          <ShotFrameControls
            text={firstPass}
            disabled={optimizing || finalizing}
            onChange={(next) => {
              setFirstPass(next);
              void persist({ first_pass_text: next });
            }}
          />

          {/* Style preset row — clicking a preset writes to project.style_prompt
              and (optionally) auto-triggers Finalize with the new style */}
          <div className="border border-vellum-border rounded p-3 bg-vellum-bg/40 space-y-2">
            <div className="flex items-center gap-2 text-[10px] uppercase text-vellum-faint">
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
            <div className="grid grid-cols-4 gap-2">
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
                        "text-[12px] font-bold mb-0.5",
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
                  ? `${backendLabel} 视觉理解 + 高密度服化道/场景/动态效果`
                  : activePreset
                  ? `当前 style: ${activePreset.label} · 厚写服化道 / 场景 / 动作 / 运镜`
                  : `当前 style: 默认 · Finalize 会厚写服化道 / 场景 / 动作 / 运镜`
              }
            />
          </div>
        </Stage>

        <Arrow active={stage2Done} />

        {/* STAGE 3: Final + submit */}
        <Stage
          n={3}
          title="Final · 成片厚写"
          subtitle={`当前：${activeEntryTitle} · 最终提交`}
        >
          <FinalStageContent
            finalPass={finalPass}
            setFinalPass={(v) => {
              setFinalPass(v);
              void persist({ final_pass_text: v });
            }}
            refImages={refImages}
            activeEntryNumber={activeEntryNumber}
            activeEntryTitle={activeEntryTitle}
          />
        </Stage>
      </div>
      {renameTarget && (
        <RenameDialog
          title="重命名提示词片段"
          initialValue={getPromptSegmentTitle(renameTarget)}
          placeholder="片段名称"
          onClose={() => setRenameTarget(null)}
          onSubmit={(next) => handleRenameEntry(renameTarget, next)}
        />
      )}
    </div>
  );
}

const SHOT_SIZE_OPTIONS = [
  "极远景",
  "远景",
  "全景",
  "中景",
  "中近景",
  "近景",
  "特写",
  "大特写",
  "微距特写",
] as const;

const BODY_CROP_OPTIONS = [
  "全身入镜",
  "膝盖以上",
  "腰部以上",
  "胸口以上",
  "肩部以上",
  "头部特写",
  "脸部特写",
  "眼部特写",
  "手部特写",
  "武器与手部局部",
  "背部肩胛位置",
] as const;

const CAMERA_ANGLE_OPTIONS = [
  "平视",
  "仰拍",
  "俯拍",
  "广角仰拍",
  "广角俯拍",
  "鸟瞰",
  "上帝视角",
  "荷兰式倾斜",
  "过肩",
  "低机位",
  "高机位",
] as const;

const CAMERA_MOVE_OPTIONS = [
  "高速推进",
  "快速推进",
  "缓慢推进",
  "撞击式推进",
  "爆发式拉远",
  "快速拉远",
  "跟拍",
  "过肩跟拍",
  "高速摇镜",
  "摇拍",
  "横移",
  "环绕",
  "手持晃动",
  "跟焦",
  "变焦",
  "一镜到底",
  "固定镜头",
] as const;

const SUBJECT_FACING_OPTIONS = [
  "正面",
  "背面",
  "侧面",
  "45度侧面",
  "正侧面对峙",
  "过肩背影",
  "俯看镜头",
  "仰看镜头",
  "背后追随",
] as const;

const MOOD_OPTIONS = [
  "高速动感与力量感",
  "冷酷压迫",
  "危险紧张",
  "史诗壮阔",
  "荒漠废土真人写实",
  "东方神怪",
  "暴烈混乱",
  "静默悬疑",
  "灾难级高空氛围",
] as const;

const ONE_TAKE_CONNECTOR_OPTIONS = [
  "沿起幅轴线推进到",
  "沿起幅轴线拉远到",
  "顺着人物运动跟拍到",
  "绕人物小幅环绕到",
  "从上半身下摇到",
  "从手部上摇到",
  "高速摇向",
  "横移到",
  "贴近到",
  "最后落到",
] as const;

const ONE_TAKE_AXIS_OPTIONS = [
  "保持起幅轴线",
  "沿人物运动方向",
  "小幅环绕不跳轴",
  "过肩轴线",
  "接触打击轴线",
  "正面过渡到45度侧面",
  "侧面过渡到背后",
  "由远景空间轴线进入局部动作轴线",
] as const;

type ShotMode = "single" | "oneTake";

type ShotParamKey =
  | "shotSize"
  | "bodyCrop"
  | "cameraAngle"
  | "cameraMove"
  | "subjectFacing"
  | "mood";

type ShotParams = Record<ShotParamKey, string>;

type ParsedShot = {
  index: number;
  start: number;
  end: number;
  text: string;
  params: ShotParams;
};

type OneTakeDraft = {
  opening: string;
  continuity: string;
  beats: OneTakeBeat[];
  ending: string;
};

type OneTakeBeat = {
  id: number;
  connector: string;
  shotSize: string;
  bodyCrop: string;
  cameraMove: string;
  cameraAngle: string;
  subjectFacing: string;
  axis: string;
  focus: string;
};

function createDefaultOneTakeDraft(): OneTakeDraft {
  return {
    opening: "从人物明确的身体部位和朝向起幅，先建立前景 / 中景 / 后景关系",
    continuity: "人物朝向与空间方位不能跳轴，动作必须能被真人站位复现",
    beats: [
      {
        id: 1,
        connector: "沿起幅轴线推进到",
        shotSize: "中景",
        bodyCrop: "腰部以上",
        cameraMove: "快速推进",
        cameraAngle: "平视",
        subjectFacing: "45度侧面",
        axis: "保持起幅轴线",
        focus: "人物动作爆点",
      },
      {
        id: 2,
        connector: "顺着人物运动跟拍到",
        shotSize: "近景",
        bodyCrop: "胸口以上",
        cameraMove: "跟拍",
        cameraAngle: "平视",
        subjectFacing: "侧面",
        axis: "沿人物运动方向",
        focus: "受力反应和空间位移",
      },
    ],
    ending: "落在新的视觉重点或动作爆点上，为下一个镜头留出明确方向",
  };
}

function ShotFrameControls({
  text,
  disabled,
  onChange,
}: {
  text: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const shots = useMemo(() => parseShotBlocks(text), [text]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [oneTakeDrafts, setOneTakeDrafts] = useState<Record<number, OneTakeDraft>>(
    {}
  );

  useEffect(() => {
    if (shots.length === 0) {
      setActiveIndex(null);
      return;
    }
    if (!shots.some((shot) => shot.index === activeIndex)) {
      setActiveIndex(shots[0].index);
    }
  }, [activeIndex, shots]);

  if (!text.trim()) return null;

  if (shots.length === 0) {
    return (
      <div className="rounded bg-vellum-elevated/45 px-3 py-2 text-[11px] text-vellum-faint">
        没检测到「镜头1，」这种格式。按镜头编号写出来后，这里会出现可调的镜头参数。
      </div>
    );
  }

  const activeShot =
    shots.find((shot) => shot.index === activeIndex) ?? shots[0];
  const oneTakeDraft =
    oneTakeDrafts[activeShot.index] ?? createDefaultOneTakeDraft();
  const shotMode: ShotMode = isOneTakeShot(activeShot) ? "oneTake" : "single";

  function updateParam(key: ShotParamKey, value: string) {
    const nextParams = {
      ...activeShot.params,
      [key]: value,
    };
    if (shotMode === "oneTake") {
      nextParams.cameraMove = "一镜到底";
    }
    const next = replaceShotText(text, activeShot, nextParams);
    onChange(next);
  }

  function setShotMode(nextMode: ShotMode) {
    if (nextMode === shotMode) return;
    if (nextMode === "oneTake") {
      const next = replaceShotText(
        text,
        activeShot,
        {
          ...activeShot.params,
          cameraMove: "一镜到底",
        },
        buildOneTakeBody(activeShot.text, oneTakeDraft)
      );
      onChange(next);
      return;
    }

    const next = replaceShotText(
      text,
      activeShot,
      {
        ...activeShot.params,
        cameraMove:
          activeShot.params.cameraMove === "一镜到底"
            ? "快速推进"
            : activeShot.params.cameraMove,
      },
      stripOneTakeScaffold(activeShot.text)
    );
    onChange(next);
  }

  function applyOneTake() {
    const next = replaceShotText(
      text,
      activeShot,
      {
        ...activeShot.params,
        cameraMove: "一镜到底",
      },
      buildOneTakeBody(activeShot.text, oneTakeDraft)
    );
    onChange(next);
  }

  function updateOneTakeDraft(
    key: "opening" | "continuity" | "ending",
    value: string
  ) {
    setOneTakeDrafts((drafts) => ({
      ...drafts,
      [activeShot.index]: {
        ...(drafts[activeShot.index] ?? createDefaultOneTakeDraft()),
        [key]: value,
      },
    }));
  }

  function updateOneTakeBeat(
    beatId: number,
    key: keyof OneTakeBeat,
    value: string
  ) {
    setOneTakeDrafts((drafts) => {
      const current = drafts[activeShot.index] ?? createDefaultOneTakeDraft();
      return {
        ...drafts,
        [activeShot.index]: {
          ...current,
          beats: current.beats.map((beat) =>
            beat.id === beatId ? { ...beat, [key]: value } : beat
          ),
        },
      };
    });
  }

  function addOneTakeBeat() {
    setOneTakeDrafts((drafts) => {
      const current = drafts[activeShot.index] ?? createDefaultOneTakeDraft();
      const maxId = Math.max(0, ...current.beats.map((beat) => beat.id));
      return {
        ...drafts,
        [activeShot.index]: {
          ...current,
          beats: [
            ...current.beats,
            {
              id: maxId + 1,
              connector: "从上半身下摇到",
              shotSize: "特写",
              bodyCrop: "手部特写",
              cameraMove: "下摇",
              cameraAngle: "平视",
              subjectFacing: "45度侧面",
              axis: "保持起幅轴线",
              focus: "关键道具或身体动作细节",
            },
          ],
        },
      };
    });
  }

  function removeOneTakeBeat(beatId: number) {
    setOneTakeDrafts((drafts) => {
      const current = drafts[activeShot.index] ?? createDefaultOneTakeDraft();
      return {
        ...drafts,
        [activeShot.index]: {
          ...current,
          beats: current.beats.filter((beat) => beat.id !== beatId),
        },
      };
    });
  }

  return (
    <div className="rounded bg-vellum-elevated/45 px-3 py-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-bold text-vellum-text">
          镜头参数控制台
        </div>
        <div className="text-[10px] text-vellum-faint">
          选中镜头后，用固定框架修：景别 / 裁切 / 角度 / 运镜 / 朝向 / mood
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {shots.map((shot) => (
            <button
              key={shot.index}
              type="button"
              disabled={disabled}
              onClick={() => setActiveIndex(shot.index)}
              className={cn(
                "h-7 px-2.5 rounded text-[10px] font-bold transition disabled:opacity-40",
                activeShot.index === shot.index
                  ? "bg-vellum-accent text-vellum-bg"
                  : "bg-vellum-bg text-vellum-muted hover:text-vellum-text"
              )}
            >
              镜头{shot.index}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-vellum-faint">结构模式</span>
        <div className="h-8 rounded bg-vellum-bg border border-vellum-border inline-flex items-center p-0.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setShotMode("single")}
            className={cn(
              "h-6 px-3 rounded text-[10px] font-bold transition disabled:opacity-40",
              shotMode === "single"
                ? "bg-vellum-accent text-vellum-bg"
                : "text-vellum-muted hover:text-vellum-text"
            )}
          >
            单个分镜头
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setShotMode("oneTake")}
            className={cn(
              "h-6 px-3 rounded text-[10px] font-bold transition disabled:opacity-40",
              shotMode === "oneTake"
                ? "bg-vellum-accent text-vellum-bg"
                : "text-vellum-muted hover:text-vellum-text"
            )}
          >
            一镜到底
          </button>
        </div>
        <span className="text-[10px] text-vellum-faint">
          {shotMode === "oneTake"
            ? "长镜头会生成连续调度节点"
            : "普通镜头只控制当前单段画面"}
        </span>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-6 gap-2">
        <ShotSelect
          label={shotMode === "oneTake" ? "起幅景别" : "景别"}
          value={activeShot.params.shotSize}
          options={SHOT_SIZE_OPTIONS}
          disabled={disabled}
          onChange={(value) => updateParam("shotSize", value)}
        />
        <ShotSelect
          label={shotMode === "oneTake" ? "起幅人物部位" : "人物部位"}
          value={activeShot.params.bodyCrop}
          options={BODY_CROP_OPTIONS}
          disabled={disabled}
          onChange={(value) => updateParam("bodyCrop", value)}
        />
        <ShotSelect
          label={shotMode === "oneTake" ? "起幅角度" : "镜头角度"}
          value={activeShot.params.cameraAngle}
          options={CAMERA_ANGLE_OPTIONS}
          disabled={disabled}
          onChange={(value) => updateParam("cameraAngle", value)}
        />
        {shotMode === "single" ? (
          <ShotSelect
            label="运镜"
            value={activeShot.params.cameraMove}
            options={CAMERA_MOVE_OPTIONS}
            disabled={disabled}
            onChange={(value) => updateParam("cameraMove", value)}
          />
        ) : (
          <div className="space-y-1">
            <span className="text-[9px] uppercase tracking-wide text-vellum-faint">
              结构运镜
            </span>
            <div className="h-8 rounded bg-vellum-bg border border-vellum-border px-2 text-[11px] text-vellum-muted inline-flex items-center w-full">
              一镜到底
            </div>
          </div>
        )}
        <ShotSelect
          label={shotMode === "oneTake" ? "起幅朝向" : "面对镜头"}
          value={activeShot.params.subjectFacing}
          options={SUBJECT_FACING_OPTIONS}
          disabled={disabled}
          onChange={(value) => updateParam("subjectFacing", value)}
        />
        <ShotSelect
          label="mood"
          value={activeShot.params.mood}
          options={MOOD_OPTIONS}
          disabled={disabled}
          onChange={(value) => updateParam("mood", value)}
        />
      </div>

      {shotMode === "oneTake" && (
        <div className="rounded bg-vellum-bg/70 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-bold text-vellum-text">
              一镜到底调度窗口
            </div>
            <div className="text-[10px] text-vellum-faint">
              不新增镜头编号；每一行都是同一段长镜头里的“紧接着镜头”
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <OneTakeInput
              label="起幅"
              value={oneTakeDraft.opening}
              disabled={disabled}
              onChange={(value) => updateOneTakeDraft("opening", value)}
            />
            <OneTakeInput
              label="连续性"
              value={oneTakeDraft.continuity}
              disabled={disabled}
              onChange={(value) => updateOneTakeDraft("continuity", value)}
            />
            <OneTakeInput
              label="落幅"
              value={oneTakeDraft.ending}
              disabled={disabled}
              onChange={(value) => updateOneTakeDraft("ending", value)}
            />
          </div>
          <div className="space-y-2">
            <div className="text-[10px] text-vellum-faint">
              连续调度节点
            </div>
            {oneTakeDraft.beats.map((beat, i) => (
              <div
                key={beat.id}
                className="rounded bg-vellum-card/80 p-2 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-vellum-muted">
                    紧接着镜头 {i + 1}
                  </span>
                  <button
                    type="button"
                    disabled={disabled || oneTakeDraft.beats.length <= 1}
                    onClick={() => removeOneTakeBeat(beat.id)}
                    className="ml-auto text-[10px] text-vellum-faint hover:text-red-300 disabled:opacity-30"
                  >
                    删除
                  </button>
                </div>
                <div className="grid grid-cols-2 xl:grid-cols-9 gap-2">
                  <div className="space-y-1 xl:col-span-2">
                    <span className="text-[9px] uppercase tracking-wide text-vellum-faint">
                      怎么移动
                    </span>
                    <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-1">
                      <div className="h-8 rounded bg-vellum-bg border border-vellum-border px-2 text-[11px] text-vellum-accent font-bold inline-flex items-center justify-center">
                        紧接着镜头
                      </div>
                      <select
                        value={normalizeOneTakeConnector(beat.connector)}
                        disabled={disabled}
                        onChange={(e) =>
                          updateOneTakeBeat(
                            beat.id,
                            "connector",
                            e.target.value
                          )
                        }
                        className="w-full h-8 rounded bg-vellum-bg border border-vellum-border px-2 text-[11px] text-vellum-text outline-none focus:border-vellum-accent disabled:opacity-40"
                      >
                        {ONE_TAKE_CONNECTOR_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <ShotSelect
                    label="景别"
                    value={beat.shotSize}
                    options={SHOT_SIZE_OPTIONS}
                    disabled={disabled}
                    onChange={(value) =>
                      updateOneTakeBeat(beat.id, "shotSize", value)
                    }
                  />
                  <ShotSelect
                    label="人物部位"
                    value={beat.bodyCrop}
                    options={BODY_CROP_OPTIONS}
                    disabled={disabled}
                    onChange={(value) =>
                      updateOneTakeBeat(beat.id, "bodyCrop", value)
                    }
                  />
                  <ShotSelect
                    label="运镜"
                    value={beat.cameraMove}
                    options={CAMERA_MOVE_OPTIONS.filter(
                      (option) => option !== "一镜到底"
                    )}
                    disabled={disabled}
                    onChange={(value) =>
                      updateOneTakeBeat(beat.id, "cameraMove", value)
                    }
                  />
                  <ShotSelect
                    label="角度"
                    value={beat.cameraAngle}
                    options={CAMERA_ANGLE_OPTIONS}
                    disabled={disabled}
                    onChange={(value) =>
                      updateOneTakeBeat(beat.id, "cameraAngle", value)
                    }
                  />
                  <ShotSelect
                    label="朝向"
                    value={beat.subjectFacing}
                    options={SUBJECT_FACING_OPTIONS}
                    disabled={disabled}
                    onChange={(value) =>
                      updateOneTakeBeat(beat.id, "subjectFacing", value)
                    }
                  />
                  <ShotSelect
                    label="空间逻辑"
                    value={beat.axis}
                    options={ONE_TAKE_AXIS_OPTIONS}
                    disabled={disabled}
                    onChange={(value) =>
                      updateOneTakeBeat(beat.id, "axis", value)
                    }
                  />
                  <OneTakeInput
                    label="视觉重点"
                    value={beat.focus}
                    disabled={disabled}
                    onChange={(value) =>
                      updateOneTakeBeat(beat.id, "focus", value)
                    }
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={addOneTakeBeat}
              className="h-8 px-3 rounded bg-vellum-elevated text-vellum-text text-[11px] font-bold hover:bg-vellum-card-hi transition disabled:opacity-40"
            >
              + 增加调度节点
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={applyOneTake}
              className="h-8 px-3 rounded bg-vellum-accent text-vellum-bg text-[11px] font-bold hover:bg-vellum-accent-hover transition disabled:opacity-40"
            >
              写入一镜到底结构
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ShotSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[9px] uppercase tracking-wide text-vellum-faint">
        {label}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-8 rounded bg-vellum-bg border border-vellum-border px-2 text-[11px] text-vellum-text outline-none focus:border-vellum-accent disabled:opacity-40"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function OneTakeInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[9px] uppercase tracking-wide text-vellum-faint">
        {label}
      </span>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-8 rounded bg-vellum-card border border-vellum-border px-2 text-[11px] text-vellum-text outline-none focus:border-vellum-accent disabled:opacity-40"
      />
    </label>
  );
}

function parseShotBlocks(text: string): ParsedShot[] {
  const matches = Array.from(text.matchAll(/镜头\s*(\d+)\s*[，,：:]/g));
  return matches.map((match, i) => {
    const start = match.index ?? 0;
    const end = matches[i + 1]?.index ?? text.length;
    const shotText = text.slice(start, end).trim();
    return {
      index: Number(match[1]),
      start,
      end,
      text: shotText,
      params: inferShotParams(shotText),
    };
  });
}

function inferShotParams(shotText: string): ShotParams {
  return {
    shotSize: findOption(shotText, SHOT_SIZE_OPTIONS, "中景"),
    bodyCrop: findOption(shotText, BODY_CROP_OPTIONS, "胸口以上"),
    cameraAngle: findOption(shotText, CAMERA_ANGLE_OPTIONS, "平视"),
    cameraMove: findOption(shotText, CAMERA_MOVE_OPTIONS, "快速推进"),
    subjectFacing: findOption(shotText, SUBJECT_FACING_OPTIONS, "45度侧面"),
    mood: findOption(shotText, MOOD_OPTIONS, "高速动感与力量感"),
  };
}

function findOption(
  text: string,
  options: readonly string[],
  fallback: string
): string {
  const sorted = [...options].sort((a, b) => b.length - a.length);
  return sorted.find((option) => text.includes(option)) ?? fallback;
}

function normalizeOneTakeConnector(connector: string) {
  if ((ONE_TAKE_CONNECTOR_OPTIONS as readonly string[]).includes(connector)) {
    return connector;
  }
  if (connector.includes("起幅") && connector.includes("拉远")) {
    return "沿起幅轴线拉远到";
  }
  if (connector.includes("起幅")) return "沿起幅轴线推进到";
  if (connector.includes("运动") || connector.includes("跟拍")) {
    return "顺着人物运动跟拍到";
  }
  if (connector.includes("小幅") || connector.includes("环绕")) {
    return "绕人物小幅环绕到";
  }
  if (connector.includes("下摇")) return "从上半身下摇到";
  if (connector.includes("上摇")) return "从手部上摇到";
  if (connector.includes("高速摇")) return "高速摇向";
  if (connector.includes("横移")) return "横移到";
  if (connector.includes("贴近")) return "贴近到";
  if (connector.includes("拉远")) return "沿起幅轴线拉远到";
  if (connector.includes("落")) return "最后落到";
  return "沿起幅轴线推进到";
}

function isOneTakeShot(shot: ParsedShot) {
  return shot.params.cameraMove === "一镜到底" || /一镜到底调度/.test(shot.text);
}

function replaceShotText(
  fullText: string,
  shot: ParsedShot,
  params: ShotParams,
  forcedBody?: string
) {
  const body = forcedBody ?? getShotBody(shot.text);
  const updatedShot = composeShot(shot.index, params, body);
  const originalSlice = fullText.slice(shot.start, shot.end);
  const trailingWhitespace = originalSlice.match(/\s*$/)?.[0] ?? "";
  return `${fullText.slice(0, shot.start)}${updatedShot}${trailingWhitespace}${fullText.slice(
    shot.end
  )}`;
}

function composeShot(index: number, params: ShotParams, body: string) {
  const lead = [
    params.shotSize,
    params.bodyCrop,
    params.cameraMove,
    params.cameraAngle,
    params.subjectFacing,
  ]
    .filter(Boolean)
    .join("");
  const normalizedBody = applyMood(body, params.mood);
  return `镜头${index}，${lead}镜头，${normalizedBody}`;
}

function getShotBody(shotText: string) {
  const withoutMarker = shotText
    .replace(/^镜头\s*\d+\s*[，,：:]\s*/, "")
    .trim();
  const leadMatch = withoutMarker.match(/^([^，,。；;\n]{2,120}?镜头)[，,：:]\s*/);
  if (leadMatch && looksLikeCameraLead(leadMatch[1])) {
    return withoutMarker.slice(leadMatch[0].length).trim();
  }
  return withoutMarker;
}

function looksLikeCameraLead(lead: string) {
  const allOptions = [
    ...SHOT_SIZE_OPTIONS,
    ...BODY_CROP_OPTIONS,
    ...CAMERA_ANGLE_OPTIONS,
    ...CAMERA_MOVE_OPTIONS,
    ...SUBJECT_FACING_OPTIONS,
  ];
  return allOptions.filter((option) => lead.includes(option)).length >= 2;
}

function applyMood(body: string, mood: string) {
  const stripped = body
    .replace(/整体\s*mood\s*[：:].*?。?$/i, "")
    .replace(/整体氛围\s*[：:].*?。?$/i, "")
    .trim();
  if (!stripped) return `整体 mood：${mood}。`;
  return `${stripped}${stripped.endsWith("。") ? "" : "。"}整体 mood：${mood}。`;
}

function stripOneTakeScaffold(shotText: string) {
  const body = getShotBody(shotText)
    .replace(/一镜到底调度\s*[：:].*?。/g, "")
    .replace(/(?:紧接着|随后|然后|再|最后)镜头[^。]{0,240}。/g, "")
    .replace(/落幅\s*[：:].*?。/g, "")
    .trim();
  return (
    body ||
    "主体在明确空间轴线上完成一个连续动作，前景 / 中景 / 后景关系清晰，最终停在动作落点上。"
  );
}

function buildOneTakeBody(shotText: string, draft: OneTakeDraft) {
  const body = stripOneTakeScaffold(shotText);
  const beatText = draft.beats
    .map(
      (beat) =>
        `紧接着镜头${normalizeOneTakeConnector(beat.connector)}${beat.shotSize}${beat.bodyCrop}${beat.cameraMove}${beat.cameraAngle}${beat.subjectFacing}画面，空间逻辑为${beat.axis}，视觉重点落在${beat.focus}，前景 / 中景 / 后景关系保持连续，空间轴线不跳。`
    )
    .join("");
  const direction = `一镜到底调度：起幅：${draft.opening}；连续性：${draft.continuity}；整个过程不剪镜头，推、拉、跟、摇保持流畅并强化动感。${beatText}落幅：${draft.ending}。`;
  return `${direction}${body ? ` ${body}` : ""}`;
}

function PromptCatalogTabs({
  entries,
  activeEntryId,
  disabled,
  onSelect,
  onAdd,
  onRename,
  onDelete,
}: {
  entries: PromptEntry[];
  activeEntryId: number | null;
  disabled: boolean;
  onSelect: (entry: PromptEntry) => void;
  onAdd: () => void;
  onRename: (entry: PromptEntry) => void;
  onDelete: (entry: PromptEntry) => void;
}) {
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    entry: PromptEntry;
  } | null>(null);

  return (
    <div className="relative z-10 -mb-2 flex items-end gap-1.5 overflow-x-auto pl-3 pr-2 pt-2">
      <span className="mb-1.5 mr-1 text-[10px] text-vellum-faint whitespace-nowrap">
        提示词目录
      </span>
      {entries.map((entry) => {
        const active = entry.id === activeEntryId;
        const hasFinal = entry.final_pass_text.trim().length > 0;
        const hasFirst = entry.first_pass_text.trim().length > 0;
        const state = hasFinal ? "终稿" : hasFirst ? "一版" : "草稿";
        return (
          <button
            key={entry.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(entry)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!disabled) setMenu({ x: e.clientX, y: e.clientY, entry });
            }}
            className={cn(
              "h-8 shrink-0 rounded-t-md rounded-b-none px-3 text-[11px] font-bold transition inline-flex items-center gap-2 disabled:opacity-50",
              active
                ? "bg-vellum-bg text-vellum-text shadow-[0_-10px_22px_rgba(0,0,0,0.22)] translate-y-px"
                : "bg-vellum-elevated/65 text-vellum-muted hover:text-vellum-text hover:bg-vellum-card-hi"
            )}
            title={`${getPromptSegmentTitle(entry)} · Stage 1/2/3 同步切换`}
          >
            <span>{getPromptSegmentTitle(entry)}</span>
            <span
              className={cn(
                "text-[9px] font-semibold",
                active ? "text-vellum-muted" : "text-vellum-faint"
              )}
            >
              {state}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        disabled={disabled}
        onClick={onAdd}
        className="h-8 shrink-0 rounded-t-md rounded-b-none px-3 text-[11px] font-bold bg-vellum-elevated/55 text-vellum-muted hover:text-vellum-text hover:bg-vellum-card-hi transition disabled:opacity-50"
        title="新增一个提示词片段"
      >
        + 新片段
      </button>
      <span className="mb-1.5 ml-1 text-[10px] text-vellum-faint whitespace-nowrap">
        选中后下面三层一起切换
      </span>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "重命名片段",
              hint: "rename",
              icon: <Pencil size={12} />,
              onSelect: () => onRename(menu.entry),
            },
            { type: "separator" },
            {
              label: "删除片段",
              hint: "delete",
              icon: <Trash2 size={12} />,
              destructive: true,
              disabled: entries.length <= 1,
              onSelect: () => onDelete(menu.entry),
            },
          ]}
        />
      )}
    </div>
  );
}

function getPromptSegmentTitle(entry: PromptEntry | null): string {
  const n = entry?.entry_number ?? 1;
  const title = entry?.title?.trim();
  if (!title || title === `索引 ${n}`) return `片段 ${n}`;
  return title.replace(/^索引\s+/, "片段 ");
}

function WorkflowPill({
  n,
  title,
  detail,
}: {
  n: number;
  title: string;
  detail: string;
}) {
  return (
    <div className="h-8 px-3 rounded bg-vellum-card border border-vellum-border inline-flex items-center gap-2">
      <span className="w-4 h-4 rounded-full bg-vellum-accent-soft text-vellum-accent text-[9px] font-bold inline-flex items-center justify-center">
        {n}
      </span>
      <span className="text-vellum-text font-semibold">{title}</span>
      <span className="text-vellum-faint">{detail}</span>
    </div>
  );
}

function WorkflowArrow() {
  return <ChevronRight size={12} className="text-vellum-dim" />;
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
    <section className="rounded bg-vellum-card/80 overflow-hidden">
      <div className="px-5 pt-4 pb-2 flex items-center gap-2">
        <div className="w-5 h-5 rounded-full bg-vellum-accent-soft border border-vellum-accent-border text-vellum-accent text-[10px] font-bold flex items-center justify-center">
          {n}
        </div>
        <div className="text-[10px] uppercase text-vellum-faint">
          stage {n}
        </div>
        <div className="text-[12px] text-vellum-text font-semibold">{title}</div>
        <div className="text-[10px] text-vellum-faint ml-auto">{subtitle}</div>
      </div>
      <div className="px-4 pb-4 pt-2 space-y-3">{children}</div>
    </section>
  );
}

function StageAction({
  label,
  shortLabel,
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
    <div className="flex flex-wrap items-center gap-2.5">
      <button
        onClick={onClick}
        disabled={disabled || running}
        className={cn(
          "h-9 min-w-[210px] px-4 rounded text-[12px] bg-vellum-accent hover:bg-vellum-accent-hover text-vellum-bg font-bold inline-flex items-center justify-center gap-2 transition whitespace-nowrap",
          "disabled:cursor-not-allowed",
          running ? "opacity-90" : disabled ? "opacity-40" : ""
        )}
      >
        {running ? (
          <Loader2 size={13} className="animate-spin shrink-0" />
        ) : (
          <Sparkles size={12} className="shrink-0" />
        )}
        <span>{running ? shortLabel : label}</span>
        {!running && <ChevronRight size={12} />}
      </button>
      {running && (
        <span className="h-9 px-3 rounded border border-vellum-border bg-vellum-bg text-[11px] text-vellum-muted font-mono inline-flex items-center whitespace-nowrap">
          {runningLabel}
        </span>
      )}
      <span className="text-[11px] text-vellum-faint leading-relaxed min-w-[220px]">
        {hint}
      </span>
    </div>
  );
}

function FinalStageContent({
  finalPass,
  setFinalPass,
  refImages,
  activeEntryNumber,
  activeEntryTitle,
}: {
  finalPass: string;
  setFinalPass: (v: string) => void;
  refImages: import("@/lib/types").RefImage[];
  activeEntryNumber: number;
  activeEntryTitle: string;
}) {
  const project = useApp((s) => s.currentProject);
  const payload = buildSubmitPayload(finalPass, refImages);
  const [copied, setCopied] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ratio, setRatio] = useState<DreaminaRatio>("16:9");
  const [duration, setDuration] = useState<5 | 10 | 15>(15);

  const bodyHasOrderHeader = /参考图上传顺序/.test(payload.body);
  const fullOutput =
    payload.uploadOrderHeader.length > 0 && !bodyHasOrderHeader
      ? `${payload.uploadOrderHeader}\n\n${payload.body}`
      : payload.body;

  function handleCopyAll() {
    void navigator.clipboard.writeText(fullOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleSubmit() {
    if (!project || !finalPass.trim()) return;
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      if (payload.orphanIndices.length > 0) {
        throw new Error(
          `提示词里有野引用：${payload.orphanIndices
            .map((n) => `(图${n})`)
            .join("、")}，请先清理`
        );
      }
      if (payload.orderedFiles.length === 0) {
        throw new Error(
          "没有检测到可提交的参考图。Final 里需要有“参考图绑定：图1=...”或 (图N) 引用。"
        );
      }

      const res = await submitMultimodal2Video(fullOutput, payload.orderedFiles, {
        model_version: "seedance2.0_vip",
        duration,
        ratio,
        video_resolution: "1080p",
      });

      const shot = await ensureShot(project.id, activeEntryNumber);
      await updateShot(shot.id, {
        raw_prompt: project.draft_text ?? "",
        enhanced_prompt: finalPass,
        status: "submitted",
        enhanced_at: Math.floor(Date.now() / 1000),
      });
      await createSubmission({
        project_id: project.id,
        shot_id: shot.id,
        cli_command: res.cli_command,
        submit_id: res.submit_id,
        status: "running",
      });

      setSubmitMsg(`已提交即梦任务：${res.submit_id} · ${activeEntryTitle}`);
    } catch (e) {
      setSubmitMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
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

      {/* Upload-order header preview */}
      {payload.uploadOrderHeader && (
        <div className="border border-vellum-accent-border bg-vellum-accent-soft/40 rounded p-3 font-mono text-[12px] text-vellum-accent leading-relaxed whitespace-pre-wrap break-words">
          {payload.uploadOrderHeader}
        </div>
      )}
      {!payload.uploadOrderHeader && finalPass.trim() && payload.orphanIndices.length === 0 && (
        <div className="text-[11px] text-vellum-faint">
          没有检测到 (图N) 引用 · 回上一阶段加图绑定再 Finalize 一次能拿到完整 header
        </div>
      )}

      <RichTextarea
        value={finalPass}
        onChange={setFinalPass}
        onClear={() => setFinalPass("")}
        minRows={12}
        placeholder="Finalize 后这里会有最终强化稿"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleCopyAll}
          disabled={!finalPass.trim()}
          className="px-3 py-1.5 rounded text-[11px] bg-vellum-elevated hover:bg-vellum-card-hi text-vellum-text flex items-center gap-1.5 transition disabled:opacity-40"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied all" : "Copy header + body"}
        </button>
        <div className="h-8 rounded bg-vellum-elevated border border-vellum-border inline-flex items-center p-0.5">
          <button
            type="button"
            onClick={() => setRatio("16:9")}
            className={cn(
              "h-6 px-2.5 rounded text-[10px] font-bold transition whitespace-nowrap",
              ratio === "16:9"
                ? "bg-vellum-accent text-vellum-bg"
                : "text-vellum-muted hover:text-vellum-text"
            )}
            title="横版 16:9"
          >
            横版 16:9
          </button>
          <button
            type="button"
            onClick={() => setRatio("9:16")}
            className={cn(
              "h-6 px-2.5 rounded text-[10px] font-bold transition whitespace-nowrap",
              ratio === "9:16"
                ? "bg-vellum-accent text-vellum-bg"
                : "text-vellum-muted hover:text-vellum-text"
            )}
            title="竖版 9:16"
          >
            竖版 9:16
          </button>
        </div>
        <div className="h-8 rounded bg-vellum-elevated border border-vellum-border inline-flex items-center p-0.5">
          {([5, 10, 15] as const).map((seconds) => (
            <button
              key={seconds}
              type="button"
              onClick={() => setDuration(seconds)}
              className={cn(
                "h-6 px-2.5 rounded text-[10px] font-bold transition whitespace-nowrap",
                duration === seconds
                  ? "bg-vellum-accent text-vellum-bg"
                  : "text-vellum-muted hover:text-vellum-text"
              )}
              title={`${seconds} 秒`}
            >
              {seconds}秒
            </button>
          ))}
        </div>
        <button
          onClick={() => void handleSubmit()}
          disabled={!finalPass.trim() || submitting}
          className="px-3 py-1.5 rounded text-[11px] bg-vellum-accent hover:bg-vellum-accent-hover text-vellum-bg font-bold flex items-center gap-1.5 transition disabled:opacity-40"
          title="调用 dreamina multimodal2video 生成"
        >
          {submitting ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <ChevronRight size={11} />
          )}
          {submitting ? "Submitting" : "Submit → 即梦 CLI"}
        </button>
        <span className="text-[10px] text-vellum-faint">
          Seedance 2.0 · 1080p · VIP · {duration}s · {ratio}
        </span>
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
  return <span className="mx-4 text-vellum-dim">·</span>;
}
