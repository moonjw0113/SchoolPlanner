# 학교 플래너 (수행평가 · 과제 관리)

종촌고등학교 1학년 7반의 2학기 시간표를 기반으로 수행평가와 과제를 달력 및 시간표 뷰에서 통합 관리하는 웹앱입니다.
**Supabase 데이터베이스 연동** 및 **Supabase 로그인 기반 관리자 권한**가 포함되어 있습니다.

---

## 🌟 주요 기능

1. **권한 구분 (일반 사용자 vs 관리자)**
   - **일반 사용자 (기본)**: 수행평가/과제 날짜별 정리 조회, 사진 및 메모 확인 (등록/수정/삭제 불가)
   - **관리자**: 상단 `🔑 관리자 로그인` 버튼으로 Supabase 계정에 로그인하면 일정과 시간표를 추가·수정·삭제할 수 있다. 권한은 DB의 RLS 정책이 검사하므로 화면을 조작해도 우회할 수 없다.
2. **Supabase 연동**: 등록한 일정을 온라인 데이터베이스에 보관 (모든 접속자가 공유, Realtime 반영)
3. **사진 첨부 지원**: 1.5MB 이하 사진을 DataURL로 저장. 목록에서는 사진을 빼고 불러오고, 일정을 열 때만 사진을 받는다.
4. **자동 과목 입력**: 종촌고 1-7 시간표 기반으로 교시 선택 시 과목 및 담당 교사 자동 연결
5. **2026 공휴일 및 달력 뷰**: 대한민국 공휴일 자동 표시 및 일별/월별 할 일 보기
6. **Claude로 일정 넣기**: claude.ai에 Supabase 공식 커넥터를 연결하고 알림장·공지 사진을 올리면, Claude가 일정을 정리해 확인을 받은 뒤 DB에 저장한다. (API 키 불필요)

---

## 🛠️ Supabase 데이터베이스 연결 방법

1. [Supabase](https://supabase.com)에 로그인 후 새 프로젝트를 생성합니다.
2. **SQL Editor**에서 아래 테이블 생성 SQL을 실행합니다.

```sql
create table if not exists assessments (
  id text primary key,
  title text not null,
  type text default '과제',
  date text not null,
  period text default '',
  subject text default '기타',
  description text default '',
  image text default '',
  completed boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists timetable (
  id text primary key,
  period integer not null,
  day_of_week integer not null,
  subject text default '',
  teacher text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists subject_locations (
  subject text primary key,
  default_location text default '',
  updated_at timestamptz default now()
);

create table if not exists timetable_location_overrides (
  id text primary key,
  date text not null,
  period integer not null,
  location text default '',
  updated_at timestamptz default now()
);
```

3. 이어서 [`supabase/security-migration.sql`](supabase/security-migration.sql) 전체를 실행합니다. 이 파일이 하는 일:
   - `timetable_overrides`(날짜별 시간표 변경) 테이블과 `admins`(관리자 목록) 테이블 생성
   - 모든 테이블에 "조회는 누구나, 쓰기는 관리자만" RLS 정책 적용 (기존 정책은 삭제)
   - Realtime 구독 대상 등록

   이미 운영 중인 DB도 이 파일만 한 번 실행하면 됩니다. 여러 번 실행해도 안전합니다.

4. Supabase 프로젝트의 **Project Settings → API**에서 `Project URL`과 공개용(publishable/anon) 키를 복사해 `app.js` 상단의 `SUPABASE_URL`, `SUPABASE_ANON_KEY`에 넣습니다. 이 키는 공개돼도 되는 키입니다. `service_role` 키는 절대 넣지 마세요.

---

## 🔑 관리자 계정 만들기

예전의 공용 비밀번호 방식은 없어졌습니다. 관리자는 Supabase 계정으로 로그인합니다.

1. Supabase 대시보드 **Authentication → Users → Add user**에서 이메일과 비밀번호로 계정을 만듭니다. (**Auto Confirm User** 체크)
2. **SQL Editor**에서 이메일을 바꿔 실행합니다.

```sql
insert into admins (user_id) select id from auth.users where email = 'admin@example.com';
```

3. 다른 사람이 계정을 만들지 못하게 **Authentication → Sign In / Providers → Email**에서 **Allow new users to sign up**을 끕니다. (꺼 두지 않아도 `admins`에 없는 계정은 쓰기 권한이 없습니다.)

관리자를 빼려면 `delete from admins where user_id = ...;`를 실행합니다.

---

## 🤖 Claude로 사진 속 일정 넣기 (Supabase 공식 커넥터)

claude.ai에 Supabase 공식 커넥터를 연결하면 Claude가 SQL로 `assessments` 테이블에 일정을 바로 넣습니다. 사이트는 Realtime으로 자동 반영됩니다.

1. claude.ai → 설정 → 커넥터 → 둘러보기에서 **Supabase**를 추가하고, 이 프로젝트가 있는 Supabase 계정으로 로그인합니다.
2. claude.ai에 "학교 플래너" 프로젝트를 만들고 아래 지침을 프로젝트 지침에 붙여 넣습니다.
3. 프로젝트 대화에서 Supabase 커넥터를 켜고, 사진과 함께 "이 일정 플래너에 넣어 줘"라고 말합니다.

> ⚠ 이 커넥터는 DB 전체를 바꿀 수 있습니다(RLS를 거치지 않음). Claude가 `delete`, `drop`, `alter`, `truncate`나 여러 행을 바꾸는 `update`를 실행하겠다고 하면 내용을 꼭 확인하고 승인하세요. 사진 파일은 커넥터로 올릴 수 없으니, 필요하면 사이트에서 일정을 열어 직접 첨부합니다.

### 프로젝트 지침

```
너는 종촌고 1학년 7반 "학교 플래너"의 일정 입력 도우미다. Supabase 커넥터로 일정을 넣는다.
- Supabase 프로젝트 이름: SchoolPlanner (project_ref: gzbnybhmxetxrsjwbgdq). 다른 프로젝트는 건드리지 않는다.
- 일정 테이블: public.assessments
  id text (형식: '<밀리초 타임스탬프>-<임의 12자리 16진수>', 예: (floor(extract(epoch from now())*1000))::bigint || '-' || substr(md5(random()::text),1,12))
  title text (80자 이하), type text ('수행평가'|'과제'|'시험'|'기타'), date text ('YYYY-MM-DD'),
  period text ('1'~'7' 또는 ''), subject text (모르면 '기타'), description text (500자 이하, 없으면 ''),
  image text (항상 ''), completed boolean (false), updated_at timestamptz (now())
- 시간표: public.timetable (period 1~7, day_of_week 1=월~5=금, subject, teacher)
  날짜별 변경: public.timetable_overrides (date, period, subject, teacher)

사진으로 일정을 넣을 때:
1. 먼저 한국 시간 오늘 날짜((now() at time zone 'Asia/Seoul')::date), 시간표, 앞으로 등록된 일정(date >= 오늘 - 7일)을 조회한다.
2. 사진에 실제로 적힌 일정만 뽑는다. "다음 주 화요일", "내일" 같은 상대 날짜는 오늘 기준으로 계산하고, 연도가 없으면 가장 가까운 미래로 본다.
3. 과목과 요일이 시간표와 맞으면 교시를 채운다. 맞는 교시가 여러 개이거나 없으면 비워 둔다.
4. 글씨가 흐리거나 날짜·과목·내용이 모호하면 저장하지 말고 먼저 짧게 물어본다.
5. 이미 같은 날짜·비슷한 제목의 일정이 있으면 새로 넣지 말고 수정할지 물어본다.
6. 저장 전에 일정 목록(날짜, 교시, 과목, 구분, 제목, 메모)을 표로 보여 주고 확인을 받은 뒤 insert 한다.
7. insert/update만 쓴다. delete, drop, alter, truncate, 보안 정책 변경, 여러 행을 한꺼번에 바꾸는 update는 사용자가 분명히 요청하고 한 번 더 확인한 경우에만 한다.
8. 저장 후 몇 개를 넣었는지 알려 주고, 사이트를 새로고침하면 보인다고 안내한다.
```

---

## 🚀 GitHub Pages 정적 배포 방법

이 프로젝트는 백엔드 서버 없이 동작하는 순수 HTML/CSS/JS 웹앱입니다.

1. 이 저장소(Repository)를 GitHub에 푸시합니다.
2. GitHub 저장소 페이지의 **Settings -> Pages** 메뉴로 이동합니다.
3. **Source**를 `Deploy from a branch`로 선택하고, **Branch**를 `main` (또는 `master`) / `/ (root)`로 설정한 뒤 **Save**를 클릭합니다.
4. 몇 분 후 제공되는 배포 URL(예: `https://username.github.io/school-planner/`)로 친구들이 접속할 수 있습니다.

> **참고**: `server.js` 및 `start-school-planner.cmd` 파일은 로컬 컴퓨터에서 서버를 띄울 때 사용하는 파일이며, GitHub Pages 웹 배포 시에는 사용되지 않습니다.
