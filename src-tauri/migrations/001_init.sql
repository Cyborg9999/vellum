-- Vellum initial schema
-- Generic by design: no hardcoded character/scene names anywhere.

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    style_prompt TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ref_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    image_index INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('character', 'scene', 'prop')),
    name TEXT NOT NULL DEFAULT '',
    file_path TEXT NOT NULL,
    thumbnail_path TEXT,
    width INTEGER,
    height INTEGER,
    file_size INTEGER,
    created_at INTEGER NOT NULL,
    UNIQUE(project_id, image_index)
);

CREATE INDEX IF NOT EXISTS idx_ref_images_project ON ref_images(project_id);

CREATE TABLE IF NOT EXISTS shots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    shot_number INTEGER NOT NULL,
    raw_prompt TEXT NOT NULL DEFAULT '',
    enhanced_prompt TEXT NOT NULL DEFAULT '',
    enhanced_at INTEGER,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'enhanced', 'submitted', 'completed')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_id, shot_number)
);

CREATE INDEX IF NOT EXISTS idx_shots_project ON shots(project_id);

CREATE TABLE IF NOT EXISTS samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_prompt TEXT NOT NULL,
    enhanced_prompt TEXT NOT NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    shot_id INTEGER REFERENCES shots(id) ON DELETE SET NULL,
    quality_score INTEGER,
    tags TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    shot_id INTEGER NOT NULL REFERENCES shots(id),
    cli_command TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'success', 'failed')),
    video_path TEXT,
    error TEXT,
    started_at INTEGER,
    completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_submissions_project_status ON submissions(project_id, status);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
