// tests/backupV2.test.ts
// 백업 포맷 v2 및 v1 호환성, 원자적 롤백, 멱등 머지, Blob 직렬화 검증

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { ToeicStudyDatabase } from '../src/storage/db';
import {
  exportBackupData,
  restoreBackupData,
  validateBackupFile,
  BACKUP_FORMAT_IDENTIFIER,
  CURRENT_BACKUP_VERSION,
  type BackupFileStructure,
} from '../src/storage/backupService';

describe('데이터 백업 v2 및 무손실 복원 격리 테스트', () => {
  const SOURCE_DB_NAME = 'TestBackupV2_Source';
  const TARGET_DB_NAME = 'TestBackupV2_Target';

  beforeEach(async () => {
    await Dexie.delete(SOURCE_DB_NAME);
    await Dexie.delete(TARGET_DB_NAME);
  });

  afterEach(async () => {
    await Dexie.delete(SOURCE_DB_NAME);
    await Dexie.delete(TARGET_DB_NAME);
  });

  it('13개 전체 테이블 데이터 및 Blob 이미지를 포함한 v2 백업/복원 라운드트립이 무손실로 동작해야 한다', async () => {
    const sourceDb = new ToeicStudyDatabase(SOURCE_DB_NAME);
    await sourceDb.open();

    // 1. v1 데이터 삽입
    await sourceDb.wordBooks.put({
      id: 'wb-1',
      title: '토익 필수 1000',
      sourceType: 'BUILTIN',
      wordCount: 1,
      createdAt: '2026-10-01T00:00:00Z',
    });
    await sourceDb.words.put({
      id: 'w-1',
      word: 'collaborate',
      meaning: ['협력하다'],
      partOfSpeech: 'verb',
      difficulty: 'medium',
      topic: 'business',
      sourceBookId: 'wb-1',
    });
    await sourceDb.appSettings.put({
      key: 'theme_mode',
      value: 'dark',
    });

    // 2. v2 문제 데이터 삽입 (Blob 이미지 포함)
    await sourceDb.questionBooks.put({
      id: 'qb-1',
      title: '토익 파트 5 실전',
      sourceType: 'IMAGE',
      questionType: 'MULTIPLE_CHOICE',
      questionCount: 1,
      createdAt: '2026-10-02T00:00:00Z',
    });
    await sourceDb.questions.put({
      id: 'q-1',
      bookId: 'qb-1',
      stem: 'Ms. Smith asked everyone to ----- closely.',
      choiceCount: 4,
      choices: [
        { id: 'c1', sourceLabel: 'A', text: 'collaborate' },
        { id: 'c2', sourceLabel: 'B', text: 'collaborates' },
        { id: 'c3', sourceLabel: 'C', text: 'collaborating' },
        { id: 'c4', sourceLabel: 'D', text: 'collaboration' },
      ],
      correctChoiceId: 'c1',
      answerStatus: 'verified',
      questionConfidence: 'high',
      choicesConfidence: 'high',
      answerConfidence: 'high',
      isUserConfirmed: true,
      createdAt: '2026-10-02T00:00:00Z',
    });

    const fakeImageBuffer = Buffer.from('fake-png-binary-content-12345');
    const fakeBlob = new Blob([fakeImageBuffer], { type: 'image/png' });

    await sourceDb.sourceImages.put({
      id: 'img-1',
      bookId: 'qb-1',
      mimeType: 'image/png',
      blob: fakeBlob,
      createdAt: '2026-10-02T00:00:00Z',
    });

    // 3. v3 회화 데이터 삽입
    await sourceDb.conversationSessions.put({
      sessionId: 'sess-1',
      lessonId: 'intro-u01-l01',
      contentRevision: 1,
      level: 'intro',
      phase: 'roleplay',
      currentTaskIndex: 2,
      draftUtterance: 'Hi there',
      hintLevel: 0,
      observedObjectives: {
        'obj-intro-01': {
          objectiveId: 'obj-intro-01',
          evidences: [
            {
              situationContext: 'practice',
              userResponse: 'Hi there',
              usedHint: false,
              observedAt: '2026-10-03T00:00:30Z',
            },
          ],
          isMasteredByRule: false,
        },
      },
      completedTaskIds: ['task_practice'],
      isCompleted: false,
      rulePassed: false,
      sessionStartedAt: '2026-10-03T00:00:00Z',
      lastActiveAt: '2026-10-03T00:01:00Z',
      turns: [
        {
          turnId: 't-1',
          speaker: 'user',
          text: 'Hello!',
          timestamp: '2026-10-03T00:00:00Z',
        },
      ],
    });
    await sourceDb.conversationProgress.put({
      lessonId: 'intro-u01-l01',
      level: 'intro',
      unitNumber: 1,
      lessonNumber: 1,
      status: 'in_progress',
      contentRevision: 1,
      masteredObjectiveIds: [],
      totalStudySeconds: 120,
      lastStudiedAt: '2026-10-03T00:01:00Z',
    });
    await sourceDb.conversationReviewItems.put({
      id: 'rev-1',
      lessonId: 'intro-u01-l01',
      expressionEn: 'Good morning',
      meaningKo: '좋은 아침입니다',
      targetObjectiveId: 'obj-intro-01',
      repetitionCount: 1,
      intervalDays: 1,
      nextReviewDate: '2026-10-04',
      lastReviewedAt: '2026-10-03T00:01:00Z',
      consecutiveSuccessCount: 1,
      isDue: false,
    });

    // 백업 추출
    const backup = await exportBackupData(sourceDb);
    expect(backup.format).toBe(BACKUP_FORMAT_IDENTIFIER);
    expect(backup.version).toBe(CURRENT_BACKUP_VERSION);
    expect(backup.data.sourceImages?.[0].dataUrl).toContain('data:image/png;base64,');

    const validation = validateBackupFile(backup);
    expect(validation.valid).toBe(true);
    expect(validation.wordsCount).toBe(1);
    expect(validation.questionBooksCount).toBe(1);
    expect(validation.conversationSessionsCount).toBe(1);

    // 대상 DB에 복원
    const targetDb = new ToeicStudyDatabase(TARGET_DB_NAME);
    await targetDb.open();

    const restoreResult = await restoreBackupData(backup, 'replace', targetDb);
    expect(restoreResult.success).toBe(true);

    // 대상 DB 내용 확인
    const restoredWords = await targetDb.words.toArray();
    expect(restoredWords.length).toBe(1);
    expect(restoredWords[0].word).toBe('collaborate');

    const restoredQuestions = await targetDb.questions.toArray();
    expect(restoredQuestions.length).toBe(1);
    expect(restoredQuestions[0].choices[0].text).toBe('collaborate');

    const restoredImages = await targetDb.sourceImages.toArray();
    expect(restoredImages.length).toBe(1);
    expect(restoredImages[0].id).toBe('img-1');
    expect(restoredImages[0].blob).toBeDefined();

    const restoredSessions = await targetDb.conversationSessions.toArray();
    expect(restoredSessions.length).toBe(1);
    expect(restoredSessions[0].sessionId).toBe('sess-1');

    sourceDb.close();
    targetDb.close();
  });

  it('동일한 백업을 2회 연속 merge 복원해도 중복 레코드가 발생하지 않아야 한다 (멱등성)', async () => {
    const targetDb = new ToeicStudyDatabase(TARGET_DB_NAME);
    await targetDb.open();

    const backup: BackupFileStructure = {
      format: BACKUP_FORMAT_IDENTIFIER,
      version: 2,
      exportedAt: new Date().toISOString(),
      metadata: {
        wordBooksCount: 1,
        wordsCount: 1,
        studyHistoryCount: 0,
        questionBooksCount: 0,
        questionsCount: 0,
        conversationSessionsCount: 0,
        conversationProgressCount: 0,
        conversationReviewItemsCount: 0,
      },
      data: {
        wordBooks: [
          {
            id: 'wb-test',
            title: '단어장',
            sourceType: 'BUILTIN',
            wordCount: 1,
            createdAt: '2026-10-01T00:00:00Z',
          },
        ],
        words: [
          {
            id: 'w-test',
            word: 'schedule',
            meaning: ['일정을 잡다'],
            partOfSpeech: 'verb',
            difficulty: 'low',
            topic: 'business',
            sourceBookId: 'wb-test',
          },
        ],
        wordStats: [],
        studyHistory: [],
        appSettings: [],
        questionBooks: [],
        questions: [],
        questionStudyHistory: [],
        questionStats: [],
        sourceImages: [],
        conversationSessions: [],
        conversationProgress: [],
        conversationReviewItems: [],
      },
    };

    // 1회차 머지
    const res1 = await restoreBackupData(backup, 'merge', targetDb);
    expect(res1.success).toBe(true);
    expect(res1.restoredWords).toBe(1);

    // 2회차 머지
    const res2 = await restoreBackupData(backup, 'merge', targetDb);
    expect(res2.success).toBe(true);
    expect(res2.restoredWords).toBe(0);
    expect(res2.skippedCount).toBe(2); // 1 book + 1 word

    const words = await targetDb.words.toArray();
    expect(words.length).toBe(1);

    targetDb.close();
  });

  it('raw Blob만 존재하는 원본 DB에 자체 백업을 merge할 때 dataUrl 부재로 인한 충돌 없이 멱등 스킵되어야 한다', async () => {
    const targetDb = new ToeicStudyDatabase(TARGET_DB_NAME);
    await targetDb.open();

    const fakeImageBuffer = Buffer.from('my-png-raw-bytes-67890');
    const fakeBlob = new Blob([fakeImageBuffer], { type: 'image/png' });

    await targetDb.questionBooks.put({
      id: 'qb-raw',
      title: '이미지 문제집',
      sourceType: 'IMAGE',
      questionType: 'MULTIPLE_CHOICE',
      questionCount: 1,
      createdAt: '2026-10-01T00:00:00Z',
    });

    // DB에는 dataUrl 없이 오직 blob만 저장됨
    await targetDb.sourceImages.put({
      id: 'img-raw-1',
      bookId: 'qb-raw',
      mimeType: 'image/png',
      blob: fakeBlob,
      createdAt: '2026-10-01T00:00:00Z',
    });

    // 백업 추출 (blob -> dataUrl 변환됨)
    const backup = await exportBackupData(targetDb);
    expect(backup.data.sourceImages?.[0].dataUrl).toBeDefined();

    // 자기 자신에게 머지 복원 수행
    const mergeResult = await restoreBackupData(backup, 'merge', targetDb);
    expect(mergeResult.success).toBe(true);
    expect(mergeResult.skippedCount).toBeGreaterThan(0);

    const images = await targetDb.sourceImages.toArray();
    expect(images.length).toBe(1);
    expect(images[0].id).toBe('img-raw-1');

    targetDb.close();
  });

  it('merge 복원 중 동일 키에 상이한 데이터가 충돌하면 전체 롤백되고 기존 데이터를 덮어쓰지 않아야 한다', async () => {
    const targetDb = new ToeicStudyDatabase(TARGET_DB_NAME);
    await targetDb.open();

    // 기존 단어 삽입
    await targetDb.words.put({
      id: 'w-conflict',
      word: 'existing_word',
      meaning: ['기존의미'],
      partOfSpeech: 'noun',
      difficulty: 'low',
      topic: 'test',
    });

    const conflictingBackup: BackupFileStructure = {
      format: BACKUP_FORMAT_IDENTIFIER,
      version: 2,
      exportedAt: new Date().toISOString(),
      metadata: {
        wordBooksCount: 0,
        wordsCount: 2,
        studyHistoryCount: 0,
        questionBooksCount: 0,
        questionsCount: 0,
        conversationSessionsCount: 0,
        conversationProgressCount: 0,
        conversationReviewItemsCount: 0,
      },
      data: {
        wordBooks: [],
        words: [
          {
            id: 'w-new',
            word: 'new_word',
            meaning: ['새의미'],
            partOfSpeech: 'verb',
            difficulty: 'high',
            topic: 'test',
          },
          {
            id: 'w-conflict',
            word: 'conflicting_word_value', // 다른 값 충돌!
            meaning: ['충돌의미'],
            partOfSpeech: 'adverb',
            difficulty: 'medium',
            topic: 'test',
          },
        ],
        wordStats: [],
        studyHistory: [],
        appSettings: [],
        questionBooks: [],
        questions: [],
        questionStudyHistory: [],
        questionStats: [],
        sourceImages: [],
        conversationSessions: [],
        conversationProgress: [],
        conversationReviewItems: [],
      },
    };

    await expect(
      restoreBackupData(conflictingBackup, 'merge', targetDb)
    ).rejects.toThrow('데이터 복원 충돌');

    // 충돌 시 원자적 롤백 확인: w-new도 추가되지 않고 w-conflict도 원래 상태 유지
    const words = await targetDb.words.toArray();
    expect(words.length).toBe(1);
    expect(words[0].word).toBe('existing_word');

    targetDb.close();
  });

  it('v1 백업을 replace 모드로 복원할 때 기존 v2/v3 데이터는 파괴되지 않고 v1 테이블만 교체되어야 한다', async () => {
    const targetDb = new ToeicStudyDatabase(TARGET_DB_NAME);
    await targetDb.open();

    // 기존 v1 데이터
    await targetDb.words.put({
      id: 'old-word',
      word: 'old',
      meaning: ['옛날의'],
      partOfSpeech: 'adj',
      difficulty: 'low',
      topic: 'general',
    });

    // 기존 v2 문제 데이터 및 v3 회화 데이터
    await targetDb.questionBooks.put({
      id: 'preserve-qb',
      title: '보존되어야 하는 문제집',
      sourceType: 'PDF',
      questionType: 'MULTIPLE_CHOICE',
      questionCount: 1,
      createdAt: '2026-10-01T00:00:00Z',
    });
    await targetDb.conversationSessions.put({
      sessionId: 'preserve-session',
      lessonId: 'intro-u01-l01',
      contentRevision: 1,
      level: 'intro',
      phase: 'intro',
      currentTaskIndex: 0,
      hintLevel: 0,
      observedObjectives: {},
      completedTaskIds: [],
      isCompleted: false,
      rulePassed: false,
      sessionStartedAt: '2026-10-01T00:00:00Z',
      lastActiveAt: '2026-10-01T00:00:00Z',
      turns: [],
    });

    // v1 형식 백업 파일
    const v1Backup: BackupFileStructure = {
      format: BACKUP_FORMAT_IDENTIFIER,
      version: 1,
      exportedAt: new Date().toISOString(),
      metadata: {
        wordBooksCount: 0,
        wordsCount: 1,
        studyHistoryCount: 0,
      },
      data: {
        wordBooks: [],
        words: [
          {
            id: 'new-v1-word',
            word: 'recent',
            meaning: ['최신의'],
            partOfSpeech: 'adj',
            difficulty: 'low',
            topic: 'general',
          },
        ],
        wordStats: [],
        studyHistory: [],
        appSettings: [],
      },
    };

    await restoreBackupData(v1Backup, 'replace', targetDb);

    // v1 테이블은 교체됨
    const words = await targetDb.words.toArray();
    expect(words.length).toBe(1);
    expect(words[0].id).toBe('new-v1-word');

    // v2/v3 테이블은 그대로 보존됨
    const qBooks = await targetDb.questionBooks.toArray();
    expect(qBooks.length).toBe(1);
    expect(qBooks[0].id).toBe('preserve-qb');

    const sessions = await targetDb.conversationSessions.toArray();
    expect(sessions.length).toBe(1);
    expect(sessions[0].sessionId).toBe('preserve-session');

    targetDb.close();
  });

  it('v2 데이터베이스에서 v3 업그레이드 시 기존 v1/v2 데이터가 100% 무손실 보존되어야 한다', async () => {
    const MIGRATION_DB_NAME = 'Test_v2_to_v3_Migration';
    await Dexie.delete(MIGRATION_DB_NAME);

    // 1. 순수 v2 데이터베이스 인스턴스로 오픈하여 데이터 삽입
    const v2Db = new Dexie(MIGRATION_DB_NAME);
    v2Db.version(1).stores({
      words: '++id, word, partOfSpeech, difficulty, topic, sourceBookId, confidence',
      wordBooks: '++id, title, sourceType, createdAt',
      studyHistory: '++id, wordId, isCorrect, studiedAt',
      wordStats: 'wordId, learningStatus, totalCount, wrongCount, lastStudiedAt',
      appSettings: 'key',
    });
    v2Db.version(2).stores({
      questionBooks: '++id, title, sourceType, questionType, createdAt',
      questions: '++id, bookId, questionNumber, answerStatus, isUserConfirmed, createdAt',
      questionStudyHistory: '++id, questionId, bookId, isCorrect, studiedAt',
      questionStats: 'questionId, bookId, totalCount, wrongCount, lastStudiedAt',
      sourceImages: 'id, bookId, createdAt',
    });
    await v2Db.open();

    await v2Db.table('words').put({ id: 'w-mig-1', word: 'retain', meaning: ['유지하다'] });
    await v2Db.table('questionBooks').put({ id: 'qb-mig-1', title: '보존 문제집' });
    v2Db.close();

    // 2. ToeicStudyDatabase (v3 포함)로 동일 DB 오픈하여 마이그레이션 확인
    const v3Db = new ToeicStudyDatabase(MIGRATION_DB_NAME);
    await v3Db.open();

    const savedWords = await v3Db.words.toArray();
    expect(savedWords.length).toBe(1);
    expect(savedWords[0].word).toBe('retain');

    const savedQBooks = await v3Db.questionBooks.toArray();
    expect(savedQBooks.length).toBe(1);
    expect(savedQBooks[0].title).toBe('보존 문제집');

    // v3 테이블 사용 가능 확인
    const convCount = await v3Db.conversationSessions.count();
    expect(convCount).toBe(0);

    v3Db.close();
    await Dexie.delete(MIGRATION_DB_NAME);
  });

  it('API 키나 비밀 토큰 등 민감한 설정이 포함된 백업 파일은 검증 단계에서 거부되어야 한다', () => {
    const maliciousBackup = {
      format: BACKUP_FORMAT_IDENTIFIER,
      version: 2,
      exportedAt: new Date().toISOString(),
      metadata: {
        wordBooksCount: 0,
        wordsCount: 1,
        studyHistoryCount: 0,
        questionBooksCount: 0,
        questionsCount: 0,
        conversationSessionsCount: 0,
        conversationProgressCount: 0,
        conversationReviewItemsCount: 0,
      },
      data: {
        wordBooks: [],
        words: [
          {
            id: 'w1',
            word: 'test',
            meaning: ['시험'],
            partOfSpeech: 'noun',
            difficulty: 'low',
            topic: 'test',
          },
        ],
        wordStats: [],
        studyHistory: [],
        appSettings: [
          {
            key: 'gemini_api_key',
            value: 'AIzaSySecretApiKey',
          },
        ],
        questionBooks: [],
        questions: [],
        questionStudyHistory: [],
        questionStats: [],
        sourceImages: [],
        conversationSessions: [],
        conversationProgress: [],
        conversationReviewItems: [],
      },
    };

    const summary = validateBackupFile(maliciousBackup);
    expect(summary.valid).toBe(false);
    expect(summary.errorMessage).toContain('민감 설정');
  });

  it('백업 파일 내부에 중복된 ID 키가 존재하면 손상된 파일로 판단하여 거부해야 한다', () => {
    const duplicateKeyBackup = {
      format: BACKUP_FORMAT_IDENTIFIER,
      version: 2,
      exportedAt: new Date().toISOString(),
      metadata: {
        wordBooksCount: 0,
        wordsCount: 0,
        studyHistoryCount: 0,
        questionBooksCount: 0,
        questionsCount: 0,
        conversationSessionsCount: 2,
        conversationProgressCount: 0,
        conversationReviewItemsCount: 0,
      },
      data: {
        wordBooks: [],
        words: [],
        wordStats: [],
        studyHistory: [],
        appSettings: [],
        questionBooks: [],
        questions: [],
        questionStudyHistory: [],
        questionStats: [],
        sourceImages: [],
        conversationSessions: [
          {
            sessionId: 'dup-sess-id',
            lessonId: 'L1',
            contentRevision: 1,
            phase: 'intro',
            turns: [],
          },
          {
            sessionId: 'dup-sess-id', // 중복!
            lessonId: 'L2',
            contentRevision: 1,
            phase: 'intro',
            turns: [],
          },
        ],
        conversationProgress: [],
        conversationReviewItems: [],
      },
    };

    const summary = validateBackupFile(duplicateKeyBackup);
    expect(summary.valid).toBe(false);
    expect(summary.errorMessage).toContain('중복 키');
  });
});
