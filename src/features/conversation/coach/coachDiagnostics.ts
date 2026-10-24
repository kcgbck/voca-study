// src/features/conversation/coach/coachDiagnostics.ts
// 로컬 전용 회화 진단 기록 및 저장소 (원격 전송 없음, 24시간/20건/64KiB 상한)

import type { CoachEvaluation } from './coachProtocol';

export const COACH_DIAGNOSTICS_KEY = 'coach_diagnostics_history_v1';
export const COACH_DIAGNOSTICS_MAX_RECORDS = 20;
export const COACH_DIAGNOSTICS_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24시간
export const COACH_DIAGNOSTICS_MAX_BYTES = 64 * 1024; // 64 KiB

export const SAFE_DIAGNOSTIC_ERROR_CODES = [
  'COACH_MINUTE_LIMIT',
  'COACH_DAILY_LIMIT',
  'EVALUATION_TIMEOUT',
  'EVALUATION_FAILED',
  'INVALID_CANDIDATE_INDEX',
  'INVALID_NO_CANDIDATE_INDEX',
  'SPEECH_NO_SPEECH',
  'SPEECH_EMPTY',
  'SPEECH_NETWORK',
  'SPEECH_PERMISSION',
  'SPEECH_ERROR',
  'OUTPUT_TIMEOUT',
  'OUTPUT_ERROR',
] as const;

export type SafeDiagnosticErrorCode = typeof SAFE_DIAGNOSTIC_ERROR_CODES[number];

export interface CoachDiagnosticRecord {
  id: string;
  timestamp: string; // ISO 8601
  questionId: string;
  questionEn: string;
  stage: 'initial' | 'repeat';
  inputSource: 'voice' | 'text';
  rawText: string;
  candidates: string[];
  evaluationSource: 'ai' | 'reuse' | 'none';
  evaluation?: CoachEvaluation;
  evaluationRequests: number;
  elapsedMs: number;
  errorCode?: SafeDiagnosticErrorCode;
  intendedText?: string;
}

function sanitizeString(str: unknown, maxLen: number): string {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLen);
}

function sanitizeStringArray(arr: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(arr)) return [];
  const result: string[] = [];
  for (const item of arr) {
    if (typeof item === 'string') {
      result.push(item.slice(0, maxLen));
      if (result.length >= maxItems) break;
    }
  }
  return result;
}

function sanitizeEvaluation(evalObj: unknown, candidateCount: number): CoachEvaluation | undefined {
  if (!evalObj || typeof evalObj !== 'object') return undefined;
  const raw = evalObj as Record<string, unknown>;
  const validMeanings = ['relevant', 'needs_help', 'uncertain'];
  if (!validMeanings.includes(raw.meaning as string)) return undefined;
  if (typeof raw.sentenceComplete !== 'boolean') return undefined;

  const result: CoachEvaluation = {
    meaning: raw.meaning as 'relevant' | 'needs_help' | 'uncertain',
    sentenceComplete: raw.sentenceComplete,
    feedbackKo: sanitizeString(raw.feedbackKo, 500),
    modelAnswerEn: sanitizeString(raw.modelAnswerEn, 200),
  };

  if (
    typeof raw.recognizedCandidateIndex === 'number' &&
    Number.isInteger(raw.recognizedCandidateIndex) &&
    raw.recognizedCandidateIndex >= 0 &&
    (candidateCount <= 0 || raw.recognizedCandidateIndex < candidateCount)
  ) {
    result.recognizedCandidateIndex = raw.recognizedCandidateIndex;
  }

  return result;
}

function validateAndSanitizeRecord(raw: unknown): CoachDiagnosticRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;

  if (typeof item.id !== 'string' || item.id.trim().length === 0) return null;
  if (typeof item.timestamp !== 'string' || Number.isNaN(Date.parse(item.timestamp))) return null;
  if (typeof item.questionId !== 'string' || item.questionId.trim().length === 0) return null;
  if (typeof item.questionEn !== 'string' || item.questionEn.trim().length === 0) return null;

  if (item.stage !== 'initial' && item.stage !== 'repeat') return null;
  if (item.inputSource !== 'voice' && item.inputSource !== 'text') return null;
  if (item.evaluationSource !== 'ai' && item.evaluationSource !== 'reuse' && item.evaluationSource !== 'none') return null;

  const rawEvalReq = item.evaluationRequests;
  const evaluationRequests =
    typeof rawEvalReq === 'number' && Number.isFinite(rawEvalReq) && rawEvalReq >= 0
      ? Math.floor(rawEvalReq)
      : 0;

  const rawElapsed = item.elapsedMs;
  const elapsedMs =
    typeof rawElapsed === 'number' && Number.isFinite(rawElapsed) && rawElapsed >= 0
      ? Math.floor(rawElapsed)
      : 0;

  const candidates = sanitizeStringArray(item.candidates, 3, 500);

  const sanitized: CoachDiagnosticRecord = {
    id: sanitizeString(item.id, 64),
    timestamp: item.timestamp,
    questionId: sanitizeString(item.questionId, 64),
    questionEn: sanitizeString(item.questionEn, 200),
    stage: item.stage,
    inputSource: item.inputSource,
    rawText: sanitizeString(item.rawText, 500),
    candidates,
    evaluationSource: item.evaluationSource,
    evaluationRequests,
    elapsedMs,
  };

  const cleanEval = sanitizeEvaluation(item.evaluation, candidates.length);
  if (cleanEval) {
    sanitized.evaluation = cleanEval;
  }

  if (
    typeof item.errorCode === 'string' &&
    SAFE_DIAGNOSTIC_ERROR_CODES.includes(item.errorCode as SafeDiagnosticErrorCode)
  ) {
    sanitized.errorCode = item.errorCode as SafeDiagnosticErrorCode;
  }

  if (typeof item.intendedText === 'string' && item.intendedText.trim().length > 0) {
    sanitized.intendedText = sanitizeString(item.intendedText, 500);
  }

  return sanitized;
}

function getByteLength(str: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).byteLength;
  }
  // Fallback: UTF-8 바이트 계산
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++; // surrogate pair
    } else bytes += 3;
  }
  return bytes;
}

export class CoachDiagnosticStore {
  private memoryStore: CoachDiagnosticRecord[] = [];
  private initialLoaded = false;
  public persistenceAvailable = true;

  constructor(
    private storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
    private now: () => number = () => Date.now()
  ) {}

  private getStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
    if (this.storage) return this.storage;
    try {
      if (typeof window !== 'undefined' && 'localStorage' in window && window.localStorage) {
        return window.localStorage;
      }
    } catch {
      this.persistenceAvailable = false;
      return null;
    }
    this.persistenceAvailable = false;
    return null;
  }

  private filterValid(records: CoachDiagnosticRecord[]): CoachDiagnosticRecord[] {
    const currentNow = this.now();
    return records.filter((r) => {
      const time = Date.parse(r.timestamp);
      if (Number.isNaN(time)) return false;
      return time <= currentNow + 60000 && currentNow - time <= COACH_DIAGNOSTICS_MAX_AGE_MS;
    });
  }

  private enforceCapacity(records: CoachDiagnosticRecord[]): CoachDiagnosticRecord[] {
    let list = records.slice(0, COACH_DIAGNOSTICS_MAX_RECORDS);
    while (list.length > 0 && getByteLength(JSON.stringify(list)) > COACH_DIAGNOSTICS_MAX_BYTES) {
      list.pop();
    }
    return list;
  }

  private ensureLoaded(): void {
    if (this.initialLoaded) return;
    this.initialLoaded = true;

    const st = this.getStorage();
    if (!st) return;

    try {
      const raw = st.getItem(COACH_DIAGNOSTICS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      const sanitizedList: CoachDiagnosticRecord[] = [];
      for (const item of parsed) {
        const record = validateAndSanitizeRecord(item);
        if (record) sanitizedList.push(record);
      }

      this.memoryStore = this.enforceCapacity(this.filterValid(sanitizedList));
    } catch {
      this.persistenceAvailable = false;
    }
  }

  private syncToDisk(): void {
    const st = this.getStorage();
    if (!st) return;

    try {
      st.setItem(COACH_DIAGNOSTICS_KEY, JSON.stringify(this.memoryStore));
      this.persistenceAvailable = true;
    } catch {
      this.persistenceAvailable = false;
      try {
        const half = this.memoryStore.slice(0, Math.max(1, Math.floor(this.memoryStore.length / 2)));
        st.setItem(COACH_DIAGNOSTICS_KEY, JSON.stringify(half));
      } catch {
        // non-fatal
      }
    }
  }

  public list(): CoachDiagnosticRecord[] {
    this.ensureLoaded();
    const valid = this.enforceCapacity(this.filterValid(this.memoryStore));
    this.memoryStore = valid;
    return JSON.parse(JSON.stringify(valid));
  }

  public append(record: CoachDiagnosticRecord): void {
    this.ensureLoaded();
    const validated = validateAndSanitizeRecord(record);
    if (!validated) return;

    const updated = [validated, ...this.memoryStore];
    this.memoryStore = this.enforceCapacity(this.filterValid(updated));
    this.syncToDisk();
  }

  public annotate(id: string, intendedText?: string): void {
    this.ensureLoaded();
    if (!id) return;
    const target = this.memoryStore.find((r) => r.id === id);
    if (!target) return;

    if (intendedText && intendedText.trim().length > 0) {
      target.intendedText = sanitizeString(intendedText.trim(), 500);
    } else {
      delete target.intendedText;
    }

    this.memoryStore = this.enforceCapacity(this.filterValid(this.memoryStore));
    this.syncToDisk();
  }

  public clear(): boolean {
    this.ensureLoaded();
    this.memoryStore = [];
    const st = this.getStorage();
    if (!st) return true;

    try {
      st.removeItem(COACH_DIAGNOSTICS_KEY);
      return true;
    } catch {
      this.persistenceAvailable = false;
      return false;
    }
  }

  public exportText(): string {
    const records = this.list();
    if (records.length === 0) {
      return '기록된 음성 인식 및 평가 진단 내역이 없습니다.';
    }

    const lines: string[] = [
      '=== AI 영어 회화 진단 기록 리포트 (coach-report-v1) ===',
      `생성 일시: ${new Date(this.now()).toISOString()}`,
      `총 기록 건수: ${records.length}건 (최대 20건 / 24시간 보관)`,
      '주의: 복사하기 전 이름이나 민감한 개인정보가 포함되어 있는지 확인하세요.',
      '------------------------------------------------------------',
    ];

    records.forEach((rec, idx) => {
      lines.push(`\n[기록 #${idx + 1}] ID: ${rec.id}`);
      lines.push(`- 시각: ${rec.timestamp} (입력·평가 소요: ${rec.elapsedMs}ms)`);
      lines.push(`- 질문: [${rec.questionId}] ${rec.questionEn}`);
      lines.push(`- 단계 및 입력: ${rec.stage === 'initial' ? '초기 답변' : '반복 연습'} / ${rec.inputSource === 'voice' ? '음성인식' : '텍스트 직접입력'}`);
      lines.push(`- 사용자 의도: ${rec.intendedText ? rec.intendedText : '(사용자 미입력 - 확인 불가)'}`);
      lines.push(`- 원본 인식 문장(Raw): "${rec.rawText}"`);

      if (rec.candidates && rec.candidates.length > 0) {
        lines.push('- 인식 대안 후보군:');
        rec.candidates.forEach((c, cIdx) => {
          lines.push(`  (${cIdx}) "${c}"`);
        });
      } else {
        lines.push('- 인식 대안 후보군: 없음 (단일 텍스트/후보 미제공)');
      }

      lines.push(`- 평가 처리 방식: ${rec.evaluationSource === 'ai' ? `AI 평가 요청 (앱 ${rec.evaluationRequests}회 시도, 제공사/예산 차감 횟수와 다를 수 있음)` : rec.evaluationSource === 'reuse' ? '로컬 승인 답안 안전 재사용 (AI 0회)' : '평가 미실행'}`);

      if (rec.evaluation) {
        const ev = rec.evaluation;
        const selectedIdx = ev.recognizedCandidateIndex ?? 0;
        const selectedText = rec.candidates && rec.candidates[selectedIdx] ? rec.candidates[selectedIdx] : rec.rawText;

        const meaningKo =
          ev.meaning === 'relevant'
            ? '뜻이 통함 (relevant)'
            : ev.meaning === 'needs_help'
            ? '다시 연습 (needs_help)'
            : '인식/의미 불확실 (uncertain)';

        lines.push(`- AI 채택 텍스트: "${selectedText}" (후보 인덱스: ${selectedIdx})`);
        lines.push(`- 평가 판정: 의미 [${meaningKo}], 문장 완성 여부 [${ev.sentenceComplete ? '완전한 문장' : '미완성/단답'}]`);
        lines.push(`- 원포인트 피드백: ${ev.feedbackKo}`);
        lines.push(`- 모범 예문: ${ev.modelAnswerEn}`);
      }

      if (rec.errorCode) {
        lines.push(`- 발생 오류 코드: ${rec.errorCode}`);
      }
    });

    lines.push('\n============================================================');
    return lines.join('\n');
  }
}
