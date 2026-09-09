-- ============================================================
-- FlowMirror · Supabase 建表脚本
-- 5 张表，严格对齐 src/lib/types.ts 数据模型
-- 执行方式：Supabase 控制台 → SQL Editor → 粘贴全文运行
-- ============================================================

-- 0. 扩展：生成 UUID（crypto 兼容）
create extension if not exists "pgcrypto";

-- ============================================================
-- 1. tasks —— 今日/历史任务（四象限）
-- ============================================================
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  title text not null,
  status text not null default 'pending'
    check (status in ('pending', 'in-progress', 'done', 'frozen')),
  category text not null
    check (category in ('deep-work', 'chore', 'blackhole', 'rest')),

  scheduled_time text,          -- "HH:mm"
  planned_duration int,         -- 分钟
  actual_duration int,          -- 分钟
  blackhole_minutes int,        -- 黑洞倒计时（仅 blackhole）

  -- 结构化 JSON 列（对齐 types.ts 的数组字段）
  time_slices jsonb not null default '[]'::jsonb,      -- TimeSlice[]
  micro_reviews jsonb not null default '[]'::jsonb,    -- MicroReview[]
  insights jsonb not null default '[]'::jsonb,         -- string[]
  sops jsonb not null default '[]'::jsonb,             -- string[]
  pitfalls jsonb not null default '[]'::jsonb,         -- string[]

  date text not null default to_char(now(), 'YYYY-MM-DD'),  -- 任务归属日
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tasks is '四象限任务：深度工作/日常杂务/娱乐黑洞/休息恢复';

-- ============================================================
-- 2. reviews —— 微复盘问答（任务维度）
-- ============================================================
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,

  blocker_tags jsonb not null default '[]'::jsonb,      -- 卡点标签
  lesson_tags jsonb not null default '[]'::jsonb,       -- 经验标签
  note text not null default '',                        -- 1~2 句快速记录
  emotion text,                                         -- 情绪标签（可选）

  created_at timestamptz not null default now()
);

comment on table public.reviews is '微复盘：做完即追问的沉淀';

-- ============================================================
-- 3. mirror_snapshots —— 每日昨日之镜快照
-- ============================================================
create table if not exists public.mirror_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  date_label text not null,           -- "9月7日 · 周一"
  date_key text not null,             -- "2026-09-07"（唯一，每天一条）
  completion_rate real not null default 0,
  done_count int not null default 0,
  total_count int not null default 0,
  deep_work_minutes int not null default 0,
  blackhole_minutes int not null default 0,

  blackhole_slices jsonb not null default '[]'::jsonb,
  blackhole_comment text not null default '',
  memory_fragments jsonb not null default '[]'::jsonb,
  most_touching text not null default '',
  lessons jsonb not null default '[]'::jsonb,
  insight_cards jsonb not null default '[]'::jsonb,
  bedtime_reflection text not null default '',
  morning_plan text not null default '',
  overall_comment text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, date_key)
);

comment on table public.mirror_snapshots is '每日昨日之镜快照（黑洞/完成率/金句）';

-- ============================================================
-- 4. memory_fragments —— 记忆碎片（可跨任务召回）
-- ============================================================
create table if not exists public.memory_fragments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  text text not null,                 -- 金句/顿悟
  source text not null default '',    -- 来源："深夜认知深潜 · 第三轮"
  kind text not null default 'quote'  -- quote | insight | lesson | touching
    check (kind in ('quote', 'insight', 'lesson', 'touching')),
  tags text[] not null default '{}',  -- 供同类任务召回

  created_at timestamptz not null default now()
);

comment on table public.memory_fragments is '记忆碎片：金句/经验卡/踩坑教训';

-- ============================================================
-- 5. heatmap_slices —— 24h 时间黑洞热力切片
-- ============================================================
create table if not exists public.heatmap_slices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  date_key text not null,             -- "2026-09-09"
  hour int not null check (hour >= 0 and hour <= 23),
  category text
    check (category in ('deep-work', 'chore', 'blackhole', 'rest') or category is null),
  intensity int not null default 0 check (intensity >= 0 and intensity <= 3),

  created_at timestamptz not null default now(),

  unique (user_id, date_key, hour)
);

comment on table public.heatmap_slices is '24h 时间黑洞热力切片';

-- ============================================================
-- 6. updated_at 自动触发器
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

drop trigger if exists mirror_set_updated_at on public.mirror_snapshots;
create trigger mirror_set_updated_at
  before update on public.mirror_snapshots
  for each row execute function public.set_updated_at();

-- ============================================================
-- 7. 索引
-- ============================================================
create index if not exists tasks_user_date_idx on public.tasks (user_id, date);
create index if not exists tasks_user_status_idx on public.tasks (user_id, status);
create index if not exists reviews_task_idx on public.reviews (task_id);
create index if not exists fragments_user_idx on public.memory_fragments (user_id, created_at desc);
create index if not exists heatmap_user_date_idx on public.heatmap_slices (user_id, date_key);

-- ============================================================
-- 8. RLS —— 按 user_id 隔离（多端同步安全核心）
-- ============================================================
alter table public.tasks enable row level security;
alter table public.reviews enable row level security;
alter table public.mirror_snapshots enable row level security;
alter table public.memory_fragments enable row level security;
alter table public.heatmap_slices enable row level security;

-- 每张表：仅允许读写「属于自己 user_id」的行
create policy "tasks_select_own" on public.tasks
  for select using (auth.uid() = user_id);
create policy "tasks_insert_own" on public.tasks
  for insert with check (auth.uid() = user_id);
create policy "tasks_update_own" on public.tasks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tasks_delete_own" on public.tasks
  for delete using (auth.uid() = user_id);

create policy "reviews_select_own" on public.reviews
  for select using (auth.uid() = user_id);
create policy "reviews_insert_own" on public.reviews
  for insert with check (auth.uid() = user_id);
create policy "reviews_update_own" on public.reviews
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "reviews_delete_own" on public.reviews
  for delete using (auth.uid() = user_id);

create policy "mirror_select_own" on public.mirror_snapshots
  for select using (auth.uid() = user_id);
create policy "mirror_insert_own" on public.mirror_snapshots
  for insert with check (auth.uid() = user_id);
create policy "mirror_update_own" on public.mirror_snapshots
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "mirror_delete_own" on public.mirror_snapshots
  for delete using (auth.uid() = user_id);

create policy "fragments_select_own" on public.memory_fragments
  for select using (auth.uid() = user_id);
create policy "fragments_insert_own" on public.memory_fragments
  for insert with check (auth.uid() = user_id);
create policy "fragments_update_own" on public.memory_fragments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "fragments_delete_own" on public.memory_fragments
  for delete using (auth.uid() = user_id);

create policy "heatmap_select_own" on public.heatmap_slices
  for select using (auth.uid() = user_id);
create policy "heatmap_insert_own" on public.heatmap_slices
  for insert with check (auth.uid() = user_id);
create policy "heatmap_update_own" on public.heatmap_slices
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "heatmap_delete_own" on public.heatmap_slices
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 9. Realtime —— 订阅 tasks 变更（多端实时同步核心）
-- ============================================================
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.reviews;

-- ============================================================
-- 完成提示
-- ============================================================
do $$
begin
  raise notice 'FlowMirror 建表完成：tasks / reviews / mirror_snapshots / memory_fragments / heatmap_slices 均已就绪，RLS 已启用，tasks 与 reviews 已加入 Realtime。';
end;
$$;
