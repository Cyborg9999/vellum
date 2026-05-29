// Mirrors src-tauri/migrations/001_init.sql

export type RefImageRole = "character" | "scene" | "prop";

export const ROLE_LABEL: Record<RefImageRole, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
};

export type ShotStatus = "draft" | "enhanced" | "submitted" | "completed";

export type SubmissionStatus = "queued" | "running" | "success" | "failed";

export interface Project {
  id: number;
  name: string;
  description: string;
  style_prompt: string;
  draft_text: string;       // stage 1 input
  first_pass_text: string;  // stage 2: claude pass 1 output (editable + image bindings)
  final_pass_text: string;  // stage 3: claude pass 2 output (ready for 即梦)
  created_at: number;
  updated_at: number;
}

export interface RefImage {
  id: number;
  project_id: number;
  image_index: number;
  role: RefImageRole;
  name: string;
  file_path: string;
  thumbnail_path: string | null;
  width: number | null;
  height: number | null;
  file_size: number | null;
  created_at: number;
  /** null when active, unix timestamp when soft-deleted (migration 003) */
  deleted_at: number | null;
  /** origin of this image: 'imported' for user uploads, 'generated' for
   * in-app synthesis (e.g. OpenAI image gen). Added in migration 007. */
  source: "imported" | "generated";
}

export interface PromptEntry {
  id: number;
  project_id: number;
  entry_number: number;
  title: string;
  draft_text: string;
  first_pass_text: string;
  final_pass_text: string;
  created_at: number;
  updated_at: number;
}

export interface Shot {
  id: number;
  project_id: number;
  shot_number: number;
  raw_prompt: string;
  enhanced_prompt: string;
  enhanced_at: number | null;
  status: ShotStatus;
  created_at: number;
  updated_at: number;
}

export interface Sample {
  id: number;
  raw_prompt: string;
  enhanced_prompt: string;
  project_id: number | null;
  shot_id: number | null;
  quality_score: number | null;
  tags: string;
  created_at: number;
}

export interface Submission {
  id: number;
  project_id: number;
  shot_id: number;
  cli_command: string;
  status: SubmissionStatus;
  video_path: string | null;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
  /** dreamina task id, added in migration 006. Null for legacy rows where
   * the id was encoded inside cli_command — getSubmitIdFromRow falls back
   * to that pattern. */
  submit_id: string | null;
}
