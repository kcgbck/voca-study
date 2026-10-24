// src/storage/db.ts
// Dexie 기반 IndexedDB 저장소 정의 (v1/v2 보존 및 v3 가산 확장)
import Dexie, { type Table } from 'dexie';
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

export interface AppSetting {
  key: string;
  value: string | number | boolean;
}

export class ToeicStudyDatabase extends Dexie {
  words!: Table<WordEntry, string>;
  wordBooks!: Table<WordBook, string>;
  studyHistory!: Table<StudyHistory, string>;
  wordStats!: Table<WordStat, string>;
  appSettings!: Table<AppSetting, string>;

  // 범용 문제 도메인 테이블 (version 2)
  questionBooks!: Table<QuestionBook, string>;
  questions!: Table<QuestionItem, string>;
  questionStudyHistory!: Table<QuestionStudyHistory, string>;
  questionStats!: Table<QuestionStat, string>;
  sourceImages!: Table<SourceImage, string>;

  // AI 회화 도메인 테이블 (version 3)
  conversationSessions!: Table<ConversationSession, string>;
  conversationProgress!: Table<LessonProgress, string>;
  conversationReviewItems!: Table<ConversationReviewItem, string>;

  constructor(dbName: string = 'ToeicStudyPwaDB') {
    super(dbName);
    this.version(1).stores({
      words: '++id, word, partOfSpeech, difficulty, topic, sourceBookId, confidence',
      wordBooks: '++id, title, sourceType, createdAt',
      studyHistory: '++id, wordId, isCorrect, studiedAt',
      wordStats: 'wordId, learningStatus, totalCount, wrongCount, lastStudiedAt',
      appSettings: 'key',
    });
    this.version(2).stores({
      questionBooks: '++id, title, sourceType, questionType, createdAt',
      questions: '++id, bookId, questionNumber, answerStatus, isUserConfirmed, createdAt',
      questionStudyHistory: '++id, questionId, bookId, isCorrect, studiedAt',
      questionStats: 'questionId, bookId, totalCount, wrongCount, lastStudiedAt',
      sourceImages: 'id, bookId, createdAt',
    });
    this.version(3).stores({
      conversationSessions: 'sessionId, lessonId, contentRevision, isCompleted, lastActiveAt',
      conversationProgress: 'lessonId, level, unitNumber, lessonNumber, status, lastStudiedAt',
      conversationReviewItems: 'id, lessonId, nextReviewDate, repetitionCount',
    });
  }
}

export const db = new ToeicStudyDatabase();
