import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToeicStudyDatabase } from '../src/storage/db';
import { exportBackupData, validateBackupFile, restoreBackupData } from '../src/storage/backupService';
import { ConversationStorageService } from '../src/features/conversation/services/storageService';
import { getLessonById } from '../src/features/conversation/content/lessons';
import { LessonStateMachine } from '../src/features/conversation/engine/lessonStateMachine';

describe('Codex 데이터 무손실 독립 회귀', () => {
  let database: ToeicStudyDatabase;
  beforeEach(async () => { database = new ToeicStudyDatabase(`review-${crypto.randomUUID()}`); await database.open(); });
  afterEach(async () => { await database.delete(); });
  it('v2 필수 테이블이 누락되면 교체 복원을 거부한다', async () => {
    const backup = await exportBackupData(database);
    delete backup.data.questions;
    expect(validateBackupFile(backup).valid).toBe(false);
    await expect(restoreBackupData(backup, 'replace', database)).rejects.toThrow();
  });
  it('민감 설정 검증에서 null 레코드는 예외 없이 거부한다', async () => {
    const backup = await exportBackupData(database);
    const malformed = { ...backup, data: { ...backup.data, appSettings: [null] } };
    expect(() => validateBackupFile(malformed)).not.toThrow();
    expect(validateBackupFile(malformed).valid).toBe(false);
  });
  it('같은 세션 완료를 반복해도 학습 시간과 기록이 누적되지 않는다', async () => {
    const service = new ConversationStorageService(database);
    const lesson = getLessonById('intro-u01-l01')!;
    const session = LessonStateMachine.createSession(lesson);
    const first = await service.completeSession(session, lesson);
    const second = await service.completeSession(session, lesson);
    expect(second.progress.totalStudySeconds).toBe(first.progress.totalStudySeconds);
    expect(await database.conversationSessions.count()).toBe(1);
  });
  it('진도 저장은 조작된 mastery 불리언만으로 목표 달성을 인정하지 않는다', async () => {
    const service = new ConversationStorageService(database);
    const lesson = getLessonById('intro-u01-l01')!;
    const session = LessonStateMachine.createSession(lesson);
    for (const observation of Object.values(session.observedObjectives)) observation.isMasteredByRule = true;
    session.rulePassed = true;
    const result = await service.completeSession(session, lesson);
    expect(result.progress.masteredObjectiveIds).toEqual([]);
    expect(result.progress.status).not.toBe('completed');
  });
  it('콘텐츠 개정 재검토가 필요한 과거 증거를 새 숙련으로 승격하지 않는다', async () => {
    const service = new ConversationStorageService(database);
    const lesson = getLessonById('intro-u01-l01')!;
    const session = LessonStateMachine.createSession(lesson);
    session.needsReReview = true;
    session.isCompleted = true;
    for (const observation of Object.values(session.observedObjectives)) {
      observation.evidences = ['before', 'after'].map(situationContext => ({ situationContext, userResponse: 'Hello.', usedHint: false, observedAt: new Date().toISOString() }));
    }
    expect((await service.completeSession(session, lesson)).progress.masteredObjectiveIds).toEqual([]);
  });
});
