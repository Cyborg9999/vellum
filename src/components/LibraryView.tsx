import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { appLocalDataDir, join } from "@tauri-apps/api/path";
import {
  Plus,
  RefreshCw,
  Trash2,
  AlertCircle,
  LayoutGrid,
  Columns3,
  List as ListIcon,
} from "lucide-react";
import type { RefImage, RefImageRole } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/types";
import {
  addRefImage,
  updateRefImage,
  deleteRefImage,
} from "@/lib/db";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ImageLightbox } from "./ImageLightbox";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const ROLES: RefImageRole[] = ["character", "scene", "prop"];

// C3 hardening: reject filenames containing newlines, NUL, or other control
// chars that could be used to inject system-instruction-shaped text into
// prompts sent to the CLI providers (claude/codex).
// Reference: grill C3 finding.
const CONTROL_CHAR = /[\x00-\x1f\x7f]/;
function isSafeImagePath(p: string): boolean {
  if (CONTROL_CHAR.test(p)) return false;
  return true;
}

function mimeToExt(mime: string): string {
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/bmp") return "bmp";
  return "png";
}

/**
 * Save a clipboard image blob to the app's local data dir and return the
 * absolute path. Used by the paste-to-library handler so users can Cmd+V
 * directly from Midjourney/browser without saving-then-drag.
 */
async function saveClipboardImage(blob: File): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const baseDir = await appLocalDataDir();
  const pastedDir = await join(baseDir, "pasted");
  if (!(await exists(pastedDir))) {
    await mkdir(pastedDir, { recursive: true });
  }

  const ext = mimeToExt(blob.type);
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 8);
  const filename = `pasted-${stamp}-${rand}.${ext}`;
  const fullPath = await join(pastedDir, filename);

  await writeFile(fullPath, bytes);
  return fullPath;
}

type Layout = "grid" | "masonry" | "list";
const LAYOUT_STORAGE_KEY = "vellum.libraryLayout";

function loadLayout(): Layout {
  try {
    const v = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (v === "grid" || v === "masonry" || v === "list") return v;
  } catch {
    /* ignore */
  }
  return "grid";
}

export function LibraryView() {
  const project = useApp((s) => s.currentProject);
  const images = useApp((s) => s.refImages);
  const loadRefImages = useApp((s) => s.loadRefImages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [lightboxId, setLightboxId] = useState<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, layout);
    } catch {
      /* ignore */
    }
  }, [layout]);

  const refresh = useCallback(async () => {
    if (!project) return;
    try {
      await loadRefImages(project.id);
    } catch (e) {
      console.error("[LibraryView] refresh failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [project, loadRefImages]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addPaths = useCallback(
    async (paths: string[]) => {
      if (!project || paths.length === 0) return;

      // C3: reject path/filename containing control characters before they
      // can be embedded into LLM prompts. Drop unsafe paths, surface to user.
      const safe: string[] = [];
      const rejected: string[] = [];
      for (const p of paths) {
        if (isSafeImagePath(p)) safe.push(p);
        else rejected.push(p);
      }
      if (rejected.length > 0) {
        setError(
          `拒绝 ${rejected.length} 个含控制字符的文件名（防 prompt 注入）。重命名后重试。例：${rejected[0].slice(0, 80)}`
        );
      }
      if (safe.length === 0) return;

      setBusy(true);
      // accumulate per-file failures instead of aborting the whole batch (H7-ish)
      const failures: { path: string; err: string }[] = [];
      try {
        for (const p of safe) {
          const name = p.split("/").pop() || "";
          try {
            await addRefImage({
              project_id: project.id,
              role: "character",
              name,
              file_path: p,
            });
          } catch (e) {
            console.error("[LibraryView] addRefImage failed:", p, e);
            failures.push({
              path: p,
              err: e instanceof Error ? e.message : String(e),
            });
          }
        }
        await refresh();
        if (failures.length > 0) {
          setError(
            `${failures.length}/${safe.length} 张导入失败。首条：${failures[0].path} — ${failures[0].err}`
          );
        }
      } catch (e) {
        console.error("[LibraryView] addPaths failed:", e);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [project, refresh]
  );

  // Clipboard paste: Cmd+V with an image in clipboard → save to app data dir
  // and add to library. Works for MJ web copy (browser→clipboard binary).
  useEffect(() => {
    async function onPaste(e: ClipboardEvent) {
      if (!project) return;
      // Skip if focus is on a textarea/input/contenteditable (user is editing text)
      const target = e.target as Element | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          (target as HTMLElement).isContentEditable
        ) {
          return;
        }
      }

      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItems = items.filter((i) => i.type.startsWith("image/"));
      if (imageItems.length === 0) return;
      e.preventDefault();

      setBusy(true);
      setError(null);
      const savedPaths: string[] = [];
      for (const item of imageItems) {
        const blob = item.getAsFile();
        if (!blob) continue;
        try {
          const p = await saveClipboardImage(blob);
          savedPaths.push(p);
        } catch (err) {
          console.error("[paste] save failed:", err);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
      setBusy(false);
      if (savedPaths.length > 0) {
        await addPaths(savedPaths);
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [project, addPaths]);

  // Native OS drag-drop via Tauri webview events
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((e) => {
        if (cancelled) return;
        const p = e.payload;
        if (p.type === "over") setDragging(true);
        else if (p.type === "leave") setDragging(false);
        else if (p.type === "drop") {
          setDragging(false);
          const imagePaths = (p.paths as string[]).filter((x) =>
            IMAGE_EXT.test(x)
          );
          if (imagePaths.length) void addPaths(imagePaths);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [addPaths]);

  async function handleImportClick() {
    try {
      const selection = await openDialog({
        multiple: true,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"],
          },
        ],
      });
      if (!selection) return;
      const paths = Array.isArray(selection) ? selection : [selection];
      await addPaths(paths);
    } catch (e) {
      console.error("[LibraryView] import dialog failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRoleChange(id: number, role: RefImageRole) {
    try {
      await updateRefImage(id, { role });
      await refresh();
    } catch (e) {
      console.error("[LibraryView] role change failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(id: number) {
    // C1: before deleting, scan current project's three workflow text fields
    // for any `(图N)` references to this image. Warn user — those references
    // will become orphans (the body still says "图3..." but the file is gone).
    const target = images.find((i) => i.id === id);
    if (target && project) {
      const ref = new RegExp(`\\(图\\s*${target.image_index}\\)`);
      const wheres: string[] = [];
      if (ref.test(project.draft_text)) wheres.push("Draft");
      if (ref.test(project.first_pass_text)) wheres.push("First Pass");
      if (ref.test(project.final_pass_text)) wheres.push("Final");
      if (wheres.length > 0) {
        const ok = confirm(
          `图${target.image_index} 在 ${wheres.join("、")} 里被引用。\n\n删除后这些 (图${target.image_index}) 会变成"野引用"（文字还在但图没了，提交时即梦看不到图会瞎编）。\n\n继续删？`
        );
        if (!ok) return;
      }
    }
    try {
      await deleteRefImage(id);
      await refresh();
    } catch (e) {
      console.error("[LibraryView] delete failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const counts = {
    total: images.length,
    char: images.filter((i) => i.role === "character").length,
    scene: images.filter((i) => i.role === "scene").length,
    prop: images.filter((i) => i.role === "prop").length,
  };

  return (
    <div>
      <div className="border-b border-vellum-border px-8 py-7 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-vellum-accent text-3xl font-medium tracking-[0.18em] uppercase">
            Library
          </h1>
          <div className="text-[11px] text-vellum-muted mt-3 uppercase tracking-wider flex items-center gap-1">
            <span>{counts.total} imgs</span>
            <Sep />
            <span>{counts.char} chars</span>
            <Sep />
            <span>{counts.scene} scenes</span>
            <Sep />
            <span>{counts.prop} props</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LayoutSwitcher layout={layout} setLayout={setLayout} />
          <button
            onClick={() => void refresh()}
            className="px-3 py-1.5 rounded text-xs text-vellum-muted hover:text-vellum-text hover:bg-vellum-elevated flex items-center gap-1.5 transition"
          >
            <RefreshCw size={11} /> Refresh
          </button>
          <button
            onClick={() => void handleImportClick()}
            disabled={busy}
            className="px-3 py-1.5 rounded text-xs bg-vellum-accent hover:bg-vellum-accent-hover text-black font-bold flex items-center gap-1.5 transition disabled:opacity-40"
          >
            <Plus size={11} /> {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 border border-red-900/60 bg-red-950/20 text-red-300 rounded p-3 text-xs flex items-start gap-2">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <div className="font-mono break-all">{error}</div>
          </div>
        )}

        {images.length === 0 ? (
          <div
            className={cn(
              "border border-dashed rounded p-16 text-center transition",
              dragging
                ? "border-vellum-accent bg-vellum-accent-soft"
                : "border-vellum-border"
            )}
          >
            <div
              className={cn(
                "text-sm transition",
                dragging ? "text-vellum-accent" : "text-vellum-muted"
              )}
            >
              {dragging
                ? "松手即导入"
                : "拖拽 Midjourney 出图到这里，或点 Import 选择文件"}
            </div>
            <div className="text-vellum-faint text-[11px] mt-2 tracking-wide">
              支持 png / jpg / jpeg / webp · 导入后自动生成 (图N) 编号
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "rounded p-4 -m-4 transition",
              dragging
                ? "ring-2 ring-vellum-accent ring-offset-4 ring-offset-vellum-bg bg-vellum-accent-soft/30"
                : ""
            )}
          >
            {layout === "grid" && (
              <GridLayout
                images={images}
                onOpen={(id) => setLightboxId(id)}
                onRoleChange={(id, r) => void handleRoleChange(id, r)}
                onDelete={(id) => void handleDelete(id)}
              />
            )}
            {layout === "masonry" && (
              <MasonryLayout
                images={images}
                onOpen={(id) => setLightboxId(id)}
                onRoleChange={(id, r) => void handleRoleChange(id, r)}
                onDelete={(id) => void handleDelete(id)}
              />
            )}
            {layout === "list" && (
              <ListLayout
                images={images}
                onOpen={(id) => setLightboxId(id)}
                onRoleChange={(id, r) => void handleRoleChange(id, r)}
                onDelete={(id) => void handleDelete(id)}
              />
            )}
          </div>
        )}
      </div>

      {lightboxId !== null && images.length > 0 && (
        <ImageLightbox
          images={images}
          startId={lightboxId}
          onClose={() => setLightboxId(null)}
          onRoleChange={(id, r) => void handleRoleChange(id, r)}
          onDelete={(id) => void handleDelete(id)}
        />
      )}
    </div>
  );
}

// ─── Layout switcher ────────────────────────────────────────────────

function LayoutSwitcher({
  layout,
  setLayout,
}: {
  layout: Layout;
  setLayout: (l: Layout) => void;
}) {
  const items: { id: Layout; icon: React.ReactNode; label: string }[] = [
    { id: "grid", icon: <LayoutGrid size={11} />, label: "Grid · 方格" },
    { id: "masonry", icon: <Columns3 size={11} />, label: "Masonry · 瀑布流" },
    { id: "list", icon: <ListIcon size={11} />, label: "List · 列表" },
  ];
  return (
    <div className="flex items-center border border-vellum-border rounded overflow-hidden">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => setLayout(it.id)}
          title={it.label}
          className={cn(
            "w-7 h-7 flex items-center justify-center transition",
            layout === it.id
              ? "bg-vellum-accent text-black"
              : "text-vellum-muted hover:text-vellum-text hover:bg-vellum-elevated"
          )}
        >
          {it.icon}
        </button>
      ))}
    </div>
  );
}

function Sep() {
  return <span className="mx-2 text-vellum-dim">·</span>;
}

// ─── Layout: Grid (uniform square) ──────────────────────────────────

function GridLayout({
  images,
  onOpen,
  onRoleChange,
  onDelete,
}: LayoutProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
      {images.map((img) => (
        <ImageCardGrid
          key={img.id}
          image={img}
          onOpen={() => onOpen(img.id)}
          onRoleChange={(r) => onRoleChange(img.id, r)}
          onDelete={() => onDelete(img.id)}
        />
      ))}
    </div>
  );
}

function ImageCardGrid({
  image,
  onOpen,
  onRoleChange,
  onDelete,
}: CardProps) {
  const src = convertFileSrc(image.file_path);
  const [imgError, setImgError] = useState(false);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(
          "application/vellum-image",
          JSON.stringify({ id: image.id, image_index: image.image_index })
        );
      }}
      className="bg-vellum-card border border-vellum-border rounded overflow-hidden group hover:border-vellum-accent-border transition cursor-grab active:cursor-grabbing"
    >
      <div
        className="aspect-square relative bg-vellum-elevated"
        onDoubleClick={onOpen}
      >
        {!imgError ? (
          <img
            src={src}
            alt=""
            onError={() => setImgError(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-vellum-faint text-[10px] text-center p-2">
            load failed
          </div>
        )}
        <IndexBadge n={image.image_index} />
        <DeleteHover onDelete={onDelete} />
      </div>
      <div className="p-2 space-y-1.5">
        <div
          className="text-[10px] text-vellum-faint truncate"
          title={image.name || image.file_path}
        >
          {image.name || "—"}
        </div>
        <RolePills role={image.role} onChange={onRoleChange} />
      </div>
    </div>
  );
}

// ─── Layout: Masonry (variable-height waterfall) ────────────────────

function MasonryLayout({
  images,
  onOpen,
  onRoleChange,
  onDelete,
}: LayoutProps) {
  return (
    <div
      className="gap-3 [column-fill:_balance]"
      style={{ columnCount: 4, columnGap: "0.75rem" }}
    >
      {images.map((img) => (
        <ImageCardMasonry
          key={img.id}
          image={img}
          onOpen={() => onOpen(img.id)}
          onRoleChange={(r) => onRoleChange(img.id, r)}
          onDelete={() => onDelete(img.id)}
        />
      ))}
    </div>
  );
}

function ImageCardMasonry({
  image,
  onOpen,
  onRoleChange,
  onDelete,
}: CardProps) {
  const src = convertFileSrc(image.file_path);
  const [imgError, setImgError] = useState(false);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(
          "application/vellum-image",
          JSON.stringify({ id: image.id, image_index: image.image_index })
        );
      }}
      className="bg-vellum-card border border-vellum-border rounded overflow-hidden group hover:border-vellum-accent-border transition cursor-grab active:cursor-grabbing mb-3 break-inside-avoid"
    >
      <div className="relative bg-vellum-elevated" onDoubleClick={onOpen}>
        {!imgError ? (
          <img
            src={src}
            alt=""
            onError={() => setImgError(true)}
            className="block w-full h-auto"
          />
        ) : (
          <div className="flex items-center justify-center text-vellum-faint text-[10px] text-center p-6 aspect-square">
            load failed
          </div>
        )}
        <IndexBadge n={image.image_index} />
        <DeleteHover onDelete={onDelete} />
      </div>
      <div className="p-2 space-y-1.5">
        <div
          className="text-[10px] text-vellum-faint truncate"
          title={image.name || image.file_path}
        >
          {image.name || "—"}
        </div>
        <RolePills role={image.role} onChange={onRoleChange} />
      </div>
    </div>
  );
}

// ─── Layout: List (Mac-style row with small thumb + meta) ───────────

function ListLayout({
  images,
  onOpen,
  onRoleChange,
  onDelete,
}: LayoutProps) {
  return (
    <div className="flex flex-col divide-y divide-vellum-border border border-vellum-border rounded overflow-hidden">
      {images.map((img) => (
        <ImageRowList
          key={img.id}
          image={img}
          onOpen={() => onOpen(img.id)}
          onRoleChange={(r) => onRoleChange(img.id, r)}
          onDelete={() => onDelete(img.id)}
        />
      ))}
    </div>
  );
}

function ImageRowList({
  image,
  onOpen,
  onRoleChange,
  onDelete,
}: CardProps) {
  const src = convertFileSrc(image.file_path);
  const [imgError, setImgError] = useState(false);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(
          "application/vellum-image",
          JSON.stringify({ id: image.id, image_index: image.image_index })
        );
      }}
      className="flex items-center gap-3 px-3 py-2 bg-vellum-card hover:bg-vellum-card-hi transition group cursor-grab active:cursor-grabbing"
      onDoubleClick={onOpen}
    >
      <div className="relative w-10 h-10 rounded overflow-hidden bg-vellum-elevated shrink-0">
        {!imgError ? (
          <img
            src={src}
            alt=""
            onError={() => setImgError(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-vellum-faint text-[8px]">
            ×
          </div>
        )}
      </div>
      <div
        className="text-vellum-accent shrink-0 w-9 text-center"
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontWeight: 400,
          fontSize: "16px",
        }}
      >
        {image.image_index}
      </div>
      <div className="text-[11px] text-vellum-muted uppercase tracking-wider shrink-0 w-16">
        {ROLE_LABEL[image.role]}
      </div>
      <div
        className="flex-1 text-[12px] text-vellum-text truncate"
        title={image.name || image.file_path}
      >
        {image.name || image.file_path.split("/").pop()}
      </div>
      <RolePills role={image.role} onChange={onRoleChange} compact />
      <button
        onClick={onDelete}
        className="w-7 h-7 flex items-center justify-center rounded text-vellum-faint hover:text-red-400 hover:bg-vellum-elevated transition opacity-0 group-hover:opacity-100"
        title="delete"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

// ─── Shared pieces ──────────────────────────────────────────────────

function IndexBadge({ n }: { n: number }) {
  return (
    <div className="absolute top-1.5 left-1.5 bg-vellum-bg/90 backdrop-blur-sm text-vellum-accent border border-vellum-accent-border rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider pointer-events-none">
      图{n}
    </div>
  );
}

function DeleteHover({ onDelete }: { onDelete: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
      title="delete"
      className="absolute top-1.5 right-1.5 bg-vellum-bg/90 backdrop-blur-sm border border-vellum-border rounded p-1 text-vellum-faint hover:text-red-400 hover:border-red-900 opacity-0 group-hover:opacity-100 transition"
    >
      <Trash2 size={11} />
    </button>
  );
}

function RolePills({
  role,
  onChange,
  compact,
}: {
  role: RefImageRole;
  onChange: (role: RefImageRole) => void;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex gap-1 text-[10px]", compact && "shrink-0")}>
      {ROLES.map((r) => (
        <button
          key={r}
          onClick={(e) => {
            e.stopPropagation();
            onChange(r);
          }}
          className={cn(
            "py-1 rounded uppercase tracking-wider transition",
            compact ? "px-2" : "flex-1",
            role === r
              ? "bg-vellum-accent text-black font-bold"
              : "bg-vellum-elevated text-vellum-muted hover:text-vellum-text"
          )}
        >
          {ROLE_LABEL[r]}
        </button>
      ))}
    </div>
  );
}

// ─── shared types ───────────────────────────────────────────────────

interface LayoutProps {
  images: RefImage[];
  onOpen: (id: number) => void;
  onRoleChange: (id: number, role: RefImageRole) => void;
  onDelete: (id: number) => void;
}

interface CardProps {
  image: RefImage;
  onOpen: () => void;
  onRoleChange: (role: RefImageRole) => void;
  onDelete: () => void;
}
