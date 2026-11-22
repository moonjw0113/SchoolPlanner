-- =====================================================================
-- 학교 플래너 자체 Claude 커넥터(planner-mcp) 정리
--  * Supabase 공식 커넥터를 쓰기로 해서, 예전 claude-connector.sql이 만든 표와 함수를 지운다.
--  * 일정·시간표 데이터는 건드리지 않는다. 여러 번 실행해도 안전하다.
-- =====================================================================
drop function if exists public.connector_call(text, text, jsonb);
drop function if exists public.connector_clean_item(jsonb, text);
drop function if exists public.connector_valid_date(text);
drop function if exists public.connector_status();
drop function if exists public.revoke_connector_token();
drop function if exists public.set_connector_token(text);
drop function if exists public.connector_token_hash(text);
drop table if exists public.connector_tokens;
