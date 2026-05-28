import { describe, it, expect, vi } from "vitest";

// Tauri plugin modules call invoke() at use-time which fails outside a
// webview. Mock the import surface so the module loads cleanly in Node.
vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: { create: vi.fn() },
}));

import { normalizeDreaminaStatus, extractSubmitId } from "./dreamina";

describe("normalizeDreaminaStatus (grill H4)", () => {
  it("maps queued-family statuses", () => {
    expect(normalizeDreaminaStatus("queued")).toBe("queued");
    expect(normalizeDreaminaStatus("pending")).toBe("queued");
    expect(normalizeDreaminaStatus("waiting")).toBe("queued");
    expect(normalizeDreaminaStatus("submitted")).toBe("queued");
    expect(normalizeDreaminaStatus("not_start")).toBe("queued");
    expect(normalizeDreaminaStatus("in_queue")).toBe("queued");
  });

  it("maps running-family statuses", () => {
    expect(normalizeDreaminaStatus("running")).toBe("running");
    expect(normalizeDreaminaStatus("processing")).toBe("running");
    expect(normalizeDreaminaStatus("in_progress")).toBe("running");
    expect(normalizeDreaminaStatus("generating")).toBe("running");
  });

  it("maps success-family statuses", () => {
    expect(normalizeDreaminaStatus("success")).toBe("success");
    expect(normalizeDreaminaStatus("done")).toBe("success");
    expect(normalizeDreaminaStatus("completed")).toBe("success");
    expect(normalizeDreaminaStatus("finished")).toBe("success");
  });

  it("maps failed-family statuses", () => {
    expect(normalizeDreaminaStatus("failed")).toBe("failed");
    expect(normalizeDreaminaStatus("error")).toBe("failed");
    expect(normalizeDreaminaStatus("canceled")).toBe("failed");
    expect(normalizeDreaminaStatus("cancelled")).toBe("failed");
    expect(normalizeDreaminaStatus("timeout")).toBe("failed");
    expect(normalizeDreaminaStatus("expired")).toBe("failed");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(normalizeDreaminaStatus("SUCCESS")).toBe("success");
    expect(normalizeDreaminaStatus("  Failed  ")).toBe("failed");
    expect(normalizeDreaminaStatus("Running")).toBe("running");
  });

  // grill H4 regression: substring matching previously mis-categorized
  // anything containing "ing" or "fail" as running / failed.
  it("does NOT match 'ing' substring (H4 regression)", () => {
    expect(normalizeDreaminaStatus("missing")).toBe("queued");
    expect(normalizeDreaminaStatus("queueing")).toBe("queued");
    expect(normalizeDreaminaStatus("waiting_for_assets")).toBe("queued");
  });

  it("does NOT match '*_failed_retrying' as terminal failed (H4 regression)", () => {
    // The dangerous case: validation_failed_retrying would have flipped to
    // terminal failed → UI marks job dead → user resubmits → second paid job.
    expect(normalizeDreaminaStatus("validation_failed_retrying")).toBe("queued");
    expect(normalizeDreaminaStatus("prepare_failed_retrying")).toBe("queued");
  });

  it("unknown strings stay queued — never silently flip to success/failed", () => {
    expect(normalizeDreaminaStatus("limit_exceeded")).toBe("queued");
    expect(normalizeDreaminaStatus("banned")).toBe("queued");
    expect(normalizeDreaminaStatus("")).toBe("queued");
    expect(normalizeDreaminaStatus("totally_unknown_status")).toBe("queued");
  });
});

describe("extractSubmitId (grill H3)", () => {
  it("returns submit_id from clean JSON", () => {
    expect(extractSubmitId('{"submit_id":"abc-123"}')).toBe("abc-123");
  });

  it("falls back to task_id and id keys in JSON", () => {
    expect(extractSubmitId('{"task_id":"xyz-456"}')).toBe("xyz-456");
    expect(extractSubmitId('{"id":"plain-id"}')).toBe("plain-id");
  });

  it("uses scoped regex when JSON parse fails but key is labeled", () => {
    const stdout = `[INFO] submitting...
{"submit_id":"abc-789","status":"queued"}
trailing garbage`;
    expect(extractSubmitId(stdout)).toBe("abc-789");
  });

  // grill H3 regression: a bare UUID elsewhere in stdout must never be
  // adopted as the submit_id, or the actual paid job becomes an orphan.
  it("does NOT fall back to bare UUID search (H3 regression)", () => {
    const stackTrace = `Error at handler:
  request_id=550e8400-e29b-41d4-a716-446655440000
  trace_id=6ba7b810-9dad-11d1-80b4-00c04fd430c8
  no submit_id present`;
    expect(extractSubmitId(stackTrace)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(extractSubmitId("totally unrelated output")).toBeNull();
    expect(extractSubmitId("")).toBeNull();
    expect(extractSubmitId("just a UUID 550e8400-e29b-41d4-a716-446655440000 floating")).toBeNull();
  });
});
