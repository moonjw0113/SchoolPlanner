-- =====================================================================
-- 학교 플래너 보안 마이그레이션 (기존 DB에 한 번 실행)
--  * 누구나 쓰기 가능하던 RLS 정책을 "조회는 모두, 쓰기는 관리자만"으로 교체
--  * 관리자 목록(admins) 테이블과 is_admin() 함수 추가
--  * 코드가 사용하지만 설치 SQL에 빠져 있던 timetable_overrides 테이블 추가
-- 여러 번 실행해도 안전하도록 작성했다.
-- =====================================================================

-- 1. 날짜별 시간표 변경 테이블 (없을 때만 생성)
create table if not exists timetable_overrides (
  id text primary key,
  date text not null,
  period integer not null,
  subject text default '',
  teacher text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. 관리자 목록
create table if not exists admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);
alter table admins enable row level security;
drop policy if exists "Admins can read own row" on admins;
create policy "Admins can read own row" on admins
  for select to authenticated using (user_id = auth.uid());

-- 3. 현재 로그인한 사용자가 관리자인지 확인하는 함수
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- 4. 기존 정책을 모두 지우고 새 정책 적용
do $$
declare
  t text;
  p record;
begin
  foreach t in array array['assessments', 'timetable', 'timetable_overrides', 'subject_locations', 'timetable_location_overrides'] loop
    execute format('alter table public.%I enable row level security', t);

    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;

    execute format('create policy "Public read" on public.%I for select using (true)', t);
    execute format('create policy "Admin insert" on public.%I for insert to authenticated with check (public.is_admin())', t);
    execute format('create policy "Admin update" on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    execute format('create policy "Admin delete" on public.%I for delete to authenticated using (public.is_admin())', t);

    -- Realtime 구독 대상에 추가 (이미 있으면 건너뜀)
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- 5. 관리자 등록
--  (1) 대시보드 Authentication → Users → Add user 로 이메일/비밀번호 계정을 만든다.
--      (Auto Confirm User 체크)
--  (2) 아래 이메일을 바꿔서 실행한다.
-- insert into admins (user_id) select id from auth.users where email = 'admin@example.com';
