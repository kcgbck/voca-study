// src/features/conversation/whisper/whisperBenchmark.ts
// 순수 텍스트 정규화, Levenshtein 기반 WER / CER 산출, 6종 대조 벤치마크 데이터셋 및 리포트 생성기

import type { WhisperBackend } from './whisperTypes';

export interface BenchmarkSentence {
  id: string;
  category: 'name' | 'coffee' | 'cup' | 'jam' | 'negation' | 'number' | 'custom';
  titleKo: string;
  referenceText: string;
}

export const BENCHMARK_SENTENCES: BenchmarkSentence[] = [
  {
    id: 'name_minjun',
    category: 'name',
    titleKo: '한국어 이름 (Minjun)',
    referenceText: 'My name is Minjun Park.',
  },
  {
    id: 'drink_coffee',
    category: 'coffee',
    titleKo: '음료 주문 (coffee vs couple)',
    referenceText: 'I would like coffee, please.',
  },
  {
    id: 'drink_cup',
    category: 'cup',
    titleKo: '컵 요청 (cup vs coffee)',
    referenceText: 'I would like a cup, please.',
  },
  {
    id: 'food_jam',
    category: 'jam',
    titleKo: '식사 어휘 (jam vs gym)',
    referenceText: 'I had toast with jam.',
  },
  {
    id: 'grammar_negation',
    category: 'negation',
    titleKo: '부정어 보존 (do not like)',
    referenceText: 'I do not like swimming.',
  },
  {
    id: 'grammar_number',
    category: 'number',
    titleKo: '숫자 인식 (thirty)',
    referenceText: 'I am thirty years old.',
  },
];

export interface BenchmarkEngineResult {
  rawText: string;
  status: 'ok' | 'silent' | 'timeout' | 'error';
  errorMessage?: string;
  totalElapsedMs: number; // 캡처/듣기 + 처리 합산 시간
  audioDurationSec?: number;
  pureInferenceMs?: number; // Whisper 순수 추론 시간
  backend?: WhisperBackend;
  isWarmCache?: boolean;
}

export interface BenchmarkPairRecord {
  id: string;
  sentenceId: string;
  category: string;
  titleKo: string;
  referenceText: string;
  timestamp: string;

  // 두 엔진의 개별 순차 발화 결과 (서로 다른 독립 녹음)
  webSpeech: BenchmarkEngineResult;
  whisper: BenchmarkEngineResult;

  // 정규화 비교 지표
  webSpeechWer: number;
  webSpeechCer: number;
  whisperWer: number;
  whisperCer: number;
}

/**
 * 비교용 텍스트 정규화:
 * - 소문자화
 * - 유니코드 아포스트로피 통일
 * - 영문/한글/숫자/유니코드 문자와 공백을 보존하여 한글이나 다국어 문장이 빈 값으로 소실되는 문제 방지
 * - 구두점은 공백으로 치환 후 연속 공백 단일화
 */
export function normalizeForMetrics(text: string): string {
  if (typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Levenshtein 거리 계산 (제네릭 배열 비교)
 */
function levenshteinDistance<T>(a: T[], b: T[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // 삭제
        dp[i][j - 1] + 1, // 삽입
        dp[i - 1][j - 1] + cost // 치환
      );
    }
  }

  return dp[m][n];
}

/**
 * Word Error Rate (WER) 계산 (단어 단위 Levenshtein / ref단어수, 1.0 초과 가능)
 * - 참조가 비어있거나 유효 문자가 없으면 0이 아닌 1.0(invalid reference) 반환
 * - 인식 결과가 비어있으면 1.0 (모든 단어 누락)
 */
export function calculateWER(reference: string, hypothesis: string): number {
  const normRef = normalizeForMetrics(reference);
  const normHyp = normalizeForMetrics(hypothesis);

  const refWords = normRef.length > 0 ? normRef.split(' ') : [];
  const hypWords = normHyp.length > 0 ? normHyp.split(' ') : [];

  if (refWords.length === 0) {
    throw new Error('참조 문장이 비어있거나 유효한 문자가 없어 WER을 산출할 수 없습니다.');
  }
  if (hypWords.length === 0) {
    return 1.0;
  }

  const dist = levenshteinDistance(refWords, hypWords);
  return Math.round((dist / refWords.length) * 1000) / 1000;
}

/**
 * Character Error Rate (CER) 계산 (글자 단위 Levenshtein / ref글자수)
 * - 공백을 제외한 유효 문자 기준
 */
export function calculateCER(reference: string, hypothesis: string): number {
  const normRef = normalizeForMetrics(reference).replace(/\s+/g, '');
  const normHyp = normalizeForMetrics(hypothesis).replace(/\s+/g, '');

  const refChars = Array.from(normRef);
  const hypChars = Array.from(normHyp);

  if (refChars.length === 0) {
    throw new Error('참조 문장이 비어있거나 유효한 문자가 없어 CER을 산출할 수 없습니다.');
  }
  if (hypChars.length === 0) {
    return 1.0;
  }

  const dist = levenshteinDistance(refChars, hypChars);
  return Math.round((dist / refChars.length) * 1000) / 1000;
}

export interface BenchmarkReportOptions {
  deviceMetadata?: string; // 예: "Samsung Galaxy S25 (Android Chrome)" 또는 "PC Chrome Dev"
  modelRevision?: string;
  isWarmCache?: boolean;
  loadDurationMs?: number;
}

/**
 * 전체 벤치마크 결과 리포트 문자열 생성 (수동 복사용 포맷)
 */
export function generateBenchmarkReport(
  records: BenchmarkPairRecord[],
  options: BenchmarkReportOptions = {}
): string {
  if (!records || records.length === 0) {
    return '실행된 음성 엔진 비교 데이터가 없습니다.';
  }

  const totalPairs = records.length;
  const plannedCount = BENCHMARK_SENTENCES.length;
  // 중복이 아닌 고유 sentenceId 기준 완료 개수 집계
  const completedSentenceIds = new Set<string>();
  let webSpeechWerSum = 0;
  let webSpeechCerSum = 0;
  let whisperWerSum = 0;
  let whisperCerSum = 0;

  const webSpeechTimes: number[] = [];
  const whisperPureTimes: number[] = [];
  const whisperTotalTimes: number[] = [];
  let webSpeechFailures = 0;
  let whisperFailures = 0;

  for (const r of records) {
    const isWsOk = r.webSpeech.status === 'ok';
    const isWhOk = r.whisper.status === 'ok';
    if (isWsOk && isWhOk) {
      completedSentenceIds.add(r.sentenceId);
    }

    webSpeechWerSum += r.webSpeechWer;
    webSpeechCerSum += r.webSpeechCer;
    whisperWerSum += r.whisperWer;
    whisperCerSum += r.whisperCer;

    if (isWsOk) {
      webSpeechTimes.push(r.webSpeech.totalElapsedMs);
    } else {
      webSpeechFailures++;
    }

    if (isWhOk) {
      whisperTotalTimes.push(r.whisper.totalElapsedMs);
      if (typeof r.whisper.pureInferenceMs === 'number') {
        whisperPureTimes.push(r.whisper.pureInferenceMs);
      }
    } else {
      whisperFailures++;
    }
  }

  const avgWsWer = Math.round((webSpeechWerSum / totalPairs) * 1000) / 1000;
  const avgWsCer = Math.round((webSpeechCerSum / totalPairs) * 1000) / 1000;
  const avgWhWer = Math.round((whisperWerSum / totalPairs) * 1000) / 1000;
  const avgWhCer = Math.round((whisperCerSum / totalPairs) * 1000) / 1000;

  const median = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  };

  const medianWsTime = median(webSpeechTimes);
  const medianWhPureTime = median(whisperPureTimes);
  const medianWhTotalTime = median(whisperTotalTimes);

  const deviceLabel = options.deviceMetadata || '미지정 단말 환경';
  const revisionLabel = options.modelRevision || 'onnx-community/whisper-tiny@q8';
  const cacheLabel = options.isWarmCache === true ? '완전 캐시 재사용 (Warm)' : options.isWarmCache === false ? '최초 다운로드/콜드 로드 (Cold)' : '확인 불가';
  const prepTimeLabel = typeof options.loadDurationMs === 'number' ? `${options.loadDurationMs}ms` : '미측정';

  const lines: string[] = [
    '=== 기기 내 음성 비교 리포트 (whisper-compare-v1) ===',
    `일시: ${new Date().toISOString()}`,
    `측정 기기 메타데이터: ${deviceLabel}`,
    `모델 정보: ${revisionLabel} (준비 소요: ${prepTimeLabel}, 캐시 상태: ${cacheLabel})`,
    `대조 문항 수: ${completedSentenceIds.size}/${plannedCount}개 고유 문항 완료 (총 ${totalPairs}회 측정, 순차 개별 발화)`,
    '고지: 두 엔진은 완전히 동일한 오디오가 아닌 동일 참조 문장을 순차적으로 따로 발화한 결과입니다.',
    '안내: 복사하기 전 이름이나 민감한 개인정보가 포함되어 있는지 확인하세요.',
    '------------------------------------------------------------',
    '[요약 지표]',
    `- Web Speech API : 평균 WER ${avgWsWer} | 평균 CER ${avgWsCer} | 중앙 총소요 ${medianWsTime}ms | 실패 ${webSpeechFailures}회`,
    `- In-Browser Whisper: 평균 WER ${avgWhWer} | 평균 CER ${avgWhCer} | 중앙 총소요 ${medianWhTotalTime}ms (순수추론: ${medianWhPureTime}ms) | 실패 ${whisperFailures}회`,
    '------------------------------------------------------------',
  ];

  records.forEach((r, idx) => {
    lines.push(`\n[문항 #${idx + 1}] ${r.titleKo}`);
    lines.push(`- 참조 텍스트(Ref): "${r.referenceText}"`);
    lines.push(
      `- Web Speech ASR: "${r.webSpeech.rawText || '(인식 실패)'}" (WER: ${r.webSpeechWer}, CER: ${r.webSpeechCer}, 총소요: ${r.webSpeech.totalElapsedMs}ms, 상태: ${r.webSpeech.status})`
    );
    lines.push(
      `- In-Browser Whisper: "${r.whisper.rawText || '(전사 실패)'}" (WER: ${r.whisperWer}, CER: ${r.whisperCer}, 총소요: ${r.whisper.totalElapsedMs}ms [순수추론: ${r.whisper.pureInferenceMs ?? 0}ms], 백엔드: ${r.whisper.backend || 'unknown'}, 상태: ${r.whisper.status})`
    );
  });

  lines.push('\n============================================================');
  lines.push('판정: 불완전하거나 실패한 결과가 있을 경우 Whisper 우세로 자동 판정하지 않으며, 실기기 실측 수치 비교 결과에 따라 기본 엔진 전환 여부를 최종 결정합니다 (자동 기본 전환 없음).');
  return lines.join('\n');
}
