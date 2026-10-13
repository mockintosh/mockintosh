-- Members' home disks (docs/club-storage-plan.md): one row per file and
-- folder, and the larger file contents by their SHA-256.

-- Every change takes the next number, so a Mac asks for what changed since the last one it saw.
create sequence disk_seq;

create table disk_node (
  user_id text not null references "user" ("id") on delete cascade,
  id text not null,
  parent_id text not null,
  name text not null,
  kind text not null check (kind in ('file', 'directory')),
  type text,
  size bigint not null default 0,
  -- The revision the Mac gave it; a change must be based on this one.
  revision integer not null,
  created_at bigint not null,
  modified_at bigint not null,
  role text,
  attributes jsonb,
  -- Small file contents in the row; larger ones in disk_blob by hash.
  content bytea,
  sha256 text,
  -- A tombstone, so other Macs learn about the removal.
  deleted boolean not null default false,
  seq bigint not null default nextval('disk_seq'),
  primary key (user_id, id)
);

create index disk_node_user_seq_idx on disk_node (user_id, seq);

create table disk_blob (
  user_id text not null references "user" ("id") on delete cascade,
  sha256 text not null,
  size bigint not null,
  content bytea not null,
  created_at timestamptz not null default now(),
  primary key (user_id, sha256)
);

-- The newest catalog format that has written to each disk: older Macs may read it, not write.
create table disk_format (
  user_id text primary key references "user" ("id") on delete cascade,
  format integer not null
);
