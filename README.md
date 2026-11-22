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
6. **AI 일정 추가**: 알림장·칠판·공지 사진을 올리면 Claude가 날짜와 내용을 정리한다. 확실하지 않은 부분은 질문으로 표시하고, 관리자가 확인·수정한 뒤 저장한다. 직접 입력과 수정 기능도 그대로 쓸 수 있다.

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

## 🤖 AI 일정 추가 설정

`+ 일정 추가`는 사진을 Supabase Edge Function(`analyze-schedule`)으로 보내고, 이 함수가 Claude API로 사진을 분석합니다. API 키는 Supabase 안에만 보관되고 웹페이지에는 들어가지 않습니다.

1. [Claude Console](https://platform.claude.com/)에서 API 키를 만들고 결제 수단을 등록합니다. (사진 한 장 분석에 대략 몇십 원 정도 듭니다.)
2. Supabase 대시보드 **Edge Functions → Secrets**에서 `ANTHROPIC_API_KEY` 이름으로 API 키를 저장합니다.
3. **Edge Functions → Deploy a new function → Via Editor**를 누르고, 함수 이름을 `analyze-schedule`로 정한 뒤 [`supabase/functions/analyze-schedule/index.ts`](supabase/functions/analyze-schedule/index.ts) 내용을 그대로 붙여 넣고 **Deploy**합니다.
   - Supabase CLI를 쓴다면 `supabase functions deploy analyze-schedule`로도 됩니다.
4. 사이트에서 관리자로 로그인하고 `+ 일정 추가` → 사진 선택 → **분석하기**를 눌러 확인합니다.

분석할 때 `Invalid JWT` 오류가 나면 함수 설정의 **Verify JWT with legacy secret**(또는 **Enforce JWT Verification**)을 끄세요. 함수 안에서 로그인 토큰으로 관리자 여부를 직접 확인하므로 꺼도 안전합니다.

함수는 관리자(`admins`에 등록된 계정)만 호출할 수 있고, DB에는 직접 쓰지 않습니다. 분석 결과는 화면에서 확인한 뒤에 저장됩니다. 함수 설정이 안 됐거나 분석이 실패하면 **직접 입력하기**로 기존 입력 창을 쓸 수 있습니다.

---

## 🚀 GitHub Pages 정적 배포 방법

이 프로젝트는 백엔드 서버 없이 동작하는 순수 HTML/CSS/JS 웹앱입니다.

1. 이 저장소(Repository)를 GitHub에 푸시합니다.
2. GitHub 저장소 페이지의 **Settings -> Pages** 메뉴로 이동합니다.
3. **Source**를 `Deploy from a branch`로 선택하고, **Branch**를 `main` (또는 `master`) / `/ (root)`로 설정한 뒤 **Save**를 클릭합니다.
4. 몇 분 후 제공되는 배포 URL(예: `https://username.github.io/school-planner/`)로 친구들이 접속할 수 있습니다.

> **참고**: `server.js` 및 `start-school-planner.cmd` 파일은 로컬 컴퓨터에서 서버를 띄울 때 사용하는 파일이며, GitHub Pages 웹 배포 시에는 사용되지 않습니다.
