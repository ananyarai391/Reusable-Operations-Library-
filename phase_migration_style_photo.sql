-- Adds a single representative photo per style (e.g. a reference shot of
-- the garment), shown while building its operation list.

alter table styles
  add column photo_url text;
