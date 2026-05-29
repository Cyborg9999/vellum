// Library Generate / Edit flow:
//   - No reference image → text-to-image via generateImage (legacy path).
//   - With a reference image → multi-angle edits via editImage, fanned out
//     in parallel (one POST per selected angle + optional custom prompt).
// Promise.allSettled because partial failures should still preview the
// successes; user can save the good ones and retry the rest.

import { useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  X,
  Sparkles,
  Loader2,
  Upload,
  Check,
  AlertCircle,
} from "lucide-react";
import {
  generateImage,
  editImage,
  saveGeneratedImageToLibrary,
  uint8ArrayToFile,
  type ImageQuality,
  type ImageSize,
} from "@/lib/openai-images";
import type { RefImage } from "@/lib/types";
import { cn } from "@/lib/utils";

type Status = "idle" | "generating" | "preview" | "saving" | "error";

type AngleKey = "top-down" | "low-angle" | "eye-level" | "close-up";
type ResultAngle = AngleKey | "custom";

const ASPECT_OPTIONS: ReadonlyArray<{
  ratio: string;
  size: ImageSize;
  w: number;
  h: number;
}> = [
  { ratio: "16:9", size: "1792x1024", w: 16, h: 9 },
  { ratio: "9:16", size: "1024x1792", w: 9, h: 16 },
  { ratio: "2:1", size: "2048x1024", w: 2, h: 1 },
  { ratio: "1:2", size: "1024x2048", w: 1, h: 2 },
  { ratio: "4:3", size: "1536x1152", w: 4, h: 3 },
  { ratio: "3:4", size: "1152x1536", w: 3, h: 4 },
];
const QUALITY_OPTIONS: ImageQuality[] = ["auto", "low", "medium", "high"];

const ANGLE_PROMPTS: Record<AngleKey, string> = {
  "top-down": "top-down view",
  "low-angle": "low-angle view",
  "eye-level": "eye-level view",
  "close-up": "close-up",
};

const ANGLE_LABELS: Record<ResultAngle, string> = {
  "top-down": "俯瞰",
  "low-angle": "仰拍",
  "eye-level": "平视",
  "close-up": "局部特写",
  custom: "自定义",
};

const ANGLE_ORDER: AngleKey[] = [
  "top-down",
  "low-angle",
  "eye-level",
  "close-up",
];

interface SourceImage {
  bytes: Uint8Array;
  name: string;
  previewUrl: string;
}

interface ResultTile {
  angle: ResultAngle;
  base64: string | null;
  error: string | null;
  saved: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
  onGenerated: (refImage: RefImage) => void;
  /**
   * Optional: pre-fill the reference image area with a Library image path
   * (used by the "Edit with AI →" context menu in LibraryView). The modal
   * reads the file when it opens and treats it like a freshly chosen file.
   */
  initialSourcePath?: string | null;
}

export function GenerateImageModal({
  open,
  onClose,
  projectId,
  onGenerated,
  initialSourcePath,
}: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<ImageSize>("1792x1024");
  const [quality, setQuality] = useState<ImageQuality>("auto");
  const [errorMsg, setErrorMsg] = useState("");

  const [sourceImage, setSourceImage] = useState<SourceImage | null>(null);
  const [selectedAngles, setSelectedAngles] = useState<Set<AngleKey>>(
    new Set()
  );
  const [results, setResults] = useState<ResultTile[] | null>(null);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Track the latest object-URL so we revoke deterministically on replace /
  // clear / unmount instead of leaking blob handles for the session.
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  // Load a Library image as the reference when the modal is opened via the
  // "Edit with AI →" context menu. Re-runs on each fresh open with a path;
  // skipped when initialSourcePath is null/undefined.
  useEffect(() => {
    if (!open || !initialSourcePath) return;
    let cancelled = false;
    void (async () => {
      try {
        const bytes = await readFile(initialSourcePath);
        if (cancelled) return;
        const name = initialSourcePath.split("/").pop() || "ref.png";
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
        }
        const blob = new Blob([bytes as BlobPart]);
        const previewUrl = URL.createObjectURL(blob);
        previewUrlRef.current = previewUrl;
        setSourceImage({ bytes, name, previewUrl });
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, initialSourcePath]);

  if (!open) return null;

  function setSourceImageFromBytes(bytes: Uint8Array, name: string) {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    const blob = new Blob([bytes as BlobPart]);
    const previewUrl = URL.createObjectURL(blob);
    previewUrlRef.current = previewUrl;
    setSourceImage({ bytes, name, previewUrl });
  }

  function clearSourceImage() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setSourceImage(null);
    setSelectedAngles(new Set());
  }

  function resetAll() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setStatus("idle");
    setPrompt("");
    setSize("1792x1024");
    setQuality("auto");
    setErrorMsg("");
    setSourceImage(null);
    setSelectedAngles(new Set());
    setResults(null);
    setSavingIdx(null);
    setDragOver(false);
  }

  function handleClose() {
    onClose();
    resetAll();
  }

  function handleTryAgain() {
    setResults(null);
    setStatus("idle");
    setErrorMsg("");
  }

  function toggleAngle(angle: AngleKey) {
    setSelectedAngles((prev) => {
      const next = new Set(prev);
      if (next.has(angle)) next.delete(angle);
      else next.add(angle);
      return next;
    });
  }

  async function handleChooseFile() {
    try {
      const selection = await openDialog({
        multiple: false,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp"],
          },
        ],
      });
      if (!selection) return;
      const path = Array.isArray(selection) ? selection[0] : selection;
      if (!path) return;
      const bytes = await readFile(path);
      const name = path.split("/").pop() || "ref.png";
      setSourceImageFromBytes(bytes, name);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    if (sourceImage) return;
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItem = items.find((i) => i.type.startsWith("image/"));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    e.preventDefault();
    try {
      const buf = await file.arrayBuffer();
      setSourceImageFromBytes(
        new Uint8Array(buf),
        file.name || "pasted.png"
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const buf = await file.arrayBuffer();
      setSourceImageFromBytes(new Uint8Array(buf), file.name || "dropped.png");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  function buildPromptsToFire(): Array<{ angle: ResultAngle; prompt: string }> {
    const trimmed = prompt.trim();
    const list: Array<{ angle: ResultAngle; prompt: string }> = [];
    for (const angle of ANGLE_ORDER) {
      if (!selectedAngles.has(angle)) continue;
      const base = ANGLE_PROMPTS[angle];
      const combined = trimmed ? `${base}, ${trimmed}` : base;
      list.push({ angle, prompt: combined });
    }
    if (selectedAngles.size === 0 && trimmed) {
      list.push({ angle: "custom", prompt: trimmed });
    }
    return list;
  }

  async function handleGenerate() {
    setErrorMsg("");

    // Text-only generation path.
    if (!sourceImage) {
      const trimmed = prompt.trim();
      if (!trimmed) return;
      setStatus("generating");
      try {
        const b64 = await generateImage({ prompt: trimmed, size, quality });
        setResults([
          { angle: "custom", base64: b64, error: null, saved: false },
        ]);
        setStatus("preview");
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
      return;
    }

    // Edit path: fan out one request per angle (+ optional custom).
    const promptsToFire = buildPromptsToFire();
    if (promptsToFire.length === 0) return;

    setStatus("generating");
    const file = uint8ArrayToFile(
      sourceImage.bytes,
      sourceImage.name,
      "image/png"
    );
    const settled = await Promise.allSettled(
      promptsToFire.map((p) =>
        editImage({
          sourceImage: file,
          sourceImageName: sourceImage.name,
          prompt: p.prompt,
          size,
          quality,
        })
      )
    );
    const tiles: ResultTile[] = settled.map((r, i) => {
      if (r.status === "fulfilled") {
        return {
          angle: promptsToFire[i].angle,
          base64: r.value,
          error: null,
          saved: false,
        };
      }
      return {
        angle: promptsToFire[i].angle,
        base64: null,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        saved: false,
      };
    });
    setResults(tiles);

    const anySuccess = tiles.some((t) => t.base64);
    if (anySuccess) {
      setStatus("preview");
    } else {
      // All failed — pick the first error message to surface up top.
      const firstErr = tiles.find((t) => t.error)?.error ?? "All edits failed.";
      setErrorMsg(firstErr);
      setStatus("error");
    }
  }

  async function saveTile(idx: number): Promise<RefImage | null> {
    if (!results) return null;
    const tile = results[idx];
    if (!tile?.base64 || tile.saved) return null;
    const customSnippet = prompt.trim().slice(0, 40);
    const promptLabel = customSnippet
      ? `${ANGLE_LABELS[tile.angle]} — ${customSnippet}`
      : ANGLE_LABELS[tile.angle];
    const ref = await saveGeneratedImageToLibrary({
      projectId,
      prompt: promptLabel,
      base64: tile.base64,
    });
    setResults((prev) => {
      if (!prev) return prev;
      const next = prev.slice();
      next[idx] = { ...next[idx], saved: true };
      return next;
    });
    onGenerated(ref);
    return ref;
  }

  async function handleSave(idx: number) {
    setSavingIdx(idx);
    setStatus("saving");
    setErrorMsg("");
    try {
      await saveTile(idx);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
      return;
    } finally {
      setSavingIdx(null);
    }
    setStatus("preview");
  }

  async function handleSaveAll() {
    if (!results) return;
    setStatus("saving");
    setErrorMsg("");
    try {
      for (let i = 0; i < results.length; i++) {
        if (!results[i].base64 || results[i].saved) continue;
        setSavingIdx(i);
        await saveTile(i);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
      return;
    } finally {
      setSavingIdx(null);
    }
    setStatus("preview");
  }

  function handleDiscard(idx: number) {
    setResults((prev) => {
      if (!prev) return prev;
      return prev.filter((_, i) => i !== idx);
    });
  }

  function handleDiscardAll() {
    setResults(null);
    setStatus("idle");
  }

  const hasSource = sourceImage !== null;
  const trimmedPrompt = prompt.trim();
  const promptsToFire = buildPromptsToFire();
  const buttonLabel = (() => {
    if (!hasSource) return "Generate";
    const n = promptsToFire.length;
    if (n === 0) return "Edit";
    return `Edit (${n} image${n > 1 ? "s" : ""})`;
  })();
  const generateDisabled =
    status === "generating" ||
    status === "saving" ||
    (hasSource ? promptsToFire.length === 0 : trimmedPrompt.length === 0);

  const successCount = results?.filter((r) => r.base64).length ?? 0;
  const unsavedSuccessCount =
    results?.filter((r) => r.base64 && !r.saved).length ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-[640px] max-h-[90vh] overflow-y-auto bg-vellum-card border border-vellum-border rounded-lg"
        onClick={(e) => e.stopPropagation()}
        onPaste={(e) => void handlePaste(e)}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 border-b border-vellum-border bg-vellum-card">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-vellum-accent" />
            <div className="text-vellum-text text-sm font-bold uppercase">
              Generate / Edit image
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-vellum-elevated text-vellum-muted hover:text-vellum-text transition"
          >
            <X size={13} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Reference image area */}
          <div>
            <div className="text-[10px] uppercase text-vellum-faint mb-2">
              Reference image (optional)
            </div>
            {hasSource ? (
              <div className="relative inline-block">
                <img
                  src={sourceImage.previewUrl}
                  alt="reference"
                  className="max-h-48 rounded border border-vellum-border"
                />
                <button
                  onClick={clearSourceImage}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-vellum-bg border border-vellum-border flex items-center justify-center text-vellum-muted hover:text-vellum-text hover:border-vellum-accent-border transition"
                  title="clear reference image"
                >
                  <X size={11} />
                </button>
              </div>
            ) : (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => void handleDrop(e)}
                className={cn(
                  "border border-dashed rounded p-6 text-center transition",
                  dragOver
                    ? "border-vellum-accent bg-vellum-accent-soft"
                    : "border-vellum-border"
                )}
              >
                <div className="text-xs text-vellum-muted mb-3">
                  Drop image here, or
                </div>
                <button
                  onClick={() => void handleChooseFile()}
                  className="px-3 py-1.5 rounded text-xs bg-vellum-elevated hover:bg-vellum-bg text-vellum-text flex items-center gap-1.5 mx-auto transition"
                >
                  <Upload size={11} /> Choose file
                </button>
                <div className="text-[10px] text-vellum-faint mt-3">
                  or paste with ⌘V
                </div>
              </div>
            )}
          </div>

          {/* Angle selection (only when ref image present) */}
          {hasSource && (
            <div>
              <div className="text-[10px] uppercase text-vellum-faint mb-2">
                选择角度（多选，每选一个生成一张）
              </div>
              <div className="grid grid-cols-4 gap-2">
                {ANGLE_ORDER.map((angle) => {
                  const sel = selectedAngles.has(angle);
                  return (
                    <button
                      key={angle}
                      onClick={() => toggleAngle(angle)}
                      className={cn(
                        "px-2 py-2 rounded text-xs transition border",
                        sel
                          ? "bg-vellum-accent text-vellum-bg border-vellum-accent font-bold"
                          : "bg-vellum-elevated text-vellum-muted border-vellum-border hover:text-vellum-text hover:border-vellum-accent-border"
                      )}
                    >
                      {ANGLE_LABELS[angle]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Prompt textarea */}
          <div>
            <div className="text-[10px] uppercase text-vellum-faint mb-2">
              {hasSource ? "额外修改（可选）" : "Prompt"}
            </div>
            <textarea
              autoFocus={!hasSource}
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                hasSource
                  ? "e.g. 把背景改成夜晚，主角穿黑色长袍..."
                  : "Describe the image you want to generate..."
              }
              className="w-full bg-vellum-bg border border-vellum-border rounded px-3 py-2 text-vellum-text placeholder:text-vellum-dim text-sm focus:border-vellum-accent-border transition resize-none"
            />
          </div>

          {/* Size + Quality */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase text-vellum-faint mb-2">
                Aspect ratio
              </div>
              <div className="grid grid-cols-3 gap-2">
                {ASPECT_OPTIONS.map((opt) => {
                  const selected = size === opt.size;
                  return (
                    <button
                      key={opt.ratio}
                      type="button"
                      onClick={() => setSize(opt.size)}
                      className={cn(
                        "h-14 px-2 py-2 rounded border flex flex-col items-stretch justify-center transition",
                        selected
                          ? "border-vellum-accent bg-vellum-accent-soft text-vellum-text"
                          : "border-vellum-border bg-vellum-elevated text-vellum-muted hover:text-vellum-text hover:border-vellum-accent-border"
                      )}
                    >
                      <div className="flex-1 flex items-center justify-center px-2">
                        <div
                          style={{
                            aspectRatio: `${opt.w} / ${opt.h}`,
                            maxHeight: "28px",
                            maxWidth: "100%",
                          }}
                          className={cn(
                            "rounded-sm",
                            selected
                              ? "bg-vellum-accent/60"
                              : "bg-vellum-muted/40"
                          )}
                        />
                      </div>
                      <div className="text-[10px] uppercase tracking-wider mt-1 text-center">
                        {opt.ratio}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-vellum-faint mb-2">
                Quality
              </div>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as ImageQuality)}
                className="w-full bg-vellum-bg border border-vellum-border rounded px-3 py-2 text-vellum-text text-sm font-mono focus:border-vellum-accent-border transition"
              >
                {QUALITY_OPTIONS.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={() => void handleGenerate()}
            disabled={generateDisabled}
            className="w-full px-3 py-2 rounded text-xs font-bold bg-vellum-accent hover:bg-vellum-accent-hover text-vellum-bg transition disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            <Sparkles size={11} /> {buttonLabel}
          </button>

          {status === "generating" && (
            <div className="flex items-center gap-2 text-vellum-muted text-xs">
              <Loader2 size={13} className="animate-spin" />
              <span>
                Generating {promptsToFire.length || 1} image
                {promptsToFire.length > 1 ? "s" : ""}… 20-60s typical.
              </span>
            </div>
          )}

          {status === "saving" && (
            <div className="flex items-center gap-2 text-vellum-muted text-xs">
              <Loader2 size={13} className="animate-spin" />
              <span>
                Saving{" "}
                {savingIdx !== null && results
                  ? `${savingIdx + 1} of ${results.length}`
                  : "…"}
              </span>
            </div>
          )}

          {status === "error" && errorMsg && (
            <div className="space-y-3">
              <div className="border border-red-900/60 bg-red-950/20 text-red-300 rounded p-3 text-xs font-mono break-all flex items-start gap-2">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <div>{errorMsg}</div>
              </div>
              <button
                onClick={handleTryAgain}
                className="w-full px-3 py-2 rounded text-xs text-vellum-text bg-vellum-elevated hover:bg-vellum-bg transition"
              >
                Try again
              </button>
            </div>
          )}

          {/* Results grid */}
          {results && results.length > 0 && status !== "generating" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => void handleSaveAll()}
                  disabled={
                    unsavedSuccessCount === 0 || status === "saving"
                  }
                  className="px-3 py-1.5 rounded text-xs font-bold bg-vellum-accent hover:bg-vellum-accent-hover text-vellum-bg transition disabled:opacity-40"
                >
                  Save all
                </button>
                <button
                  onClick={handleDiscardAll}
                  className="px-3 py-1.5 rounded text-xs text-vellum-text bg-vellum-elevated hover:bg-vellum-bg transition"
                >
                  Discard all
                </button>
                <button
                  onClick={handleTryAgain}
                  className="px-3 py-1.5 rounded text-xs text-vellum-muted hover:text-vellum-text hover:bg-vellum-elevated transition"
                >
                  Try again
                </button>
                <div className="ml-auto text-[10px] text-vellum-faint">
                  {successCount}/{results.length} ok
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {results.map((tile, i) => (
                  <ResultTileView
                    key={`${tile.angle}-${i}`}
                    tile={tile}
                    busy={status === "saving" && savingIdx === i}
                    onSave={() => void handleSave(i)}
                    onDiscard={() => handleDiscard(i)}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="text-center text-[11px] text-vellum-muted pt-1">
            Powered by OpenAI gpt-image-2
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultTileView({
  tile,
  busy,
  onSave,
  onDiscard,
}: {
  tile: ResultTile;
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (tile.error) {
    return (
      <div className="border border-red-900/60 bg-red-950/20 rounded p-3 text-xs text-red-300 space-y-2">
        <div className="font-bold uppercase">
          {ANGLE_LABELS[tile.angle]} · failed
        </div>
        <div className="font-mono break-all text-[11px]">{tile.error}</div>
        <button
          onClick={onDiscard}
          className="w-full px-2 py-1 rounded text-[11px] text-vellum-text bg-vellum-elevated hover:bg-vellum-bg transition"
        >
          Dismiss
        </button>
      </div>
    );
  }
  if (!tile.base64) return null;
  return (
    <div className="space-y-2">
      <div className="relative">
        <img
          src={`data:image/png;base64,${tile.base64}`}
          alt={ANGLE_LABELS[tile.angle]}
          className="w-full rounded border border-vellum-border"
        />
        {tile.saved && (
          <div className="absolute inset-0 bg-vellum-accent/20 border-2 border-vellum-accent rounded flex items-center justify-center">
            <div className="bg-vellum-accent text-vellum-bg rounded-full p-2">
              <Check size={16} />
            </div>
          </div>
        )}
      </div>
      <div className="text-[11px] text-vellum-muted text-center uppercase">
        {ANGLE_LABELS[tile.angle]}
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={onSave}
          disabled={tile.saved || busy}
          className="flex-1 px-2 py-1 rounded text-[11px] font-bold bg-vellum-accent hover:bg-vellum-accent-hover text-vellum-bg transition disabled:opacity-40 flex items-center justify-center gap-1"
        >
          {busy ? (
            <Loader2 size={10} className="animate-spin" />
          ) : tile.saved ? (
            <>
              <Check size={10} /> Saved
            </>
          ) : (
            "Save"
          )}
        </button>
        <button
          onClick={onDiscard}
          disabled={busy}
          className="px-2 py-1 rounded text-[11px] text-vellum-muted hover:text-vellum-text bg-vellum-elevated hover:bg-vellum-bg transition disabled:opacity-40"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
