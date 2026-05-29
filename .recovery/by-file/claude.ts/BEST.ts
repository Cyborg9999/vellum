# === Partial reconstruction from Codex audit session ===
# Source: /Users/chengyue/.codex/sessions/2026/05/29/rollout-2026-05-29T12-36-12-019e7204-b9fc-7e00-a9b4-e68f81fbcee7.jsonl
# Session mtime: 2026-05-29T12:40:42.141864
# Target file: src/lib/claude.ts
# Fragments captured (1-indexed line ranges from `nl -ba ... | sed -n A,Bp`):
#   lines 80-170  (rollout jsonl line 107)
#   lines 209-390  (rollout jsonl line 108)
#   lines 400-470  (rollout jsonl line 109)
#   lines 1840-1975  (rollout jsonl line 110)
#   lines 2220-2285  (rollout jsonl line 111)
#   lines 2680-2735  (rollout jsonl line 112)
#   lines 2735-2808  (rollout jsonl line 116)
# Reconstructed lines: 675 (file lines 80-2808)
# NOTE: Lines outside captured ranges are MISSING from this snapshot.
# NOTE: This is the file state at session start (~2026-05-29 12:36 BJT),
#       BEFORE any edits the user may have made later.

80	      return runCodexExec(FALLBACK_CODEX_MODEL, fullPrompt, imagePaths);
81	    }
82	    throw e;
83	  }
84	}
85	
86	async function runCodexExec(
87	  model: string,
88	  fullPrompt: string,
89	  imagePaths: string[]
90	): Promise<string> {
91	  const args = [
92	    "exec",
93	    "--json",
94	    "-m",
95	    model,
96	    "--sandbox",
97	    "read-only",
98	    "--skip-git-repo-check",
99	    "--ephemeral",
100	    "--color",
101	    "never",
102	  ];
103	  for (const p of imagePaths) {
104	    args.push("-i", p);
105	  }
106	  // `--` ensures any user-controlled content in fullPrompt that starts with `-`
107	  // is treated as a positional argument, not a flag (C3 hardening).
108	  args.push("--", fullPrompt);
109	
110	  // codex is a Node script (#!/usr/bin/env node). When Vellum.app is launched
111	  // from Finder/Dock, the inherited PATH lacks /opt/homebrew/bin (Apple Silicon
112	  // Homebrew default), so `env node` exits 127. We splice a PATH override that
113	  // covers both /opt/homebrew/bin (Apple Silicon) and /usr/local/bin (Intel /
114	  // legacy) plus the standard system paths.
115	  const cmd = Command.create("codex", args, {
116	    env: {
117	      PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
118	    },
119	  });
120	  const result = await runTracked(cmd, {
121	    timeoutMs: CLI_TIMEOUT_MS,
122	    label: "codex exec",
123	  });
124	
125	  if (result.code !== 0) {
126	    throw new Error(
127	      `Codex CLI exit ${result.code}: ${
128	        result.stderr || result.stdout || "(no output)"
129	      }`
130	    );
131	  }
132	  return cleanCodexOutput(result.stdout || "");
133	}
134	
135	function buildCodexPrompt(
136	  systemPrompt: string,
137	  userText: string,
138	  imagePaths: string[]
139	): string {
140	  const imageNote =
141	    imagePaths.length > 0
142	      ? `\n\n【视觉输入】本次调用已通过 codex exec -i 附上 ${imagePaths.length} 张参考图。请直接理解图像视觉信息，用于参考图绑定和镜头细节；不要在输出里解释你看到了图片。`
143	      : "";
144	
145	  return `你正在 Vellum 桌面应用内部作为“提示词优化引擎”运行。
146	
147	硬性约束：
148	- 这是纯文本改写任务，不要修改文件、不要运行命令、不要提出计划。
149	- 不要输出解释、分析过程、道歉、Markdown 标题或代码块。
150	- 只输出可以直接粘贴回 Vellum 的最终文本。
151	- 严格遵守下方系统指令里的格式、字数、风格和禁用项。
152	${imageNote}
153	
154	【系统指令】
155	${systemPrompt}
156	
157	【用户输入】
158	${userText}
159	
160	【最终输出】
161	`;
162	}
163	
164	function cleanCodexOutput(stdout: string): string {
165	  const text = parseCodexJsonOutput(stdout) ?? stdout.trim();
166	  // Strip a tiny final-answer label if a model ever emits it despite the
167	  // prompt contract. Keeps Dreamina-facing text clean.
168	  return text.replace(/^(?:final answer|final)\s*[:：]\s*/i, "").trim();
169	}
170	
# --- gap: lines 171..208 missing ---
209	const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
210	const DEFAULT_OPENAI_MODEL = "gpt-5";
211	
212	interface OpenAIContentText { type: "text"; text: string }
213	interface OpenAIContentImage {
214	  type: "image_url";
215	  image_url: { url: string; detail?: "auto" | "low" | "high" };
216	}
217	type OpenAIContent = OpenAIContentText | OpenAIContentImage;
218	
219	
220	async function callViaOpenAI(
221	  systemPrompt: string,
222	  userText: string,
223	  imagePaths: string[],
224	  onChunk?: (fullText: string) => void
225	): Promise<string> {
226	  const apiKey = await getSetting("openai_api_key");
227	  if (!apiKey) {
228	    throw new Error(
229	      "OpenAI mode selected but no OpenAI API key. ⚙ Settings → enter key."
230	    );
231	  }
232	  const model = (await getSetting("openai_model")) || DEFAULT_OPENAI_MODEL;
233	  const isReasoningModel = /^(gpt-5|o1|o3)/.test(model);
234	
235	  const imageBlocks: OpenAIContentImage[] = [];
236	  const failedImagePaths: string[] = [];
237	  for (const p of imagePaths) {
238	    try {
239	      const bytes = await readFile(p);
240	      const mime = mediaTypeFromPath(p);
241	      const b64 = bytesToBase64(bytes);
242	      imageBlocks.push({
243	        type: "image_url",
244	        image_url: { url: `data:${mime};base64,${b64}`, detail: "auto" },
245	      });
246	    } catch (e) {
247	      console.warn("[openai] read image failed:", p, e);
248	      failedImagePaths.push(p);
249	    }
250	  }
251	  // H7: surface image-read failures to the UI instead of silently degrading
252	  // the request. If every image failed, hard-fail; if some failed but caller
253	  // expected images, fail loudly so user knows visual binding broke.
254	  if (failedImagePaths.length > 0 && imagePaths.length > 0) {
255	    if (imageBlocks.length === 0) {
256	      throw new Error(
257	        `Unable to read any of the ${imagePaths.length} reference image(s). Check Library file paths and Tauri fs:scope. First failure: ${failedImagePaths[0]}`
258	      );
259	    }
260	    throw new Error(
261	      `${failedImagePaths.length}/${imagePaths.length} reference image(s) failed to read; aborting before sending an incomplete request to OpenAI. Failed: ${failedImagePaths
262	        .slice(0, 3)
263	        .join(", ")}${failedImagePaths.length > 3 ? ", …" : ""}`
264	    );
265	  }
266	
267	  const userContent: string | OpenAIContent[] =
268	    imageBlocks.length > 0
269	      ? [...imageBlocks, { type: "text", text: userText }]
270	      : userText;
271	
272	  const r = await fetch(OPENAI_URL, {
273	    method: "POST",
274	    headers: {
275	      Authorization: `Bearer ${apiKey}`,
276	      "Content-Type": "application/json",
277	    },
278	    body: JSON.stringify({
279	      model,
280	      messages: [
281	        { role: "system", content: systemPrompt },
282	        { role: "user", content: userContent },
283	      ],
284	      stream: true,
285	      ...(isReasoningModel
286	        ? {
287	            // low > minimal: minimal 模式下模型会跳过格式校对，导致 (图N) 引用被简写成"图N"
288	            // 失去 UI 缩略图渲染。low 多花 2-3s 但保住格式合规
289	            max_completion_tokens: 8192,
290	            reasoning_effort: "low",
291	          }
292	        : { max_tokens: 8192 }),
293	    }),
294	    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
295	  });
296	
297	  if (!r.ok) {
298	    const body = await r.text();
299	    let detail = body;
300	    try {
301	      const parsed = JSON.parse(body);
302	      detail = parsed?.error?.message ?? body;
303	    } catch {
304	      /* keep raw */
305	    }
306	    throw new Error(`OpenAI ${r.status}: ${detail}`);
307	  }
308	
309	  if (!r.body) {
310	    throw new Error("OpenAI returned no response body");
311	  }
312	
313	  // SSE 流式解析：每行 `data: {...}`，[DONE] 收尾；忽略 keepalive 注释
314	  const reader = r.body.getReader();
315	  const decoder = new TextDecoder();
316	  let buffer = "";
317	  let fullText = "";
318	  try {
319	    while (true) {
320	      const { done, value } = await reader.read();
321	      if (done) break;
322	      buffer += decoder.decode(value, { stream: true });
323	      const lines = buffer.split("\n");
324	      buffer = lines.pop() ?? "";
325	      for (const line of lines) {
326	        const trimmed = line.trim();
327	        if (!trimmed.startsWith("data:")) continue;
328	        const payload = trimmed.slice(5).trim();
329	        if (!payload || payload === "[DONE]") continue;
330	        try {
331	          const event = JSON.parse(payload);
332	          const delta: unknown = event?.choices?.[0]?.delta?.content;
333	          if (typeof delta === "string" && delta.length > 0) {
334	            fullText += delta;
335	            onChunk?.(fullText);
336	          }
337	        } catch {
338	          /* skip non-JSON SSE event */
339	        }
340	      }
341	    }
342	  } finally {
343	    reader.releaseLock();
344	  }
345	
346	  if (!fullText.trim()) {
347	    throw new Error("OpenAI returned empty response");
348	  }
349	  return fullText.trim();
350	}
351	
352	// ─── API mode ───────────────────────────────────────────────────────
353	
354	async function callViaAPI(req: ApiRequest): Promise<string> {
355	  const apiKey = await getSetting("claude_api_key");
356	  if (!apiKey) {
357	    throw new Error(
358	      "API mode is selected but no Claude API key set. ⚙ Settings → enter key, or switch to Claude Code CLI mode."
359	    );
360	  }
361	
362	  const r = await fetch(API_URL, {
363	    method: "POST",
364	    headers: {
365	      "x-api-key": apiKey,
366	      "anthropic-version": API_VERSION,
367	      "anthropic-dangerous-direct-browser-access": "true",
368	      "content-type": "application/json",
369	    },
370	    body: JSON.stringify(req),
371	    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
372	  });
373	
374	  if (!r.ok) {
375	    const body = await r.text();
376	    let detail = body;
377	    try {
378	      const parsed = JSON.parse(body);
379	      detail = parsed?.error?.message ?? body;
380	    } catch {
381	      /* keep raw */
382	    }
383	    throw new Error(`Claude API ${r.status}: ${detail}`);
384	  }
385	
386	  const data = (await r.json()) as ApiResponse;
387	  const block = data.content?.[0];
388	  if (!block || block.type !== "text") {
389	    throw new Error("Claude returned non-text response");
390	  }
# --- gap: lines 391..399 missing ---
400	): Promise<string> {
401	  const imageDirective =
402	    imagePaths.length > 0
403	      ? `[系统指令] 请先用 Read 工具读取以下本地参考图作为视觉上下文（不要复述图片内容，理解后直接进入任务）：\n${imagePaths
404	          .map((p, i) => `${i + 1}. ${p}`)
405	          .join("\n")}\n\n`
406	      : "";
407	
408	  const fullPrompt = `[系统人设]
409	${systemPrompt}
410	
411	${imageDirective}[任务]
412	${userText}`;
413	
414	  const cmd = Command.create("claude", [
415	    "--print",
416	    "--output-format",
417	    "text",
418	    // `--` separator: any leading `-` in the user-controlled prompt would
419	    // otherwise be parsed as a CLI flag (e.g. `--mcp-config /tmp/evil`).
420	    // C3 hardening — prevents prompt-injection-to-CLI-flag escalation.
421	    "--",
422	    fullPrompt,
423	  ]);
424	
425	  const result = await runTracked(cmd, {
426	    timeoutMs: CLI_TIMEOUT_MS,
427	    label: "Claude CLI",
428	  });
429	
430	  if (result.code !== 0) {
431	    throw new Error(
432	      `Claude CLI exit ${result.code}: ${result.stderr || "(no stderr)"}`
433	    );
434	  }
435	  return (result.stdout || "").trim();
436	}
437	
438	export function resetClaudeClient() {
439	  /* no persistent state to reset */
440	}
441	
442	export async function getPromptBackendLabel(): Promise<string> {
443	  const mode = await getAuthMode();
444	  if (mode === "cli") return "Claude CLI";
445	  if (mode === "openai") {
446	    return `OpenAI API · ${(await getSetting("openai_model")) || DEFAULT_OPENAI_MODEL}`;
447	  }
448	  if (mode === "codex") {
449	    return `Codex CLI · ${(await getSetting("codex_model")) || DEFAULT_CODEX_MODEL}`;
450	  }
451	  return "Claude API";
452	}
453	
454	// ─── Pass 0: rough draft → beat sheet (导演骨架，只解决导演问题) ──
455	// 把"拆镜 / 定轴线 / 定机位 / 定 A B 位置 / 定动作向量"从 Pass 1 里剥离出来。
456	// Pass 1 之前先让模型做导演调度，这样 Pass 1 只负责按骨架扩写细节，
457	// 不再同时承担"拆镜 + 定参数 + 扩写"三件事。
458	
459	const PASS_0_BEAT_SHEET_SYSTEM = `你是专业级视频导演兼分镜师。用户给你一段笼统的故事/动作粗稿，可能只有一两句话。你的任务**不是写画面**，而是先做导演调度——把粗稿拆成几个连续镜头骨架，每个镜头骨架只解决导演问题，不写服化道、风格、光影、画面细节。
460	
461	${VELLUM_DIRECTOR_WORKFLOW}
462	
463	【输出严格遵守这种格式（机器要解析）】
464	
465	镜头1
466	目的：建立空间 / 角色出手 / 目标反应 / 接触打击 / 重建规模 / 情绪特写 / 道具操作（七选一，只能写一个）
467	机位：摄影机站在哪里。例如「站在两人侧面，画面左低机位」「站在 A 身后右肩」「贴近 B 正前方」「远处高位俯瞰」。必须是可演示的物理站位。
468	A：A 的名字 / 画面位置（左前景/右前景/左中景/右中景/左后景/右后景/画面中央）/ 身体取景（全身入镜/腰部以上/胸口以上/肩部以上/头部特写/手部特写/背部肩胛/后脑勺与肩背 等）/ 朝向（正面/背影/侧面/45度侧面/过肩背影 等）
469	B：B 的名字 / 画面位置 / 身体取景 / 朝向（如果只有一个主体，写「B：无」）
470	距离：两人之间空间关系。例如「贴身接触」「一臂距离」「三到五米潮湿空地」「隔着雾气和管线」「远处虚化」「同一焦平面」「A 前景遮挡 B 后景」。如果只有一个主体，写场景到主体的空间关系。
# --- gap: lines 471..1839 missing ---
1840	  if (fixedShots.length > 1) {
1841	    issues.push("最终稿固定镜头超过一个。动作段落必须优先推、拉、跟、摇、环绕或一镜到底。");
1842	  }
1843	
1844	  return issues.slice(0, 18);
1845	}
1846	
1847	async function callFinalPromptModel(
1848	  systemPrompt: string,
1849	  userText: string,
1850	  usedRefImages: RefImage[],
1851	  onChunk?: (fullText: string) => void
1852	): Promise<string> {
1853	  const imagePaths = usedRefImages.map((i) => i.file_path);
1854	  const mode = await getAuthMode();
1855	  if (mode === "cli") {
1856	    return callViaCLI(systemPrompt, userText, imagePaths);
1857	  }
1858	  if (mode === "openai") {
1859	    return callViaOpenAI(systemPrompt, userText, imagePaths, onChunk);
1860	  }
1861	  if (mode === "codex") {
1862	    return callViaCodex(systemPrompt, userText, imagePaths);
1863	  }
1864	
1865	  const imageBlocks: ImageBlock[] = [];
1866	  const failedImages: string[] = [];
1867	  for (const img of usedRefImages) {
1868	    try {
1869	      const bytes = await readFile(img.file_path);
1870	      imageBlocks.push({
1871	        type: "image",
1872	        source: {
1873	          type: "base64",
1874	          media_type: mediaTypeFromPath(img.file_path),
1875	          data: bytesToBase64(bytes),
1876	        },
1877	      });
1878	    } catch (e) {
1879	      console.warn("[claude] read image failed:", img.file_path, e);
1880	      failedImages.push(img.file_path);
1881	    }
1882	  }
1883	  if (failedImages.length > 0 && usedRefImages.length > 0) {
1884	    if (imageBlocks.length === 0) {
1885	      throw new Error(
1886	        `Unable to read any of the ${usedRefImages.length} reference image(s). Check Library file paths and Tauri fs:scope. First failure: ${failedImages[0]}`
1887	      );
1888	    }
1889	    throw new Error(
1890	      `${failedImages.length}/${usedRefImages.length} reference image(s) failed to read; aborting to avoid sending an incomplete request. Failed: ${failedImages
1891	        .slice(0, 3)
1892	        .join(", ")}${failedImages.length > 3 ? ", …" : ""}`
1893	    );
1894	  }
1895	
1896	  return callViaAPI({
1897	    model: MODEL_OPUS,
1898	    max_tokens: 8192,
1899	    system: systemPrompt,
1900	    messages: [
1901	      {
1902	        role: "user",
1903	        content: [...imageBlocks, { type: "text", text: userText }],
1904	      },
1905	    ],
1906	  });
1907	}
1908	
1909	async function callPromptModel(
1910	  systemPrompt: string,
1911	  userText: string,
1912	  imagePaths: string[] = [],
1913	  onChunk?: (fullText: string) => void
1914	): Promise<string> {
1915	  const mode = await getAuthMode();
1916	  if (mode === "cli") {
1917	    return callViaCLI(systemPrompt, userText, imagePaths);
1918	  }
1919	  if (mode === "openai") {
1920	    return callViaOpenAI(systemPrompt, userText, imagePaths, onChunk);
1921	  }
1922	  if (mode === "codex") {
1923	    return callViaCodex(systemPrompt, userText, imagePaths);
1924	  }
1925	  if (imagePaths.length > 0) {
1926	    const imageBlocks = await readImageBlocksOrThrow(imagePaths);
1927	    return callViaAPI({
1928	      model: MODEL_SONNET,
1929	      max_tokens: 4096,
1930	      system: systemPrompt,
1931	      messages: [
1932	        {
1933	          role: "user",
1934	          content: [...imageBlocks, { type: "text", text: userText }],
1935	        },
1936	      ],
1937	    });
1938	  }
1939	  return callViaAPI({
1940	    model: MODEL_SONNET,
1941	    max_tokens: 4096,
1942	    system: systemPrompt,
1943	    messages: [{ role: "user", content: userText }],
1944	  });
1945	}
1946	
1947	async function readImageBlocksOrThrow(imagePaths: string[]): Promise<ImageBlock[]> {
1948	  const imageBlocks: ImageBlock[] = [];
1949	  const failedImages: string[] = [];
1950	
1951	  for (const path of imagePaths) {
1952	    try {
1953	      const bytes = await readFile(path);
1954	      imageBlocks.push({
1955	        type: "image",
1956	        source: {
1957	          type: "base64",
1958	          media_type: mediaTypeFromPath(path),
1959	          data: bytesToBase64(bytes),
1960	        },
1961	      });
1962	    } catch (e) {
1963	      console.warn("[claude] read image failed:", path, e);
1964	      failedImages.push(path);
1965	    }
1966	  }
1967	
1968	  if (failedImages.length > 0) {
1969	    if (imageBlocks.length === 0) {
1970	      throw new Error(
1971	        `Unable to read any of the ${imagePaths.length} reference image(s). First failure: ${failedImages[0]}`
1972	      );
1973	    }
1974	    throw new Error(
1975	      `${failedImages.length}/${imagePaths.length} reference image(s) failed to read; aborting to avoid incomplete visual context. Failed: ${failedImages
# --- gap: lines 1976..2219 missing ---
2220	  // still trigger a full rewrite.
2221	  const { shotLocal, hasGlobalIssue } = extractBadShotIndices(issues);
2222	  console.warn("[vellum] first pass failed validation; repairing", {
2223	    issues,
2224	    surgicalTargets: shotLocal,
2225	    fullRewrite: hasGlobalIssue || shotLocal.length === 0,
2226	  });
2227	  const surgical = !hasGlobalIssue && shotLocal.length > 0;
2228	  const partialOrFull = await repairFirstPassOutput(
2229	    draft,
2230	    first,
2231	    issues,
2232	    usedRefImages,
2233	    {
2234	      badShotIndices: surgical ? shotLocal : [],
2235	      beatSheet,
2236	    }
2237	  );
2238	  const merged = surgical ? mergeFirstPassShots(first, partialOrFull) : partialOrFull;
2239	  const repairedIssues = validateFirstPassOutput(merged, {
2240	    expectedImageIndices,
2241	    expectedSceneIndices,
2242	  });
2243	  if (repairedIssues.length > 0) {
2244	    console.warn("[vellum] repaired first pass still has issues", repairedIssues);
2245	  }
2246	  return merged;
2247	}
2248	
2249	// ─── Pass 2: first pass + bindings + images → final enhanced ────────
2250	// 基于 docs/methodology.md 「分镜固定规则」+「风格提示词的位置（写两层 + 三层结构）」
2251	
2252	/**
2253	 * Wrap a Promise with a hard JS-side timeout that rejects after `ms` ms.
2254	 * Orphans the underlying operation (subprocess keeps running until OS kills it),
2255	 * but unblocks the UI so the user can retry / cancel. Defends against grill
2256	 * H2: CLI subprocess wrappers have no timeout / no cancel.
2257	 */
2258	const CLI_TIMEOUT_MS = 180_000; // 3 min hard cap for Claude/Codex subprocess
2259	const FETCH_TIMEOUT_MS = 300_000; // 5 min cap — gpt-5 reasoning models 思考阶段没字节流出，90s 会被 abort
2260	
2261	/**
2262	 * Extract video duration (in seconds) from a draft / first-pass / shot title.
2263	 * Matches patterns like "激斗15秒", "追逐10s", "5秒". Clamped to dreamina's
2264	 * 4-15 second range. Returns null if no match. Used by SubmitView to pre-fill
2265	 * the --duration option so the user doesn't have to retype it.
2266	 */
2267	export function parseDurationSeconds(text: string): number | null {
2268	  if (!text) return null;
2269	  // Prefer the first match (typically in the title line)
2270	  const m = text.match(/(\d{1,2})\s*(?:秒|s\b)/i);
2271	  if (!m) return null;
2272	  const n = Number(m[1]);
2273	  if (!Number.isFinite(n) || n <= 0) return null;
2274	  return Math.max(4, Math.min(15, n));
2275	}
2276	
2277	const DEFAULT_STYLE_LAYER = `虚幻5引擎实时渲染，Blur 公司顶级 CG 质感，史诗级 3D 写实画面，融入胡金铨电影的凌厉节奏、东方色彩与禅意氛围；重质感光影：真实太阳光与体积云散射，运动模糊只作用于高速边缘，人物脸部、武器、服化道与关键材质保持锐利；色调以东方暖金、墨绿、赭红、烟灰为主，色彩饱和度高但带胶片褪色感；环境带电影粒子感与油画肌理；全程无配乐，只保留环境风声、刀剑碰撞、能量电弧与空气冲击声。`;
2278	
2279	function isLiveActionStyle(style: string): boolean {
2280	  return /真人|实拍|真实演员|现场摄影|非CG|非 CG|电影级写实|动作电影|废土生存者|live[-\s]?action/i.test(style);
2281	}
2282	
2283	function buildStylePriorityBlock(liveAction: boolean): string {
2284	  if (!liveAction) {
2285	    return `【风格优先级】
# --- gap: lines 2286..2679 missing ---
2680	export function stripOrphanImageRefs(
2681	  text: string,
2682	  refImages: RefImage[]
2683	): string {
2684	  const validIndices = new Set(refImages.map((r) => r.image_index));
2685	  return text.replace(/\(图\s*(\d+)\)/g, (m, n) =>
2686	    validIndices.has(Number(n)) ? m : ""
2687	  );
2688	}
2689	
2690	/** C1 helper: find (图N) markers in a text that don't match any ref image. */
2691	export function findOrphanImageRefs(
2692	  text: string,
2693	  refImages: RefImage[]
2694	): number[] {
2695	  const validIndices = new Set(refImages.map((r) => r.image_index));
2696	  const orphans = new Set<number>();
2697	  const re = /\(图\s*(\d+)\)/g;
2698	  let m: RegExpExecArray | null;
2699	  while ((m = re.exec(text)) !== null) {
2700	    const n = Number(m[1]);
2701	    if (!validIndices.has(n)) orphans.add(n);
2702	  }
2703	  return Array.from(orphans).sort((a, b) => a - b);
2704	}
2705	
2706	export function buildSubmitPayload(
2707	  finalText: string,
2708	  refImages: RefImage[]
2709	): SubmitPayload {
2710	  // find all image refs in finalText, dedupe in order of FIRST appearance.
2711	  // Supports both editable badge syntax "(图N)" and finalized binding syntax
2712	  // "参考图绑定：图1=..." where Pass 2 removes badge nodes from shot bodies.
2713	  const usedIndices: number[] = [];
2714	  const re = /\(图\s*(\d+)\)|图\s*(\d+)\s*[=＝:：]/g;
2715	  let m: RegExpExecArray | null;
2716	  while ((m = re.exec(finalText)) !== null) {
2717	    const n = Number(m[1] ?? m[2]);
2718	    if (!usedIndices.includes(n)) usedIndices.push(n);
2719	  }
2720	
2721	  // Resolve each index to a RefImage, preserving first-appearance order.
2722	  // This matters because dreamina sees images positionally — the Nth uploaded
2723	  // image is "第N张" to the model, and the prompt's "第N张=图M" header tells
2724	  // the model how to map positions back to (图M) text refs.
2725	  const orderedFiles: string[] = [];
2726	  const orderedIndices: number[] = [];
2727	  const orphanIndices: number[] = [];
2728	  const orderedRefs: { ref: RefImage; index: number }[] = [];
2729	  for (const n of usedIndices) {
2730	    const ref = refImages.find((r) => r.image_index === n);
2731	    if (!ref) {
2732	      orphanIndices.push(n);
2733	      continue;
2734	    }
2735	    orderedFiles.push(ref.file_path);
2736	    orderedIndices.push(n);
2737	    orderedRefs.push({ ref, index: n });
2738	  }
2739	
2740	  // Upload-order header in dreamina's expected shape. Keeps per-image role
2741	  // labels (人物/场景/道具) as a short hint; user's body text supplies the
2742	  // detailed binding descriptions.
2743	  const uploadOrderParts = orderedRefs.map(
2744	    ({ index }, i) => `第${i + 1}张=图${index}`
2745	  );
2746	  const uploadOrderHeader =
2747	    uploadOrderParts.length > 0
2748	      ? `本条任务参考图上传顺序：${uploadOrderParts.join("；")}。`
2749	      : "";
2750	
2751	  // Per-role grouping (kept for UI breakdown chips, not for prompt header)
2752	  const byRole = new Map<
2753	    string,
2754	    { role: string; label: string; indices: number[]; files: string[] }
2755	  >();
2756	  for (const { ref, index } of orderedRefs) {
2757	    const label = ROLE_LABEL_ZH[ref.role] || ref.role;
2758	    if (!byRole.has(ref.role)) {
2759	      byRole.set(ref.role, { role: ref.role, label, indices: [], files: [] });
2760	    }
2761	    const g = byRole.get(ref.role)!;
2762	    g.indices.push(index);
2763	    g.files.push(ref.file_path);
2764	  }
2765	
2766	  return {
2767	    uploadOrderHeader,
2768	    body: finalText,
2769	    orderedFiles,
2770	    orderedIndices,
2771	    imageBindings: Array.from(byRole.values()),
2772	    orphanIndices,
2773	  };
2774	}
2775	
2776	// ─── helpers ────────────────────────────────────────────────────────
2777	
2778	function bytesToBase64(bytes: Uint8Array): string {
2779	  // Prefer the modern native API where available — it's ~10× faster and
2780	  // doesn't risk RangeError from String.fromCharCode arg-cap (grill M7).
2781	  const proto = Uint8Array.prototype as unknown as {
2782	    toBase64?: () => string;
2783	  };
2784	  if (typeof proto.toBase64 === "function") {
2785	    return (bytes as unknown as { toBase64: () => string }).toBase64();
2786	  }
2787	  // Fallback: chunked apply() — safer than spread because apply takes an
2788	  // array argument rather than spreading into discrete function args.
2789	  let binary = "";
2790	  const chunk = 0x8000;
2791	  for (let i = 0; i < bytes.length; i += chunk) {
2792	    binary += String.fromCharCode.apply(
2793	      null,
2794	      Array.from(bytes.subarray(i, i + chunk))
2795	    );
2796	  }
2797	  return btoa(binary);
2798	}
2799	
2800	function mediaTypeFromPath(
2801	  p: string
2802	): "image/png" | "image/jpeg" | "image/webp" | "image/gif" {
2803	  const lower = p.toLowerCase();
2804	  if (lower.endsWith(".png")) return "image/png";
2805	  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
2806	  if (lower.endsWith(".webp")) return "image/webp";
2807	  if (lower.endsWith(".gif")) return "image/gif";
2808	  return "image/png";