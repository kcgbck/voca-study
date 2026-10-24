// src/features/conversation/server/budgetAdapter.ts
// Cloudflare D1 기반 원자적 요청 예산 및 동시성 제어 어댑터
// [보안 및 원자성 원칙]
// 1. 단일 INSERT ... SELECT ... WHERE 쿼리로 중복 PK 및 한도 조건을 동시에 원자적 검사.
// 2. isolate Map/KV 금지 (글로벌 원자성 보장 불가).
// 3. 사용자 발화, 음성 데이터, 수업 ID, 점수, 키 저장 절대 금지 (비식별화된 가명 해시 및 카운터 전용).
// 4. 모델별 RPM, TPM, Pacific Time(America/Los_Angeles) RPD, callerRpm 4개 조건 동시 만족 시에만 예약 허용.
// 5. upstream 시도 후 consume은 멱등하며 환불 불가(release 불허). 오류를 무작정 삼키지 않고 안전 실패 전파.

import type { ServerBudgetAdapter } from './types';
import { isAllowedModel } from './geminiInteractionsClient';

export interface D1RunResult {
  success?: boolean;
  meta?: {
    changes?: number;
  };
  error?: unknown;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1RunResult>;
  first?<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface D1BudgetAdapterOptions {
  db: D1Database;
  model: string;
  rpm: number; // 분당 호출 한도 (양의 정수)
  tpm: number; // 분당 토큰/유닛 한도 (양의 정수)
  rpd: number; // 태평양 표준시 일일 호출 한도 (양의 정수)
  callerRpm: number; // 발신자별 분당 호출 한도 (양의 정수)
  clockNow?: () => number;
}

/**
 * 미국 태평양 표준시(America/Los_Angeles) 기준 YYYY-MM-DD 날짜 문자열
 * Google AI Quota(RPD)는 태평양 시간 자정 기준으로 리셋되므로 일반 KST와 엄격히 구별
 */
export function toPacificDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${year}-${month}-${day}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class D1ServerBudgetAdapter implements ServerBudgetAdapter {
  private readonly db: D1Database;
  private readonly model: string;
  private readonly rpm: number;
  private readonly tpm: number;
  private readonly rpd: number;
  private readonly callerRpm: number;
  private readonly clockNow: () => number;
  private readonly isConfigValid: boolean;

  constructor(options: D1BudgetAdapterOptions) {
    this.db = options.db;
    this.clockNow = options.clockNow || (() => Date.now());

    const isPositiveSafeInt = (n: unknown): n is number =>
      typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

    // model은 임의의 string이 아닌 GEMINI_MODELS 3종 allowlist에 한정되어야 함
    const isValidModel =
      typeof options.model === 'string' &&
      isAllowedModel(options.model.trim());

    if (
      !options.db ||
      !isValidModel ||
      !isPositiveSafeInt(options.rpm) ||
      !isPositiveSafeInt(options.tpm) ||
      !isPositiveSafeInt(options.rpd) ||
      !isPositiveSafeInt(options.callerRpm)
    ) {
      this.model = '';
      this.rpm = 0;
      this.tpm = 0;
      this.rpd = 0;
      this.callerRpm = 0;
      this.isConfigValid = false;
    } else {
      this.model = options.model.trim();
      this.rpm = options.rpm;
      this.tpm = options.tpm;
      this.rpd = options.rpd;
      this.callerRpm = options.callerRpm;
      this.isConfigValid = true;
    }
  }

  /**
   * 단일 INSERT ... SELECT ... WHERE 문을 통한 원자적 예산 예약
   * 1. 모델 rolling 60s RPM
   * 2. 모델 rolling 60s TPM (기존 예약 + 신규 estimatedUnits)
   * 3. 모델 Pacific Day RPD
   * 4. 발신자 및 모델별 rolling 60s RPM (caller_hash 및 model 격리)
   * 5. request_hash PK 충돌 방지
   */
  public async reserve(
    requestId: string,
    estimatedUnits: number
  ): Promise<{
    allowed: boolean;
    remaining?: number;
    reason?: string;
  }> {
    if (!this.isConfigValid) {
      return { allowed: false, reason: 'INVALID_OR_MISSING_BUDGET_CONFIG' };
    }

    if (
      !requestId ||
      typeof requestId !== 'string' ||
      requestId.length > 512 ||
      !Number.isSafeInteger(estimatedUnits) ||
      estimatedUnits <= 0
    ) {
      return { allowed: false, reason: 'INVALID_RESERVATION_PARAMS' };
    }

    // requestId는 반드시 caller:opaqueId 형태여야 하며 양쪽 모두 공백이 아닌 유효 문자열이어야 함
    const colonIdx = requestId.indexOf(':');
    if (colonIdx <= 0 || colonIdx >= requestId.length - 1) {
      return { allowed: false, reason: 'INVALID_RESERVATION_PARAMS' };
    }
    const callerPart = requestId.slice(0, colonIdx).trim();
    const opaquePart = requestId.slice(colonIdx + 1).trim();
    if (callerPart.length === 0 || opaquePart.length === 0) {
      return { allowed: false, reason: 'INVALID_RESERVATION_PARAMS' };
    }

    const nowMs = this.clockNow();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      return { allowed: false, reason: 'INVALID_CLOCK' };
    }

    try {
      const requestHash = await sha256Hex(requestId);
      const callerHash = await sha256Hex(callerPart);
      const dayKey = toPacificDateString(new Date(nowMs));
      const windowStartMs = nowMs - 60000;

      const query = `
        INSERT INTO conversation_budget_reservations (
          request_hash, caller_hash, model, created_ms, day_key, units, state
        )
        SELECT
          ?, ?, ?, ?, ?, ?, 'reserved'
        WHERE
          (SELECT COUNT(*) FROM conversation_budget_reservations
           WHERE model = ? AND state != 'released' AND created_ms > ?) < ?
          AND (SELECT COALESCE(SUM(units), 0) FROM conversation_budget_reservations
           WHERE model = ? AND state != 'released' AND created_ms > ?) + ? <= ?
          AND (SELECT COUNT(*) FROM conversation_budget_reservations
           WHERE model = ? AND state != 'released' AND day_key = ?) < ?
          AND (SELECT COUNT(*) FROM conversation_budget_reservations
           WHERE caller_hash = ? AND model = ? AND state != 'released' AND created_ms > ?) < ?;
      `;

      const stmt = this.db.prepare(query);
      const result = await stmt
        .bind(
          requestHash,
          callerHash,
          this.model,
          nowMs,
          dayKey,
          estimatedUnits,
          this.model,
          windowStartMs,
          this.rpm,
          this.model,
          windowStartMs,
          estimatedUnits,
          this.tpm,
          this.model,
          dayKey,
          this.rpd,
          callerHash,
          this.model,
          windowStartMs,
          this.callerRpm
        )
        .run();

      // meta.changes가 1이더라도 success가 false이거나 meta가 유실된 경우 failclosed
      if (result.success === true && result.meta?.changes === 1) {
        return { allowed: true };
      }

      return {
        allowed: false,
        reason: 'BUDGET_LIMIT_EXCEEDED_OR_DUPLICATE_REQUEST',
      };
    } catch {
      // DB 예외 또는 PK 충돌 발생 시 안전하게 거절 (Fail-Closed)
      return {
        allowed: false,
        reason: 'DATABASE_RESERVATION_FAILED',
      };
    }
  }

  /**
   * upstream 시도 후 예산 소진 확정 (중복 멱등, units 축소 금지)
   */
  public async consume(requestId: string, actualUnits: number): Promise<void> {
    if (!requestId || typeof requestId !== 'string') return;
    const safeUnits = Number.isSafeInteger(actualUnits) && actualUnits > 0 ? actualUnits : 1;

    const requestHash = await sha256Hex(requestId);
    const query = `
      UPDATE conversation_budget_reservations
      SET state = 'consumed', units = MAX(units, ?)
      WHERE request_hash = ? AND state = 'reserved';
    `;
    const res = await this.db.prepare(query).bind(safeUnits, requestHash).run();
    if (res.success === false) {
      throw new Error('D1_BUDGET_CONSUME_FAILED');
    }
  }

  /**
   * upstream 시도 전 중단 시에만 예약 해제 (consumed 상태는 절대 환불 불가)
   */
  public async release(requestId: string): Promise<void> {
    if (!requestId || typeof requestId !== 'string') return;

    const requestHash = await sha256Hex(requestId);
    const query = `
      UPDATE conversation_budget_reservations
      SET state = 'released'
      WHERE request_hash = ? AND state = 'reserved';
    `;
    const res = await this.db.prepare(query).bind(requestHash).run();
    if (res.success === false) {
      throw new Error('D1_BUDGET_RELEASE_FAILED');
    }
  }

  /**
   * 예산 예약 실패 시 재시도 가능 여부 및 원인 판정 (Read-Only)
   * reserve 거절 원인이 BUDGET_LIMIT_EXCEEDED_OR_DUPLICATE_REQUEST일 때만 호출
   */
  public async getRetryAdvice(
    requestId: string,
    estimatedUnits: number
  ): Promise<{
    kind: 'minute' | 'daily' | 'duplicate' | 'unavailable' | 'request-too-large';
    retryAfterSeconds?: number;
  }> {
    if (!this.isConfigValid) {
      return { kind: 'unavailable' };
    }

    if (
      !requestId ||
      typeof requestId !== 'string' ||
      requestId.length > 512 ||
      !Number.isSafeInteger(estimatedUnits) ||
      estimatedUnits <= 0
    ) {
      return { kind: 'unavailable' };
    }

    if (estimatedUnits > this.tpm) {
      return { kind: 'request-too-large' };
    }

    const colonIdx = requestId.indexOf(':');
    if (colonIdx <= 0 || colonIdx >= requestId.length - 1) {
      return { kind: 'unavailable' };
    }
    const callerPart = requestId.slice(0, colonIdx).trim();
    const opaquePart = requestId.slice(colonIdx + 1).trim();
    if (callerPart.length === 0 || opaquePart.length === 0) {
      return { kind: 'unavailable' };
    }

    const nowMs = this.clockNow();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      return { kind: 'unavailable' };
    }

    try {
      const requestHash = await sha256Hex(requestId);
      const callerHash = await sha256Hex(callerPart);
      const dayKey = toPacificDateString(new Date(nowMs));
      const windowStartMs = nowMs - 60000;

      const query = `
        SELECT
          (SELECT COUNT(*) FROM conversation_budget_reservations WHERE request_hash = ?) AS duplicate_count,
          (SELECT COUNT(*) FROM conversation_budget_reservations WHERE model = ? AND state != 'released' AND day_key = ?) AS daily_count,
          (SELECT COUNT(*) FROM conversation_budget_reservations WHERE model = ? AND state != 'released' AND created_ms > ?) AS minute_count,
          (SELECT COALESCE(SUM(units), 0) FROM conversation_budget_reservations WHERE model = ? AND state != 'released' AND created_ms > ?) AS minute_units,
          (SELECT COUNT(*) FROM conversation_budget_reservations WHERE caller_hash = ? AND model = ? AND state != 'released' AND created_ms > ?) AS caller_count;
      `;

      const stmt = this.db.prepare(query);
      const boundStmt = stmt.bind(
        requestHash,
        this.model,
        dayKey,
        this.model,
        windowStartMs,
        this.model,
        windowStartMs,
        callerHash,
        this.model,
        windowStartMs
      );

      let row: Record<string, unknown> | null = null;
      if (typeof boundStmt.first === 'function') {
        row = await boundStmt.first();
      } else {
        return { kind: 'unavailable' };
      }

      if (!row || typeof row !== 'object') {
        return { kind: 'unavailable' };
      }

      const isSafeNonNegativeInt = (v: unknown): v is number =>
        typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

      const dupRaw = row.duplicate_count;
      const dailyRaw = row.daily_count;
      const minCountRaw = row.minute_count;
      const minUnitsRaw = row.minute_units;
      const callerRaw = row.caller_count;

      if (
        !isSafeNonNegativeInt(dupRaw) ||
        !isSafeNonNegativeInt(dailyRaw) ||
        !isSafeNonNegativeInt(minCountRaw) ||
        !isSafeNonNegativeInt(minUnitsRaw) ||
        !isSafeNonNegativeInt(callerRaw)
      ) {
        return { kind: 'unavailable' };
      }

      if (dupRaw > 0) {
        return { kind: 'duplicate' };
      }

      if (dailyRaw >= this.rpd) {
        return { kind: 'daily' };
      }

      const isMinuteCountExceeded = minCountRaw >= this.rpm;
      const isMinuteUnitsExceeded = minUnitsRaw + estimatedUnits > this.tpm;
      const isCallerExceeded = callerRaw >= this.callerRpm;

      if (isMinuteCountExceeded || isMinuteUnitsExceeded || isCallerExceeded) {
        return { kind: 'minute', retryAfterSeconds: 61 };
      }

      // 일일 한도가 남아있고 중복이 아니지만 순간적인 롤링 압박으로 거절된 경우
      return { kind: 'minute', retryAfterSeconds: 61 };
    } catch {
      return { kind: 'unavailable' };
    }
  }
}
