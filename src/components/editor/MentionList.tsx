import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { RefImage } from "@/lib/types";

export type BindingRole = "character" | "scene" | "prop";

export interface MentionListProps {
  items: RefImage[];
  command: (item: { id: number; image_index: number }) => void;
  selected?: number;
  binding?: BindingRole | null;
  bindingWord?: string | null;
}

export interface MentionListHandle {
  onKeyDown: (event: { event: KeyboardEvent }) => boolean;
}

const ROLE_ZH: Record<string, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
};

function roleZh(role: string): string {
  return ROLE_ZH[role] || role;
}

export const MentionList = forwardRef<MentionListHandle, MentionListProps>(
  ({ items, command, binding, bindingWord }, ref) => {
    const [selected, setSelected] = useState(0);
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

    useEffect(() => {
      setSelected(0);
    }, [items]);

    // Keep the keyboard-selected row inside the scrollable popup viewport —
    // without this, ↓ past row 8 (popup is ~340px tall) silently moves the
    // cursor offscreen and the user thinks the selection got stuck.
    useEffect(() => {
      itemRefs.current[selected]?.scrollIntoView({ block: "nearest" });
    }, [selected]);

    const pick = (index: number) => {
      const item = items[index];
      if (!item) return;
      command({ id: item.id, image_index: item.image_index });
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          setSelected((s) => (s + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelected((s) => (s + 1) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          pick(selected);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="bg-vellum-card border border-vellum-accent-border rounded-lg p-4 text-[11px] text-vellum-faint shadow-2xl min-w-[200px]">
          没有参考图 · 先去 Library 导入
        </div>
      );
    }

    return (
      <div className="bg-vellum-card border border-vellum-accent-border rounded-lg shadow-2xl min-w-[240px] max-h-[340px] overflow-y-auto p-1.5">
        {binding ? (
          <div className="mx-1 mb-1 px-2.5 py-1.5 rounded bg-vellum-accent-soft border border-vellum-accent-border flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-vellum-accent" />
            <span className="text-[10px] uppercase text-vellum-faint">
              binding
            </span>
            <span className="text-[11px] text-vellum-accent font-bold">
              {bindingWord ?? roleZh(binding)}
            </span>
            <span className="text-[10px] text-vellum-faint">
              → {roleZh(binding)} 图
            </span>
          </div>
        ) : (
          <div className="text-[9px] uppercase text-vellum-faint px-2 py-1.5">
            insert reference
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          {items.map((img, i) => (
            <button
              key={img.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              onMouseEnter={() => setSelected(i)}
              onClick={() => pick(i)}
              className={`flex items-center gap-2.5 px-2 py-1.5 rounded text-left transition ${
                i === selected
                  ? "bg-vellum-accent-soft"
                  : "hover:bg-vellum-elevated"
              }`}
            >
              <img
                src={convertFileSrc(img.file_path)}
                alt=""
                className="w-7 h-7 rounded-full object-cover border border-vellum-border shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div
                  className={`text-[12px] font-semibold leading-tight ${
                    i === selected ? "text-vellum-accent" : "text-vellum-text"
                  }`}
                >
                  图片{img.image_index}
                </div>
                <div className="text-[10px] text-vellum-faint truncate leading-tight">
                  {ROLE_ZH[img.role] || img.role}
                  {img.name ? ` · ${img.name}` : ""}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }
);

MentionList.displayName = "MentionList";
