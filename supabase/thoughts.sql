-- ============================================================
-- FlowMirror · thoughts 灵感/思考流 建表脚本（增量）
-- 在已执行 schema.sql 的基础上，单独运行本文件即可新增 thoughts 表
-- 执行方式：Supabase 控制台 → SQL Editor → 粘贴全文运行
-- ============================================================

-- 6. thoughts —— 灵感 / 思考流（闪念随记，不与执行任务混淆）
create table if not exists public.thoughts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  content text not null,                -- 原始想法
  ai_expansion text not null default '', -- AI 拓展内容（维度拆解/反思提示/落地建议）
  tags text[] not null default '{}',    -- 可选标签

  date text not null default to_char(now(), 'YYYY-MM-DD'),  -- 归属日，按日归档
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.thoughts is '灵感/思考流：随时记录闪念与日常思路，带 AI 拓展';

-- updated_at 触发器
drop trigger if exists thoughts_set_updated_at on public.thoughts;
create trigger thoughts_set_updated_at
  before update on public.thoughts
  for each row execute function public.set_updated_at();

-- 索引：按 user + 日期归档回查
create index if not exists thoughts_user_date_idx on public.thoughts (user_id, date, created_at desc);

-- RLS：按 user_id 隔离
alter table public.thoughts enable row level security;

create policy "thoughts_select_own" on public.thoughts
  for select using (auth.uid() = user_id);
create policy "thoughts_insert_own" on public.thoughts
  for insert with check (auth.uid() = user_id);
create policy "thoughts_update_own" on public.thoughts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "thoughts_delete_own" on public.thoughts
  for delete using (auth.uid() = user_id);

-- Realtime：订阅 thoughts 变更（多端实时同步）
alter publication supabase_realtime add table public.thoughts;

do $$
begin
  raise notice 'thoughts 表已就绪：RLS 已启用，已加入 Realtime。';
end;
$$;
