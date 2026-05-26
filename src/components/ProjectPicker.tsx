import { useEffect, useState } from "react";
import { FolderOpen, Plus, AlertCircle } from "lucide-react";
import { useApp } from "@/lib/store";

// Optional workspace image. Drop a file at public/workspace.jpg (or .png) and it
// will appear automatically. Falls back to a neon gradient placeholder.
const WORKSPACE_IMG = "/workspace.png";

export function ProjectPicker() {
  const projects = useApp((s) => s.projects);
  const initialized = useApp((s) => s.initialized);
  const loading = useApp((s) => s.loading);
  const error = useApp((s) => s.error);
  const init = useApp((s) => s.init);
  const selectProject = useApp((s) => s.selectProject);
  const newProject = useApp((s) => s.newProject);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    if (!initialized) void init();
  }, [initialized, init]);

  async function handleCreate() {
    const trimmed = name.trim();
    console.log("[ProjectPicker] handleCreate clicked, name=", trimmed);
    if (!trimmed) {
      setFormError("项目名不能为空");
      return;
    }
    setFormError("");
    setBusy(true);
    try {
      const project = await newProject(trimmed);
      console.log("[ProjectPicker] created:", project);
      setName("");
      setCreating(false);
    } catch (e) {
      console.error("[ProjectPicker] create failed:", e);
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canCreate = name.trim().length > 0 && !busy;

  return (
    <div className="h-screen w-screen bg-vellum-bg text-vellum-text flex">
      {/* Left: content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 shrink-0 flex items-center px-6 gap-3">
          <div className="text-vellum-accent text-xs tracking-[0.3em] font-bold">
            VELLUM
          </div>
          <span className="text-vellum-dim">/</span>
          <div className="text-[11px] text-vellum-faint uppercase tracking-wider">
            workspace
          </div>
        </header>

        <div className="flex-1 flex items-center overflow-auto px-16">
          <div className="w-full max-w-lg">
            <div className="mb-12">
              <h1 className="vellum-logo text-7xl leading-none mb-5">
                VELLUM
              </h1>
              <div className="text-vellum-muted text-sm tracking-wide">
                即梦视频提示词工作流
              </div>
              <div className="text-vellum-faint text-[11px] mt-1 uppercase tracking-wider">
                prompt forge · batch render
              </div>
            </div>

            {loading && (
              <div className="text-vellum-muted text-xs uppercase tracking-wider">
                Loading…
              </div>
            )}

            {error && (
              <div className="border border-red-900/60 bg-red-950/20 text-red-300 rounded p-3 text-xs mb-4 flex items-start gap-2">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <div>
                  <div className="font-bold uppercase tracking-wider mb-1">
                    DB error
                  </div>
                  <div className="font-mono text-[11px]">{error}</div>
                </div>
              </div>
            )}

            {!loading && projects.length > 0 && (
              <div className="space-y-1.5 mb-5">
                <div className="text-[10px] uppercase tracking-[0.18em] text-vellum-faint mb-2 px-1">
                  Projects · {projects.length}
                </div>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => selectProject(p)}
                    className="w-full flex items-center gap-3 px-3.5 py-3 rounded border border-vellum-border bg-vellum-card hover:border-vellum-accent-border hover:bg-vellum-card-hi transition group"
                  >
                    <div className="w-8 h-8 rounded-sm flex items-center justify-center bg-vellum-elevated text-vellum-accent text-xs font-bold border border-vellum-border">
                      {p.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-sm text-vellum-text truncate">
                        {p.name}
                      </div>
                      {p.description && (
                        <div className="text-[11px] text-vellum-faint truncate mt-0.5">
                          {p.description}
                        </div>
                      )}
                    </div>
                    <FolderOpen
                      size={13}
                      className="text-vellum-dim group-hover:text-vellum-accent transition"
                    />
                  </button>
                ))}
              </div>
            )}

            {creating ? (
              <div className="border border-vellum-accent-border bg-vellum-card rounded p-5">
                <div className="text-[10px] uppercase tracking-[0.18em] text-vellum-faint mb-3 flex items-center gap-1.5">
                  <Plus size={10} /> New Project
                </div>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (formError) setFormError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleCreate();
                    if (e.key === "Escape") {
                      setCreating(false);
                      setName("");
                      setFormError("");
                    }
                  }}
                  placeholder="项目名，例如：scene-001"
                  className={`w-full bg-vellum-bg border rounded px-3 py-2 text-vellum-text placeholder:text-vellum-dim text-sm focus:border-vellum-accent-border transition ${
                    formError
                      ? "border-red-500/60"
                      : "border-vellum-border"
                  }`}
                />
                {formError && (
                  <div className="text-red-400 text-xs mt-2 flex items-center gap-1.5">
                    <AlertCircle size={11} /> {formError}
                  </div>
                )}
                <div className="flex gap-2 mt-4 items-center">
                  <button
                    onClick={() => void handleCreate()}
                    disabled={!canCreate}
                    className="px-4 py-1.5 bg-vellum-accent hover:bg-vellum-accent-hover text-black rounded text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed transition"
                  >
                    {busy ? "Creating…" : "Create"}
                  </button>
                  <button
                    onClick={() => {
                      setCreating(false);
                      setName("");
                      setFormError("");
                    }}
                    disabled={busy}
                    className="px-3 py-1.5 text-vellum-muted hover:text-vellum-text rounded text-xs disabled:opacity-40 transition"
                  >
                    Cancel
                  </button>
                  <div className="ml-auto text-[10px] text-vellum-dim uppercase tracking-wider">
                    ↵ confirm · esc cancel
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="w-full border border-vellum-border border-dashed rounded px-4 py-3.5 text-vellum-muted hover:border-vellum-accent-border hover:text-vellum-text hover:bg-vellum-card flex items-center justify-center gap-2 text-sm transition"
              >
                <Plus size={13} /> New project
              </button>
            )}
          </div>
        </div>

        <footer className="h-6 shrink-0 flex items-center px-6 text-[10px] uppercase tracking-wider text-vellum-faint">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-vellum-success" />
            <span>vellum studio</span>
          </div>
          <div className="ml-auto">v0.1.0</div>
        </footer>
      </div>

      {/* Right: image panel */}
      <div className="w-[42%] relative shrink-0 overflow-hidden">
        {!imgFailed ? (
          <img
            src={WORKSPACE_IMG}
            alt=""
            onError={() => setImgFailed(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 workspace-bg-placeholder">
            <div className="absolute bottom-6 left-6 right-6 text-[10px] uppercase tracking-[0.18em] text-vellum-faint">
              <div className="opacity-60">drop image at</div>
              <div className="font-mono normal-case tracking-normal text-vellum-muted mt-1">
                public/workspace.jpg
              </div>
            </div>
          </div>
        )}
        {/* Subtle left edge fade to blend with content area */}
        <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-vellum-bg to-transparent pointer-events-none" />
      </div>
    </div>
  );
}
