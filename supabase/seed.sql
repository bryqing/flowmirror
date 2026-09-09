-- ============================================================
-- FlowMirror · 演示账号 Seed 脚本
-- 用法：先用一个测试账号登录（Auth），拿到其 user_id 后替换下方
--       'REPLACE_WITH_USER_ID'，再运行本脚本灌入演示数据。
-- 或：在 Supabase 控制台 → Authentication 创建用户后，用其 UUID。
-- ============================================================

do $$
declare
  v_user uuid := 'REPLACE_WITH_USER_ID';  -- TODO: 替换为真实登录用户 id
begin
  if v_user is null or v_user = '00000000-0000-0000-0000-000000000000' then
    raise exception '请先替换 v_user 为真实用户 id';
  end if;

  -- 今日任务（对齐 mock-data.ts 的 TODAY_TASKS）
  insert into public.tasks (user_id, title, status, category, scheduled_time, planned_duration, actual_duration, blackhole_minutes, time_slices, micro_reviews, insights, sops, pitfalls, date)
  values
    (v_user, '撰写 Q3 产品复盘报告', 'in-progress', 'deep-work', '09:30', 90, null, null,
     '[{"start":"09:30","end":"10:15","label":"报告框架搭建"}]',
     '[]',
     '[]',
     '["先写结论与三段故事线，再填数据","断网 25 分钟，手机翻面扣在桌角","烂初稿直接写，禁止回头改措辞"]',
     '["上次一上来就调排版，2 小时没写完 300 字"]',
     to_char(now(), 'YYYY-MM-DD')),
    (v_user, '回复客户邮件 & 审批流程', 'done', 'chore', '11:00', 30, 38, null,
     '[{"start":"11:02","end":"11:40","label":"邮件与审批"}]',
     '[{"id":"mr-02","createdAt":"11:42","blockerTags":["被打断"],"lessonTags":["批量处理"],"note":"一封询价邮件拖进了聊天，以后杂务统一 30 分钟批处理。"}]',
     '["杂务批处理比随时响应平均少花 12 分钟"]',
     '["先回紧急的 3 封，其余归档","审批单一键过，不纠结措辞"]',
     '["不要在杂务时段点开微信群"]',
     to_char(now(), 'YYYY-MM-DD')),
    (v_user, '午休刷短视频（计划外黑洞）', 'done', 'blackhole', '12:30', null, 30, 30,
     '[{"start":"12:30","end":"13:00","label":"刷短视频"}]',
     '[{"id":"mr-03","createdAt":"13:05","blockerTags":["超时失控"],"lessonTags":["环境隔离"],"note":"说好的 10 分钟……下午把手机放到抽屉里。"}]',
     '[]', '[]',
     '["躺着刷 = 必然超时，倒计时必须开声音"]',
     to_char(now(), 'YYYY-MM-DD')),
    (v_user, '准备周四方案评审：故事线初稿', 'pending', 'deep-work', '14:00', 120, null, null,
     '[]', '[]', '[]',
     '["白板先画 5 页叙事流，不开 PPT","每页只写一个核心观点句","数据图表最后补，先借位占位"]',
     '["上次直接套模板，做了 40 页被批「没有观点」","午后犯困，先冲一杯咖啡再开始"]',
     to_char(now(), 'YYYY-MM-DD')),
    (v_user, '冥想 15 分钟 + 下楼散步', 'pending', 'rest', '15:30', 30, null, null,
     '[]', '[]', '[]',
     '["4-7-8 呼吸三轮","不带手机下楼"]',
     '[]',
     to_char(now(), 'YYYY-MM-DD')),
    (v_user, '整理本周报销单', 'pending', 'chore', '16:30', 20, null, null,
     '[]', '[]', '[]',
     '["发票拍照 → 统一贴入模板","超过 20 分钟立刻停，明天续"]',
     '[]',
     to_char(now(), 'YYYY-MM-DD'));

  -- 昨日之镜快照
  insert into public.mirror_snapshots
    (user_id, date_label, date_key, completion_rate, done_count, total_count, deep_work_minutes, blackhole_minutes, blackhole_slices, blackhole_comment, memory_fragments, most_touching, lessons, insight_cards, bedtime_reflection, morning_plan, overall_comment)
  values
    (v_user, '9月7日 · 周一', to_char(now() - interval '1 day', 'YYYY-MM-DD'),
     0.71, 5, 7, 215, 150,
     '[{"start":"12:30","end":"13:00","label":"刷短视频 · 午休"},{"start":"17:15","end":"17:45","label":"游戏摸鱼"},{"start":"21:00","end":"22:00","label":"刷短视频 · 失控段","runaway":true}]',
     '夜间 21 点后为重度失控期，单段失控 60 分钟、占昨日黑洞 40%。今晚建议 21:00 把手机物理隔离到客厅。',
     '[{"text":"外界的挑剔，只是内心心虚的放大镜。","source":"深夜认知深潜 · 第三轮"},{"text":"先写烂初稿，再迭代到好——开场焦虑只能靠动手治。","source":"微复盘 · 方案初稿"},{"text":"刷手机不是休息，是逃避；真正的恢复是散步和冥想。","source":"微复盘 · 午休黑洞"}]',
     '下午方案被否后，没有继续刷手机逃避，而是在白板前重画故事线——15 分钟就找到了真正的卡点。',
     '[{"taskTitle":"方案初稿","text":"别打开 PPT 就找模板，先在白板搭故事线"},{"taskTitle":"午休黑洞","text":"午后刷视频极易超时，手机放在另一个房间"},{"taskTitle":"数据整理","text":"深度工作前先关通知，平均少花 18 分钟"}]',
     '[{"title":"开场焦虑是最大的时间税","text":"连续两天卡在「准备开始」上，耗掉 70 分钟。对策：烂初稿先行，定时器 5 分钟内必须敲下第一个字。"},{"title":"黑洞不是罪恶，失控才是","text":"计划内娱乐 40 分钟恢复了状态；无倒计时的 95 分钟刷屏只带来愧疚。给快乐装上刹车。"},{"title":"白板比 PPT 更快接近真相","text":"方案被否后在白板上重画叙事流，15 分钟定位卡点，而对着模板调了 2 小时排版。观点先行，样式最后。"}]',
     '今天不是懒，是被「开场焦虑」卡住了。允许初稿烂，允许自己不完美地开始。',
     '10:00 前完成复盘报告框架，不碰排版、不调字体。',
     '完成率 71%，深度工作 3 小时 35 分是本周高点；真正的敌人不是懒，而是夜间失控与开场焦虑。今天带着两条教训开战：先动手、21 点隔离手机。');

  -- 记忆碎片
  insert into public.memory_fragments (user_id, text, source, kind, tags) values
    (v_user, '外界的挑剔，只是内心心虚的放大镜。', '深夜认知深潜 · 第三轮', 'quote', '{"认知","情绪"}'),
    (v_user, '先写烂初稿，再迭代到好——开场焦虑只能靠动手治。', '微复盘 · 方案初稿', 'insight', '{"开场焦虑","写作"}'),
    (v_user, '刷手机不是休息，是逃避；真正的恢复是散步和冥想。', '微复盘 · 午休黑洞', 'lesson', '{"手机","恢复"}');

  raise notice 'FlowMirror 演示数据灌入完成';
end;
$$;
