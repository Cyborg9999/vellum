-- Vellum migration 002: add three-stage workflow text fields to projects.
--
-- The three-stage flow:
--   draft_text       — rough natural-language input the user pastes
--   first_pass_text  — Claude pass 1 output: structured "镜头N，..." paragraphs, detailed but no image refs yet
--   final_pass_text  — Claude pass 2 output: full enhancement with (图N) refs + style framework

ALTER TABLE projects ADD COLUMN draft_text TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN first_pass_text TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN final_pass_text TEXT NOT NULL DEFAULT '';
