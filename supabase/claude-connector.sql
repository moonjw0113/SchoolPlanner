-- =====================================================================
-- 학교 플래너 Claude 커넥터(MCP) 연결
--  * claude.ai 대화에서 사진 속 일정을 플래너에 바로 저장하기 위한 표와 함수
--  * security-migration.sql(관리자 admins 테이블)을 먼저 실행한 뒤 한 번 실행한다.
--  * 여러 번 실행해도 안전하다. 기존 일정 데이터는 바뀌지 않는다.
-- =====================================================================

-- 관리자마다 연결 주소 하나. 토큰 원문은 저장하지 않고 SHA-256 해시만 보관한다.
create table if not exists public.connector_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.connector_tokens enable row level security;
revoke all on public.connector_tokens from public, anon, authenticated;

create or replace function public.connector_token_hash(p_token text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

-- 웹앱에서 관리자가 새 연결 주소를 만든다. 이전 주소는 바로 끊긴다.
create or replace function public.set_connector_token(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null or not exists (select 1 from public.admins where user_id = u) then
    raise exception '관리자만 연결 주소를 만들 수 있습니다.';
  end if;
  if coalesce(length(p_token), 0) not between 32 and 200 or p_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception '연결 토큰 형식 오류';
  end if;
  insert into public.connector_tokens (user_id, token_hash)
  values (u, public.connector_token_hash(p_token))
  on conflict (user_id) do update
    set token_hash = excluded.token_hash, created_at = now(), last_used_at = null;
end $$;

create or replace function public.revoke_connector_token()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  delete from public.connector_tokens where user_id = auth.uid();
end $$;

create or replace function public.connector_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('createdAt', created_at, 'lastUsedAt', last_used_at)
  from public.connector_tokens where user_id = auth.uid();
$$;

-- 'YYYY-MM-DD'이면서 실제로 있는 날짜인지
create or replace function public.connector_valid_date(p text)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  return to_char(p::date, 'YYYY-MM-DD') = p;
exception when others then
  return false;
end $$;

-- 일정 하나를 검사해 정리한 값을 돌려준다. 잘못된 값이 있으면 예외를 낸다.
create or replace function public.connector_clean_item(p jsonb, p_label text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_title text := btrim(coalesce(p->>'title', ''));
  v_date text := btrim(coalesce(p->>'date', ''));
  v_type text := coalesce(nullif(btrim(p->>'type'), ''), '과제');
  v_period text := coalesce(btrim(p->>'period'), '');
  v_subject text := coalesce(nullif(btrim(p->>'subject'), ''), '기타');
  v_description text := btrim(coalesce(p->>'description', ''));
begin
  if v_title = '' or length(v_title) > 80 then raise exception '%: 제목은 1~80자여야 합니다.', p_label; end if;
  if not public.connector_valid_date(v_date) then raise exception '%: 날짜는 YYYY-MM-DD 형식의 실제 날짜여야 합니다. (받은 값: %)', p_label, v_date; end if;
  if v_type not in ('수행평가', '과제', '시험', '기타') then raise exception '%: 구분은 수행평가, 과제, 시험, 기타 중 하나여야 합니다.', p_label; end if;
  if v_period !~ '^[1-7]?$' then raise exception '%: 교시는 1~7 또는 빈 값이어야 합니다.', p_label; end if;
  if length(v_subject) > 40 then raise exception '%: 과목은 40자 이하여야 합니다.', p_label; end if;
  if length(v_description) > 500 then raise exception '%: 메모는 500자 이하여야 합니다.', p_label; end if;
  return jsonb_build_object('title', v_title, 'date', v_date, 'type', v_type, 'period', v_period,
                            'subject', v_subject, 'description', v_description);
end $$;

-- 커넥터 서버(Edge Function planner-mcp)가 공개 키로 부른다.
-- 토큰으로 관리자를 확인한 뒤 일정 조회·추가·수정만 한다. (삭제는 웹앱에서만)
create or replace function public.connector_call(p_token text, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u uuid;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_items jsonb;
  v_item jsonb;
  v_clean jsonb;
  v_cleaned jsonb := '[]'::jsonb;
  v_added jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_id text;
  v_from text;
  v_to text;
  v_existing record;
  i int := 0;
begin
  select user_id into u from public.connector_tokens where token_hash = public.connector_token_hash(p_token);
  if u is null then
    raise exception '연결 주소가 올바르지 않거나 끊어졌습니다. 학교 플래너에서 새 연결 주소를 만들어 주세요.';
  end if;
  if not exists (select 1 from public.admins where user_id = u) then
    raise exception '이 연결 주소의 계정은 더 이상 관리자가 아닙니다.';
  end if;
  update public.connector_tokens set last_used_at = now() where user_id = u;

  if p_action = 'context' then
    return jsonb_build_object(
      'today', to_char(v_today, 'YYYY-MM-DD'),
      'weekday', (array['일', '월', '화', '수', '목', '금', '토'])[extract(dow from v_today)::int + 1],
      'timetable', (
        select coalesce(jsonb_agg(jsonb_build_object('day_of_week', day_of_week, 'period', period, 'subject', subject, 'teacher', teacher)
                                  order by day_of_week, period), '[]'::jsonb)
        from public.timetable where coalesce(subject, '') <> ''),
      'timetable_changes', (
        select coalesce(jsonb_agg(jsonb_build_object('date', date, 'period', period, 'subject', subject, 'teacher', teacher)
                                  order by date, period), '[]'::jsonb)
        from public.timetable_overrides where date >= to_char(v_today, 'YYYY-MM-DD')),
      'upcoming', (
        select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'type', type, 'date', date, 'period', period,
                                                     'subject', subject, 'description', description) order by date, period), '[]'::jsonb)
        from public.assessments where date >= to_char(v_today - 7, 'YYYY-MM-DD'))
    );

  elsif p_action = 'list' then
    v_from := coalesce(nullif(p_args->>'from', ''), to_char(v_today, 'YYYY-MM-DD'));
    v_to := coalesce(nullif(p_args->>'to', ''), to_char(v_today + 60, 'YYYY-MM-DD'));
    if not public.connector_valid_date(v_from) or not public.connector_valid_date(v_to) then
      raise exception 'from, to는 YYYY-MM-DD 형식이어야 합니다.';
    end if;
    return (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'type', type, 'date', date, 'period', period,
                                                   'subject', subject, 'description', description) order by date, period), '[]'::jsonb)
      from public.assessments where date between v_from and v_to);

  elsif p_action = 'add' then
    v_items := p_args->'items';
    if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
      raise exception 'items에 일정을 하나 이상 넣어 주세요.';
    end if;
    if jsonb_array_length(v_items) > 30 then raise exception '한 번에 30개까지 저장할 수 있습니다.'; end if;
    -- 모두 검사한 뒤에 저장한다. (하나라도 틀리면 아무것도 저장하지 않음)
    for v_item in select value from jsonb_array_elements(v_items) loop
      i := i + 1;
      v_cleaned := v_cleaned || jsonb_build_array(public.connector_clean_item(v_item, format('%s번째 일정', i)));
    end loop;
    for v_clean in select value from jsonb_array_elements(v_cleaned) loop
      select id, title, date into v_existing from public.assessments
        where date = v_clean->>'date' and lower(title) = lower(v_clean->>'title') limit 1;
      if found then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id', v_existing.id, 'title', v_existing.title, 'date', v_existing.date));
        continue;
      end if;
      v_id := (floor(extract(epoch from clock_timestamp()) * 1000))::bigint::text || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
      insert into public.assessments (id, title, type, date, period, subject, description, image, completed, updated_at)
      values (v_id, v_clean->>'title', v_clean->>'type', v_clean->>'date', v_clean->>'period', v_clean->>'subject',
              v_clean->>'description', '', false, now());
      v_added := v_added || jsonb_build_array(v_clean || jsonb_build_object('id', v_id));
    end loop;
    return jsonb_build_object('added', v_added, 'skipped_duplicates', v_skipped);

  elsif p_action = 'update' then
    v_id := p_args->>'id';
    select * into v_existing from public.assessments where id = v_id;
    if not found then raise exception '일정을 찾을 수 없습니다: %', v_id; end if;
    -- 넘어온 값만 바꾸고 나머지는 기존 값을 쓴다.
    v_clean := public.connector_clean_item(
      jsonb_build_object('title', v_existing.title, 'date', v_existing.date, 'type', v_existing.type, 'period', v_existing.period,
                         'subject', v_existing.subject, 'description', v_existing.description)
      || (coalesce(p_args->'changes', '{}'::jsonb) - 'id' - 'image' - 'completed'),
      '수정할 일정');
    update public.assessments set
      title = v_clean->>'title', date = v_clean->>'date', type = v_clean->>'type', period = v_clean->>'period',
      subject = v_clean->>'subject', description = v_clean->>'description', updated_at = now()
    where id = v_id;
    return v_clean || jsonb_build_object('id', v_id);

  else
    raise exception '알 수 없는 커넥터 작업: %', p_action;
  end if;
end $$;

revoke all on function public.connector_token_hash(text), public.set_connector_token(text), public.revoke_connector_token(),
  public.connector_status(), public.connector_valid_date(text), public.connector_clean_item(jsonb, text),
  public.connector_call(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.set_connector_token(text), public.revoke_connector_token(), public.connector_status() to authenticated;
grant execute on function public.connector_call(text, text, jsonb) to anon, authenticated;
