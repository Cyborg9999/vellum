// Library Generate flow: prompt → OpenAI gpt-image-1 → preview → save to
// the active project's Library. State machine covers idle / generating /
// preview / saving / error so the user can iterate without re-opening.

import { useState } from "react";
import { X, Sparkles, Loader2 } from "lucide-react";
import {
  generateImage,
  saveGeneratedImageToLibrary,
  type ImageQuality,
  type ImageSize,
} from "@/lib/openai-images";
import type { RefImage } from "@/lib/types";

type Status = "idle" | "generating" | "preview" | "saving" | "error";

const SIZE_OPTIONS: ImageSize[] = ["1024x1024", "1536x1024", "1024x1536"];
const QUALITY_OPTIONS: ImageQuality[] = ["auto", "low", "medium", "high"];

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
  onGenerated: (refImage: RefImage) => void;
}

export function GenerateImageModal({
  open,
  onClose,
  projectId,
  onGenerated,
}: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<ImageSize>("1024x1024");
  const [quality, setQuality] = useState<ImageQuality>("auto");
  const [base64, setBase64] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  if (!open) return null;

  function resetAll() {
    setStatus("idle");
    setPrompt("");
    setSize("1024x1024");
    setQuality("auto");
    setBase64("");
    setErrorMsg("");
  }

  function handleClose() {
    onClose();
    resetAll();
  }

  function handleTryAgain() {
    setStatus("idle");
    setBase64("");
    setErrorMsg("");
  }

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setStatus("generating");
    setErrorMsg("");
    try {
      const b64 = await generateImage({
        prompt: prompt.trim(),
        size,
        quality,
      });
      setBase64(b64);
      setStatus("preview");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function handleSave() {
    setStatus("saving");
    setErrorMsg("");
    try {
      const ref = await saveGeneratedImageToLibrary({
        projectId,
        prompt: prompt.trim(),
        base64,
      });
      onGenerated(ref);
      onClose();
      resetAll();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  const generateDisabled =
    !prompt.trim() || status === "generating" || status === "saving";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-[480px] bg-vellum-card border border-vellum-border rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-vellum-border">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-vellum-accent" />
            <div className="text-vellum-text text-sm font-bold uppercase">
              Generate image
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
          <div>
            <div className="text-[10px] uppercase text-vellum-faint mb-2">
              Prompt
            </div>
            <textarea
              autoFocus
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the image you want to generate..."
              className="w-full bg-vellum-bg border border-vellum-border rounded px-3 py-2 text-vellum-text placeholder:text-vellum-dim text-sm focus:border-vellum-accent-border transition resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase text-vellum-faint mb-2">
                Size
              </div>
              <select
                value={size}
                onChange={(e) => setSize(e.target.value as ImageSize)}
                className="w-full bg-vellum-bg border border-vellum-border rounded px-3 py-2 text-vellum-text text-sm font-mono focus:border-vellum-accent-border transition"
              >
                {SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
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
            <Sparkles size={11} /> Generate
          </button>

          {status === "generating" && (
            <div className="flex items-center gap-2 text-vellum-muted text-xs">
              <Loader2 size={13} className="animate-spin" />
              <span>Generating image… 10-30s typical.</span>
            </div>
          )}

          {status === "preview" && (
            <div className="space-y-3">
              <img
                src={`data:image/png;base64,${base64}`}
                alt="Generated"
                className="w-full rounded"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleSave()}
                  className="flex-1 px-3 py-2 rounded text-xs font-bold bg-vellum-accent hover:bg-vellum-accent-hover text-vellum-bg transition"
                >
                  Save to Library
                </button>
                <button
                  onClick={handleTryAgain}
                  className="flex-1 px-3 py-2 rounded text-xs text-vellum-text bg-vellum-elevated hover:bg-vellum-bg transition"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {status === "saving" && (
            <div className="flex items-center gap-2 text-vellum-muted text-xs">
              <Loader2 size={13} className="animate-spin" />
              <span>Saving to Library…</span>
            </div>
          )}

          {status === "error" && (
            <div className="space-y-3">
              <div className="border border-red-900/60 bg-red-950/20 text-red-300 rounded p-3 text-xs font-mono break-all">
                {errorMsg}
              </div>
              <button
                onClick={handleTryAgain}
                className="w-full px-3 py-2 rounded text-xs text-vellum-text bg-vellum-elevated hover:bg-vellum-bg transition"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
