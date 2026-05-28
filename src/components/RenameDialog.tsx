import { useEffect, useState } from "react";
import { AlertCircle, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function RenameDialog({
  title,
  initialValue,
  placeholder,
  onSubmit,
  onClose,
}: {
  title: string;
  initialValue: string;
  placeholder?: string;
  onSubmit: (value: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  async function handleSubmit() {
    const next = value.trim();
    if (!next || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(next);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-vellum-border bg-vellum-card p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs font-bold uppercase text-vellum-text">
            {title}
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-vellum-faint transition hover:bg-vellum-elevated hover:text-vellum-text"
          >
            <X size={13} />
          </button>
        </div>

        <input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSubmit();
            if (e.key === "Escape") onClose();
          }}
          className={cn(
            "w-full rounded border bg-vellum-bg px-3 py-2 text-sm text-vellum-text placeholder:text-vellum-dim transition focus:border-vellum-accent-border",
            error ? "border-red-500/60" : "border-vellum-border"
          )}
        />

        {error && (
          <div className="mt-2 flex items-start gap-1.5 text-xs text-red-300">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => void handleSubmit()}
            disabled={!value.trim() || saving}
            className="flex items-center gap-1.5 rounded bg-vellum-accent px-3 py-1.5 text-xs font-bold text-vellum-bg transition hover:bg-vellum-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check size={11} />
            {saving ? "Saving..." : "保存"}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded px-3 py-1.5 text-xs text-vellum-muted transition hover:bg-vellum-elevated hover:text-vellum-text disabled:opacity-40"
          >
            取消
          </button>
          <div className="ml-auto text-[10px] uppercase text-vellum-faint">
            Enter 保存 · Esc 取消
          </div>
        </div>
      </div>
    </div>
  );
}
