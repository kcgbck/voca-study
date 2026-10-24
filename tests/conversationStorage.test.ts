// tests/conversationStorage.test.ts
// AI 회화 세션, 진도, 복습 큐, 설정 로컬 IndexedDB 저장소 서비스 격리 단위 테스트

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { ToeicStudyDatabase } from '../src/storage/db';
import { ConversationStorageService } from '../src/features/conversation/services/storageService';
import { getLessonById } from '../src/features/conversation/content/lessons';
import { LessonStateMachine } from '../src/features/conversation/engine/lessonStateMachine';
import type { LessonContent } from '../src/features/conversation/types';

describe('AI 회화 데이터 계층 (ConversationStorageService) 격리 테스트', () => {
  const TEST_DB_NAME = 'TestConversationStorageDb';
  let testDb: ToeicStudyDatabase;
  let service: ConversationStorageService;
  let realLesson: LessonContent;

  beforeEach(async () => {
    await Dexie.delete(TEST_DB_NAME);
    testDb = new ToeicStudyDatabase(TEST_DB_NAME);
    await testDb.open();
    service = new ConversationStorageService(testDb);

    const lesson = getLessonById('intro-u01-l01');
    if (!lesson) {
      throw new Error('실제 수업 intro-u01-l01을 찾을 수 없습니다.');
    }
    realLesson = lesson;
  });

  afterEach(async () => {
    testDb.close();
    await Dexie.delete(TEST_DB_NAME);
  });

  it('세션 저장 및 진행 중인 세션 이어하기 조회가 정상 동작해야 한다', async () => {
    const session = LessonStateMachine.createSession(realLesson, 'sess-resume-01');
    session.phase = 'practice';
    session.currentTaskIndex = 1;
    session.hintLevel = 1;
    session.draftUtterance = 'Hello, I am...';
    session.turns = [
      {
        turnId: 't-1',
        speaker: 'tutor',
        text: 'Welcome!',
        timestamp: '2026-10-21T10:00:00Z',
      },
      {
        turnId: 't-2',
        speaker: 'user',
        text: 'Hi there.',
        timestamp: '2026-10-21T10:00:10Z',
      },
    ];

    await service.saveSession(session);

    const active = await service.getActiveSession(realLesson.id);
    expect(active).toBeDefined();
    expect(active?.sessionId).toBe('sess-resume-01');
    expect(active?.phase).toBe('practice');
    expect(active?.draftUtterance).toBe('Hello, I am...');
    expect(active?.turns.length).toBe(2);

    // 완료된 세션은 getActiveSession에서 제외되는지 확인
    session.isCompleted = true;
    session.completedAt = '2026-10-21T10:05:00Z';
    await service.saveSession(session);

    const activeAfterComplete = await service.getActiveSession(realLesson.id);
    expect(activeAfterComplete).toBeUndefined();
  });

  it('동일 세션 완료를 반복 호출해도 중복 복습 아이템이나 학습 시간 누적이 발생하지 않아야 한다 (멱등성)', async () => {
    const session = LessonStateMachine.createSession(realLesson, 'sess-idempotent-01');
    session.sessionStartedAt = '2026-10-21T10:00:00Z';
    session.completedAt = '2026-10-21T10:03:00Z'; // 180초 소요
    session.isCompleted = true;

    // 1개 목표에 대해 서로 다른 2개 상황의 노힌트 증거 등록
    const targetObjId = realLesson.learningObjectives[0].id;
    session.observedObjectives[targetObjId] = {
      objectiveId: targetObjId,
      evidences: [
        {
          situationContext: 'practice',
          userResponse: 'Hello, nice to meet you.',
          usedHint: false,
          observedAt: '2026-10-21T10:01:00Z',
        },
        {
          situationContext: 'transfer',
          userResponse: 'Good morning, nice to meet you.',
          usedHint: false,
          observedAt: '2026-10-21T10:02:30Z',
        },
      ],
      isMasteredByRule: true,
    };

    // 1회 완료 호출
    const firstResult = await service.completeSession(session, realLesson);
    expect(firstResult.progress.masteredObjectiveIds).toContain(targetObjId);
    expect(firstResult.progress.totalStudySeconds).toBe(180);
    const firstReviewsCount = firstResult.createdReviews.length;

    // 2회 동일 세션 완료 호출
    const secondResult = await service.completeSession(session, realLesson);
    expect(secondResult.createdReviews.length).toBe(0); // 중복 생성 0개
    expect(secondResult.progress.totalStudySeconds).toBe(180); // 시간 추가 누적 없음!

    // DB 내 실제 개수 확인
    const allProgress = await service.getAllProgress();
    expect(allProgress.length).toBe(1);

    const allReviews = await testDb.conversationReviewItems.toArray();
    expect(allReviews.length).toBe(firstReviewsCount);
  });

  it('서로 다른 2개 상황의 노힌트 발화 증거가 충족된 목표만 마스터로 판정되어야 한다', async () => {
    const session = LessonStateMachine.createSession(realLesson, 'sess-evidence-check');
    session.sessionStartedAt = '2026-10-21T10:00:00Z';
    session.completedAt = '2026-10-21T10:05:00Z';
    session.isCompleted = true;

    const [obj1, obj2] = realLesson.learningObjectives;

    // obj1: 2개 서로 다른 상황 노힌트 발화 충족
    session.observedObjectives[obj1.id] = {
      objectiveId: obj1.id,
      evidences: [
        {
          situationContext: 'controlled_practice',
          userResponse: 'Hello there',
          usedHint: false,
          observedAt: '2026-10-21T10:01:00Z',
        },
        {
          situationContext: 'transfer_assessment',
          userResponse: 'Hello there',
          usedHint: false,
          observedAt: '2026-10-21T10:03:00Z',
        },
      ],
      isMasteredByRule: true,
    };

    // obj2: 1개 상황만 존재 (불리언만 true로 조작)
    session.observedObjectives[obj2.id] = {
      objectiveId: obj2.id,
      evidences: [
        {
          situationContext: 'controlled_practice',
          userResponse: 'I am Alex',
          usedHint: false,
          observedAt: '2026-10-21T10:02:00Z',
        },
      ],
      isMasteredByRule: true, // 조작된 불리언
    };

    const { progress } = await service.completeSession(session, realLesson);
    expect(progress.masteredObjectiveIds).toContain(obj1.id);
    expect(progress.masteredObjectiveIds).not.toContain(obj2.id); // 증거 부족으로 마스터 불가
  });

  it('복습 결과 기록 시 성공과 실패가 올바르게 스케줄링되며 당일 중복 호출을 방어해야 한다', async () => {
    const reviewId = 'rev-test-schedule-1';
    await testDb.conversationReviewItems.put({
      id: reviewId,
      lessonId: realLesson.id,
      expressionEn: 'Nice to meet you.',
      meaningKo: '만나서 반갑습니다.',
      targetObjectiveId: realLesson.learningObjectives[0].id,
      repetitionCount: 0,
      intervalDays: 1,
      nextReviewDate: '2026-10-22',
      consecutiveSuccessCount: 0,
      isDue: false,
    });

    const day1 = new Date('2026-10-22T09:00:00Z');

    // 1차 성공 -> interval 3일
    const after1st = await service.recordReviewResult(reviewId, true, day1);
    expect(after1st.repetitionCount).toBe(1);
    expect(after1st.intervalDays).toBe(3);
    expect(after1st.consecutiveSuccessCount).toBe(1);

    // 당일 중복 클릭 방어 -> interval/repetition 증가 없이 현재 상태 반환
    const duplicateClick = await service.recordReviewResult(reviewId, true, day1);
    expect(duplicateClick.repetitionCount).toBe(1);
    expect(duplicateClick.intervalDays).toBe(3);

    // 다음 복습 일자(3일 후)에 2차 성공 -> interval 7일
    const day2 = new Date('2026-10-25T09:00:00Z');
    const after2nd = await service.recordReviewResult(reviewId, true, day2);
    expect(after2nd.repetitionCount).toBe(2);
    expect(after2nd.intervalDays).toBe(7);

    // 실패 시 즉시 1일로 단축
    const day3 = new Date('2026-11-01T09:00:00Z');
    const afterFail = await service.recordReviewResult(reviewId, false, day3);
    expect(afterFail.intervalDays).toBe(1);
    expect(afterFail.consecutiveSuccessCount).toBe(0);
  });

  it('오늘 날짜 기준 Due 복습 아이템 목록 조회가 정확해야 한다', async () => {
    await testDb.conversationReviewItems.bulkPut([
      {
        id: 'rev-due-item-1',
        lessonId: realLesson.id,
        expressionEn: 'Due expr',
        meaningKo: '오늘 복습 대상',
        targetObjectiveId: 'obj-1',
        repetitionCount: 1,
        intervalDays: 1,
        nextReviewDate: '2026-10-21',
        consecutiveSuccessCount: 1,
        isDue: true,
      },
      {
        id: 'rev-future-item-2',
        lessonId: realLesson.id,
        expressionEn: 'Future expr',
        meaningKo: '미래 복습 대상',
        targetObjectiveId: 'obj-1',
        repetitionCount: 1,
        intervalDays: 7,
        nextReviewDate: '2026-10-28',
        consecutiveSuccessCount: 1,
        isDue: false,
      },
    ]);

    const today = new Date('2026-10-21T12:00:00Z');
    const dueItems = await service.getDueReviewItems(today);
    expect(dueItems.length).toBe(1);
    expect(dueItems[0].id).toBe('rev-due-item-1');
  });

  it('회화 설정 조회 및 저장이 안전하게 수행되어야 한다 (기본값 외부호출 차단)', async () => {
    const defaultSettings = await service.getSettings();
    expect(defaultSettings.allowExternalFreeGeminiCalls).toBe(false);
    expect(defaultSettings.engineMode).toBe('local_rule_engine');
    expect(defaultSettings.speechConfirmationRequired).toBe(true);

    const updated = await service.saveSettings({
      audioAutoPlay: true,
      speechConfirmationRequired: false,
    });
    expect(updated.audioAutoPlay).toBe(true);
    expect(updated.speechConfirmationRequired).toBe(false);
    expect(updated.allowExternalFreeGeminiCalls).toBe(false);

    const reloaded = await service.getSettings();
    expect(reloaded.audioAutoPlay).toBe(true);
    expect(reloaded.speechConfirmationRequired).toBe(false);
  });
});
