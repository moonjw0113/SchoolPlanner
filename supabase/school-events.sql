-- =====================================================================
-- 학사일정(school_events): 공휴일, 학교 행사, 휴업일, 방학, 시험기간
--  * 달력과 날짜별 수업 보기에 표시한다. 수행평가·과제(assessments)와는 따로 관리한다.
--  * security-migration.sql(admins, is_admin)을 먼저 실행한 뒤 실행한다.
--  * 여러 번 실행해도 안전하다.
-- =====================================================================

create table if not exists public.school_events (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  title text not null check (length(btrim(title)) between 1 and 60),
  -- 공휴일·휴업일·방학은 수업이 없는 날, 행사·시험기간은 수업은 그대로 있는 날
  kind text not null check (kind in ('공휴일', '휴업일', '방학', '행사', '시험기간')),
  note text not null default '' check (length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date <= 120)
);
create index if not exists school_events_dates on public.school_events (start_date, end_date);

alter table public.school_events enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'school_events' loop
    execute format('drop policy %I on public.school_events', p.policyname);
  end loop;
end $$;
create policy "Public read" on public.school_events for select using (true);
create policy "Admin insert" on public.school_events for insert to authenticated with check (public.is_admin());
create policy "Admin update" on public.school_events for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admin delete" on public.school_events for delete to authenticated using (public.is_admin());

do $$
begin
  alter publication supabase_realtime add table public.school_events;
exception when duplicate_object then null;
end $$;

-- 2026년 공휴일 (예전에 app.js에 적혀 있던 목록). 같은 날짜·이름이 이미 있으면 건너뛴다.
insert into public.school_events (start_date, end_date, title, kind)
select d::date, d::date, t, '공휴일'
from (values
  ('2026-01-01', '신정'), ('2026-02-16', '설날 연휴'), ('2026-02-17', '설날'), ('2026-02-18', '설날 연휴'),
  ('2026-03-01', '삼일절'), ('2026-03-02', '대체공휴일'), ('2026-05-01', '근로자의 날'), ('2026-05-05', '어린이날'),
  ('2026-05-24', '부처님오신날'), ('2026-05-25', '대체공휴일'), ('2026-06-06', '현충일'), ('2026-07-17', '제헌절'),
  ('2026-08-15', '광복절'), ('2026-08-17', '대체공휴일'), ('2026-09-24', '추석 연휴'), ('2026-09-25', '추석'),
  ('2026-09-26', '추석 연휴'), ('2026-10-03', '개천절'), ('2026-10-05', '대체공휴일'), ('2026-10-09', '한글날'),
  ('2026-12-25', '성탄절')
) as h(d, t)
where not exists (
  select 1 from public.school_events e where e.start_date = h.d::date and e.title = h.t
);
