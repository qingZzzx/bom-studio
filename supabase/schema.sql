create table if not exists public.project_boards (
  id text primary key,
  name text not null,
  imported_at timestamptz not null default now(),
  sheet_names jsonb not null default '[]'::jsonb,
  projects jsonb not null default '[]'::jsonb
);

create index if not exists project_boards_imported_at_idx
  on public.project_boards (imported_at desc);

create table if not exists public.generation_history (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  model text not null default '',
  template text not null default '',
  matched integer not null default 0,
  pending integer not null default 0
);

create index if not exists generation_history_created_at_idx
  on public.generation_history (created_at desc);

alter table public.project_boards enable row level security;
alter table public.generation_history enable row level security;

-- 不创建匿名访问策略。Cloudflare Pages Functions 使用服务端 service-role 密钥访问。
