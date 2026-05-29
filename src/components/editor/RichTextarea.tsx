import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { JSONContent } from "@tiptap/core";
import { useApp } from "@/lib/store";
import { ImageBadge } from "./ImageBadge";
import { MentionList, type BindingRole } from "./MentionList";
import type { RefImage } from "@/lib/types";

// Detect 主角/场景/道具 binding word in the few chars before @.
const BINDING_PATTERNS: { re: RegExp; role: BindingRole; word: string }[] = [
  { re: /(主角|男主|女主|反派|角色)$/, role: "character", word: "" },
  { re: /(场景|背景|环境)$/, role: "scene", word: "" },
  { re: /(道具|物品|武器|法器)$/, role: "prop", word: "" },
];

function detectBinding(
  text: string
): { role: BindingRole; word: string } | null {
  for (const p of BINDING_PATTERNS) {
    const m = text.match(p.re);
    if (m) return { role: p.role, word: m[1] };
  }
  return null;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  minRows?: number;
  className?: string;
}

// Serialize editor JSON → flat text. ImageBadge nodes → "(图N)".
export function serializeJsonToText(
  doc: JSONContent | null | undefined
): string {
  if (!doc) return "";
  const out: string[] = [];
  walk(doc);
  return out.join("");

  function walk(node: JSONContent) {
    if (node.type === "imageBadge") {
      const idx = node.attrs?.imageIndex;
      if (idx != null) out.push(`(图${idx})`);
      return;
    }
    if (node.type === "text") {
      if (node.text) out.push(node.text);
      return;
    }
    if (node.type === "hardBreak") {
      out.push("\n");
      return;
    }
    if (node.content) {
      for (const c of node.content) walk(c);
    }
    if (node.type === "paragraph") out.push("\n");
  }
}

// Deserialize text → JSON. (图N) markers become ImageBadge nodes.
export function deserializeTextToJson(
  text: string,
  refImagesById?: Map<number, number>
): JSONContent {
  const paragraphs = text.split(/\n+/);
  return {
    type: "doc",
    content: paragraphs.map((p) => {
      const inline: JSONContent[] = [];
      const re = /\(图\s*(\d+)\)/g;
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(p)) !== null) {
        if (m.index > last) {
          inline.push({ type: "text", text: p.slice(last, m.index) });
        }
        const idx = Number(m[1]);
        const id = refImagesById?.get(idx) ?? null;
        inline.push({
          type: "imageBadge",
          attrs: { imageId: id, imageIndex: idx },
        });
        last = re.lastIndex;
      }
      if (last < p.length) {
        inline.push({ type: "text", text: p.slice(last) });
      }
      return inline.length > 0
        ? { type: "paragraph", content: inline }
        : { type: "paragraph" };
    }),
  };
}

interface PopupState {
  atPos: number;     // position of the @ character itself
  left: number;      // popup screen x
  top: number;       // popup screen y
  query: string;     // text typed after @
  selected: number;
  binding: BindingRole | null;
  bindingWord: string | null;
}

export function RichTextarea({
  value,
  onChange,
  onClear,
  onBlur,
  placeholder,
  minRows = 8,
  className,
}: Props) {
  const refImages = useApp((s) => s.refImages);
  const refImagesByIndexRef = useRef(new Map<number, number>());
  const [popup, setPopup] = useState<PopupState | null>(null);
  const popupRef = useRef<PopupState | null>(null);
  popupRef.current = popup;

  useEffect(() => {
    const map = new Map<number, number>();
    refImages.forEach((r) => map.set(r.image_index, r.id));
    refImagesByIndexRef.current = map;
  }, [refImages]);

  // Filter + sort items based on current query and binding
  const filteredItems = filterRefImages(
    refImages,
    popup?.query ?? "",
    popup?.binding ?? null
  );

  const editor = useEditor({
    extensions: [StarterKit, ImageBadge],
    content: deserializeTextToJson(value, refImagesByIndexRef.current),
    editorProps: {
      attributes: {
        class: `vellum-richtext px-3.5 py-3 pr-16 outline-none text-[13px] leading-relaxed font-mono min-h-[${
          minRows * 1.6
        }em]`,
        spellcheck: "false",
      },
      handleDOMEvents: {
        blur() {
          onBlur?.();
          return false;
        },
      },
      handleKeyDown(view, event) {
        const open = popupRef.current;

        // While popup open: hijack arrow / enter / esc
        if (open) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setPopup((p) =>
              p
                ? {
                    ...p,
                    selected:
                      (p.selected + 1) %
                      Math.max(
                        1,
                        filterRefImages(
                          useApp.getState().refImages,
                          p.query,
                          p.binding
                        ).length
                      ),
                  }
                : null
            );
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setPopup((p) => {
              if (!p) return null;
              const len = Math.max(
                1,
                filterRefImages(
                  useApp.getState().refImages,
                  p.query,
                  p.binding
                ).length
              );
              return { ...p, selected: (p.selected + len - 1) % len };
            });
            return true;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            selectCurrent();
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setPopup(null);
            return true;
          }
        }

        // Detect @ press → schedule popup open (after @ is inserted)
        if (event.key === "@" && !event.isComposing) {
          requestAnimationFrame(() => {
            const sel = view.state.selection;
            const atCharPos = sel.from - 1; // @ was just inserted at this pos
            const screen = view.coordsAtPos(sel.from);
            const POPUP_W = 260;
            let left = screen.left;
            if (left + POPUP_W > window.innerWidth - 8) {
              left = window.innerWidth - POPUP_W - 8;
            }
            if (left < 8) left = 8;
            let top = screen.bottom + 6;
            if (top + 360 > window.innerHeight - 8) {
              top = Math.max(8, screen.top - 360 - 6);
            }
            // Inspect text before @ for binding keyword
            const beforeText = view.state.doc.textBetween(
              Math.max(0, atCharPos - 12),
              atCharPos
            );
            const det = detectBinding(beforeText);
            console.log("[mention] popup opening", {
              left,
              top,
              atCharPos,
              binding: det,
            });
            setPopup({
              atPos: atCharPos,
              left,
              top,
              query: "",
              selected: 0,
              binding: det?.role ?? null,
              bindingWord: det?.word ?? null,
            });
          });
          return false;
        }

        return false;
      },
      handleDrop(view, event, _slice, _moved) {
        const data = event.dataTransfer?.getData("application/vellum-image");
        if (!data) return false;
        try {
          const { id, image_index } = JSON.parse(data) as {
            id: number;
            image_index: number;
          };
          const pos = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          })?.pos;
          if (pos == null) return false;
          const { schema, tr } = view.state;
          const node = schema.nodes.imageBadge.create({
            imageId: id,
            imageIndex: image_index,
          });
          view.dispatch(tr.insert(pos, node));
          event.preventDefault();
          return true;
        } catch (e) {
          console.warn("[RichTextarea] drop parse failed:", e);
          return false;
        }
      },
    },
    onTransaction({ editor }) {
      const open = popupRef.current;
      if (!open) return;
      const cursorPos = editor.state.selection.from;
      // cursor moved before @ → close
      if (cursorPos <= open.atPos) {
        setPopup(null);
        return;
      }
      // text between @ pos+1 and cursor is the query
      const query = editor.state.doc.textBetween(open.atPos + 1, cursorPos);
      if (query.includes("\n") || query.includes("@") || query.length > 30) {
        setPopup(null);
        return;
      }
      if (query !== open.query) {
        setPopup({ ...open, query, selected: 0 });
      }
    },
    onUpdate({ editor }) {
      const text = serializeJsonToText(editor.getJSON());
      onChange(text.trim());
    },
  });

  function selectCurrent() {
    const open = popupRef.current;
    if (!open || !editor) return;
    const all = useApp.getState().refImages;
    const items = filterRefImages(all, open.query, open.binding);
    const item = items[open.selected];
    if (!item) {
      setPopup(null);
      return;
    }
    insertImage(item);
  }

  function insertImage(item: RefImage) {
    const open = popupRef.current;
    if (!editor) return;
    if (open) {
      // Replace @ + query chars with the image badge node
      const cursor = editor.state.selection.from;
      editor
        .chain()
        .focus()
        .deleteRange({ from: open.atPos, to: cursor })
        .insertContent([
          {
            type: "imageBadge",
            attrs: {
              imageId: item.id,
              imageIndex: item.image_index,
            },
          },
          { type: "text", text: " " },
        ])
        .run();
    } else {
      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: "imageBadge",
            attrs: {
              imageId: item.id,
              imageIndex: item.image_index,
            },
          },
          { type: "text", text: " " },
        ])
        .run();
    }
    setPopup(null);
  }

  function handleClear() {
    if (!editor) return;
    editor.commands.clearContent(false);
    onChange("");
    onClear?.();
    setPopup(null);
    requestAnimationFrame(() => editor.commands.focus());
  }

  // Re-sync content when value changes externally
  useEffect(() => {
    if (!editor) return;
    const current = serializeJsonToText(editor.getJSON()).trim();
    if (current === value.trim()) return;
    editor.commands.setContent(
      deserializeTextToJson(value, refImagesByIndexRef.current),
      { emitUpdate: false }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  // Close popup on click outside
  useEffect(() => {
    if (!popup) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("[data-vellum-mention-popup]")) return;
      if (target?.closest(".vellum-richtext")) return;
      setPopup(null);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [popup]);

  return (
    <div
      className={`vellum-richtext-wrapper relative bg-vellum-bg/80 rounded transition focus-within:bg-vellum-bg ${
        className ?? ""
      }`}
    >
      {placeholder && editor && editor.isEmpty && (
        <div className="absolute inset-0 pointer-events-none px-3.5 py-3 pr-16 text-[13px] leading-relaxed text-vellum-dim whitespace-pre-line font-mono">
          {placeholder}
        </div>
      )}
      {editor && !editor.isEmpty && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleClear}
          className="absolute top-2 right-2 z-10 px-2 py-1 rounded text-[10px] text-vellum-faint bg-vellum-elevated/70 hover:bg-vellum-card-hi hover:text-vellum-text transition"
          title="一键清空"
        >
          清空
        </button>
      )}
      <EditorContent editor={editor} />
      {popup &&
        createPortal(
          <div
            data-vellum-mention-popup="true"
            style={{
              position: "fixed",
              left: popup.left,
              top: popup.top,
              zIndex: 9999,
            }}
          >
            <MentionList
              items={filteredItems}
              binding={popup.binding}
              bindingWord={popup.bindingWord}
              selected={popup.selected}
              command={(item) => {
                const ref = filteredItems.find((i) => i.id === item.id);
                if (ref) insertImage(ref);
              }}
              ref={null}
            />
          </div>,
          document.body
        )}
    </div>
  );
}

function filterRefImages(
  all: RefImage[],
  q: string,
  binding: BindingRole | null
): RefImage[] {
  const query = q.toLowerCase().trim();
  let filtered = !query
    ? all.slice()
    : all.filter((img) => {
        const idx = String(img.image_index);
        const name = (img.name || "").toLowerCase();
        const role = img.role.toLowerCase();
        return (
          idx.includes(query) ||
          name.includes(query) ||
          role.includes(query) ||
          roleZh(role).includes(query)
        );
      });
  // When a binding is active, surface matching role first
  if (binding) {
    filtered.sort((a, b) => {
      const aMatch = a.role === binding ? 0 : 1;
      const bMatch = b.role === binding ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return a.image_index - b.image_index;
    });
  }
  // Show all matches — MentionList has overflow-y-auto + arrow-key
  // scrollIntoView, so the popup scales to any project size.
  return filtered;
}

function roleZh(role: string): string {
  if (role === "character") return "角色";
  if (role === "scene") return "场景";
  if (role === "prop") return "道具";
  return role;
}
