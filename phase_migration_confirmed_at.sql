-- Adds a lock/confirm state to styles: once a supervisor confirms the
-- operation list, the builder UI moves from "browse & assemble" into
-- "record missing videos" for whatever is still a placeholder.

alter table styles
  add column confirmed_at timestamptz;
