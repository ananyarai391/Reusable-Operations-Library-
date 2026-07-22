-- Phase 3 addition: is_placeholder flag
-- Lets a library entry exist with no video yet, marking "this needs to be recorded"

alter table elements
  add column is_placeholder boolean not null default false;
