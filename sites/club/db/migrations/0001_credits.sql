-- Computer Club credits: a balance per member, and every change to it.
-- One credit is $0.001 of AI use at our prices (api/_pricing.ts).

create table credit_balance (
  user_id text primary key references "user" ("id") on delete cascade,
  balance bigint not null default 0
);

create table credit_ledger (
  id bigserial primary key,
  user_id text not null references "user" ("id") on delete cascade,
  -- Credits added (positive) or spent (negative).
  delta bigint not null,
  kind text not null check (kind in ('grant', 'purchase', 'usage', 'refund', 'adjust')),
  -- What the change is for; at most one change per ref (signup:<user>, a Polar order, a request).
  ref text not null unique,
  -- For usage: what was used, and what it cost us before the markup.
  model text,
  input_tokens integer,
  output_tokens integer,
  cost_microusd bigint,
  created_at timestamptz not null default now()
);

create index credit_ledger_user_created_idx on credit_ledger (user_id, created_at desc);
