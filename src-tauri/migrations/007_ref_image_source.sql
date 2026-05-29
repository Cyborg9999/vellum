-- Vellum migration 007: track origin of ref_images.
--
-- Adds a `source` column distinguishing user-imported images from images
-- generated in-app (e.g. OpenAI image gen path). Existing rows backfill to
-- 'imported' since they all pre-date the generated pipeline.
--
-- Library / Lightbox can badge generated images; future RAG can weight
-- imported references differently from synthesized ones.

ALTER TABLE ref_images ADD COLUMN source TEXT NOT NULL DEFAULT 'imported' CHECK (source IN ('imported', 'generated'));
