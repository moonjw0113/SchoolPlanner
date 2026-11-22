# 학교 플래너 (SchoolPlanner)

종촌고 1학년 7반 수행평가·과제를 달력/시간표로 관리하는 웹앱. 바닐라 JS(`app.js`, `index.html`, `style.css`, `style-overrides.css`) + 로컬용 정적 파일 서버(`server.js`), Supabase 연동, GitHub Pages로 `main`이 배포된다.

## 실행
- `node server.js` (Node 18 이상, 기본 포트 3000). Windows에서는 `start-school-planner.cmd`.
- 빌드 단계와 패키지 설치는 없다.

## 검증
- 푸시 전에 문법 검사를 통과시킨다: `node --check app.js && node --check server.js`
- 테스트가 없으므로 UI를 바꿨다면 커밋 메시지나 답변에 확인 방법(어디를 눌러 보면 되는지)을 적는다.

## Git 규칙
- 작업을 시작하기 전에 `git pull --ff-only`로 원격의 최신 변경을 받는다. 로컬에 커밋하지 않은 변경이나 충돌로 실패하면 임의로 덮어쓰지 말고 사용자에게 알린다. (여러 컴퓨터에서 같은 레포를 수정하므로 필수)
- `main`에 직접 push하지 않는다. `claude/<작업-요약>` 브랜치에서 커밋하고 그 브랜치로 push한다.
- push 후 `main` 대상 PR을 열고, 검증을 통과했으면 사용자에게 따로 묻지 않고 바로 squash 머지한다. (`main`이 곧 배포다.)
- Supabase에서 SQL 실행이나 함수 배포처럼 사용자가 먼저 해야 사이트가 깨지지 않는 작업이 있으면, 머지 전에 그 순서를 안내하고 사용자가 끝냈다고 한 뒤 머지한다.
- 커밋 메시지는 Conventional Commits 형식(`feat:`, `fix:`, `docs:`, `refactor:` 등)으로 쓴다.
- 커밋은 작은 단위로 나눈다.
- 문제가 생기면 `git revert`로 되돌린다. 강제 push(`--force`)는 하지 않는다.

## 사진으로 일정 넣기
- 사용자가 사진을 첨부하고 일정을 넣어 달라고 하면 `.claude/skills/add-schedule-from-photo/SKILL.md` 순서를 따른다. DB에만 쓰는 작업이라 브랜치·PR이 필요 없다.

## 주의
- `app.js`의 Supabase 키는 공개용 publishable 키다. 그 외 비밀 값(서비스 롤 키, 비밀번호 등)은 절대 커밋하지 않는다.
- `data/assessments.json`은 예전 로컬 서버 API가 쓰던 파일로, 지금은 쓰이지 않는다. `server.js`는 `PUBLIC_FILES`에 적힌 파일만 내려주는 정적 서버다.
