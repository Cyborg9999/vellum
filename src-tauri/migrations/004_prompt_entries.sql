-- Vellum migration 004: prompt index entries.
--
-- Each project can now have multiple prompt entries. One entry owns the full
-- Stage 1 -> Stage 2 -> Stage 3 text pipeline, so switching an index switches
-- all three editors together.

CREATE TABLE IF NOT EXISTS prompt_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    entry_number INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    draft_text TEXT NOT NULL DEFAULT '',
    first_pass_text TEXT NOT NULL DEFAULT '',
    final_pass_text TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_id, entry_number)
);

CREATE INDEX IF NOT EXISTS idx_prompt_entries_project ON prompt_entries(project_id);

INSERT INTO prompt_entries
    (project_id, entry_number, title, draft_text, first_pass_text, final_pass_text, created_at, updated_at)
SELECT
    id,
    1,
    '索引 1',
    COALESCE(draft_text, ''),
    COALESCE(first_pass_text, ''),
    COALESCE(final_pass_text, ''),
    created_at,
    updated_at
FROM projects
WHERE NOT EXISTS (
    SELECT 1 FROM prompt_entries WHERE prompt_entries.project_id = projects.id
);
