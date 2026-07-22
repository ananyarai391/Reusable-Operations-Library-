-- ============================================================
-- Line-setting video library schema
-- Run this once against your local Postgres database
-- ============================================================

create extension if not exists "pgcrypto";
create extension if not exists pg_trgm;

-- ------------------------------------------------------------
-- ELEMENTS: the reusable library (video + defect info lives here)
-- ------------------------------------------------------------
create table elements (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  garment_types text[] not null default '{}',

  video_url text,
  thumbnail_url text,
  defect_notes text,
  defect_photo_urls text[] default '{}',

  parent_element_id uuid references elements(id) on delete set null,

  scope text not null default 'permanent'
    check (scope in ('permanent', 'temporary')),

  is_active boolean not null default true,

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_elements_garment_types on elements using gin (garment_types);
create index idx_elements_category on elements (category);
create index idx_elements_parent on elements (parent_element_id);
create index idx_elements_active_permanent on elements (is_active) where scope = 'permanent';
create index idx_elements_name_trgm on elements using gin (name gin_trgm_ops);


-- ------------------------------------------------------------
-- ELEMENT_VERSIONS: video history per element
-- ------------------------------------------------------------
create table element_versions (
  id uuid primary key default gen_random_uuid(),
  element_id uuid not null references elements(id) on delete cascade,
  version_no int not null,
  video_url text not null,
  defect_notes text,
  defect_photo_urls text[] default '{}',
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (element_id, version_no)
);

create index idx_element_versions_element on element_versions (element_id);


-- ------------------------------------------------------------
-- STYLES: one garment style / line
-- ------------------------------------------------------------
create table styles (
  id uuid primary key default gen_random_uuid(),
  brand text,
  style_name text not null,
  garment_type text not null,
  line_number text,

  cloned_from_style_id uuid references styles(id) on delete set null,

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_styles_garment_type on styles (garment_type);
create index idx_styles_cloned_from on styles (cloned_from_style_id);


-- ------------------------------------------------------------
-- OPERATIONS: one row per operation/station within a style
-- ------------------------------------------------------------
create table operations (
  id uuid primary key default gen_random_uuid(),
  style_id uuid not null references styles(id) on delete cascade,
  sequence_no int not null,
  station_name text,
  notecard_text text,

  element_id uuid not null references elements(id),
  element_version_id uuid references element_versions(id),

  qr_code_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (style_id, sequence_no)
);

create index idx_operations_style on operations (style_id);
create index idx_operations_element on operations (element_id);


-- ------------------------------------------------------------
-- USERS: supervisor logins
-- ------------------------------------------------------------
create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  username text not null unique,
  password_hash text not null,
  role text not null default 'supervisor',
  created_at timestamptz not null default now()
);
