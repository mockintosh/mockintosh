-- Which session (a connected Macintosh) spent each credit, for its daily cap.
-- Not a foreign key: the ledger keeps its rows after a Mac is disconnected.

alter table credit_ledger add column session_id text;

create index credit_ledger_session_created_idx on credit_ledger (session_id, created_at) where session_id is not null;
