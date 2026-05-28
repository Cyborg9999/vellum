import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type ContextMenuItem =
  | {
      type?: "item";
      label: string;
      hint?: string;
      icon?: React.ReactNode;
      destructive?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { type: "separator" };

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      x: Math.min(x, window.innerWidth - rect.width - pad),
      y: Math.min(y, window.innerHeight - rect.height - pad),
    });
  }, [x, y, items]);

  useLayoutEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[90] min-w-44 rounded-md border border-vellum-border-strong bg-vellum-card/95 p-1 shadow-2xl backdrop-blur-md"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item, idx) => {
        if (item.type === "separator") {
          return <div key={idx} className="my-1 h-px bg-vellum-border" />;
        }
        return (
          <button
            key={idx}
            disabled={item.disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (item.disabled) return;
              item.onSelect();
              onClose();
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-40",
              item.destructive
                ? "text-red-300 hover:bg-red-950/30"
                : "text-vellum-muted hover:bg-vellum-elevated hover:text-vellum-text"
            )}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {item.icon}
            </span>
            <span className="flex-1">{item.label}</span>
            {item.hint && (
              <span className="ml-4 text-[10px] uppercase text-vellum-faint">
                {item.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
