import { useEffect, useState } from "react";
import type { ButtonHTMLAttributes, ElementType, ReactNode } from "react";
import {
  Home,
  Search,
  Bell,
  ChevronDown,
  Settings as SettingsIcon,
  Image as ImageIcon,
  Film,
  Send,
  FolderOpen,
  Check,
  ChevronRight,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { RefImage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useApp } from "@/lib/store";
import { ProjectPicker } from "@/components/ProjectPicker";
import { LibraryView } from "@/components/LibraryView";
import { ShotsView } from "@/components/ShotsView";
import { SettingsButton } from "@/components/SettingsModal";

type View = "library" | "shots" | "submit";

const NAV: { id: View; label: string; icon: ElementType }[] = [
  { id: "library", label: "Library", icon: ImageIcon },
  { id: "shots", label: "Shots", icon: Film },
  { id: "submit", label: "Submit", icon: Send },
];

function App() {
  const currentProject = useApp((s) => s.currentProject);
  const init = useApp((s) => s.init);
  const initialized = useApp((s) => s.initialized);
  const [view, setView] = useState<View>("library");

  useEffect(() => {
    if (!initialized) void init();
  }, [initialized, init]);

  if (!currentProject) {
    return <ProjectPicker />;
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-vellum-bg text-vellum-text">
      <TopBar view={view} />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar view={view} setView={setView} />
        <main className="flex-1 overflow-auto">
          {view === "library" && <LibraryView />}
          {view === "shots" && <ShotsView />}
          {view === "submit" && <SubmitView />}
        </main>
      </div>
      <StatusBar />
    </div>
  );
}

// ─── Top Bar ────────────────────────────────────────────────────────

function TopBar({ view }: { view: View }) {
  const currentProject = useApp((s) => s.currentProject);
  const selectProject = useApp((s) => s.selectProject);
  return (
    <header className="h-12 shrink-0 border-b border-vellum-border flex items-center px-3 gap-3">
      <button
        onClick={() => selectProject(null)}
        title="Back to projects"
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-vellum-elevated text-vellum-muted hover:text-vellum-text transition"
      >
        <Home size={14} />
      </button>
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-vellum-faint">vellum</span>
        <span className="text-vellum-dim">/</span>
        <span className="text-vellum-text">{currentProject?.name}</span>
        <span className="text-vellum-dim">/</span>
        <span className="text-vellum-muted lowercase">{view}</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-vellum-faint pointer-events-none"
          />
          <input
            placeholder="Jump to anything"
            className="w-72 bg-vellum-elevated/40 border border-vellum-border rounded pl-7 pr-12 py-1.5 text-xs placeholder:text-vellum-faint focus:border-vellum-border-strong transition"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-vellum-faint bg-vellum-elevated px-1.5 py-0.5 rounded font-mono">
            ⌘K
          </kbd>
        </div>
        <SettingsButton />
        <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-vellum-elevated text-vellum-muted hover:text-vellum-text transition">
          <Bell size={13} />
        </button>
      </div>
    </header>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────

function Sidebar({
  view,
  setView,
}: {
  view: View;
  setView: (v: View) => void;
}) {
  const currentProject = useApp((s) => s.currentProject);
  const projects = useApp((s) => s.projects);
  const selectProject = useApp((s) => s.selectProject);
  const [openSwitcher, setOpenSwitcher] = useState(false);

  return (
    <aside className="w-64 shrink-0 border-r border-vellum-border bg-vellum-panel flex flex-col overflow-y-auto">
      {/* Active project + switcher */}
      <div className="p-3">
        <SectionLabel>Active Project</SectionLabel>
        <button
          onClick={() => setOpenSwitcher((v) => !v)}
          className={cn(
            "w-full flex items-start gap-2 px-2.5 py-2 rounded bg-vellum-card border transition group",
            openSwitcher
              ? "border-vellum-accent-border"
              : "border-vellum-border hover:border-vellum-border-strong"
          )}
        >
          <FolderOpen
            size={13}
            className="mt-0.5 text-vellum-accent shrink-0"
          />
          <div className="flex-1 min-w-0 text-left">
            <div className="text-[10px] uppercase tracking-[0.15em] text-vellum-faint">
              PRJ
            </div>
            <div className="text-sm text-vellum-text truncate">
              {currentProject?.name}
            </div>
          </div>
          <ChevronDown
            size={13}
            className={cn(
              "mt-1.5 text-vellum-faint transition",
              openSwitcher && "rotate-180"
            )}
          />
        </button>

        {openSwitcher && (
          <div className="mt-2 p-1.5 rounded bg-vellum-card border border-vellum-accent-border">
            <div className="text-[10px] uppercase tracking-[0.15em] text-vellum-faint px-2 py-1.5 flex items-center gap-1.5">
              <ChevronDown size={9} className="-rotate-90" />
              Switch project to
            </div>
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  selectProject(p);
                  setOpenSwitcher(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition",
                  p.id === currentProject?.id
                    ? "bg-vellum-accent-soft text-vellum-text"
                    : "hover:bg-vellum-elevated text-vellum-muted"
                )}
              >
                <Avatar letter={p.name.slice(0, 1)} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs truncate">{p.name}</div>
                  {p.description && (
                    <div className="text-[10px] text-vellum-faint truncate">
                      {p.description}
                    </div>
                  )}
                </div>
                {p.id === currentProject?.id && (
                  <Check size={11} className="text-vellum-accent" />
                )}
              </button>
            ))}
            <button
              onClick={() => {
                setOpenSwitcher(false);
                selectProject(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 mt-1 border-t border-vellum-border pt-2 rounded text-vellum-muted hover:bg-vellum-elevated hover:text-vellum-text transition"
            >
              <SettingsIcon size={11} />
              <span className="text-xs">Manage projects…</span>
            </button>
          </div>
        )}
      </div>

      {/* Workbench nav */}
      <div className="px-3">
        <SectionLabel>Workbench</SectionLabel>
        <nav className="flex flex-col">
          <LibraryNavItem active={view === "library"} onNav={() => setView("library")} />
          {NAV.filter((i) => i.id !== "library").map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={cn(
                  "relative flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded text-sm transition",
                  active
                    ? "bg-vellum-accent-soft text-vellum-text"
                    : "text-vellum-muted hover:bg-vellum-elevated hover:text-vellum-text"
                )}
              >
                {active && (
                  <div className="absolute left-0 top-1.5 bottom-1.5 w-[2px] bg-vellum-accent rounded-r" />
                )}
                <Icon size={13} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Recent */}
      <div className="px-3 mt-6">
        <SectionLabel>Recent</SectionLabel>
        <div className="text-xs text-vellum-faint px-2 py-1">
          No activity yet
        </div>
      </div>

      <div className="mt-auto p-3 border-t border-vellum-border">
        <div className="flex items-center gap-1.5 text-[11px] text-vellum-faint">
          <div className="w-1.5 h-1.5 rounded-full bg-vellum-success" />
          <span>synced</span>
          <span className="ml-auto">v0.1.0</span>
        </div>
      </div>
    </aside>
  );
}

// ─── Library nav item with expandable thumbnail grid ────────────────

function LibraryNavItem({
  active,
  onNav,
}: {
  active: boolean;
  onNav: () => void;
}) {
  const refImages = useApp((s) => s.refImages);
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <div
        className={cn(
          "relative flex items-center rounded transition group",
          active
            ? "bg-vellum-accent-soft text-vellum-text"
            : "text-vellum-muted hover:bg-vellum-elevated hover:text-vellum-text"
        )}
      >
        {active && (
          <div className="absolute left-0 top-1.5 bottom-1.5 w-[2px] bg-vellum-accent rounded-r" />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="pl-1.5 pr-1 py-1.5 hover:text-vellum-accent transition"
          title={expanded ? "collapse" : "expand"}
        >
          <ChevronRight
            size={11}
            className={cn(
              "transition-transform",
              expanded && "rotate-90"
            )}
          />
        </button>
        <button
          onClick={onNav}
          className="flex-1 flex items-center gap-2 pr-2 py-1.5 text-sm text-left"
        >
          <span>Library</span>
          <span className="ml-auto text-[10px] text-vellum-faint font-mono">
            {refImages.length}
          </span>
        </button>
      </div>
      {expanded && (
        <div className="pl-5 pr-1 py-1.5">
          {refImages.length === 0 ? (
            <div className="text-[10px] text-vellum-dim italic py-1 px-1">
              empty · import in Library
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1">
              {refImages.map((img) => (
                <Thumb key={img.id} img={img} onClick={onNav} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Thumb({
  img,
  onClick,
}: {
  img: RefImage;
  onClick: () => void;
}) {
  const src = convertFileSrc(img.file_path);
  return (
    <button
      onClick={onClick}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(
          "application/vellum-image",
          JSON.stringify({ id: img.id, image_index: img.image_index })
        );
      }}
      title={`图${img.image_index} · ${img.role}${img.name ? ` · ${img.name}` : ""} · 拖到文本框里嵌入`}
      className="relative aspect-square rounded overflow-hidden border border-vellum-border hover:border-vellum-accent-border focus:border-vellum-accent transition bg-vellum-elevated group cursor-grab active:cursor-grabbing"
    >
      <img
        src={src}
        alt=""
        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
      />
      {/* gradient overlay so number always reads */}
      <div className="absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
      {/* number badge */}
      <div
        className="absolute left-0.5 bottom-0 text-vellum-accent pointer-events-none"
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 900,
          fontStyle: "italic",
          fontSize: "13px",
          lineHeight: 1,
          paddingBottom: "2px",
          paddingLeft: "3px",
          letterSpacing: "-0.02em",
          textShadow:
            "0 0 4px rgba(0,0,0,0.95), 0 1px 2px rgba(0,0,0,1), 0 0 10px rgba(57,255,20,0.45)",
        }}
      >
        {img.image_index}
      </div>
    </button>
  );
}

// ─── Status Bar ─────────────────────────────────────────────────────

function StatusBar() {
  const projects = useApp((s) => s.projects);
  return (
    <footer className="h-6 shrink-0 border-t border-vellum-border bg-vellum-panel flex items-center px-3 text-[10px] uppercase tracking-wider text-vellum-faint">
      <div className="flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-vellum-accent" />
        <span>{projects.length} prj</span>
      </div>
      <Sep />
      <div>0 imgs</div>
      <Sep />
      <div>0 shots</div>
      <Sep />
      <div>0 submitted</div>
      <div className="ml-auto">vellum studio</div>
    </footer>
  );
}

// ─── Primitives ─────────────────────────────────────────────────────

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.18em] text-vellum-faint mb-1.5 px-1.5">
      {children}
    </div>
  );
}

function Sep() {
  return <span className="mx-2 text-vellum-dim">·</span>;
}

function Avatar({ letter }: { letter: string }) {
  return (
    <div className="w-5 h-5 rounded-sm flex items-center justify-center text-[10px] bg-vellum-elevated text-vellum-accent border border-vellum-border shrink-0">
      {letter.toUpperCase()}
    </div>
  );
}

function ViewHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="border-b border-vellum-border px-8 py-7 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-vellum-accent text-3xl font-medium tracking-[0.18em] uppercase">
          {title}
        </h1>
        {subtitle && (
          <div className="text-[11px] text-vellum-muted mt-3 uppercase tracking-wider flex items-center gap-1">
            {subtitle}
          </div>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

function PrimaryButton(
  props: ButtonHTMLAttributes<HTMLButtonElement>
) {
  return (
    <button
      {...props}
      className={cn(
        "px-3 py-1.5 rounded text-xs bg-vellum-accent hover:bg-vellum-accent-hover text-vellum-bg font-medium flex items-center gap-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed",
        props.className
      )}
    />
  );
}

// ─── Views ──────────────────────────────────────────────────────────

function SubmitView() {
  return (
    <div>
      <ViewHeader
        title="Submit"
        subtitle={
          <>
            <span>0 in queue</span>
            <Sep />
            <span className="text-vellum-warning">即梦 CLI not configured</span>
          </>
        }
        actions={
          <PrimaryButton disabled>
            <Send size={11} /> Submit all
          </PrimaryButton>
        }
      />
      <div className="p-8 text-vellum-muted text-sm">
        批量提交到即梦 CLI · (图N) 自动绑定参考图
      </div>
    </div>
  );
}

export default App;
