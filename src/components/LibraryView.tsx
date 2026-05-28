import { useCallback, useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeFile, mkdir, exists, readFile } from "@tauri-apps/plugin-fs";
import { appLocalDataDir, join } from "@tauri-apps/api/path";
import {
  Plus,
  RefreshCw,
  Trash2,
  AlertCircle,
  LayoutGrid,
  Columns3,
  List as ListIcon,
  Trash,
  RotateCcw,
  XCircle,
  Pencil,
  Copy,
  Eye,
} from "lucide-react";
import type { RefImage, RefImageRole } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/types";
import {
  addRefImage,
  updateRefImage,
  deleteRefImage,
  listTrashedRefImages,
  restoreRefImage,
  permanentlyDeleteRefImage,
  compactImageIndices,
} from "@/lib/db";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ImageLightbox } from "./ImageLightbox";
import { ContextMenu } from "./ContextMenu";
import { RenameDialog } from "./RenameDialog";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const ROLES: RefImageRole[] = ["character", "scene", "prop"];

function mimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  return "image/png";
}

async function blobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建图片画布");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((png) => {
      if (png) resolve(png);
      else reject(new Error("图片转 PNG 失败"));
    }, "image/png");
  });
}

async function readImageAsClipboardPng(filePath: string): Promise<Blob> {
  const bytes = await readFile(filePath);
  const source = new Blob([bytes], { type: mimeFromPath(filePath) });
  return blobToPng(source);
}

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

  // Multi-select + trash
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showTrash, setShowTrash] = useState(false);
  const [trashedImages, setTrashedImages] = useState<RefImage[]>([]);
  const [imageMenu, setImageMenu] = useState<{
    x: number;
    y: number;
    image: RefImage;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<RefImage | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  // Marquee rectangle (client coords, fixed-position overlay)
  const [marquee, setMarquee] = useState<null | {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }>(null);

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
      // Densify image_index → 1..N and rewrite (图N) refs to match. Idempotent;
      // a no-op when indices are already sequential.
      await compactImageIndices(project.id);
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

  async function handleRenameImage(img: RefImage, next: string) {
    if (!next || next === img.name) return;
    await updateRefImage(img.id, { name: next });
    await refresh();
  }

  async function handleCopyImagePath(img: RefImage) {
    try {
      await navigator.clipboard.writeText(img.file_path);
    } catch (e) {
      console.error("[LibraryView] copy path failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleCopyImage(img: RefImage) {
    try {
      setError(null);
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        await navigator.clipboard.writeText(img.file_path);
        setError("当前系统不支持复制图片本体，已改为复制文件路径。");
        return;
      }
      const png = await readImageAsClipboardPng(img.file_path);
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": png }),
      ]);
    } catch (e) {
      console.error("[LibraryView] copy image failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Soft-delete an image. Goes to trash, recoverable. No more confirm dialog
   * since deletion is now reversible — user can hit Trash button + Restore.
   * (图N) refs in shot text show as orphans until restored or stripped, same
   * as before.
   */
  async function handleDelete(id: number) {
    try {
      await deleteRefImage(id);
      await refresh();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e) {
      console.error("[LibraryView] delete failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    try {
      for (const id of selectedIds) {
        await deleteRefImage(id);
      }
      setSelectedIds(new Set());
      await refresh();
    } catch (e) {
      console.error("[LibraryView] bulk delete failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Trash CRUD
  const refreshTrash = useCallback(async () => {
    if (!project) return;
    try {
      const list = await listTrashedRefImages(project.id);
      setTrashedImages(list);
    } catch (e) {
      console.error("[LibraryView] refreshTrash failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [project]);

  async function handleRestore(id: number) {
    try {
      await restoreRefImage(id);
      await Promise.all([refresh(), refreshTrash()]);
    } catch (e) {
      console.error("[LibraryView] restore failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handlePermanentDelete(id: number) {
    try {
      await permanentlyDeleteRefImage(id);
      await refreshTrash();
    } catch (e) {
      console.error("[LibraryView] permanent delete failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleEmptyTrash() {
    if (trashedImages.length === 0) return;
    const ok = confirm(
      `彻底删除垃圾桶里全部 ${trashedImages.length} 张图？此操作不可恢复（DB 行真删除，磁盘文件不动）。`
    );
    if (!ok) return;
    try {
      for (const img of trashedImages) {
        await permanentlyDeleteRefImage(img.id);
      }
      await refreshTrash();
    } catch (e) {
      console.error("[LibraryView] empty trash failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Load trash list when entering trash view
  useEffect(() => {
    if (showTrash) void refreshTrash();
  }, [showTrash, refreshTrash]);

  // Refresh trash count on initial mount and on project switch (for header badge)
  useEffect(() => {
    void refreshTrash();
  }, [refreshTrash]);

  // Marquee selection: rubber-band rectangle that starts on mousedown anywhere
  // inside the Library view (except on cards / interactive controls / header
  // buttons). Listener lives on document so it doesn't depend on gridRef
  // having been assigned by render time.
  useEffect(() => {
    if (showTrash) return; // no marquee in trash view

    let startX = 0;
    let startY = 0;
    let isMarqueeing = false;
    // 4px threshold to distinguish "click on empty area" from "drag to select"
    // (avoids accidentally clearing selection on a stationary click)
    const DRAG_THRESHOLD = 4;
    let isPastThreshold = false;

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return; // primary button only

      const target = e.target as Element | null;
      // Ignore clicks on cards, role pills, delete buttons, layout switcher etc.
      if (target?.closest("[data-image-id]")) return;
      if (target?.closest("button, input, textarea, a, select")) return;
      // Only handle clicks inside the Library main content area — sidebar /
      // top bar / status bar are out of scope.
      if (!target?.closest("[data-library-root]")) return;

      startX = e.clientX;
      startY = e.clientY;
      isMarqueeing = true;
      isPastThreshold = false;
    }

    function onMouseMove(e: MouseEvent) {
      if (!isMarqueeing) return;
      const x2 = e.clientX;
      const y2 = e.clientY;

      if (!isPastThreshold) {
        const dx = Math.abs(x2 - startX);
        const dy = Math.abs(y2 - startY);
        if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
        isPastThreshold = true;
        // Clear any previous selection only once we know it's a drag.
        setSelectedIds(new Set());
      }

      setMarquee({ x1: startX, y1: startY, x2, y2 });

      const left = Math.min(startX, x2);
      const right = Math.max(startX, x2);
      const top = Math.min(startY, y2);
      const bottom = Math.max(startY, y2);

      const next = new Set<number>();
      document.querySelectorAll("[data-image-id]").forEach((card) => {
        const r = (card as HTMLElement).getBoundingClientRect();
        if (
          r.right >= left &&
          r.left <= right &&
          r.bottom >= top &&
          r.top <= bottom
        ) {
          const id = Number(card.getAttribute("data-image-id"));
          if (!Number.isNaN(id)) next.add(id);
        }
      });
      setSelectedIds((prev) => {
        if (prev.size === next.size && [...prev].every((id) => next.has(id))) {
          return prev;
        }
        return next;
      });
    }

    function onMouseUp() {
      if (!isMarqueeing) return;
      isMarqueeing = false;
      isPastThreshold = false;
      setMarquee(null);
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [showTrash]);

  // Delete / Backspace keyboard bulk-delete when items selected
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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
      if (e.key === "Escape") {
        if (selectedIds.size > 0) {
          e.preventDefault();
          setSelectedIds(new Set());
        }
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0 && !showTrash) {
        e.preventDefault();
        void handleBulkDelete();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, showTrash]);

  const counts = {
    total: images.length,
    char: images.filter((i) => i.role === "character").length,
    scene: images.filter((i) => i.role === "scene").length,
    prop: images.filter((i) => i.role === "prop").length,
  };

  return (
    <div className="relative">
      <div className="border-b border-vellum-border px-8 py-7 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-vellum-accent text-3xl font-medium uppercase">
            {showTrash ? "Library / Trash" : "Library"}
          </h1>
          <div className="text-[11px] text-vellum-muted mt-3 uppercase flex items-center gap-1">
            {showTrash ? (
              <span>{trashedImages.length} in trash</span>
            ) : (
              <>
                <span>{counts.total} imgs</span>
                <Sep />
                <span>{counts.char} chars</span>
                <Sep />
                <span>{counts.scene} scenes</span>
                <Sep />
                <span>{counts.prop} props</span>
                {trashedImages.length > 0 && (
                  <>
                    <Sep />
                    <span className="text-vellum-faint">
                      {trashedImages.length} trashed
                    </span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!showTrash && <LayoutSwitcher layout={layout} setLayout={setLayout} />}
          <button
            onClick={() => {
              setShowTrash((v) => !v);
              setSelectedIds(new Set());
            }}
            title={showTrash ? "Back to library" : "View trash"}
            className={cn(
              "px-3 py-1.5 rounded text-xs flex items-center gap-1.5 transition",
              showTrash
                ? "bg-vellum-accent-soft text-vellum-text border border-vellum-accent-border"
                : "text-vellum-muted hover:text-vellum-text hover:bg-vellum-elevated"
            )}
          >
            <Trash size={11} />
            {showTrash ? "Back" : "Trash"}
            {!showTrash && trashedImages.length > 0 && (
              <span className="ml-1 px-1.5 rounded bg-vellum-elevated text-vellum-faint text-[10px]">
                {trashedImages.length}
              </span>
            )}
          </button>
          {showTrash && trashedImages.length > 0 && (
            <button
              onClick={() => void handleEmptyTrash()}
              className="px-3 py-1.5 rounded text-xs text-red-400 hover:bg-red-950/30 border border-red-900/50 flex items-center gap-1.5 transition"
            >
              <XCircle size={11} /> Empty trash
            </button>
          )}
          {!showTrash && (
            <>
              <button
                onClick={() => void refresh()}
                className="px-3 py-1.5 rounded text-xs text-vellum-muted hover:text-vellum-text hover:bg-vellum-elevated flex items-center gap-1.5 transition"
              >
                <RefreshCw size={11} /> Refresh
              </button>
              <button
                onClick={() => void handleImportClick()}
                disabled={busy}
                className="px-3 py-1.5 rounded text-xs bg-vellum-accent hover:bg-vellum-accent-hover text-vellum-bg font-bold flex items-center gap-1.5 transition disabled:opacity-40"
              >
                <Plus size={11} /> {busy ? "Importing…" : "Import"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="p-8" data-library-root>
        {error && (
          <div className="mb-6 border border-red-900/60 bg-red-950/20 text-red-300 rounded p-3 text-xs flex items-start gap-2">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <div className="font-mono break-all">{error}</div>
          </div>
        )}

        {showTrash ? (
          trashedImages.length === 0 ? (
            <div className="border border-dashed border-vellum-border rounded p-16 text-center text-vellum-muted text-sm">
              垃圾桶空了
              <div className="text-vellum-faint text-[11px] mt-2">
                软删除的图会在此显示 · 可恢复或彻底清除
              </div>
            </div>
          ) : (
            <TrashGrid
              images={trashedImages}
              onRestore={(id) => void handleRestore(id)}
              onPermanentDelete={(id) => void handlePermanentDelete(id)}
            />
          )
        ) : images.length === 0 ? (
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
                : "拖拽 Midjourney 出图到这里，或点 Import 选择文件 · 也可 Cmd+V 粘贴"}
            </div>
            <div className="text-vellum-faint text-[11px] mt-2">
              支持 png / jpg / jpeg / webp · 导入后自动生成 (图N) 编号
            </div>
          </div>
        ) : (
          <div
            ref={gridRef}
            className={cn(
              "rounded p-4 -m-4 transition select-none",
              dragging
                ? "ring-2 ring-vellum-accent ring-offset-4 ring-offset-vellum-bg bg-vellum-accent-soft/30"
                : ""
            )}
          >
            {layout === "grid" && (
              <GridLayout
                images={images}
                selectedIds={selectedIds}
                onOpen={(id) => setLightboxId(id)}
                onRoleChange={(id, r) => void handleRoleChange(id, r)}
                onDelete={(id) => void handleDelete(id)}
                onContextMenu={(event, image) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setSelectedIds(new Set([image.id]));
                  setImageMenu({ x: event.clientX, y: event.clientY, image });
                }}
              />
            )}
            {layout === "masonry" && (
              <MasonryLayout
                images={images}
                selectedIds={selectedIds}
                onOpen={(id) => setLightboxId(id)}
                onRoleChange={(id, r) => void handleRoleChange(id, r)}
                onDelete={(id) => void handleDelete(id)}
                onContextMenu={(event, image) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setSelectedIds(new Set([image.id]));
                  setImageMenu({ x: event.clientX, y: event.clientY, image });
                }}
              />
            )}
            {layout === "list" && (
              <ListLayout
                images={images}
                selectedIds={selectedIds}
                onOpen={(id) => setLightboxId(id)}
                onRoleChange={(id, r) => void handleRoleChange(id, r)}
                onDelete={(id) => void handleDelete(id)}
                onContextMenu={(event, image) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setSelectedIds(new Set([image.id]));
                  setImageMenu({ x: event.clientX, y: event.clientY, image });
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Marquee rectangle overlay (client-fixed coords) */}
      {marquee && (
        <div
          className="fixed pointer-events-none border-2 border-vellum-accent z-40"
          style={{
            left: Math.min(marquee.x1, marquee.x2),
            top: Math.min(marquee.y1, marquee.y2),
            width: Math.abs(marquee.x2 - marquee.x1),
            height: Math.abs(marquee.y2 - marquee.y1),
            background: "rgba(212, 208, 200, 0.18)",
          }}
        />
      )}

      {/* Bulk action bar — visible when selection non-empty in active view */}
      {!showTrash && selectedIds.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-vellum-card border border-vellum-accent-border shadow-2xl">
          <span className="text-xs text-vellum-text">
            已选 <span className="text-vellum-accent font-bold">{selectedIds.size}</span> 张
          </span>
          <div className="w-px h-4 bg-vellum-border mx-1" />
          <button
            onClick={() => void handleBulkDelete()}
            className="px-3 py-1.5 rounded text-xs bg-red-950/40 hover:bg-red-900/50 text-red-300 border border-red-900/50 flex items-center gap-1.5 transition"
          >
            <Trash2 size={11} /> Delete · 进垃圾桶
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="px-3 py-1.5 rounded text-xs text-vellum-muted hover:text-vellum-text hover:bg-vellum-elevated transition"
          >
            Cancel · Esc
          </button>
        </div>
      )}

      {lightboxId !== null && images.length > 0 && (
        <ImageLightbox
          images={images}
          startId={lightboxId}
          onClose={() => setLightboxId(null)}
          onRoleChange={(id, r) => void handleRoleChange(id, r)}
          onDelete={(id) => void handleDelete(id)}
        />
      )}

      {imageMenu && (
        <ContextMenu
          x={imageMenu.x}
          y={imageMenu.y}
          onClose={() => setImageMenu(null)}
          items={[
            {
              label: "打开预览",
              icon: <Eye size={12} />,
              onSelect: () => setLightboxId(imageMenu.image.id),
            },
            {
              label: "重命名",
              hint: "rename",
              icon: <Pencil size={12} />,
              onSelect: () => setRenameTarget(imageMenu.image),
            },
            {
              label: "复制图片",
              hint: "copy",
              icon: <Copy size={12} />,
              onSelect: () => void handleCopyImage(imageMenu.image),
            },
            {
              label: "复制文件路径",
              icon: <Copy size={12} />,
              onSelect: () => void handleCopyImagePath(imageMenu.image),
            },
            { type: "separator" },
            ...ROLES.map((role) => ({
              label: `设为${ROLE_LABEL[role]}`,
              disabled: imageMenu.image.role === role,
              onSelect: () => void handleRoleChange(imageMenu.image.id, role),
            })),
            { type: "separator" },
            {
              label: "删除图片",
              hint: "delete",
              icon: <Trash2 size={12} />,
              destructive: true,
              onSelect: () => void handleDelete(imageMenu.image.id),
            },
          ]}
        />
      )}
      {renameTarget && (
        <RenameDialog
          title={`重命名图${renameTarget.image_index}`}
          initialValue={renameTarget.name || `图${renameTarget.image_index}`}
          placeholder="图片名称"
          onClose={() => setRenameTarget(null)}
          onSubmit={(next) => handleRenameImage(renameTarget, next)}
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
              ? "bg-vellum-accent text-vellum-bg"
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
  return <span className="mx-4 text-vellum-dim">·</span>;
}

// ─── Layout: Grid (uniform square) ──────────────────────────────────

function GridLayout({
  images,
  selectedIds,
  onOpen,
  onRoleChange,
  onDelete,
  onContextMenu,
}: LayoutProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
      {images.map((img) => (
        <ImageCardGrid
          key={img.id}
          image={img}
          selected={selectedIds.has(img.id)}
          onOpen={() => onOpen(img.id)}
          onRoleChange={(r) => onRoleChange(img.id, r)}
          onDelete={() => onDelete(img.id)}
          onContextMenu={(e) => onContextMenu(e, img)}
        />
      ))}
    </div>
  );
}

function ImageCardGrid({
  image,
  selected,
  onOpen,
  onRoleChange,
  onDelete,
  onContextMenu,
}: CardProps) {
  const src = convertFileSrc(image.file_path);
  const [imgError, setImgError] = useState(false);
  return (
    <div
      data-image-id={image.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(
          "application/vellum-image",
          JSON.stringify({ id: image.id, image_index: image.image_index })
        );
      }}
      onContextMenu={onContextMenu}
      className={cn(
        "bg-vellum-card border rounded overflow-hidden group transition cursor-grab active:cursor-grabbing",
        selected
          ? "border-vellum-accent ring-2 ring-vellum-accent ring-offset-2 ring-offset-vellum-bg"
          : "border-vellum-border hover:border-vellum-accent-border"
      )}
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
  selectedIds,
  onOpen,
  onRoleChange,
  onDelete,
  onContextMenu,
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
          selected={selectedIds.has(img.id)}
          onOpen={() => onOpen(img.id)}
          onRoleChange={(r) => onRoleChange(img.id, r)}
          onDelete={() => onDelete(img.id)}
          onContextMenu={(e) => onContextMenu(e, img)}
        />
      ))}
    </div>
  );
}

function ImageCardMasonry({
  image,
  selected,
  onOpen,
  onRoleChange,
  onDelete,
  onContextMenu,
}: CardProps) {
  const src = convertFileSrc(image.file_path);
  const [imgError, setImgError] = useState(false);
  return (
    <div
      data-image-id={image.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(
          "application/vellum-image",
          JSON.stringify({ id: image.id, image_index: image.image_index })
        );
      }}
      onContextMenu={onContextMenu}
      className={cn(
        "bg-vellum-card border rounded overflow-hidden group transition cursor-grab active:cursor-grabbing mb-3 break-inside-avoid",
        selected
          ? "border-vellum-accent ring-2 ring-vellum-accent ring-offset-2 ring-offset-vellum-bg"
          : "border-vellum-border hover:border-vellum-accent-border"
      )}
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
  selectedIds,
  onOpen,
  onRoleChange,
  onDelete,
  onContextMenu,
}: LayoutProps) {
  return (
    <div className="flex flex-col divide-y divide-vellum-border border border-vellum-border rounded overflow-hidden">
      {images.map((img) => (
        <ImageRowList
          key={img.id}
          image={img}
          selected={selectedIds.has(img.id)}
          onOpen={() => onOpen(img.id)}
          onRoleChange={(r) => onRoleChange(img.id, r)}
          onDelete={() => onDelete(img.id)}
          onContextMenu={(e) => onContextMenu(e, img)}
        />
      ))}
    </div>
  );
}

function ImageRowList({
  image,
  selected,
  onOpen,
  onRoleChange,
  onDelete,
  onContextMenu,
}: CardProps) {
  const src = convertFileSrc(image.file_path);
  const [imgError, setImgError] = useState(false);
  return (
    <div
      data-image-id={image.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(
          "application/vellum-image",
          JSON.stringify({ id: image.id, image_index: image.image_index })
        );
      }}
      onContextMenu={onContextMenu}
      className={cn(
        "flex items-center gap-3 px-3 py-2 transition group cursor-grab active:cursor-grabbing",
        selected
          ? "bg-vellum-accent-soft border-l-2 border-vellum-accent"
          : "bg-vellum-card hover:bg-vellum-card-hi"
      )}
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
      <div className="text-[11px] text-vellum-muted uppercase shrink-0 w-16">
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
    <div className="absolute top-1.5 left-1.5 bg-vellum-bg/90 backdrop-blur-sm text-vellum-accent border border-vellum-accent-border rounded px-1.5 py-0.5 text-[10px] font-bold pointer-events-none">
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
            "py-1 rounded uppercase transition",
            compact ? "px-2" : "flex-1",
            role === r
              ? "bg-vellum-accent text-vellum-bg font-bold"
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
  selectedIds: Set<number>;
  onOpen: (id: number) => void;
  onRoleChange: (id: number, role: RefImageRole) => void;
  onDelete: (id: number) => void;
  onContextMenu: (
    event: React.MouseEvent<HTMLElement>,
    image: RefImage
  ) => void;
}

interface CardProps {
  image: RefImage;
  selected: boolean;
  onOpen: () => void;
  onRoleChange: (role: RefImageRole) => void;
  onDelete: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
}

// ─── Trash grid (read-only thumbnails with restore + permanent-delete) ──

function TrashGrid({
  images,
  onRestore,
  onPermanentDelete,
}: {
  images: RefImage[];
  onRestore: (id: number) => void;
  onPermanentDelete: (id: number) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
      {images.map((img) => {
        const src = convertFileSrc(img.file_path);
        return (
          <div
            key={img.id}
            className="bg-vellum-card border border-vellum-border rounded overflow-hidden opacity-60 hover:opacity-100 transition"
          >
            <div className="aspect-square relative bg-vellum-elevated">
              <img
                src={src}
                alt=""
                className="absolute inset-0 w-full h-full object-cover grayscale"
              />
              <div className="absolute top-1.5 left-1.5 bg-vellum-bg/90 backdrop-blur-sm text-vellum-faint border border-vellum-border rounded px-1.5 py-0.5 text-[10px] font-bold pointer-events-none">
                图{img.image_index}
              </div>
            </div>
            <div className="p-2 space-y-1.5">
              <div
                className="text-[10px] text-vellum-faint truncate"
                title={img.name || img.file_path}
              >
                {img.name || "—"}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => onRestore(img.id)}
                  className="flex-1 py-1 rounded text-[10px] text-vellum-text bg-vellum-elevated hover:bg-vellum-accent hover:text-vellum-bg transition flex items-center justify-center gap-1"
                  title="restore"
                >
                  <RotateCcw size={10} /> Restore
                </button>
                <button
                  onClick={() => onPermanentDelete(img.id)}
                  className="py-1 px-2 rounded text-[10px] text-red-400 bg-red-950/30 hover:bg-red-900/50 border border-red-900/40 transition"
                  title="permanently delete"
                >
                  <XCircle size={10} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
