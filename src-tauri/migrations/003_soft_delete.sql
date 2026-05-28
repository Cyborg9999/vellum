-- Vellum migration 003: soft-delete for ref_images.
--
-- Replaces hard DELETE with a `deleted_at` timestamp. Lets users recover
-- accidentally-deleted images via the Library "Trash" view.
--
-- Active queries should filter `WHERE deleted_at IS NULL`.
-- Trash view filters `WHERE deleted_at IS NOT NULL`.

ALTER TABLE ref_images ADD COLUMN deleted_at INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_ref_images_deleted_at ON ref_images(deleted_at);
