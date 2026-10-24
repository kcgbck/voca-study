-- scripts/conversation/budget-schema.sql
-- AI 회화 독립 예산 전용 D1 스키마 (CONVERSATION_BUDGET_DB)
-- [개인정보 및 보안 원칙]
-- 1. 사용자 발화, 음성 데이터, 수업 ID, 점수, JWT 원문, API Key 저장을 절대 금지한다.
-- 2. 비식별화된 해시값(SHA-256)과 정수형 카운터/타임스탬프만 보관한다.
-- 3. 로컬 격리 시험 및 배포용 원본 DDL이며 기존 앱 DB(DB)와 무관한 독립 바인딩용이다.

CREATE TABLE IF NOT EXISTS conversation_budget_reservations (
  request_hash TEXT PRIMARY KEY,
  caller_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  created_ms INTEGER NOT NULL CHECK(created_ms >= 0),
  day_key TEXT NOT NULL,
  units INTEGER NOT NULL CHECK(units > 0),
  state TEXT NOT NULL CHECK(state IN ('reserved', 'consumed', 'released'))
);

CREATE INDEX IF NOT EXISTS idx_budget_model_window
  ON conversation_budget_reservations (model, state, created_ms);

CREATE INDEX IF NOT EXISTS idx_budget_model_day
  ON conversation_budget_reservations (model, state, day_key);

CREATE INDEX IF NOT EXISTS idx_budget_caller_window
  ON conversation_budget_reservations (caller_hash, state, created_ms);
