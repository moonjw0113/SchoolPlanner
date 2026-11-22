#!/usr/bin/env python3
"""사진과 일정 목록을 학교 플래너 DB(assessments)에 저장한다.

Claude Code 채팅에서 사진 속 일정을 넣을 때 쓴다. 사용법은
.claude/skills/add-schedule-from-photo/SKILL.md 를 본다.

    python3 scripts/add_schedules.py items.json --image a.jpg --image b.png
    python3 scripts/add_schedules.py items.json --dry-run      # 검사와 중복 확인만
    python3 scripts/add_schedules.py --check                   # 연결·권한 확인만
    python3 scripts/add_schedules.py events.json --school-events   # 학사일정 저장

학사일정 events.json 형식 (배열, end_date는 하루짜리면 생략 가능):
    [{"title": "겨울방학", "kind": "방학", "start_date": "2026-12-31", "end_date": "2027-02-28", "note": ""}]
    kind: 공휴일, 휴업일, 방학(수업 없는 날) / 행사, 시험기간(수업 있는 날)

items.json 형식 (배열):
    [{"title": "통합사회 발표", "date": "2026-11-25", "type": "수행평가",
      "period": "2", "subject": "통합사회", "description": "5분 발표"}]

인증: Supabase 비밀 키(sb_secret_...)를 apikey 헤더로 보낸다. 키는 Claude Code 환경의
네트워크 비밀 값으로 저장돼 있어서 프록시가 요청에 넣어 준다. 그래서 이 스크립트는
자리표시 값만 보내고, 키 원문은 코드·채팅·환경 변수 어디에도 두지 않는다.
(환경 변수 SUPABASE_SECRET_KEY가 있으면 그 값을 쓴다. 로컬 컴퓨터에서 쓸 때용.)
"""
import argparse
import base64
import datetime as dt
import io
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SUPABASE_URL = os.environ.get("PLANNER_SUPABASE_URL", "https://gzbnybhmxetxrsjwbgdq.supabase.co")
API_KEY = os.environ.get("SUPABASE_SECRET_KEY") or "sb_secret_placeholder_injected_by_proxy"
TYPES = ("수행평가", "과제", "시험", "기타")
MAX_IMAGE_BYTES = 1_400_000  # 사이트의 사진 첨부 한도(1.5MB)보다 조금 작게
KST = dt.timezone(dt.timedelta(hours=9))


def request(method, path, body=None, prefer=None):
    headers = {"apikey": API_KEY, "content-type": "application/json"}
    if prefer:
        headers["prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            text = res.read().decode()
            return json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        if e.code in (401, 403):
            sys.exit(f"인증 실패 ({e.code}): Supabase 비밀 키가 이 환경에 저장돼 있는지 확인하세요.\n{detail}")
        sys.exit(f"Supabase 오류 ({e.code}): {detail}")
    except urllib.error.URLError as e:
        sys.exit(f"Supabase에 접속하지 못했습니다: {e.reason}\n이 환경의 네트워크에서 {SUPABASE_URL} 가 허용돼 있는지 확인하세요.")


def valid_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        return dt.date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def clean_item(raw, n):
    label = f"{n}번째 일정"
    title = str(raw.get("title", "")).strip()
    date = str(raw.get("date", "")).strip()
    kind = str(raw.get("type") or "과제").strip()
    period = str(raw.get("period") or "").strip()
    subject = str(raw.get("subject") or "").strip() or "기타"
    description = str(raw.get("description") or "").strip()
    errors = []
    if not 1 <= len(title) <= 80:
        errors.append("제목은 1~80자")
    if not valid_date(date):
        errors.append(f"날짜는 YYYY-MM-DD 실제 날짜 (받은 값: {date!r})")
    if kind not in TYPES:
        errors.append(f"구분은 {', '.join(TYPES)} 중 하나 (받은 값: {kind!r})")
    if not re.fullmatch(r"[1-7]?", period):
        errors.append(f"교시는 '1'~'7' 또는 빈 값 (받은 값: {period!r})")
    if len(subject) > 40:
        errors.append("과목은 40자 이하")
    if len(description) > 500:
        errors.append("메모는 500자 이하")
    if errors:
        raise ValueError(f"{label}: " + ", ".join(errors))
    return {"title": title, "date": date, "type": kind, "period": period, "subject": subject, "description": description}


EVENT_KINDS = ("공휴일", "휴업일", "방학", "행사", "시험기간")


def clean_event(raw, n):
    label = f"{n}번째 학사일정"
    title = str(raw.get("title", "")).strip()
    kind = str(raw.get("kind", "")).strip()
    start = str(raw.get("start_date", "")).strip()
    end = str(raw.get("end_date") or start).strip()
    note = str(raw.get("note") or "").strip()
    errors = []
    if not 1 <= len(title) <= 60:
        errors.append("이름은 1~60자")
    if kind not in EVENT_KINDS:
        errors.append(f"종류는 {', '.join(EVENT_KINDS)} 중 하나 (받은 값: {kind!r})")
    if not valid_date(start) or not valid_date(end):
        errors.append(f"날짜는 YYYY-MM-DD 실제 날짜 (받은 값: {start!r} ~ {end!r})")
    elif end < start or (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days > 120:
        errors.append("끝나는 날은 시작일과 같거나 뒤, 기간은 120일 이하")
    if len(note) > 300:
        errors.append("메모는 300자 이하")
    if errors:
        raise ValueError(f"{label}: " + ", ".join(errors))
    return {"title": title, "kind": kind, "start_date": start, "end_date": end, "note": note}


def add_school_events(path, dry_run):
    with open(path, encoding="utf-8") as f:
        raw_events = json.load(f)
    if not isinstance(raw_events, list) or not raw_events:
        sys.exit("학사일정 JSON은 하나 이상 든 배열이어야 합니다.")
    try:
        events = [clean_event(raw, n) for n, raw in enumerate(raw_events, 1)]
    except ValueError as e:
        sys.exit(f"형식 오류로 아무것도 저장하지 않았습니다: {e}")
    existing = request("GET", "school_events?select=id,title,start_date")
    seen = {(r["start_date"], r["title"].strip().lower()) for r in existing}
    to_add = [e for e in events if (e["start_date"], e["title"].lower()) not in seen]
    for e in events:
        mark = "저장 예정" if e in to_add else "건너뜀(이미 있음)"
        span = e["start_date"] if e["start_date"] == e["end_date"] else f"{e['start_date']} ~ {e['end_date']}"
        print(f"{mark}: {span} [{e['kind']}] {e['title']}")
    if dry_run or not to_add:
        print(f"{'dry-run: ' if dry_run else ''}새 학사일정 {len(to_add)}개, 건너뜀 {len(events) - len(to_add)}개. 저장하지 않았습니다.")
        return
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    request("POST", "school_events", [{**e, "updated_at": now} for e in to_add], prefer="return=minimal")
    after = request("GET", "school_events?select=title,start_date")
    saved = {(r["start_date"], r["title"].strip().lower()) for r in after}
    missing = [e["title"] for e in to_add if (e["start_date"], e["title"].lower()) not in saved]
    if missing:
        sys.exit("저장 후 확인에서 찾지 못한 학사일정: " + ", ".join(missing))
    print(f"완료: 새 학사일정 {len(to_add)}개, 건너뜀 {len(events) - len(to_add)}개. 다시 읽어서 확인했습니다.")


def build_image(paths):
    """사진 여러 장을 세로로 이어 붙여 JPEG 하나로 만들고 data URL로 돌려준다."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        sys.exit("Pillow가 필요합니다: pip install pillow")
    images = []
    for path in paths:
        img = ImageOps.exif_transpose(Image.open(path))
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            bg = Image.new("RGB", img.size, "white")
            bg.paste(img, mask=img.split()[-1])
            img = bg
        images.append(img.convert("RGB"))
    for max_width, quality in ((1400, 82), (1200, 75), (1000, 70), (800, 65), (700, 55)):
        scaled = []
        for img in images:
            ratio = min(1.0, max_width / img.width)
            scaled.append(img.resize((round(img.width * ratio), round(img.height * ratio))) if ratio < 1 else img)
        width = max(i.width for i in scaled)
        gap = 16 if len(scaled) > 1 else 0
        canvas = Image.new("RGB", (width, sum(i.height for i in scaled) + gap * (len(scaled) - 1)), "white")
        y = 0
        for img in scaled:
            canvas.paste(img, ((width - img.width) // 2, y))
            y += img.height + gap
        buf = io.BytesIO()
        canvas.save(buf, "JPEG", quality=quality, optimize=True)
        data_url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
        if len(data_url) <= MAX_IMAGE_BYTES:
            return data_url, canvas.size
    sys.exit("사진이 너무 커서 1.4MB 아래로 줄이지 못했습니다. 사진 수를 줄여 주세요.")


def new_id():
    return f"{int(time.time() * 1000)}-{secrets.token_hex(6)}"


def main():
    parser = argparse.ArgumentParser(description="학교 플래너에 일정 저장")
    parser.add_argument("items", nargs="?", help="일정 목록 JSON 파일")
    parser.add_argument("--image", action="append", default=[], help="첨부할 사진 (여러 번 쓰면 세로로 이어 붙임)")
    parser.add_argument("--dry-run", action="store_true", help="저장하지 않고 검사와 중복 확인만")
    parser.add_argument("--check", action="store_true", help="연결과 비밀 키 권한만 확인")
    parser.add_argument("--school-events", action="store_true", help="items 파일을 학사일정(school_events)으로 저장")
    args = parser.parse_args()

    if args.school_events:
        if not args.items:
            parser.error("학사일정 JSON 파일이 필요합니다")
        add_school_events(args.items, args.dry_run)
        return

    if args.check:
        # admins는 RLS로 막혀 있어 공개 키로는 0줄, 비밀 키로는 관리자 수만큼 보인다.
        admins = request("GET", "admins?select=user_id")
        if not admins:
            sys.exit("연결은 됐지만 비밀 키 권한이 아닙니다(공개 키로 접속됨). 환경의 네트워크 비밀 값을 확인하세요.")
        today = dt.datetime.now(KST).date().isoformat()
        upcoming = request("GET", f"assessments?select=id&date=gte.{today}")
        print(f"연결 확인: 비밀 키 권한 OK, 앞으로 남은 일정 {len(upcoming)}개")
        return

    if not args.items:
        parser.error("items JSON 파일이 필요합니다")
    with open(args.items, encoding="utf-8") as f:
        raw_items = json.load(f)
    if not isinstance(raw_items, list) or not raw_items:
        sys.exit("items.json은 일정이 하나 이상 든 배열이어야 합니다.")
    try:
        items = [clean_item(raw, n) for n, raw in enumerate(raw_items, 1)]
    except ValueError as e:
        sys.exit(f"형식 오류로 아무것도 저장하지 않았습니다: {e}")

    image, size = ("", None)
    if args.image:
        image, size = build_image(args.image)
        print(f"사진 {len(args.image)}장 → JPEG {size[0]}x{size[1]}, {len(image) / 1024:.0f}KB")

    to_add, skipped = [], []
    for item in items:
        same_day = request("GET", f"assessments?select=id,title&date=eq.{item['date']}")
        dup = next((r for r in same_day if r["title"].strip().lower() == item["title"].lower()), None)
        (skipped if dup else to_add).append({**item, "dup_id": dup["id"] if dup else None})

    for s in skipped:
        print(f"건너뜀(이미 있음): {s['date']} {s['title']} (id {s['dup_id']})")
    if args.dry_run:
        for item in to_add:
            print(f"저장 예정: {item['date']} {item['period'] or '-'}교시 [{item['type']}] {item['subject']} · {item['title']}")
        print(f"dry-run: 새 일정 {len(to_add)}개, 건너뜀 {len(skipped)}개. 저장하지 않았습니다.")
        return
    if not to_add:
        print("새로 저장할 일정이 없습니다.")
        return

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    rows = [{
        "id": new_id(), "title": i["title"], "type": i["type"], "date": i["date"], "period": i["period"],
        "subject": i["subject"], "description": i["description"], "image": image, "completed": False,
        "updated_at": now,
    } for i in to_add]
    request("POST", "assessments", rows, prefer="return=minimal")

    # 다시 읽어서 확인
    ids = urllib.parse.quote(",".join(f'"{r["id"]}"' for r in rows))
    saved = request("GET", f"assessments?select=id,title,type,date,period,subject,description,image&id=in.({ids})")
    by_id = {r["id"]: r for r in saved}
    problems = []
    for r in rows:
        got = by_id.get(r["id"])
        if not got:
            problems.append(f"{r['title']}: 저장된 행을 찾지 못함")
            continue
        for key in ("title", "type", "date", "period", "subject", "description", "image"):
            if (got.get(key) or "") != r[key]:
                problems.append(f"{r['title']}: {key} 값이 다름")
    for r in rows:
        print(f"저장: {r['date']} {r['period'] or '-'}교시 [{r['type']}] {r['subject']} · {r['title']} (id {r['id']})")
    if problems:
        sys.exit("저장 후 확인에서 문제가 있습니다:\n- " + "\n- ".join(problems))
    print(f"완료: 새 일정 {len(rows)}개{' (사진 첨부)' if image else ''}, 건너뜀 {len(skipped)}개. 다시 읽어서 모두 일치함을 확인했습니다.")


if __name__ == "__main__":
    main()
