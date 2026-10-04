// 단어 및 학습 도메인 모델 정의

export type DifficultyLevel = 'low' | 'medium' | 'high' | 'auto';
export type LearningStatus = 'new' | 'learning' | 'weak' | 'review_needed' | 'familiar' | 'mastered';
export type SourceType = 'BUILTIN' | 'IMAGE' | 'PDF';

export interface WordEntry {
  id?: string;
  word: string;
  meaning: string[];
  partOfSpeech: string;
  difficulty: 'low' | 'medium' | 'high';
  topic: string;
  confusables?: string[];
  sourceBookId?: string;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  createdAt?: string;
  exampleSentence?: string;
  exampleTranslation?: string;
}

export interface WordBook {
  id?: string;
  title: string;
  sourceType: SourceType;
  sourceFileName?: string;
  wordCount: number;
  createdAt: string;
  lastStudiedAt?: string;
}

export interface StudyHistory {
  id?: string;
  wordId: string;
  isCorrect: boolean;
  selectedAnswer: string;
  studiedAt: string;
}

export interface WordStat {
  wordId: string;
  totalCount: number;
  correctCount: number;
  wrongCount: number;
  correctStreak: number;
  learningStatus: LearningStatus;
  lastStudiedAt: string;
}

export type JapaneseQuizMode = 'meaning' | 'hiragana' | 'combined';

export interface QuizQuestion {
  wordId: string;
  word: string;
  displayWord?: string;
  prompt?: string;
  quizMode?: JapaneseQuizMode;
  options: string[]; // 4지선다 보기
  correctIndex: number; // 0, 1, 2, 3
  difficulty: DifficultyLevel;
  partOfSpeech?: string;
  meaning?: string[];
  exampleSentence?: string;
  exampleTranslation?: string;
}


// 지시서 DB-PILOT-200 Section 9, 10, 15, 34 표준 어휘 DB 모델
export type BuiltinDifficulty = 'easy' | 'medium' | 'hard';
export type ConfidenceGrade = 'A' | 'B' | 'C';
export type WordStatus = 'candidate' | 'review' | 'verified' | 'quiz_ready' | 'excluded';

export interface WordEvidence {
  source: 'wordnet' | 'wordfreq' | 'business_corpus' | 'official_public_mention';
  detail: string;
  verifiedAt: string;
}

export type OfficialEvidenceStatus = 'verified' | 'none' | 'unknown';

export interface OfficialEvidenceItem {
  sourceTitle: string;
  sourceUrl: string;
  accessedAt: string;
  locator?: string;
}

export interface WordRelevanceScores {
  generalFrequency: 'high' | 'medium' | 'low';
  businessRelevance: 'high' | 'medium' | 'low';
  examDomainRelevance: 'high' | 'medium' | 'low';
  officialPublicEvidence?: boolean;
}

export interface BuiltinWord {
  id: string; // e.g. "builtin:acquire:verb"
  word: string; // 표제어
  lemma: string; // 정규화 표제어

  partOfSpeech: 'noun' | 'verb' | 'adjective' | 'adverb' | 'preposition' | 'conjunction' | 'phrase' | 'other';

  mainMeaning: string;
  subMeanings: string[];

  difficulty: BuiltinDifficulty;

  topics: string[];

  confidenceGrade: ConfidenceGrade;

  status: WordStatus;

  quizEligible: boolean;

  confusableWords: string[];
  blockedMeanings: string[];

  evidence: WordEvidence[];

  relevance: WordRelevanceScores;

  officialEvidenceStatus?: OfficialEvidenceStatus;
  officialEvidence?: OfficialEvidenceItem[];

  databaseVersion: number;
}

export interface BuiltinWordsDatabase {
  schemaVersion: number;
  databaseVersion: number;
  wordCount: number;
  generatedAt: string;
  words: BuiltinWord[];
}

/**
 * BuiltinWord를 퀴즈 엔진 및 IndexedDB 호환 WordEntry로 변환
 */
export function builtinWordToWordEntry(b: BuiltinWord): WordEntry {
  return {
    id: b.id,
    word: b.word,
    meaning: [b.mainMeaning, ...b.subMeanings],
    partOfSpeech: b.partOfSpeech,
    difficulty: b.difficulty === 'easy' ? 'low' : b.difficulty === 'hard' ? 'high' : 'medium',
    topic: b.topics[0] || 'general',
    confusables: b.confusableWords,
    confidence: b.confidenceGrade === 'A' ? 'HIGH' : b.confidenceGrade === 'B' ? 'MEDIUM' : 'LOW',
  };
}
