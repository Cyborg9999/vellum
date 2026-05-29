import { useEffect, useState } from "react";
import {
  Settings as SettingsIcon,
  X,
  Eye,
  EyeOff,
  Check,
  Terminal,
  KeyRound,
  Bot,
  Cpu,
  Sparkles,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { getSetting, setSetting } from "@/lib/db";
import { resetClaudeClient, type AuthMode } from "@/lib/claude";
import {
  getResolvedTheme,
  getThemeMode,
  setThemeMode,
  subscribeTheme,
  type ThemeMode,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Settings"
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-vellum-elevated text-vellum-muted hover:text-vellum-text transition"
      >
        <SettingsIcon size={13} />
      </button>
      {open && <SettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<AuthMode>("codex");
  const [apiKey, setApiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-5");
  const [codexModel, setCodexModel] = useState("gpt-5.5");
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-flash");
  const [theme, setTheme] = useState<ThemeMode>(getThemeMode);
  const [resolvedTheme, setResolvedTheme] = useState(getResolvedTheme);
  const [revealClaude, setRevealClaude] = useState(false);
  const [revealOpenai, setRevealOpenai] = useState(false);
  const [revealGemini, setRevealGemini] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeTheme(({ mode, resolved }) => {
      setTheme(mode);
      setResolvedTheme(resolved);
    });
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const m = (await getSetting("claude_auth_mode")) as AuthMode | null;
        if (
          m === "api" ||
          m === "cli" ||
          m === "openai" ||
          m === "codex" ||
          m === "gemini"
        ) {
          setMode(m);
        }
        const k = await getSetting("claude_api_key");
        if (k) setApiKey(k);
        const ok = await getSetting("openai_api_key");
        if (ok) setOpenaiKey(ok);
        const om = await getSetting("openai_model");
        if (om) setOpenaiModel(om);
        const cm = await getSetting("codex_model");
        if (cm) setCodexModel(cm);
        const gk = await getSetting("gemini_api_key");
        if (gk) setGeminiKey(gk);
        const gm = await getSetting("gemini_model");
        if (gm) setGeminiModel(gm);
      } catch (e) {
        console.error("[Settings] load failed:", e);
      }
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await setSetting("claude_auth_mode", mode);
      if (mode === "api") {
        await setSetting("claude_api_key", apiKey.trim());
      }
      if (mode === "openai") {
        await setSetting("openai_api_key", openaiKey.trim());
        await setSetting("openai_model", openaiModel.trim() || "gpt-5");
      }
      if (mode === "codex") {
        await setSetting("codex_model", codexModel.trim() || "gpt-5.5");
      }
      if (mode === "gemini") {
        await setSetting("gemini_api_key", geminiKey.trim());
        await setSetting(
          "gemini_model",
          geminiModel.trim() || "gemini-2.5-flash"
        );
      }
      resetClaudeClient();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const saveDisabled =
    saving ||
    (mode === "api" && !apiKey.trim()) ||
    (mode === "openai" && !openaiKey.trim()) ||
    (mode === "gemini" && !geminiKey.trim());

  const resolvedThemeLabel =
    resolvedTheme === "dark"
      ? "\u6df1\u8272"
      : resolvedTheme === "gray"
      ? "\u62a4\u773c\u7070"
      : "\u6d45\u8272";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-vellum-card border border-vellum-border rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-vellum-border">
          <div className="flex items-center gap-2">
            <SettingsIcon size={14} className="text-vellum-accent" />
            <div className="text-vellum-text text-sm font-bold uppercase">
              Settings
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-vellum-elevated text-vellum-muted hover:text-vellum-text transition"
          >
            <X size={13} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] uppercase text-vellum-faint">
                Appearance
              </div>
              <div className="text-[10px] uppercase text-vellum-faint">
                {"\u5f53\u524d\uff1a"}{resolvedThemeLabel}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <ModeOption
                active={theme === "dark"}
                onClick={() => setThemeMode("dark")}
                icon={<Moon size={13} />}
                label="深色"
                hint="固定深色界面"
              />
              <ModeOption
                active={theme === "light"}
                onClick={() => setThemeMode("light")}
                icon={<Sun size={13} />}
                label="浅色"
                hint="固定浅色界面"
              />
              <ModeOption
                active={theme === "gray"}
                onClick={() => setThemeMode("gray")}
                icon={
                  <span className="h-3 w-3 rounded-full border border-vellum-border-strong bg-vellum-elevated" />
                }
                label={"\u62a4\u773c\u7070"}
                hint={"\u504f\u6d45\u7070\u4f4e\u5bf9\u6bd4"}
              />
              <ModeOption
                active={theme === "system"}
                onClick={() => setThemeMode("system")}
                icon={<Monitor size={13} />}
                label="跟随系统"
                hint="随 macOS 切换"
              />
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase text-vellum-faint mb-2">
              Auth mode
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ModeOption
                active={mode === "api"}
                onClick={() => setMode("api")}
                icon={<KeyRound size={13} />}
                label="Claude API"
                hint="anthropic 直连 · 要 API key · 快"
              />
              <ModeOption
                active={mode === "cli"}
                onClick={() => setMode("cli")}
                icon={<Terminal size={13} />}
                label="Claude CLI"
                hint="走你 Claude Code 订阅 · 慢 30-60s"
              />
              <ModeOption
                active={mode === "openai"}
                onClick={() => setMode("openai")}
                icon={<Bot size={13} />}
                label="OpenAI API"
                hint="GPT 系列 · 要 OpenAI key · 快"
              />
              <ModeOption
                active={mode === "codex"}
                onClick={() => setMode("codex")}
                icon={<Cpu size={13} />}
                label="Codex CLI"
                hint="走你 ChatGPT 订阅 · 无额外 key · 原生支持图片"
              />
              <ModeOption
                active={mode === "gemini"}
                onClick={() => setMode("gemini")}
                icon={<Sparkles size={13} />}
                label="Gemini"
                hint="Google AI Studio API · 免费 tier 够日常用"
                className="col-span-2"
              />
            </div>
          </div>

          {mode === "api" && (
            <div>
              <div className="text-[10px] uppercase text-vellum-faint mb-2">
                Claude API Key
              </div>
              <div className="relative">
                <input
                  type={revealClaude ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setSaved(false);
                  }}
                  placeholder="sk-ant-..."
                  className="w-full bg-vellum-bg border border-vellum-border rounded px-3 py-2 pr-10 text-vellum-text placeholder:text-vellum-dim text-sm font-mono focus:border-vellum-accent-border transition"
                />
                <button
                  type="button"
                  onClick={() => setRevealClaude((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-vellum-faint hover:text-vellum-muted"
                >
                  {revealClaude ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              <div className="text-[10px] text-vellum-faint mt-2 leading-relaxed">
                console.anthropic.com → API keys · Pass 1 用 Sonnet 4.6 · Pass 2 用 Opus 4.7
              </div>
            </div>
          )}

          {mode === "cli" && (
            <div className="border border-vellum-border rounded p-3 bg-vellum-bg/50">
              <div className="text-[10px] uppercase text-vellum-faint mb-2">
                Claude CLI Binary
              </div>
              <div className="text-xs font-mono text-vellum-muted break-all">
                whichever path you set in capabilities/default.json
              </div>
              <div className="text-[10px] text-vellum-faint mt-2 leading-relaxed">
                Tauri subprocess 调你 Claude Code 订阅 · 30-60s/调用
              </div>
            </div>
          )}

          {mode === "openai" && (
            <div className="space-y-3">
              <div>
                <div className="text-[10px] uppercase text-vellum-faint mb-2">
                  OpenAI API Key
                </div>
                <div className="relative">
                  <input
                    type={revealOpenai ? "text" : "password"}
                    value={openaiKey}
                    onChange={(e) => {
                      setOpenaiKey(e.target.value);
                      setSaved(false);
                    }}
                    placeholder="sk-proj-... or sk-..."
                    className="w-full bg-vellum-bg border border-vellum-border rounded px-3 py-2 pr-10 text-vellum-text placeholder:text-vellum-dim text-sm font-mono focus:border-vellum-accent-border transition"
                  />
                  <button
                    type="button"
                    onClick={() => setRevealOpenai((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-vellum-faint hover:text-vellum-muted"
                  >
                    {revealOpenai ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                <div className="text-[10px] text-vellum-faint mt-2 leading-relaxed">
                  platform.openai.com → API keys
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-vellum-faint mb-2">
                  Model
                </div>
                <input
                  value={openaiModel}
                  onChange={(e) => {
                    setOpenaiModel(e.target.value);
                    setSaved(false);
                  }}
                  placeholder="gpt-5"
                  className="w-full bg-vellum-bg border border-vellum-border rounded px-3 py-2 text-vellum-text placeholder:text-vellum-dim text-sm font-mono focus:border-vellum-accent-border transition"
                />
              </div>
            </div>
          )}

          {mode === "codex" && (
            <div className="space-y-3">
              <div className="border border-vellum-border rounded p-3 bg-vellum-bg/50">
                <div className="text-[10px] uppercase text-vellum-faint mb-2">
                  Codex CLI Binary
                </div>
                <div className="text-xs font-mono text-vellum-muted break-all">
                  /opt/homebrew/bin/codex
                </div>
                <div className="text-[10px] text-vellum-faint mt-2 leading-relaxed">
                  走你的 ChatGPT 订阅 (Logged in)。Optimize / Finalize 都走
                  <code className="text-vellum-accent mx-1">codex exec</code>；
                  Finalize 用<code className="text-vellum-accent mx-1">-i</code>原生附图。
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-vellum-faint mb-2">
                  Model
                </div>
                <input
                  value={codexModel}
                  onChange={(e) => {
                    setCodexModel(e.target.value);
                    setSaved(false);
                  }}
                  placeholder="gpt-5.5"
                  className="w-full bg-vellum-bg border border-vellum-border rounded px-3 py-2 text-vellum-text placeholder:text-vellum-dim text-sm font-mono focus:border-vellum-accent-border transition"
                />
                <div className="text-[10px] text-vellum-faint mt-2 leading-relaxed">
                  默认 <code className="text-vellum-accent">gpt-5.5</code>。若提示 model 不存在，可换{" "}
                  <code className="text-vellum-accent">gpt-5.2</code> /{" "}
                  <code className="text-vellum-accent">gpt-5.1</code> 等。
                </div>
              </div>
            </div>
          )}

          {mode === "gemini" && (
            <div className="space-y-3">
              <div>
                <div className="text-[10px] uppercase text-vellum-faint mb-2">
                  Gemini API Key
                </div>
                <div className="relative">
                  <input
                    type={revealGemini ? "text" : "password"}
                    value={geminiKey}
                    onChange={(e) => {
                      setGeminiKey(e.target.value);
                      setSaved(false);
                    }}
                    placeholder="AIza..."
                    className="w-full bg-vellum-bg border border-vellum-border rounded px-3 py-2 pr-10 text-vellum-text placeholder:text-vellum-dim text-sm font-mono focus:border-vellum-accent-border transition"
                  />
                  <button
                    type="button"
                    onClick={() => setRevealGemini((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-vellum-faint hover:text-vellum-muted"
                  >
                    {revealGemini ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                <div className="text-[10px] text-vellum-faint mt-2 leading-relaxed">
                  Get a free API key at{" "}
                  <code className="text-vellum-accent">
                    aistudio.google.com/apikey
                  </code>
                  。注意是 AI Studio key，不是 Vertex AI / GCP service
                  account。
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-vellum-faint mb-2">
                  Model
                </div>
                <select
                  value={geminiModel}
                  onChange={(e) => {
                    setGeminiModel(e.target.value);
                    setSaved(false);
                  }}
                  className="w-full bg-vellum-bg border border-vellum-border rounded px-3 py-2 text-vellum-text text-sm font-mono focus:border-vellum-accent-border transition"
                >
                  <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                  <option value="gemini-3.1-flash-lite">
                    gemini-3.1-flash-lite
                  </option>
                  <option value="gemini-3.5-flash">gemini-3.5-flash</option>
                  <option value="gemini-3-flash-preview">
                    gemini-3-flash-preview
                  </option>
                </select>
                <div className="text-[10px] text-vellum-faint mt-2 leading-relaxed">
                  默认 <code className="text-vellum-accent">gemini-2.5-flash</code>
                  ，免费 tier 日常够用。如遇 429 切{" "}
                  <code className="text-vellum-accent">gemini-3.1-flash-lite</code>
                  。实时 quota 见{" "}
                  <code className="text-vellum-accent">
                    aistudio.google.com/rate-limit
                  </code>
                  。
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="border border-red-900/60 bg-red-950/20 text-red-300 rounded p-3 text-xs font-mono break-all">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={() => void handleSave()}
              disabled={saveDisabled}
              className={cn(
                "px-3 py-1.5 rounded text-xs font-bold transition flex items-center gap-1.5",
                saved
                  ? "bg-vellum-success text-vellum-bg"
                  : "bg-vellum-accent hover:bg-vellum-accent-hover text-vellum-bg disabled:opacity-40"
              )}
            >
              {saved ? (
                <>
                  <Check size={11} /> Saved
                </>
              ) : saving ? (
                "Saving…"
              ) : (
                "Save"
              )}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-vellum-muted hover:text-vellum-text rounded text-xs transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeOption({
  active,
  onClick,
  icon,
  label,
  hint,
  className,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-left p-3 rounded border transition",
        active
          ? "border-vellum-accent bg-vellum-accent-soft"
          : "border-vellum-border bg-vellum-bg/40 hover:border-vellum-border-strong",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-bold uppercase mb-1",
          active ? "text-vellum-accent" : "text-vellum-text"
        )}
      >
        {icon}
        {label}
      </div>
      <div className="text-[10px] text-vellum-faint leading-snug">{hint}</div>
    </button>
  );
}
