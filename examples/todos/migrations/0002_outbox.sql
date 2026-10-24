-- The hints of a change, written in its transaction and deleted once they are
-- published (src/lib/server/outbox.ts). What a Worker that died in between
-- leaves here, the cron publishes (worker.js).
create table outbox (
	id text primary key,
	hints text not null
);
