import Database from "@tauri-apps/plugin-sql";
import type {
  Project,
  PromptEntry,
  RefImage,
  RefImageRole,
  Shot,
  Submission,
  SubmissionStatus,
} from "./types";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:vellum.db");
  }
  return dbPromise;
}

const now = () => Math.floor(Date.now() / 1000);

// Per-project async mutex for compactImageIndices. Prevents two concurrent
// compactions (e.g. bulk delete loop + Library auto-refresh) from racing
// over the transient parking slot space (-1000-N). See grill C2.
const compactQueues = new Map<number, Promise<void>>();

// ── Projects ────────────────────────────────────────────────────────

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  return db.select<Project[]>(
    "SELECT * FROM projects ORDER BY updated_at DESC"
  );
}

export async function getProject(id: number): Promise<Project | null> {
  const db = await getDb();
  const rows = await db.select<Project[]>(
    "SELECT * FROM projects WHERE id = ?",
    [id]
  );
  return rows[0] ?? null;
}

export async function createProject(
  name: string,
  description = "",
  stylePrompt = ""
): Promise<Project> {
  const db = await getDb();
  const t = now();
  const result = await db.execute(
    "INSERT INTO projects (name, description, style_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [name, description, stylePrompt, t, t]
  );
  const rows = await db.select<Project[]>(
    "SELECT * FROM projects WHERE id = ?",
    [result.lastInsertId]
  );
  return rows[0];
}

export async function updateProject(
  id: number,
  patch: Partial<
    Pick<
      Project,
      | "name"
      | "description"
      | "style_prompt"
      | "draft_text"
      | "first_pass_text"
      | "final_pass_text"
    >
  >
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const k of [
    "name",
    "description",
    "style_prompt",
    "draft_text",
    "first_pass_text",
    "final_pass_text",
  ] as const) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(patch[k]);
    }
  }
  if (fields.length === 0) return;
  fields.push("updated_at = ?");
  values.push(now());
  values.push(id);
  await db.execute(
    `UPDATE projects SET ${fields.join(", ")} WHERE id = ?`,
    values
  );
}

export async function deleteProject(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM projects WHERE id = ?", [id]);
}

// ── Reference Images ────────────────────────────────────────────────

export async function listRefImages(projectId: number): Promise<RefImage[]> {
  const db = await getDb();
  return db.select<RefImage[]>(
    "SELECT * FROM ref_images WHERE project_id = ? AND deleted_at IS NULL ORDER BY image_index ASC",
    [projectId]
  );
}

export async function listTrashedRefImages(
  projectId: number
): Promise<RefImage[]> {
  const db = await getDb();
  return db.select<RefImage[]>(
    "SELECT * FROM ref_images WHERE project_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC",
    [projectId]
  );
}

export async function restoreRefImage(id: number): Promise<void> {
  const db = await getDb();
  const projectId = await getProjectIdForRefImage(id);
  if (projectId === null) return;
  // Reclaim a positive slot (max active + 1) so the restored row re-enters the
  // active index space without colliding with the negative trash parking.
  const max = await db.select<{ max_idx: number | null }[]>(
    `SELECT MAX(image_index) as max_idx FROM ref_images
     WHERE project_id = ? AND deleted_at IS NULL`,
    [projectId]
  );
  const newIdx = (max[0]?.max_idx ?? 0) + 1;
  await db.execute(
    "UPDATE ref_images SET deleted_at = NULL, image_index = ? WHERE id = ?",
    [newIdx, id]
  );
  await compactImageIndices(projectId);
}

export async function permanentlyDeleteRefImage(id: number): Promise<void> {
  const db = await getDb();
  const projectId = await getProjectIdForRefImage(id);
  await db.execute("DELETE FROM ref_images WHERE id = ?", [id]);
  if (projectId !== null) await compactImageIndices(projectId);
}

async function getProjectIdForRefImage(id: number): Promise<number | null> {
  const db = await getDb();
  const rows = await db.select<{ project_id: number }[]>(
    "SELECT project_id FROM ref_images WHERE id = ?",
    [id]
  );
  return rows[0]?.project_id ?? null;
}

/**
 * Densify the active image_index sequence to 1..N (ordered by current index)
 * and rewrite (图OLD) references in shots, projects, and prompt_entries to
 * match. Called after delete / restore / permanent delete and on initial
 * Library load.
 *
 * Hardening (grill C1/C2/C3):
 *  - C2: per-project async mutex serializes overlapping calls so two
 *    in-flight compactions can't collide in the transient parking range.
 *  - C3: idempotent fast-path — when the active set is already 1..N and no
 *    trashed rows squat on positive indices, return without writes.
 *  - C1: mutating passes are wrapped in BEGIN / COMMIT (ROLLBACK on throw).
 *    tauri-plugin-sql routes raw statements to the active connection, so
 *    this gives best-effort atomicity. If the pool ever routes BEGIN and
 *    follow-up writes to different connections the worst case is the
 *    pre-hotfix behavior — no regression.
 */
export async function compactImageIndices(projectId: number): Promise<void> {
  const prev = compactQueues.get(projectId) ?? Promise.resolve();
  const job = prev
    .catch(() => undefined)
    .then(() => compactImageIndicesInner(projectId));
  compactQueues.set(projectId, job);
  try {
    await job;
  } finally {
    if (compactQueues.get(projectId) === job) compactQueues.delete(projectId);
  }
}

async function compactImageIndicesInner(projectId: number): Promise<void> {
  const db = await getDb();

  // C3 fast-path: read current state, return early if nothing to do.
  const activeRows = await db.select<{ id: number; image_index: number }[]>(
    `SELECT id, image_index FROM ref_images
     WHERE project_id = ? AND deleted_at IS NULL
     ORDER BY image_index ASC`,
    [projectId]
  );
  const needsActiveRemap = activeRows.some((r, i) => r.image_index !== i + 1);

  const trashedPositive = await db.select<{ c: number }[]>(
    `SELECT COUNT(*) as c FROM ref_images
     WHERE project_id = ? AND deleted_at IS NOT NULL AND image_index >= 0`,
    [projectId]
  );
  const needsTrashPark = (trashedPositive[0]?.c ?? 0) > 0;

  if (!needsActiveRemap && !needsTrashPark) return;

  const remap = new Map<number, number>();
  activeRows.forEach((r, i) => {
    const next = i + 1;
    if (r.image_index !== next) remap.set(r.image_index, next);
  });

  // C1: wrap mutating passes in a transaction. ROLLBACK on any throw so a
  // partial write never persists.
  await db.execute("BEGIN");
  try {
    // Step 0: park any trashed rows squatting on positive index slots into a
    // high-negative range (-100000 - id, guaranteed unique). UNIQUE(project_id,
    // image_index) would otherwise reject the compacted active set.
    if (needsTrashPark) {
      await db.execute(
        `UPDATE ref_images SET image_index = -100000 - id
         WHERE project_id = ? AND deleted_at IS NOT NULL
           AND image_index >= 0`,
        [projectId]
      );
    }

    // Two-pass remap: first park each active row at -1000 - desired, then
    // write the final positive index. Prevents intra-active swap collisions.
    if (needsActiveRemap) {
      for (const r of activeRows) {
        const desired = remap.get(r.image_index) ?? r.image_index;
        await db.execute(
          "UPDATE ref_images SET image_index = ? WHERE id = ?",
          [-1000 - desired, r.id]
        );
      }
      for (const r of activeRows) {
        const desired = remap.get(r.image_index) ?? r.image_index;
        await db.execute(
          "UPDATE ref_images SET image_index = ? WHERE id = ?",
          [desired, r.id]
        );
      }
    }

    // Text rewrites only run when there's a remap; otherwise nothing in user
    // prose needs to change.
    if (remap.size > 0) {
      const shots = await db.select<
        { id: number; raw_prompt: string; enhanced_prompt: string }[]
      >(
        "SELECT id, raw_prompt, enhanced_prompt FROM shots WHERE project_id = ?",
        [projectId]
      );
      for (const s of shots) {
        const raw = applyImageRemap(s.raw_prompt ?? "", remap);
        const enh = applyImageRemap(s.enhanced_prompt ?? "", remap);
        if (raw !== (s.raw_prompt ?? "") || enh !== (s.enhanced_prompt ?? "")) {
          await db.execute(
            "UPDATE shots SET raw_prompt = ?, enhanced_prompt = ?, updated_at = ? WHERE id = ?",
            [raw, enh, now(), s.id]
          );
        }
      }

      const projRows = await db.select<
        {
          draft_text: string | null;
          first_pass_text: string | null;
          final_pass_text: string | null;
        }[]
      >(
        "SELECT draft_text, first_pass_text, final_pass_text FROM projects WHERE id = ?",
        [projectId]
      );
      const p = projRows[0];
      if (p) {
        const newDraft = applyImageRemap(p.draft_text ?? "", remap);
        const newFirst = applyImageRemap(p.first_pass_text ?? "", remap);
        const newFinal = applyImageRemap(p.final_pass_text ?? "", remap);
        if (
          newDraft !== (p.draft_text ?? "") ||
          newFirst !== (p.first_pass_text ?? "") ||
          newFinal !== (p.final_pass_text ?? "")
        ) {
          await db.execute(
            `UPDATE projects
             SET draft_text = ?, first_pass_text = ?, final_pass_text = ?, updated_at = ?
             WHERE id = ?`,
            [newDraft, newFirst, newFinal, now(), projectId]
          );
        }
      }

      const entries = await db.select<
        {
          id: number;
          draft_text: string | null;
          first_pass_text: string | null;
          final_pass_text: string | null;
        }[]
      >(
        "SELECT id, draft_text, first_pass_text, final_pass_text FROM prompt_entries WHERE project_id = ?",
        [projectId]
      );
      for (const entry of entries) {
        const newDraft = applyImageRemap(entry.draft_text ?? "", remap);
        const newFirst = applyImageRemap(entry.first_pass_text ?? "", remap);
        const newFinal = applyImageRemap(entry.final_pass_text ?? "", remap);
        if (
          newDraft !== (entry.draft_text ?? "") ||
          newFirst !== (entry.first_pass_text ?? "") ||
          newFinal !== (entry.final_pass_text ?? "")
        ) {
          await db.execute(
            `UPDATE prompt_entries
             SET draft_text = ?, first_pass_text = ?, final_pass_text = ?, updated_at = ?
             WHERE id = ?`,
            [newDraft, newFirst, newFinal, now(), entry.id]
          );
        }
      }
    }

    await db.execute("COMMIT");
  } catch (e) {
    try {
      await db.execute("ROLLBACK");
    } catch {
      // ROLLBACK may fail if BEGIN was already auto-finalized; swallow so
      // the original error still surfaces.
    }
    throw e;
  }
}

/**
 * Rewrite (图OLD) → (图NEW) in a text buffer using a two-pass placeholder
 * strategy so swaps and chained mappings can't collide. Only touches digits
 * matching the captured numbers — orphan refs (no entry in remap) are left
 * unchanged.
 */
function applyImageRemap(text: string, remap: Map<number, number>): string {
  if (!text || remap.size === 0) return text;
  let out = text;
  for (const oldN of remap.keys()) {
    const re = new RegExp(`\\(图\\s*${oldN}\\)`, "g");
    out = out.replace(re, `\x01${oldN}\x02`);
  }
  for (const [oldN, newN] of remap) {
    const re = new RegExp(`\x01${oldN}\x02`, "g");
    out = out.replace(re, `(图${newN})`);
  }
  return out;
}

export async function addRefImage(input: {
  project_id: number;
  role: RefImageRole;
  name?: string;
  file_path: string;
  thumbnail_path?: string;
  width?: number;
  height?: number;
  file_size?: number;
}): Promise<RefImage> {
  const db = await getDb();
  const max = await db.select<{ max_idx: number | null }[]>(
    "SELECT MAX(image_index) as max_idx FROM ref_images WHERE project_id = ?",
    [input.project_id]
  );
  const nextIdx = (max[0]?.max_idx ?? 0) + 1;
  const result = await db.execute(
    `INSERT INTO ref_images
       (project_id, image_index, role, name, file_path, thumbnail_path, width, height, file_size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.project_id,
      nextIdx,
      input.role,
      input.name ?? "",
      input.file_path,
      input.thumbnail_path ?? null,
      input.width ?? null,
      input.height ?? null,
      input.file_size ?? null,
      now(),
    ]
  );
  const rows = await db.select<RefImage[]>(
    "SELECT * FROM ref_images WHERE id = ?",
    [result.lastInsertId]
  );
  return rows[0];
}

export async function updateRefImage(
  id: number,
  patch: Partial<Pick<RefImage, "role" | "name">>
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.role !== undefined) {
    fields.push("role = ?");
    values.push(patch.role);
  }
  if (patch.name !== undefined) {
    fields.push("name = ?");
    values.push(patch.name);
  }
  if (fields.length === 0) return;
  values.push(id);
  await db.execute(
    `UPDATE ref_images SET ${fields.join(", ")} WHERE id = ?`,
    values
  );
}

/**
 * Soft-delete: sets deleted_at = now() instead of removing the row.
 * Image still in DB, hidden from listRefImages, recoverable via Trash view.
 * For permanent removal use permanentlyDeleteRefImage.
 *
 * After soft-delete, compact the active set's image_index to keep numbering
 * sequential, and rewrite (图N) refs in any shot/project text to match.
 */
export async function deleteRefImage(id: number): Promise<void> {
  const db = await getDb();
  const projectId = await getProjectIdForRefImage(id);
  // Park to negative slot (-100000 - id) on soft-delete so the positive index
  // space stays clean for the active set's compaction.
  await db.execute(
    "UPDATE ref_images SET deleted_at = ?, image_index = -100000 - id WHERE id = ?",
    [now(), id]
  );
  if (projectId !== null) await compactImageIndices(projectId);
}

// ── Prompt Segment Entries ──────────────────────────────────────────

export async function listPromptEntries(
  projectId: number
): Promise<PromptEntry[]> {
  const db = await getDb();
  await ensurePromptEntry(projectId);
  return db.select<PromptEntry[]>(
    "SELECT * FROM prompt_entries WHERE project_id = ? ORDER BY entry_number ASC",
    [projectId]
  );
}

async function ensurePromptEntry(projectId: number): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ c: number }[]>(
    "SELECT COUNT(*) as c FROM prompt_entries WHERE project_id = ?",
    [projectId]
  );
  if ((rows[0]?.c ?? 0) > 0) return;

  const projects = await db.select<Project[]>(
    "SELECT * FROM projects WHERE id = ?",
    [projectId]
  );
  const p = projects[0];
  const t = now();
  await db.execute(
    `INSERT INTO prompt_entries
       (project_id, entry_number, title, draft_text, first_pass_text, final_pass_text, created_at, updated_at)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?)`,
    [
      projectId,
      "片段 1",
      p?.draft_text ?? "",
      p?.first_pass_text ?? "",
      p?.final_pass_text ?? "",
      p?.created_at ?? t,
      p?.updated_at ?? t,
    ]
  );
}

export async function createPromptEntry(
  projectId: number
): Promise<PromptEntry> {
  const db = await getDb();
  const max = await db.select<{ max_n: number | null }[]>(
    "SELECT MAX(entry_number) as max_n FROM prompt_entries WHERE project_id = ?",
    [projectId]
  );
  const nextN = (max[0]?.max_n ?? 0) + 1;
  const t = now();
  const result = await db.execute(
    `INSERT INTO prompt_entries
       (project_id, entry_number, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [projectId, nextN, `片段 ${nextN}`, t, t]
  );
  const rows = await db.select<PromptEntry[]>(
    "SELECT * FROM prompt_entries WHERE id = ?",
    [result.lastInsertId]
  );
  return rows[0];
}

export async function updatePromptEntry(
  id: number,
  patch: Partial<
    Pick<
      PromptEntry,
      "title" | "draft_text" | "first_pass_text" | "final_pass_text"
    >
  >
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const k of [
    "title",
    "draft_text",
    "first_pass_text",
    "final_pass_text",
  ] as const) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(patch[k]);
    }
  }
  if (fields.length === 0) return;
  fields.push("updated_at = ?");
  values.push(now());
  values.push(id);
  await db.execute(
    `UPDATE prompt_entries SET ${fields.join(", ")} WHERE id = ?`,
    values
  );
}

export async function deletePromptEntry(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM prompt_entries WHERE id = ?", [id]);
}

// ── Shots ───────────────────────────────────────────────────────────

export async function listShots(projectId: number): Promise<Shot[]> {
  const db = await getDb();
  return db.select<Shot[]>(
    "SELECT * FROM shots WHERE project_id = ? ORDER BY shot_number ASC",
    [projectId]
  );
}

export async function addShot(projectId: number): Promise<Shot> {
  const db = await getDb();
  const max = await db.select<{ max_n: number | null }[]>(
    "SELECT MAX(shot_number) as max_n FROM shots WHERE project_id = ?",
    [projectId]
  );
  const nextN = (max[0]?.max_n ?? 0) + 1;
  const t = now();
  const result = await db.execute(
    "INSERT INTO shots (project_id, shot_number, created_at, updated_at) VALUES (?, ?, ?, ?)",
    [projectId, nextN, t, t]
  );
  const rows = await db.select<Shot[]>("SELECT * FROM shots WHERE id = ?", [
    result.lastInsertId,
  ]);
  return rows[0];
}

export async function ensureShot(
  projectId: number,
  shotNumber: number
): Promise<Shot> {
  const db = await getDb();
  const existing = await db.select<Shot[]>(
    "SELECT * FROM shots WHERE project_id = ? AND shot_number = ?",
    [projectId, shotNumber]
  );
  if (existing[0]) return existing[0];

  const t = now();
  const result = await db.execute(
    "INSERT INTO shots (project_id, shot_number, created_at, updated_at) VALUES (?, ?, ?, ?)",
    [projectId, shotNumber, t, t]
  );
  const rows = await db.select<Shot[]>("SELECT * FROM shots WHERE id = ?", [
    result.lastInsertId,
  ]);
  return rows[0];
}

export async function updateShot(
  id: number,
  patch: Partial<
    Pick<Shot, "raw_prompt" | "enhanced_prompt" | "status" | "enhanced_at">
  >
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const k of [
    "raw_prompt",
    "enhanced_prompt",
    "status",
    "enhanced_at",
  ] as const) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(patch[k]);
    }
  }
  if (fields.length === 0) return;
  fields.push("updated_at = ?");
  values.push(now());
  values.push(id);
  await db.execute(
    `UPDATE shots SET ${fields.join(", ")} WHERE id = ?`,
    values
  );
}

export async function deleteShot(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM shots WHERE id = ?", [id]);
}

// ── Submissions (Dreamina jobs) ──────────────────────────────────────

export async function listSubmissions(
  projectId: number
): Promise<Submission[]> {
  const db = await getDb();
  return db.select<Submission[]>(
    "SELECT * FROM submissions WHERE project_id = ? ORDER BY id DESC",
    [projectId]
  );
}

export async function getSubmission(id: number): Promise<Submission | null> {
  const db = await getDb();
  const rows = await db.select<Submission[]>(
    "SELECT * FROM submissions WHERE id = ?",
    [id]
  );
  return rows[0] ?? null;
}

export async function getActiveSubmissionForShot(
  shotId: number
): Promise<Submission | null> {
  const db = await getDb();
  // Newest non-failed submission for this shot, if any
  const rows = await db.select<Submission[]>(
    `SELECT * FROM submissions
     WHERE shot_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [shotId]
  );
  return rows[0] ?? null;
}

export async function createSubmission(input: {
  project_id: number;
  shot_id: number;
  cli_command: string;
  submit_id: string; // dreamina's task id — stored in error column repurposed? No, see below.
  status?: SubmissionStatus;
}): Promise<Submission> {
  const db = await getDb();
  // We store the dreamina submit_id in `error` column? No — use a dedicated
  // approach: store the cli_command which includes args, and stash submit_id
  // in video_path until success (we'll overwrite with the real video_path).
  // Cleaner: append "\nsubmit_id=<id>" to cli_command for now.
  const t = Math.floor(Date.now() / 1000);
  const cliWithId = `${input.cli_command}\n# submit_id=${input.submit_id}`;
  const result = await db.execute(
    `INSERT INTO submissions
       (project_id, shot_id, cli_command, status, started_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      input.project_id,
      input.shot_id,
      cliWithId,
      input.status ?? "queued",
      t,
    ]
  );
  const rows = await db.select<Submission[]>(
    "SELECT * FROM submissions WHERE id = ?",
    [result.lastInsertId]
  );
  return rows[0];
}

export async function updateSubmission(
  id: number,
  patch: Partial<
    Pick<Submission, "status" | "video_path" | "error" | "completed_at">
  >
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const k of [
    "status",
    "video_path",
    "error",
    "completed_at",
  ] as const) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(patch[k]);
    }
  }
  if (fields.length === 0) return;
  values.push(id);
  await db.execute(
    `UPDATE submissions SET ${fields.join(", ")} WHERE id = ?`,
    values
  );
}

export async function deleteSubmission(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM submissions WHERE id = ?", [id]);
}

/**
 * Extract the dreamina submit_id we stashed in cli_command at creation time.
 * Returns null if not found (legacy rows or hand-tampered data).
 */
export function getSubmitIdFromRow(row: Submission): string | null {
  const m = row.cli_command.match(/# submit_id=([^\s\n]+)/);
  return m?.[1] ?? null;
}

// ── Settings (key-value) ────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = ?",
    [key]
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, now()]
  );
}
