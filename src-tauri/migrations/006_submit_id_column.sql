-- Vellum migration 006: dedicated submit_id column on submissions.
--
-- Earlier rows encoded submit_id as a "# submit_id=<id>" comment appended
-- to cli_command (grill M2). getSubmitIdFromRow falls back to that pattern
-- when this new column is null, so no SQL backfill is needed — legacy rows
-- keep working, new rows write the column cleanly.

ALTER TABLE submissions ADD COLUMN submit_id TEXT;

CREATE INDEX IF NOT EXISTS idx_submissions_submit_id ON submissions(submit_id);
