import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { X, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import type { RefImage, RefImageRole } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/types";

const ROLES: RefImageRole[] = ["character", "scene", "prop"];

interface Props {
  images: RefImage[];
  startId: number;
  onClose: () => void;
  onRoleChange: (id: number, role: RefImageRole) => void;
  onDelete: (id: number) => void;
}

export function ImageLightbox({
  images,
  startId,
  onClose,
  onRoleChange,
  onDelete,
}: Props) {
  const startIndex = Math.max(
    0,
    images.findIndex((i) => i.id === startId)
  );
  const [idx, setIdx] = useState(startIndex);
  const current = images[idx];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => (i + images.length - 1) % images.length);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => (i + 1) % images.length);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [images.length, onClose]);

  if (!current) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex flex-col"
      onClick={onClose}
    >
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3 text-xs">
          <div
            className="text-vellum-accent font-bold"
            style={{
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: "18px",
            }}
          >
            图{current.image_index}
          </div>
          <div className="text-vellum-muted">
            {ROLE_LABEL[current.role]}
            {current.name ? ` · ${current.name}` : ""}
          </div>
          <div className="text-vellum-faint">
            {idx + 1} / {images.length}
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-vellum-muted hover:text-vellum-text transition"
        >
          <X size={16} />
        </button>
      </div>

      <div
        className="flex-1 flex items-center justify-center relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {images.length > 1 && (
          <button
            onClick={() =>
              setIdx((i) => (i + images.length - 1) % images.length)
            }
            className="absolute left-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/15 text-vellum-text transition"
            title="prev (←)"
          >
            <ChevronLeft size={18} />
          </button>
        )}

        <img
          src={convertFileSrc(current.file_path)}
          alt=""
          className="max-w-[88vw] max-h-[78vh] object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />

        {images.length > 1 && (
          <button
            onClick={() => setIdx((i) => (i + 1) % images.length)}
            className="absolute right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/15 text-vellum-text transition"
            title="next (→)"
          >
            <ChevronRight size={18} />
          </button>
        )}
      </div>

      <div
        className="border-t border-white/10 px-5 py-3 flex items-center gap-3 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[10px] uppercase text-vellum-faint">role</div>
        <div className="flex gap-1">
          {ROLES.map((r) => (
            <button
              key={r}
              onClick={() => onRoleChange(current.id, r)}
              className={`px-2.5 py-1 rounded text-[10px] uppercase font-bold transition ${
                current.role === r
                  ? "bg-vellum-accent text-vellum-bg"
                  : "bg-vellum-elevated text-vellum-muted hover:text-vellum-text"
              }`}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <div className="ml-auto text-[10px] font-mono text-vellum-faint truncate max-w-md">
          {current.file_path}
        </div>
        <button
          onClick={() => {
            if (confirm(`删除图片${current.image_index}？`)) {
              onDelete(current.id);
              if (images.length === 1) onClose();
              else setIdx((i) => Math.min(i, images.length - 2));
            }
          }}
          className="w-7 h-7 flex items-center justify-center rounded text-vellum-faint hover:text-red-400 hover:bg-vellum-elevated transition"
          title="delete"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>,
    document.body
  );
}
