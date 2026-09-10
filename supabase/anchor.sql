-- ============================================================
-- FlowMirror · morning_anchors 晨间心锚 建表脚本（增量）
-- 在已执行 schema.sql 的基础上，单独运行本文件即可新增 morning_anchors 表
-- 执行方式：Supabase 控制台 → SQL Editor → 粘贴全文运行
-- ============================================================

-- 7. morning_anchors —— 晨间心锚（每日一条，由昨日反思 + 今日排布凝练）
create table if not exists public.morning_anchors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  date text not null default to_char(now(), 'YYYY-MM-DD'),  -- 归属日 YYYY-MM-DD（本地时区）
  slogan text not null,                   -- 大字心锚：一行动作断言（AI 凝练 ≤15 字）
  action text not null default '',        -- 小字注解：昨日卡点 + 今日时间锚点
  source text not null default 'user',    -- 来源：ai / user / seed

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 同一用户同一天仅一条（重 roll = 覆盖）
  constraint morning_anchors_user_date_key unique (user_id, date)
);

comment on table public.morning_anchors is '晨间心锚：每日一条行动锚点，大字 slogan + 小字 action';

-- updated_at 触发器
drop trigger if exists morning_anchors_set_updated_at on public.morning_anchors;
create trigger morning_anchors_set_updated_at
  before update on public.morning_anchors
  for each row execute function public.set_updated_at();

-- 索引：按 user + 日期回查
create index if not exists morning_anchors_user_date_idx on public.morning_anchors (user_id, date desc);

-- RLS：按 user_id 隔离
alter table public.morning_anchors enable row level security;

create policy "morning_anchors_select_own" on public.morning_anchors
  for select using (auth.uid() = user_id);
create policy "morning_anchors_insert_own" on public.morning_anchors
  for insert with check (auth.uid() = user_id);
create policy "morning_anchors_update_own" on public.morning_anchors
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "morning_anchors_delete_own" on public.morning_anchors
  for delete using (auth.uid() = user_id);

-- Realtime：订阅 morning_anchors 变更（多端实时同步）
alter publication supabase_realtime add table public.morning_anchors;

do $$
begin
  raise notice 'morning_anchors 表已就绪：RLS 已启用，已加入 Realtime。';
end;
$$;
