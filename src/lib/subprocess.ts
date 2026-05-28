// Tauri shell subprocess helpers — wraps Command with timeout + abort +
// progress streaming (grill H2). Plain `cmd.execute()` resolves only when
// the child exits, and `withTimeout(execute(), ...)` only rejects the
// Promise — the orphaned child keeps consuming resources until natural
// exit. `runTracked` uses spawn() + child.kill() so the OS process is
// actually torn down on timeout / cancel.

import { Command } from "@tauri-apps/plugin-shell";

export interface RunResult {
  code: number | null;
  signal: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Default 120s. Pass Infinity to disable. */
  timeoutMs?: number;
  /** AbortSignal — when aborted the child is killed and the call rejects. */
  signal?: AbortSignal;
  /** Called per stdout/stderr line as the child streams output. Useful for
   * "still running, N seconds elapsed" UI feedback. */
  onProgress?: (chunk: string, source: "stdout" | "stderr") => void;
  /** Label used in timeout / cancel error messages. */
  label?: string;
}

type ChildHandle = { kill: () => Promise<void> };

/**
 * Run a Tauri shell Command with timeout + AbortSignal + line-buffered
 * progress callback. Always spawns under the hood and kills the child on
 * timeout / abort so a stuck subprocess can't pin the UI's "running" state.
 */
export async function runTracked(
  cmd: Command<string>,
  opts: RunOptions = {}
): Promise<RunResult> {
  const {
    timeoutMs = 120_000,
    signal,
    onProgress,
    label = "subprocess",
  } = opts;

  let stdout = "";
  let stderr = "";

  cmd.stdout.on("data", (line) => {
    const s = String(line);
    stdout += s + "\n";
    onProgress?.(s, "stdout");
  });
  cmd.stderr.on("data", (line) => {
    const s = String(line);
    stderr += s + "\n";
    onProgress?.(s, "stderr");
  });

  return new Promise<RunResult>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let child: ChildHandle | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    const killChild = () => {
      void child?.kill().catch(() => undefined);
    };

    cmd.on("close", (payload) => {
      const p = payload as { code?: number | null; signal?: number | null };
      finish(() =>
        resolve({
          code: p.code ?? null,
          signal: p.signal ?? null,
          stdout,
          stderr,
        })
      );
    });
    cmd.on("error", (err) => {
      finish(() =>
        reject(
          new Error(
            `${label} error: ${typeof err === "string" ? err : String(err)}`
          )
        )
      );
    });

    cmd.spawn().then(
      (c) => {
        child = c as ChildHandle;
        if (signal?.aborted) {
          finish(() => {
            killChild();
            reject(new Error(`${label} 已取消`));
          });
          return;
        }
        if (timeoutMs !== Infinity) {
          timer = setTimeout(() => {
            finish(() => {
              killChild();
              reject(
                new Error(
                  `${label} 超时 (${Math.round(
                    timeoutMs / 1000
                  )}s) — 子进程已 kill。可重试或换 auth mode。`
                )
              );
            });
          }, timeoutMs);
        }
        signal?.addEventListener(
          "abort",
          () => {
            finish(() => {
              killChild();
              reject(new Error(`${label} 被取消`));
            });
          },
          { once: true }
        );
      },
      (err) => {
        finish(() =>
          reject(err instanceof Error ? err : new Error(String(err)))
        );
      }
    );
  });
}
