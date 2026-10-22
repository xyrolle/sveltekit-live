create table todos (
	id text primary key,
	text text not null,
	done integer not null default 0,
	created integer not null
);
