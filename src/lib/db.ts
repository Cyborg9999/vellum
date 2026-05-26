import Database from "@tauri-apps/plugin-sql";
import type {
  Project,
  RefImage,
  RefImageRole,
  Shot,
} from "./types";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:vellum.db");
  }
  return dbPromise;
}

const now = () => Math.floor(Date.now() / 1000);

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
    "SELECT * FROM ref_images WHERE project_id = ? ORDER BY image_index ASC",
    [projectId]
  );
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

export async function deleteRefImage(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM ref_images WHERE id = ?", [id]);
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
