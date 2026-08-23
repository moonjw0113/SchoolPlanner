# 학교 플래너 (수행평가 · 과제 관리)

종촌고등학교 1학년 7반의 2학기 시간표를 기반으로 수행평가와 과제를 달력 및 시간표 뷰에서 통합 관리하는 웹앱입니다.
**Supabase 데이터베이스 연동** 및 **등록 비밀번호 기반 권한 제어**가 포함되어 있습니다.

---

## 🌟 주요 기능

1. **권한 구분 (일반 사용자 vs 등록 권한 사용자)**
   - **일반 사용자 (기본)**: 사이트 접속, 수행평가/과제 날짜별 정리 조회, 사진 및 메모 확인 (등록/수정/삭제 제한)
   - **등록 권한 사용자**: 상단 `🔑 등록 권한` 버튼 클릭 후 비밀번호 입력 시 일정 추가·수정·삭제 가능 (로그인 상태는 새로고침 후에도 유지)
2. **Supabase 연동**: 등록한 일정을 온라인 데이터베이스에 안전하게 보관 (모든 접속자가 공유)
3. **사진 첨부 지원**: 1.5MB 이하 사진 첨부 및 DataURL 기반 저장/미리보기
4. **자동 과목 입력**: 종촌고 1-7 시간표 기반으로 교시 선택 시 과목 및 담당 교사 자동 연결
5. **2026 공휴일 및 달력 뷰**: 대한민국 공휴일 자동 표시 및 일별/월별 할 일 보기

---

## 🛠️ Supabase 데이터베이스 연결 방법

1. [Supabase](https://supabase.com)에 로그인 후 새 프로젝트를 생성합니다.
2. **SQL Editor**로 이동하여 아래 SQL 문을 복사하여 실행합니다. (테이블 생성, RLS 권한 설정 및 Realtime 활성화)

```sql
-- 1. 수행평가 및 과제 테이블
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

-- 2. 시간표 테이블 (정규 요일/교시 시간표)
create table if not exists timetable (
  id text primary key,
  period integer not null,
  day_of_week integer not null,
  subject text default '',
  teacher text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. 과목별 기본 장소 테이블
create table if not exists subject_locations (
  subject text primary key,
  default_location text default '',
  updated_at timestamptz default now()
);

-- 4. 특정 날짜 장소 변경 테이블
create table if not exists timetable_location_overrides (
  id text primary key,
  date text not null,
  period integer not null,
  location text default '',
  updated_at timestamptz default now()
);

-- Row Level Security (RLS) 활성화
alter table assessments enable row level security;
alter table timetable enable row level security;
alter table subject_locations enable row level security;
alter table timetable_location_overrides enable row level security;

-- 조회/수정 정책 설정 (클라이언트 비밀번호 7777 권한 제어와 연동)
create policy "Allow all access to assessments" on assessments for all using (true) with check (true);
create policy "Allow all access to timetable" on timetable for all using (true) with check (true);
create policy "Allow all access to subject_locations" on subject_locations for all using (true) with check (true);
create policy "Allow all access to timetable_location_overrides" on timetable_location_overrides for all using (true) with check (true);

-- ⚡ Supabase Realtime (Postgres Changes) 활성화
alter publication supabase_realtime add table assessments;
alter publication supabase_realtime add table timetable;
alter publication supabase_realtime add table subject_locations;
alter publication supabase_realtime add table timetable_location_overrides;
```

> **참고 (Realtime 대시보드 설정)**:
> SQL 구문 실행 외에도 Supabase 대시보드의 **Database -> Publications -> `supabase_realtime`** 메뉴에서 해당 테이블들의 INSERT, UPDATE, DELETE 토글을 직접 활성화하실 수도 있습니다.

3. Supabase 프로젝트의 **Project Settings -> API**에서 `Project URL`과 `anon public key`를 복사합니다.
4. [`app.js`](file:///c:/Users/MoonJunWoo/Desktop/school-planner/app.js) 상단의 변수를 수정합니다:

```javascript
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';
```

---

## 🔑 등록 비밀번호 변경 방법

[`app.js`](file:///c:/Users/MoonJunWoo/Desktop/school-planner/app.js) 파일 상단의 `ADMIN_PASSWORD` 상수를 원하는 비밀번호로 변경할 수 있습니다 (기본값: `7777`).

```javascript
const ADMIN_PASSWORD = '7777'; // 원하는 비밀번호로 수정
```

---

## 🚀 GitHub Pages 정적 배포 방법

이 프로젝트는 백엔드 서버 없이 동작하는 순수 HTML/CSS/JS 웹앱입니다.

1. 이 저장소(Repository)를 GitHub에 푸시합니다.
2. GitHub 저장소 페이지의 **Settings -> Pages** 메뉴로 이동합니다.
3. **Source**를 `Deploy from a branch`로 선택하고, **Branch**를 `main` (또는 `master`) / `/ (root)`로 설정한 뒤 **Save**를 클릭합니다.
4. 몇 분 후 제공되는 배포 URL(예: `https://username.github.io/school-planner/`)로 친구들이 접속할 수 있습니다.

> **참고**: `server.js` 및 `start-school-planner.cmd` 파일은 로컬 컴퓨터에서 서버를 띄울 때 사용하는 파일이며, GitHub Pages 웹 배포 시에는 사용되지 않습니다.
