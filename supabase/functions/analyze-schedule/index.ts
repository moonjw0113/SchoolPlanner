// Supabase Edge Function: 사진 속 수행평가·과제 공지를 Claude로 분석해 일정 후보를 돌려준다.
// - 관리자(admins 테이블에 등록된 사용자)만 호출할 수 있다.
// - DB에는 쓰지 않는다. 관리자가 화면에서 확인·수정한 뒤 app.js가 저장한다.
// - 필요한 비밀 값: ANTHROPIC_API_KEY (대시보드 Edge Functions → Secrets)
import Anthropic from "npm:@anthropic-ai/sdk@1.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const MODEL = "claude-opus-5-5";
const MAX_IMAGE_BASE64 = 5 * 1024 * 1024; // Claude 이미지 한 장 한도 (base64 기준)
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

// Claude가 돌려줄 형식. 확실하지 않은 값은 null로 두고 questions에 사람에게 물어볼 내용을 적게 한다.
const RESULT_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "일정 제목 (짧게, 예: '통합사회 발표 자료 제출')" },
          type: { type: "string", enum: ["수행평가", "과제", "시험", "기타"] },
          date: { type: ["string", "null"], description: "YYYY-MM-DD. 사진만으로 정할 수 없으면 null" },
          period: { type: ["integer", "null"], description: "1~7교시. 알 수 없으면 null" },
          subject: { type: ["string", "null"], description: "과목명. 가능하면 제공된 과목 목록의 이름" },
          description: { type: "string", description: "준비물, 범위, 제출 방법 등 메모. 없으면 빈 문자열" },
          questions: {
            type: "array",
            items: { type: "string" },
            description: "확실하지 않아 사용자에게 확인할 내용. 확실하면 빈 배열",
          },
        },
        required: ["title", "type", "date", "period", "subject", "description", "questions"],
        additionalProperties: false,
      },
    },
    notes: { type: "string", description: "사진 전체에 대한 참고 사항 (읽을 수 없는 부분 등). 없으면 빈 문자열" },
  },
  required: ["items", "notes"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `너는 한국 고등학교 학급 플래너의 일정 입력 도우미다.
사용자가 올린 사진(알림장, 칠판, 공지문, 메신저 캡처, 수행평가 안내문 등)에서 수행평가·과제·시험 일정을 찾아 정리한다.

규칙:
- 사진에 실제로 적힌 내용만 쓴다. 추측으로 일정을 만들지 않는다.
- 날짜는 YYYY-MM-DD로 쓴다. 연도가 없으면 기준 날짜와 가장 가까운 미래로 본다. "다음 주 화요일", "내일" 같은 상대 날짜는 기준 날짜로 계산한다.
- 시간표가 주어지면 과목과 요일을 맞춰 교시를 정할 수 있다. 맞는 교시가 여러 개거나 없으면 period는 null로 두고 questions에 적는다.
- 글씨가 흐리거나, 날짜·과목·내용이 모호하거나, 계산한 날짜가 시간표와 맞지 않는 등 조금이라도 확실하지 않으면 questions에 사용자가 바로 답할 수 있는 짧은 질문으로 적는다. (예: "날짜가 11월 25일로 보이는데 맞나요?")
- 사진에 일정이 없으면 items를 빈 배열로 두고 notes에 이유를 적는다.
- 모든 문장은 한국어로 쓴다.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST만 지원합니다." });

  // 1. 관리자 확인: 요청한 사람의 로그인 토큰으로 is_admin()을 호출한다.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { error: "로그인이 필요합니다." });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError) {
    console.error("is_admin 확인 실패:", adminError);
    return json(500, { error: "권한을 확인하지 못했습니다." });
  }
  if (isAdmin !== true) return json(403, { error: "등록 권한이 없습니다." });

  // 2. 입력 확인
  let body: { image?: unknown; today?: unknown; hintDate?: unknown; hintPeriod?: unknown; timetable?: unknown; subjects?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "잘못된 요청입니다." });
  }
  const match = typeof body.image === "string"
    ? body.image.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/)
    : null;
  if (!match) return json(400, { error: "JPG, PNG, GIF, WEBP 사진만 분석할 수 있습니다." });
  const mediaType = match[1] as MediaType;
  const imageData = match[2];
  if (imageData.length > MAX_IMAGE_BASE64) return json(413, { error: "사진이 너무 큽니다." });
  const today = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today)
    ? body.today
    : new Date().toISOString().slice(0, 10);
  const hintDate = typeof body.hintDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.hintDate) ? body.hintDate : "";
  const hintPeriod = typeof body.hintPeriod === "string" && /^[1-7]$/.test(body.hintPeriod) ? body.hintPeriod : "";
  const timetable = typeof body.timetable === "string" ? body.timetable.slice(0, 4000) : "";
  const subjects = Array.isArray(body.subjects)
    ? body.subjects.filter((s): s is string => typeof s === "string").slice(0, 50)
    : [];

  const context = [
    `기준 날짜(오늘): ${today}`,
    hintDate
      ? `사용자가 달력에서 고른 날짜: ${hintDate}${hintPeriod ? ` ${hintPeriod}교시` : ""} (사진에 날짜가 없으면 이 날짜로 본다)`
      : "",
    subjects.length ? `과목 목록: ${subjects.join(", ")}` : "",
    timetable ? `기본 시간표 (교시: 월/화/수/목/금):\n${timetable}` : "",
    "위 정보를 참고해 사진 속 일정을 정리해 줘.",
  ].filter(Boolean).join("\n\n");

  // 3. Claude 호출
  const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  try {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: RESULT_SCHEMA },
      },
      // 안전 분류기가 거절하면 서버가 다른 모델로 다시 시도한다.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageData } },
          { type: "text", text: context },
        ],
      }],
    });

    if (response.stop_reason === "refusal") {
      return json(422, { error: "이 사진은 분석할 수 없습니다. 직접 입력해 주세요." });
    }
    if (response.stop_reason === "max_tokens") {
      return json(422, { error: "사진 내용이 너무 많습니다. 사진을 나눠서 올려 주세요." });
    }
    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") return json(502, { error: "분석 결과가 비어 있습니다." });
    const result = JSON.parse(text.text);
    return json(200, result);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return json(429, { error: "요청이 많습니다. 잠시 후 다시 시도해 주세요." });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("Anthropic API 키 오류:", err.message);
      return json(500, { error: "AI 설정(API 키)에 문제가 있습니다." });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic API 오류:", err.status, err.message);
      return json(502, { error: "AI 분석 중 오류가 났습니다. 잠시 후 다시 시도해 주세요." });
    }
    console.error("분석 실패:", err);
    return json(500, { error: "분석 중 오류가 났습니다." });
  }
});
