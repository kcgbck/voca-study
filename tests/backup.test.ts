import { describe, it, expect } from 'vitest';
import {
  validateBackupFile,
  BACKUP_FORMAT_IDENTIFIER,
  type BackupFileStructure,
} from '../src/storage/backupService';
import { checkStorageHealth } from '../src/storage/storageHealth';

describe('데이터 백업 및 저장소 안정성 (지시서 Section 7, 8, 9)', () => {
  it('유효한 v1 백업 파일을 올바르게 검증해야 한다', () => {
    const validBackup: BackupFileStructure = {
      format: BACKUP_FORMAT_IDENTIFIER,
      version: 1,
      exportedAt: new Date().toISOString(),
      metadata: {
        wordBooksCount: 1,
        wordsCount: 2,
        studyHistoryCount: 0,
      },
      data: {
        wordBooks: [
          {
            id: 'book_1',
            title: '테스트 문제집',
            sourceType: 'PDF',
            wordCount: 2,
            createdAt: new Date().toISOString(),
          },
        ],
        words: [
          {
            word: 'reserve',
            meaning: ['예약하다'],
            partOfSpeech: 'verb',
            difficulty: 'medium',
            topic: 'biz',
          },
          {
            word: 'invoice',
            meaning: ['청구서'],
            partOfSpeech: 'noun',
            difficulty: 'low',
            topic: 'biz',
          },
        ],
        wordStats: [],
        studyHistory: [],
        appSettings: [],
      },
    };

    const summary = validateBackupFile(validBackup);
    expect(summary.valid).toBe(true);
    expect(summary.version).toBe(1);
    expect(summary.wordsCount).toBe(2);
    expect(summary.wordBooksCount).toBe(1);
  });

  it('잘못된 포맷 식별자는 복원을 차단해야 한다', () => {
    const invalidFormat = {
      format: 'unknown-format',
      version: 1,
      data: {},
    };

    const summary = validateBackupFile(invalidFormat);
    expect(summary.valid).toBe(false);
    expect(summary.errorMessage).toContain('지원하지 않는 백업 파일 형식');
  });

  it('미래의 알 수 없는 버전은 복원을 거부해야 한다', () => {
    const futureVersion = {
      format: BACKUP_FORMAT_IDENTIFIER,
      version: 99,
      data: {},
    };

    const summary = validateBackupFile(futureVersion);
    expect(summary.valid).toBe(false);
    expect(summary.errorMessage).toContain('지원하지 않는 백업 버전');
  });

  it('StorageHealth 진단 함수가 예외 없이 동작해야 한다', async () => {
    const health = await checkStorageHealth();
    expect(typeof health.supported).toBe('boolean');
    expect(typeof health.persistenceMessage).toBe('string');
  });
});
