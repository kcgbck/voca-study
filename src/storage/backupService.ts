// src/storage/backupService.ts
// TOEIC_STUDY 백업 및 복원 서비스 모듈 (v1/v2 완전 호환, v3 회화 데이터 계층 가산)

import { db, type ToeicStudyDatabase, type AppSetting } from './db';
import type { WordEntry, WordBook, StudyHistory, WordStat } from '../types/word';
import type {
  QuestionBook,
  QuestionItem,
  QuestionStudyHistory,
  QuestionStat,
  SourceImage,
} from '../types/question';
import type {
  ConversationSession,
  LessonProgress,
  ConversationReviewItem,
} from '../features/conversation/types';
import type { WrongWordItem } from '../services/wrongNoteService';
import type { Table } from 'dexie';

export const BACKUP_FORMAT_IDENTIFIER = 'toeic-study-backup';
export const CURRENT_BACKUP_VERSION = 2;

export interface SerializedSourceImage {
  id: string;
  bookId: string;
  page?: number;
  mimeType: string;
  dataUrl?: string;
  createdAt: string;
}

export interface BackupDataPayload {
  // v1 도메인 테이블 (v1/v2 공통 필수)
  wordBooks: WordBook[];
  words: WordEntry[];
  wordStats: WordStat[];
  studyHistory: StudyHistory[];
  appSettings: AppSetting[];

  // v2 문제 도메인 테이블 (v2 백업에서 필수)
  questionBooks?: QuestionBook[];
  questions?: QuestionItem[];
  questionStudyHistory?: QuestionStudyHistory[];
  questionStats?: QuestionStat[];
  sourceImages?: SerializedSourceImage[];

  // v3 회화 도메인 테이블 (v2 백업에서 필수)
  conversationSessions?: ConversationSession[];
  conversationProgress?: LessonProgress[];
  conversationReviewItems?: ConversationReviewItem[];

  // 안전한 로컬 오답 캐시 (선택적)
  wrongNotesCache?: WrongWordItem[];
}

export interface BackupFileStructure {
  format: typeof BACKUP_FORMAT_IDENTIFIER;
  version: number;
  exportedAt: string;
  appVersion?: string;
  metadata: {
    wordBooksCount: number;
    wordsCount: number;
    studyHistoryCount: number;
    questionBooksCount?: number;
    questionsCount?: number;
    conversationSessionsCount?: number;
    conversationProgressCount?: number;
    conversationReviewItemsCount?: number;
  };
  data: BackupDataPayload;
}

export interface BackupSummary {
  valid: boolean;
  version: number;
  exportedAt: string;
  wordBooksCount: number;
  wordsCount: number;
  studyHistoryCount: number;
  questionBooksCount?: number;
  questionsCount?: number;
  conversationSessionsCount?: number;
  conversationProgressCount?: number;
  conversationReviewItemsCount?: number;
  errorMessage?: string;
}

export interface RestoreResult {
  success: boolean;
  restoredWords: number;
  restoredBooks: number;
  restoredQuestions: number;
  restoredSessions: number;
  skippedCount: number;
}

/**
 * Blob을 DataURL (Base64) 문자열로 안전하게 비동기 변환 (트랜잭션 외부 실행)
 */
async function blobToDataUrl(blob: Blob, mimeType: string): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Node.js / Vitest 환경 폴백
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return `data:${mimeType || 'application/octet-stream'};base64,${buffer.toString('base64')}`;
}

/**
 * DataURL 문자열을 Blob 객체로 역변환 (트랜잭션 외부 실행)
 */
function dataUrlToBlob(dataUrl: string, fallbackMime: string = 'application/octet-stream'): Blob {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) {
    throw new Error('손상된 DataURL 형식입니다.');
  }

  const mime = match[1] || fallbackMime;
  const base64Data = match[2];

  if (!base64Data || base64Data.length === 0) {
    throw new Error('빈 base64 데이터는 허용되지 않습니다.');
  }

  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(base64Data, 'base64');
    return new Blob([buf], { type: mime });
  } else {
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }
}

/**
 * 두 레코드가 동일한지 심층 비교 (머지 시 멱등 스킵 및 충돌 감지)
 */
function areRecordsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;

  // SourceImage의 Blob 인스턴스 차이는 직렬화 비교 대상에서 제외 (dataUrl/필드로 비교)
  const keysA = Object.keys(objA).filter((k) => k !== 'blob');
  const keysB = Object.keys(objB).filter((k) => k !== 'blob');

  const allKeys = new Set([...keysA, ...keysB]);
  for (const key of allKeys) {
    const valA = objA[key];
    const valB = objB[key];
    if (valA === valB) continue;
    if (JSON.stringify(valA) !== JSON.stringify(valB)) {
      return false;
    }
  }
  return true;
}

/**
 * 민감 설정 키 패턴 (API Key, 토큰, 비밀번호, 사용자 프로필, 장치 코드 등 백업 배제)
 */
const SENSITIVE_KEY_PATTERN = /(api_?key|token|secret|credential|password|profile|device_?code|device_?id)/i;

/**
 * 전체 IndexedDB 데이터를 JSON 파일 형식으로 스냅샷 추출 (readonly 트랜잭션 + 외부 비동기 Blob 직렬화)
 */
export async function exportBackupData(customDb?: ToeicStudyDatabase): Promise<BackupFileStructure> {
  const targetDb = customDb || db;

  // 1. 13개 전체 테이블을 단일 readonly 트랜잭션으로 원자적 스냅샷 조회
  const snapshot = await targetDb.transaction(
    'r',
    [
      targetDb.wordBooks,
      targetDb.words,
      targetDb.wordStats,
      targetDb.studyHistory,
      targetDb.appSettings,
      targetDb.questionBooks,
      targetDb.questions,
      targetDb.questionStudyHistory,
      targetDb.questionStats,
      targetDb.sourceImages,
      targetDb.conversationSessions,
      targetDb.conversationProgress,
      targetDb.conversationReviewItems,
    ],
    async () => {
      const [
        wordBooks,
        words,
        wordStats,
        studyHistory,
        rawAppSettings,
        questionBooks,
        questions,
        questionStudyHistory,
        questionStats,
        rawSourceImages,
        rawConversationSessions,
        conversationProgress,
        conversationReviewItems,
      ] = await Promise.all([
        targetDb.wordBooks.toArray(),
        targetDb.words.toArray(),
        targetDb.wordStats.toArray(),
        targetDb.studyHistory.toArray(),
        targetDb.appSettings.toArray(),
        targetDb.questionBooks.toArray(),
        targetDb.questions.toArray(),
        targetDb.questionStudyHistory.toArray(),
        targetDb.questionStats.toArray(),
        targetDb.sourceImages.toArray(),
        targetDb.conversationSessions.toArray(),
        targetDb.conversationProgress.toArray(),
        targetDb.conversationReviewItems.toArray(),
      ]);

      return {
        wordBooks,
        words,
        wordStats,
        studyHistory,
        rawAppSettings,
        questionBooks,
        questions,
        questionStudyHistory,
        questionStats,
        rawSourceImages,
        rawConversationSessions,
        conversationProgress,
        conversationReviewItems,
      };
    }
  );

  // 2. 민감한 설정 배제 (API Key, 사용자 프로필 등)
  const safeAppSettings = snapshot.rawAppSettings.filter(
    (s) => !SENSITIVE_KEY_PATTERN.test(s.key)
  );

  // 3. SourceImage Blob을 트랜잭션 외부에서 Base64 DataURL로 비동기 변환 (트랜잭션 타임아웃 방지)
  const serializedSourceImages: SerializedSourceImage[] = await Promise.all(
    snapshot.rawSourceImages.map(async (img) => {
      let dataUrl = img.dataUrl;
      if (!dataUrl && img.blob) {
        dataUrl = await blobToDataUrl(img.blob, img.mimeType);
      }
      return {
        id: img.id,
        bookId: img.bookId,
        page: img.page,
        mimeType: img.mimeType,
        dataUrl,
        createdAt: img.createdAt,
      };
    })
  );

  // 4. 세션 데이터 정제 (사용자 원음 음성 바이너리 배제, 텍스트 및 평가 메타데이터만 보존)
  const sanitizedSessions: ConversationSession[] = snapshot.rawConversationSessions.map(
    (session) => ({
      ...session,
      turns: session.turns.map((t) => ({
        turnId: t.turnId,
        speaker: t.speaker,
        text: typeof t.text === 'string' ? t.text : '',
        timestamp: t.timestamp,
        evaluation: t.evaluation ? { ...t.evaluation } : undefined,
      })),
    })
  );

  const backup: BackupFileStructure = {
    format: BACKUP_FORMAT_IDENTIFIER,
    version: CURRENT_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    metadata: {
      wordBooksCount: snapshot.wordBooks.length,
      wordsCount: snapshot.words.length,
      studyHistoryCount: snapshot.studyHistory.length,
      questionBooksCount: snapshot.questionBooks.length,
      questionsCount: snapshot.questions.length,
      conversationSessionsCount: sanitizedSessions.length,
      conversationProgressCount: snapshot.conversationProgress.length,
      conversationReviewItemsCount: snapshot.conversationReviewItems.length,
    },
    data: {
      wordBooks: snapshot.wordBooks,
      words: snapshot.words,
      wordStats: snapshot.wordStats,
      studyHistory: snapshot.studyHistory,
      appSettings: safeAppSettings,
      questionBooks: snapshot.questionBooks,
      questions: snapshot.questions,
      questionStudyHistory: snapshot.questionStudyHistory,
      questionStats: snapshot.questionStats,
      sourceImages: serializedSourceImages,
      conversationSessions: sanitizedSessions,
      conversationProgress: snapshot.conversationProgress,
      conversationReviewItems: snapshot.conversationReviewItems,
    },
  };

  return backup;
}

/**
 * 브라우저에서 JSON 백업 파일 다운로드 트리거
 */
export async function downloadBackupFile(): Promise<string> {
  const backup = await exportBackupData();
  const jsonStr = JSON.stringify(backup, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const fileName = `toeic_study_backup_${dateStr}.json`;

  if (typeof document !== 'undefined') {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return fileName;
}

/**
 * 복원 전 백업 파일 스키마, 무결성, 보안, 메타데이터 일치 검증 (예외 발생 없이 항상 객체 반환)
 */
export function validateBackupFile(content: unknown): BackupSummary {
  const createInvalidSummary = (version: number, exportedAt: string, errorMessage: string): BackupSummary => ({
    valid: false,
    version,
    exportedAt,
    wordBooksCount: 0,
    wordsCount: 0,
    studyHistoryCount: 0,
    errorMessage,
  });

  try {
    if (!content || typeof content !== 'object') {
      return createInvalidSummary(0, '', '유효한 JSON 객체가 아닙니다.');
    }

    const raw = content as Partial<BackupFileStructure>;

    if (raw.format !== BACKUP_FORMAT_IDENTIFIER) {
      return createInvalidSummary(
        raw.version || 0,
        raw.exportedAt || '',
        `지원하지 않는 백업 파일 형식입니다. (식별자: ${raw.format ?? '없음'})`
      );
    }

    // 지원 버전: v1 (기존), v2 (현재)
    if (raw.version !== 1 && raw.version !== CURRENT_BACKUP_VERSION) {
      return createInvalidSummary(
        raw.version || 0,
        raw.exportedAt || '',
        `지원하지 않는 백업 버전입니다. (버전 ${raw.version}, 현재 지원: v1, v${CURRENT_BACKUP_VERSION})`
      );
    }

    if (!raw.data || typeof raw.data !== 'object') {
      return createInvalidSummary(raw.version, raw.exportedAt || '', '백업 데이터 페이로드가 손상되었습니다.');
    }

    const data = raw.data;

    // v1 필수 테이블 목록 vs v2 필수 테이블 목록 (v2는 13개 전체 필수)
    const v1RequiredTables = ['wordBooks', 'words', 'wordStats', 'studyHistory', 'appSettings'] as const;
    const v2RequiredTables = [
      ...v1RequiredTables,
      'questionBooks',
      'questions',
      'questionStudyHistory',
      'questionStats',
      'sourceImages',
      'conversationSessions',
      'conversationProgress',
      'conversationReviewItems',
    ] as const;

    const requiredTables = raw.version === 1 ? v1RequiredTables : v2RequiredTables;

    for (const tableName of requiredTables) {
      const arr = data[tableName];
      if (!Array.isArray(arr)) {
        return createInvalidSummary(
          raw.version,
          raw.exportedAt || '',
          `필수 데이터 테이블('${tableName}')이 누락되었거나 배열 형식이 아닙니다.`
        );
      }
      for (const item of arr) {
        if (!item || typeof item !== 'object') {
          return createInvalidSummary(
            raw.version,
            raw.exportedAt || '',
            `'${tableName}' 테이블에 유효하지 않은(null 또는 비객체) 레코드가 포함되어 있습니다.`
          );
        }
      }
    }

    // 민감한 설정 정보(API Key, 토큰, 계정 정보) 존재 여부 검사
    for (const setting of data.appSettings) {
      if (typeof setting.key === 'string' && SENSITIVE_KEY_PATTERN.test(setting.key)) {
        return createInvalidSummary(
          raw.version,
          raw.exportedAt || '',
          `보안상 허용되지 않는 민감 설정('${setting.key}')이 백업 파일에 포함되어 있습니다.`
        );
      }
    }

    // 레코드 필드 무결성 및 내부 중복 키 검증
    const checkDuplicateKeys = (records: Array<Record<string, unknown>>, keyField: string, tableName: string) => {
      const seen = new Set<unknown>();
      for (const r of records) {
        if (!r || typeof r !== 'object') continue;
        const val = r[keyField];
        if (val !== undefined && val !== null) {
          if (seen.has(val)) {
            throw new Error(`[무결성 오류] 백업 파일 내 ${tableName} 테이블에 중복 키('${val}')가 존재합니다.`);
          }
          seen.add(val);
        }
      }
    };

    checkDuplicateKeys(data.wordBooks as any, 'id', 'wordBooks');
    checkDuplicateKeys(data.words as any, 'id', 'words');
    checkDuplicateKeys(data.wordStats as any, 'wordId', 'wordStats');
    checkDuplicateKeys(data.studyHistory as any, 'id', 'studyHistory');
    checkDuplicateKeys(data.appSettings as any, 'key', 'appSettings');

    if (raw.version >= 2) {
      if (data.questionBooks) checkDuplicateKeys(data.questionBooks as any, 'id', 'questionBooks');
      if (data.questions) checkDuplicateKeys(data.questions as any, 'id', 'questions');
      if (data.questionStudyHistory) checkDuplicateKeys(data.questionStudyHistory as any, 'id', 'questionStudyHistory');
      if (data.questionStats) checkDuplicateKeys(data.questionStats as any, 'questionId', 'questionStats');
      if (data.sourceImages) checkDuplicateKeys(data.sourceImages as any, 'id', 'sourceImages');
      if (data.conversationSessions) checkDuplicateKeys(data.conversationSessions as any, 'sessionId', 'conversationSessions');
      if (data.conversationProgress) checkDuplicateKeys(data.conversationProgress as any, 'lessonId', 'conversationProgress');
      if (data.conversationReviewItems) checkDuplicateKeys(data.conversationReviewItems as any, 'id', 'conversationReviewItems');
    }

    // 개별 레코드 기본 유효성 검사
    for (const w of data.words) {
      if (typeof w.word !== 'string' || w.word.trim().length === 0 || !Array.isArray(w.meaning)) {
        return createInvalidSummary(raw.version, raw.exportedAt || '', '손상된 단어 레코드가 감지되었습니다.');
      }
    }

    if (Array.isArray(data.questions)) {
      const qBookIds = new Set(
        Array.isArray(data.questionBooks)
          ? data.questionBooks.map((b) => b.id).filter(Boolean)
          : []
      );
      for (const q of data.questions) {
        if (typeof q.bookId !== 'string' || typeof q.stem !== 'string' || !Array.isArray(q.choices)) {
          return createInvalidSummary(raw.version, raw.exportedAt || '', '손상된 문제 레코드가 감지되었습니다.');
        }
        if (qBookIds.size > 0 && !qBookIds.has(q.bookId)) {
          return createInvalidSummary(
            raw.version,
            raw.exportedAt || '',
            `외래 참조 오류: questions의 bookId('${q.bookId}')가 questionBooks에 존재하지 않습니다.`
          );
        }
      }
    }

    if (Array.isArray(data.sourceImages)) {
      for (const img of data.sourceImages) {
        if (typeof img.id !== 'string' || typeof img.bookId !== 'string' || typeof img.mimeType !== 'string') {
          return createInvalidSummary(raw.version, raw.exportedAt || '', '손상된 원본 이미지 레코드가 감지되었습니다.');
        }
        if (!img.mimeType.startsWith('image/')) {
          return createInvalidSummary(raw.version, raw.exportedAt || '', `허용되지 않는 이미지 MIME 타입입니다: ${img.mimeType}`);
        }
        if (typeof img.dataUrl === 'string') {
          const match = img.dataUrl.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
          if (!match) {
            return createInvalidSummary(raw.version, raw.exportedAt || '', `손상된 DataURL 형식입니다 (이미지 id: ${img.id})`);
          }
          const urlMime = match[1];
          const base64Data = match[2];
          if (urlMime !== img.mimeType) {
            return createInvalidSummary(raw.version, raw.exportedAt || '', `MIME 타입 불일치 (dataUrl: ${urlMime}, mimeType: ${img.mimeType})`);
          }
          if (!base64Data || base64Data.length === 0) {
            return createInvalidSummary(raw.version, raw.exportedAt || '', `빈 이미지 데이터는 허용되지 않습니다 (id: ${img.id})`);
          }
        }
      }
    }

    if (Array.isArray(data.conversationSessions)) {
      for (const s of data.conversationSessions) {
        if (typeof s.sessionId !== 'string' || typeof s.lessonId !== 'string' || !Array.isArray(s.turns)) {
          return createInvalidSummary(raw.version, raw.exportedAt || '', '손상된 회화 세션 레코드가 감지되었습니다.');
        }
      }
    }

    const wordBooksCount = data.wordBooks.length;
    const wordsCount = data.words.length;
    const studyHistoryCount = data.studyHistory.length;
    const questionBooksCount = Array.isArray(data.questionBooks) ? data.questionBooks.length : 0;
    const questionsCount = Array.isArray(data.questions) ? data.questions.length : 0;
    const conversationSessionsCount = Array.isArray(data.conversationSessions) ? data.conversationSessions.length : 0;
    const conversationProgressCount = Array.isArray(data.conversationProgress) ? data.conversationProgress.length : 0;
    const conversationReviewItemsCount = Array.isArray(data.conversationReviewItems) ? data.conversationReviewItems.length : 0;

    // 메타데이터 일관성 검사 (메타데이터가 명시된 경우 실제 개수와 일치해야 함)
    if (raw.metadata && typeof raw.metadata === 'object') {
      if (
        raw.metadata.wordBooksCount !== undefined &&
        raw.metadata.wordBooksCount !== wordBooksCount
      ) {
        return createInvalidSummary(raw.version, raw.exportedAt || '', '메타데이터와 실제 레코드 개수가 일치하지 않습니다.');
      }
      if (
        raw.metadata.wordsCount !== undefined &&
        raw.metadata.wordsCount !== wordsCount
      ) {
        return createInvalidSummary(raw.version, raw.exportedAt || '', '메타데이터와 실제 레코드 개수가 일치하지 않습니다.');
      }
      if (
        raw.metadata.studyHistoryCount !== undefined &&
        raw.metadata.studyHistoryCount !== studyHistoryCount
      ) {
        return createInvalidSummary(raw.version, raw.exportedAt || '', '메타데이터와 실제 레코드 개수가 일치하지 않습니다.');
      }
    }

    return {
      valid: true,
      version: raw.version,
      exportedAt: raw.exportedAt || '알 수 없음',
      wordBooksCount,
      wordsCount,
      studyHistoryCount,
      questionBooksCount,
      questionsCount,
      conversationSessionsCount,
      conversationProgressCount,
      conversationReviewItemsCount,
    };
  } catch (err) {
    return createInvalidSummary(
      0,
      '',
      err instanceof Error ? err.message : '백업 파일 검증 중 예외가 발생했습니다.'
    );
  }
}

/**
 * 백업 데이터를 IndexedDB에 복원 (v1/v2 완전 호환, 원자적 단일 쓰기 트랜잭션, 멱등 머지 및 충돌 감지)
 */
export async function restoreBackupData(
  backup: BackupFileStructure,
  mode: 'merge' | 'replace' = 'merge',
  customDb?: ToeicStudyDatabase
): Promise<RestoreResult> {
  const summary = validateBackupFile(backup);
  if (!summary.valid) {
    throw new Error(summary.errorMessage || '백업 파일 검증 실패');
  }

  const targetDb = customDb || db;

  // 트랜잭션 진입 전 DataURL -> Blob 디코딩 및 기존 SourceImage 캐시 준비 (트랜잭션 타임아웃 방지)
  let reconstructedImages: SourceImage[] = [];
  if (Array.isArray(backup.data.sourceImages)) {
    reconstructedImages = backup.data.sourceImages.map((sImg) => {
      let blob: Blob | undefined;
      if (sImg.dataUrl) {
        blob = dataUrlToBlob(sImg.dataUrl, sImg.mimeType);
      }
      return {
        id: sImg.id,
        bookId: sImg.bookId,
        page: sImg.page,
        mimeType: sImg.mimeType,
        dataUrl: sImg.dataUrl,
        blob,
        createdAt: sImg.createdAt,
      };
    });
  }

  // 머지 모드일 때 기존 DB의 SourceImage 캐시를 트랜잭션 밖에서 미리 준비 (원본 blob만 있는 경우 base64 변환)
  const existingImagesMap = new Map<string, { mimeType: string; dataUrl: string }>();
  if (mode === 'merge' && reconstructedImages.length > 0) {
    const existingSourceImages = await targetDb.sourceImages.toArray();
    for (const exImg of existingSourceImages) {
      let dataUrl = exImg.dataUrl;
      if (!dataUrl && exImg.blob) {
        dataUrl = await blobToDataUrl(exImg.blob, exImg.mimeType);
      }
      if (dataUrl) {
        existingImagesMap.set(exImg.id, { mimeType: exImg.mimeType, dataUrl });
      }
    }
  }

  const v1Tables: Table<any, any>[] = [
    targetDb.wordBooks,
    targetDb.words,
    targetDb.wordStats,
    targetDb.studyHistory,
    targetDb.appSettings,
  ];

  const v2v3Tables: Table<any, any>[] = [
    targetDb.questionBooks,
    targetDb.questions,
    targetDb.questionStudyHistory,
    targetDb.questionStats,
    targetDb.sourceImages,
    targetDb.conversationSessions,
    targetDb.conversationProgress,
    targetDb.conversationReviewItems,
  ];

  const allTables = [...v1Tables, ...v2v3Tables];

  // 단일 쓰기 트랜잭션 실행
  const result = await targetDb.transaction('rw', allTables, async () => {
    // 1. 교체(replace) 모드 처리
    if (mode === 'replace') {
      if (backup.version === 1) {
        // v1 replace는 오직 v1 테이블만 초기화하여 v2/v3 기존 데이터 보존
        await Promise.all(v1Tables.map((t) => t.clear()));
      } else {
        // v2 replace는 전체 13개 테이블 초기화
        await Promise.all(allTables.map((t) => t.clear()));
      }
    }

    let restoredWords = 0;
    let restoredBooks = 0;
    let restoredQuestions = 0;
    let restoredSessions = 0;
    let skippedCount = 0;

    /**
     * 개별 테이블 레코드 복원 헬퍼
     * - merge 모드: 동일 키 동일 값은 skip (멱등성 보장, 2회 복원 시 중복 0), 상이한 값은 Error 투척 (전체 롤백)
     * - replace 모드: put으로 신규 저장
     */
    async function restoreTableRecords<T extends Record<string, any>>(
      table: Table<T, any>,
      tableName: string,
      records: T[] | undefined,
      keyField: string
    ): Promise<number> {
      if (!Array.isArray(records) || records.length === 0) return 0;

      let added = 0;
      for (const record of records) {
        const keyValue = record[keyField];

        if (mode === 'replace') {
          await table.put(record);
          added++;
          continue;
        }

        // Merge 모드
        if (keyValue !== undefined && keyValue !== null) {
          const existing = await table.get(keyValue);
          if (existing) {
            // sourceImages 전용 바이트 레벨 일치 검사
            if (tableName === 'sourceImages') {
              const cachedExisting = existingImagesMap.get(keyValue);
              if (cachedExisting && record.dataUrl) {
                if (
                  cachedExisting.dataUrl === record.dataUrl &&
                  cachedExisting.mimeType === record.mimeType
                ) {
                  skippedCount++;
                  continue;
                } else {
                  throw new Error(
                    `[데이터 복원 충돌] sourceImages 테이블의 키 '${keyValue}'의 이미지 내용이 상이합니다. 원자적 롤백이 수행됩니다.`
                  );
                }
              }
            }

            if (areRecordsEqual(existing, record)) {
              // 동일 키 & 동일 값 -> 멱등 스킵
              skippedCount++;
              continue;
            } else {
              // 동일 키 & 상이한 값 -> 충돌 발생, 전체 원자적 롤백
              throw new Error(
                `[데이터 복원 충돌] ${tableName} 테이블의 키 '${keyValue}'에 이미 상이한 데이터가 존재합니다. 복원 작업이 전체 롤백됩니다.`
              );
            }
          } else {
            await table.put(record);
            added++;
          }
        } else {
          // 명시적 키가 없는 자동증가 레코드(예: v1 WordEntry)의 경우 동일 내용 기등록 여부 검사
          if (tableName === 'words' && record.word) {
            const existingWord = await targetDb.words.where('word').equals(record.word).first();
            if (existingWord) {
              if (areRecordsEqual(existingWord, record)) {
                skippedCount++;
                continue;
              } else {
                throw new Error(
                  `[데이터 복원 충돌] words 테이블의 단어 '${record.word}'에 상이한 레코드가 이미 존재합니다. 복원 작업이 전체 롤백됩니다.`
                );
              }
            }
          }
          await table.add(record);
          added++;
        }
      }
      return added;
    }

    // 2. v1 테이블 복원
    restoredBooks += await restoreTableRecords(targetDb.wordBooks, 'wordBooks', backup.data.wordBooks, 'id');
    restoredWords += await restoreTableRecords(targetDb.words, 'words', backup.data.words, 'id');
    await restoreTableRecords(targetDb.wordStats, 'wordStats', backup.data.wordStats, 'wordId');
    await restoreTableRecords(targetDb.studyHistory, 'studyHistory', backup.data.studyHistory, 'id');
    await restoreTableRecords(targetDb.appSettings, 'appSettings', backup.data.appSettings, 'key');

    // 3. v2/v3 테이블 복원 (백업 버전 2 이상이고 해당 데이터가 존재하는 경우에만 복원)
    if (backup.version >= 2) {
      if (backup.data.questionBooks) {
        restoredBooks += await restoreTableRecords(targetDb.questionBooks, 'questionBooks', backup.data.questionBooks, 'id');
      }
      if (backup.data.questions) {
        restoredQuestions += await restoreTableRecords(targetDb.questions, 'questions', backup.data.questions, 'id');
      }
      if (backup.data.questionStudyHistory) {
        await restoreTableRecords(targetDb.questionStudyHistory, 'questionStudyHistory', backup.data.questionStudyHistory, 'id');
      }
      if (backup.data.questionStats) {
        await restoreTableRecords(targetDb.questionStats, 'questionStats', backup.data.questionStats, 'questionId');
      }
      if (reconstructedImages.length > 0) {
        await restoreTableRecords(targetDb.sourceImages, 'sourceImages', reconstructedImages, 'id');
      }

      if (backup.data.conversationSessions) {
        restoredSessions += await restoreTableRecords(targetDb.conversationSessions, 'conversationSessions', backup.data.conversationSessions, 'sessionId');
      }
      if (backup.data.conversationProgress) {
        await restoreTableRecords(targetDb.conversationProgress, 'conversationProgress', backup.data.conversationProgress, 'lessonId');
      }
      if (backup.data.conversationReviewItems) {
        await restoreTableRecords(targetDb.conversationReviewItems, 'conversationReviewItems', backup.data.conversationReviewItems, 'id');
      }
    }

    return {
      success: true,
      restoredWords,
      restoredBooks,
      restoredQuestions,
      restoredSessions,
      skippedCount,
    };
  });

  // 안전한 오답노트 로컬 캐시 동기화 (사용자 프로필이나 장치 정보 제외)
  if (
    typeof window !== 'undefined' &&
    typeof localStorage !== 'undefined' &&
    Array.isArray(backup.data.wrongNotesCache)
  ) {
    try {
      localStorage.setItem('voca_study_wrong_notes_v1', JSON.stringify(backup.data.wrongNotesCache));
    } catch {
      // 캐시 동기화 실패는 치명적이지 않으므로 무시
    }
  }

  return result;
}
