import { describe, it, expect, vi } from "vitest";

// Tauri plugin modules + ./db must be mocked: they call invoke() / load
// a SQLite plugin which fails outside a webview. Test target is pure
// functions only — buildSubmitPayload, parseDurationSeconds, etc.
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn() }));
vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create: vi.fn() } }));
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn(() => Promise.reject(new Error("mocked"))) },
}));

import {
  parseDurationSeconds,
  stripOrphanImageRefs,
  findOrphanImageRefs,
  buildSubmitPayload,
} from "./claude";
import type { RefImage } from "./types";

function mkRef(image_index: number, file_path = `/tmp/img${image_index}.png`): RefImage {
  return {
    id: image_index,
    project_id: 1,
    image_index,
    role: "character",
    name: `img${image_index}`,
    file_path,
    thumbnail_path: null,
    width: null,
    height: null,
    file_size: null,
    created_at: 0,
    deleted_at: null,
  };
}

describe("parseDurationSeconds", () => {
  it("extracts the first 秒/s number", () => {
    expect(parseDurationSeconds("激斗15秒，能量爆发")).toBe(15);
    expect(parseDurationSeconds("追逐10秒")).toBe(10);
    expect(parseDurationSeconds("5秒静止")).toBe(5);
    expect(parseDurationSeconds("loop 8s slow zoom")).toBe(8);
  });

  it("clamps to dreamina's 4-15 second range", () => {
    expect(parseDurationSeconds("2秒")).toBe(4); // clamp up
    expect(parseDurationSeconds("99秒")).toBe(15); // clamp down
  });

  it("returns null for missing / unparseable input", () => {
    expect(parseDurationSeconds("")).toBeNull();
    expect(parseDurationSeconds("no duration here")).toBeNull();
    expect(parseDurationSeconds("0秒")).toBeNull();
  });
});

describe("stripOrphanImageRefs", () => {
  it("removes (图N) markers that don't match any active ref image", () => {
    const refs = [mkRef(1), mkRef(2)];
    expect(stripOrphanImageRefs("人物(图1) 持剑站在(图2)的山巅(图3)边", refs))
      .toBe("人物(图1) 持剑站在(图2)的山巅边");
  });

  it("keeps everything when all refs are valid", () => {
    const refs = [mkRef(1), mkRef(2), mkRef(3)];
    const txt = "(图1)(图2)(图3)";
    expect(stripOrphanImageRefs(txt, refs)).toBe(txt);
  });

  it("handles empty ref list — strips all", () => {
    expect(stripOrphanImageRefs("(图1)something(图2)", [])).toBe("something");
  });
});

describe("findOrphanImageRefs", () => {
  it("lists distinct orphan indices in ascending order", () => {
    const refs = [mkRef(2)];
    expect(findOrphanImageRefs("(图3)x(图1)y(图3)z(图5)", refs))
      .toEqual([1, 3, 5]);
  });

  it("returns empty when all refs are valid", () => {
    expect(findOrphanImageRefs("(图1)(图2)", [mkRef(1), mkRef(2)])).toEqual([]);
  });
});

describe("buildSubmitPayload", () => {
  it("collects (图N) markers in first-appearance order, dedup", () => {
    const refs = [mkRef(1), mkRef(2), mkRef(3)];
    const payload = buildSubmitPayload(
      "镜头1：(图2)走过 (图1)的森林 (图2)再次出现 (图3)挥剑",
      refs
    );
    expect(payload.orderedIndices).toEqual([2, 1, 3]);
    expect(payload.uploadOrderHeader).toContain("第1张=图2");
    expect(payload.uploadOrderHeader).toContain("第2张=图1");
    expect(payload.uploadOrderHeader).toContain("第3张=图3");
  });

  it("reports orphan indices when finalText cites missing refs", () => {
    const refs = [mkRef(1)];
    const payload = buildSubmitPayload("(图1)(图99)", refs);
    expect(payload.orphanIndices).toEqual([99]);
    expect(payload.orderedIndices).toEqual([1]);
  });

  it("emits empty header when text has no image refs", () => {
    const payload = buildSubmitPayload("纯文字提示词，无图引用", [mkRef(1)]);
    expect(payload.orderedIndices).toEqual([]);
    expect(payload.uploadOrderHeader).toBe("");
  });

  it("also picks up '图N=' header binding syntax", () => {
    const refs = [mkRef(5), mkRef(7)];
    const payload = buildSubmitPayload(
      "参考图绑定：图5=主角，图7=场景\n身穿铠甲的将军立于雪原",
      refs
    );
    expect(payload.orderedIndices).toEqual([5, 7]);
  });
});
