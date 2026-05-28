-- Vellum migration 005: rename older prompt index labels.
--
-- The UI now treats each saved Stage 1 -> Stage 2 -> Stage 3 pipeline as a
-- prompt segment, not an index. Keep existing user data and only rename the
-- generated default labels.

UPDATE prompt_entries
SET
    title = '片段 ' || entry_number,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER)
WHERE title = '索引 ' || entry_number;
