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
  parseBeatSheet,
  validateBeatSheet,
  mergeBeatSheetShots,
  mergeFirstPassShots,
  extractBadShotIndices,
  splitCombinedOutput,
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
    source: "imported",
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

// ─── Beat Sheet (Pass 0 导演骨架) ──────────────────────────────────

const SAMPLE_BEAT = `镜头1
目的：建立空间
机位：站在两人侧面，画面左低机位
A：少年 / 左前景 / 全身入镜 / 45度侧面朝右
B：昆虫武士 / 右中景 / 全身入镜 / 45度侧面朝左
距离：三到五米潮湿空地，散落锈蚀铁片
向量：A 向右压近，B 同时向左压近，二者沿同一水平轴线接近
镜头运动：缓慢推进
落幅：定在二者将要相撞的那一刻，画面中央留出冲突核心
图：(图1)=少年；(图3)=场景

镜头2
目的：角色出手
机位：贴近少年右前方低机位
A：少年 / 左前景 / 腰部以上 / 45度正面朝右
B：无
距离：A 与镜头一臂距离
向量：A 从画面左前景向右后方拔枪连射
镜头运动：快速推进
落幅：定在少年右手腕和枪口连续喷焰的瞬间
图：(图1)=少年`;

describe("parseBeatSheet", () => {
  it("parses 镜头N + 9 fields per shot", () => {
    const shots = parseBeatSheet(SAMPLE_BEAT);
    expect(shots).toHaveLength(2);
    expect(shots[0].index).toBe(1);
    expect(shots[0].fields.目的).toBe("建立空间");
    expect(shots[0].fields.机位).toContain("两人侧面");
    expect(shots[0].fields.A).toContain("少年");
    expect(shots[0].fields.B).toContain("昆虫武士");
    expect(shots[0].fields.镜头运动).toBe("缓慢推进");
    expect(shots[1].fields.B).toBe("无");
  });

  it("ignores blank lines and extra whitespace", () => {
    const messy = `\n\n镜头1\n  目的：建立空间  \n机位：站在两人侧面，画面左低机位\n\nA：少年 / 左前景 / 全身入镜 / 侧面\nB：无\n距离：远处虚化\n向量：A 站立不动\n镜头运动：固定\n落幅：定在少年眼神\n图：无\n`;
    const shots = parseBeatSheet(messy);
    expect(shots).toHaveLength(1);
    expect(shots[0].fields.目的).toBe("建立空间");
    expect(shots[0].fields.镜头运动).toBe("固定");
  });

  it("returns empty array on garbage input", () => {
    expect(parseBeatSheet("这只是一段散文，没有镜头标记")).toEqual([]);
  });
});

describe("validateBeatSheet", () => {
  it("passes a well-formed beat sheet", () => {
    const result = validateBeatSheet(SAMPLE_BEAT);
    expect(result.issues).toEqual([]);
    expect(result.badShotIndices).toEqual([]);
  });

  it("flags missing required fields and points at the right shot index", () => {
    const broken = `镜头1
目的：建立空间
机位：站在两人侧面，画面左低机位
A：少年 / 左前景 / 全身入镜 / 45度侧面朝右
B：无
距离：远处虚化
向量：A 站立
镜头运动：固定
落幅：定在少年眼神
图：无`;
    // shot 1 ok by itself; now append a broken shot 2 missing fields
    const text = broken + "\n\n镜头2\n目的：角色出手\n机位：贴近\n";
    const result = validateBeatSheet(text);
    expect(result.badShotIndices).toContain(2);
    expect(result.issues.some((i) => i.startsWith("镜头2"))).toBe(true);
  });

  it("flags both-front violation (轴线 wrong)", () => {
    const wrong = SAMPLE_BEAT.replace(
      "B：昆虫武士 / 右中景 / 全身入镜 / 45度侧面朝左",
      "B：昆虫武士 / 右中景 / 全身入镜 / 正面"
    ).replace(
      "A：少年 / 左前景 / 全身入镜 / 45度侧面朝右",
      "A：少年 / 左前景 / 全身入镜 / 正面"
    );
    const result = validateBeatSheet(wrong);
    expect(result.badShotIndices).toContain(1);
    expect(result.issues.some((i) => /同时写「正面」/.test(i))).toBe(true);
  });

  it("flags fixed-camera abuse beyond shot 1", () => {
    const wrong = SAMPLE_BEAT.replace("镜头运动：快速推进", "镜头运动：固定");
    const result = validateBeatSheet(wrong);
    expect(result.badShotIndices).toContain(2);
  });

  it("flags 目的=接触打击 without impact verb in 向量", () => {
    const wrong = SAMPLE_BEAT.replace("目的：角色出手", "目的：接触打击");
    const result = validateBeatSheet(wrong);
    expect(result.badShotIndices).toContain(2);
    expect(result.issues.some((i) => /接触打击/.test(i))).toBe(true);
  });

  it("flags missing expected (图N) refs across all shots", () => {
    const noFigs = SAMPLE_BEAT.replace(/图：.*/g, "图：无");
    const result = validateBeatSheet(noFigs, { expectedImageIndices: [1, 3] });
    expect(result.issues.some((i) => /\(图1\)/.test(i))).toBe(true);
    expect(result.issues.some((i) => /\(图3\)/.test(i))).toBe(true);
  });
});

describe("mergeBeatSheetShots", () => {
  it("replaces only the shots present in partial, keeping others intact", () => {
    const partial = `镜头2
目的：角色出手
机位：贴近少年正前方
A：少年 / 中央 / 胸口以上 / 正面
B：无
距离：与镜头一臂距离
向量：A 拔枪向画面右后方连射
镜头运动：快速推进
落幅：定在枪口火光照亮脸侧的瞬间
图：(图1)=少年`;
    const merged = mergeBeatSheetShots(SAMPLE_BEAT, partial);
    expect(merged).toContain("镜头1");
    expect(merged).toContain("镜头2");
    // shot 1 unchanged (still has 昆虫武士)
    expect(merged).toContain("昆虫武士");
    // shot 2 replaced (now has 中央 / 胸口以上)
    expect(merged).toContain("贴近少年正前方");
  });
});

describe("extractBadShotIndices", () => {
  it("groups shot-local issues by 镜头N and marks global issues separately", () => {
    const issues = [
      "镜头2第一句缺少景别。",
      "镜头2缺少身体取景/画幅裁切。",
      "镜头4里有 2 个主体同时标\"正面\"。",
      "固定镜头过多（除第 1 镜头外还有 1 个固定镜头）。",
    ];
    const result = extractBadShotIndices(issues);
    expect(result.shotLocal).toEqual([2, 4]);
    expect(result.hasGlobalIssue).toBe(true);
  });

  it("returns empty + no global when issues are empty", () => {
    expect(extractBadShotIndices([])).toEqual({
      shotLocal: [],
      hasGlobalIssue: false,
    });
  });
});

describe("mergeFirstPassShots", () => {
  const original = `激斗15秒

镜头1，中景肩部以上正面镜头，少年看着战场。

镜头2，中景腰部以上正面镜头，少年举起武器。

镜头3，远景全身入镜45度侧面镜头，少年冲向敌人。`;

  it("splices only rewritten shots back, keeping preamble + unchanged shots", () => {
    const partial = `镜头2，过肩跟拍腰部以上背影快速推进镜头，少年后脑勺、肩背和武器占据前景，向后景敌阵冲去。`;
    const merged = mergeFirstPassShots(original, partial);
    expect(merged).toContain("激斗15秒"); // preamble preserved
    expect(merged).toContain("镜头1，中景肩部以上"); // shot 1 unchanged
    expect(merged).toContain("过肩跟拍腰部以上背影"); // shot 2 rewritten
    expect(merged).toContain("镜头3，远景全身入镜"); // shot 3 unchanged
  });

  it("returns original when partial has no parseable shots", () => {
    expect(mergeFirstPassShots(original, "garbage with no shot markers")).toBe(
      original
    );
  });
});

describe("splitCombinedOutput", () => {
  it("splits a well-formed two-stage response by delimiter tags", () => {
    const raw = `<<<BEAT_SHEET>>>
镜头1
目的：建立空间
机位：站在两人侧面
A：少年 / 左前景 / 全身入镜 / 45度侧面
B：无
距离：远处虚化
向量：A 站立
镜头运动：固定
落幅：定在少年眼神
图：无

<<<FIRST_PASS>>>
镜头1，远景全身入镜固定平视45度侧面镜头，少年站在废墟前方。`;
    const r = splitCombinedOutput(raw);
    expect(r.beatSheet).toContain("镜头1");
    expect(r.beatSheet).toContain("目的：建立空间");
    expect(r.beatSheet).not.toContain("远景全身入镜");
    expect(r.firstPass).toContain("远景全身入镜固定平视45度侧面镜头");
    expect(r.firstPass).not.toContain("目的：");
  });

  it("tolerates whitespace and dashes inside the tags", () => {
    const raw = `<<< BEAT-SHEET >>>
镜头1
目的：建立空间

<<< FIRST PASS >>>
镜头1，远景。`;
    const r = splitCombinedOutput(raw);
    expect(r.beatSheet).toContain("目的：建立空间");
    expect(r.firstPass).toContain("远景");
  });

  it("falls back: no FIRST_PASS tag → return full output as firstPass", () => {
    const raw = `镜头1，全景固定平视正面，少年站立。镜头2，中景推近...`;
    const r = splitCombinedOutput(raw);
    expect(r.beatSheet).toBe("");
    expect(r.firstPass).toContain("镜头1");
  });

  it("falls back: only FIRST_PASS tag, no BEAT_SHEET tag → prefix becomes beatSheet", () => {
    const raw = `镜头1
目的：建立空间

<<<FIRST_PASS>>>
镜头1，远景。`;
    const r = splitCombinedOutput(raw);
    expect(r.beatSheet).toContain("目的：建立空间");
    expect(r.firstPass).toContain("远景");
  });

  it("returns empty for empty input", () => {
    expect(splitCombinedOutput("")).toEqual({ beatSheet: "", firstPass: "" });
  });
});
