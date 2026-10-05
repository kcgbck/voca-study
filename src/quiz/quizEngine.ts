import type { WordEntry, QuizQuestion, JapaneseQuizMode } from '../types/word';
import { evaluateDistractorSafety, normalizeMeaning } from './synonymDictionary';

export interface QuizGenOptions {
  seed?: number;
  matchPartOfSpeech?: boolean;
  matchDifficulty?: boolean;
  maxAttempts?: number;
  japaneseMode?: JapaneseQuizMode;
}

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
}

/**
 * 일본어 표제어에서 한자 및 히라가나 읽기(요미가나) 추출
 */
export function parseJapaneseWord(rawWord: string): {
  kanji: string;
  reading: string;
  isPureKana: boolean;
} {
  if (!rawWord) return { kanji: '', reading: '', isPureKana: true };
  const match = rawWord.match(/^([^\(（]+)\s*[\(（]([^\)）]+)[\)）]$/);
  if (match) {
    return {
      kanji: match[1].trim(),
      reading: match[2].trim(),
      isPureKana: false,
    };
  }
  return {
    kanji: rawWord.trim(),
    reading: rawWord.trim(),
    isPureKana: true,
  };
}


/**
 * 재현 가능한 난수 생성을 위한 선형 합동 PRNG (지시서 27항)
 */
export class SimplePrng {
  private state: number;

  constructor(seed: number = 123456789) {
    this.state = seed % 2147483647;
    if (this.state <= 0) this.state += 2147483646;
  }

  next(): number {
    this.state = (this.state * 16807) % 2147483647;
    return (this.state - 1) / 2147483646;
  }

  shuffle<T>(array: T[]): T[] {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}

/**
 * 4지선다 정답 유일성 Hard Gate 검증 함수 (지시서 22항)
 * 반드시 확인:
 * 1. 보기 수 = 4
 * 2. 보기 문자열 중복 = 0
 * 3. 정답 포함 수 = 1
 * 4. 정답 index = 정확히 1개
 * 5. 오답 보기 중 정답의 다의어 또는 BLOCK 동의어가 0개
 */
export function validateQuestionUniqueness(
  question: QuizQuestion,
  targetMeanings: string[] = []
): ValidationResult {
  // 1. 보기 수 = 4
  if (!question.options || question.options.length !== 4) {
    return { isValid: false, reason: `보기 수는 정확히 4개여야 합니다 (현재: ${question.options?.length})` };
  }

  // 2. 보기 문자열 중복 = 0
  const normalizedOptions = question.options.map(normalizeMeaning);
  const uniqueSet = new Set(normalizedOptions);
  if (uniqueSet.size !== 4) {
    return { isValid: false, reason: `보기 간에 중복된 문자열이 존재합니다 (${uniqueSet.size}/4)` };
  }

  // 3. 정답 index 유효성
  if (
    typeof question.correctIndex !== 'number' ||
    question.correctIndex < 0 ||
    question.correctIndex >= 4
  ) {
    return { isValid: false, reason: `정답 인덱스가 올바르지 않습니다: ${question.correctIndex}` };
  }

  // 4. 정답 보기 문자열 일치 검사
  const correctOption = question.options[question.correctIndex];
  if (!correctOption || correctOption.trim().length === 0) {
    return { isValid: false, reason: '정답 보기 문자열이 비어있습니다' };
  }

  // 5. 정답 개념 집합과 오답 보기 간 의미 중복(동의어/다의어) 검사 (지시서 24, 25항)
  // 히라가나 모드('hiragana')일 때는 일본어 발음 문자열이므로 한국어 뜻 사전 검사를 건너뜁니다.
  if (question.quizMode !== 'hiragana') {
    const allTargetMeanings = targetMeanings.length > 0 ? targetMeanings : [correctOption];
    for (let i = 0; i < question.options.length; i++) {
      if (i === question.correctIndex) continue; // 정답 본인은 제외

      const distractor = question.options[i];
      let meaningToCheck = distractor;
      if (question.quizMode === 'combined') {
        const mMatch = distractor.match(/\((.+)\)/);
        if (mMatch) meaningToCheck = mMatch[1].trim();
      }

      const safety = evaluateDistractorSafety(allTargetMeanings, meaningToCheck);
      if (safety === 'BLOCK') {
        return {
          isValid: false,
          reason: `오답 보기 "${distractor}"이(가) 정답 의미(${allTargetMeanings.join(', ')})와 동의어 또는 다의어로 BLOCK되었습니다`,
        };
      }
    }
  }

  return { isValid: true };
}

/**
 * 해사 대칭 쌍 목록 (함정 보기 생성용)
 */
export const MARITIME_OPPOSITE_PAIRS: [string, string][] = [
  ['우현 대 우현', '좌현 대 좌현'],
  ['우현', '좌현'],
  ['선수', '선미'],
  ['전진', '후진'],
  ['투묘', '양묘'],
  ['정박', '항행'],
  ['출항', '입항'],
  ['증속', '감속'],
  ['동의하는가', '거부하는가'],
  ['동의한다', '동의하지 않는다'],
  ['허가한다', '허가하지 않는다'],
  ['메이데이', '팬팬'],
  ['조난', '긴급'],
  ['요청한다', '요청하지 않는다'],
  ['확인했다', '확인할 수 없다'],
  ['가능하다', '불가능하다'],
  ['있다', '없다'],
];

/**
 * 해사 통신 문장 정답 기반 대칭 함정 문구 생성
 */
export function generateMaritimeTrapSentence(sentence: string): string | null {
  if (!sentence) return null;
  for (const [a, b] of MARITIME_OPPOSITE_PAIRS) {
    if (sentence.includes(a)) {
      return sentence.replace(a, b);
    }
    if (sentence.includes(b)) {
      return sentence.replace(b, a);
    }
  }
  return null;
}

/**
 * 안전한 4지선다 문제 생성기 (지시서 21, 26항 및 일본어 등급/출제 모드 지원)
 */
export function createQuizQuestion(
  wordList: WordEntry[],
  targetWord: WordEntry,
  options: QuizGenOptions = {}
): QuizQuestion | null {
  if (!wordList || wordList.length < 4 || !targetWord) {
    return null;
  }

  const prng = new SimplePrng(options.seed !== undefined ? options.seed : Date.now());

  // 정답 개념 집합: 대표 뜻 + 추가 뜻(다의어)
  const targetMeaningList: string[] = [];
  if (Array.isArray(targetWord.meaning)) {
    targetMeaningList.push(...targetWord.meaning);
  } else if (typeof targetWord.meaning === 'string') {
    targetMeaningList.push(targetWord.meaning);
  }

  const targetParsed = parseJapaneseWord(targetWord.word);
  const jMode = options.japaneseMode;

  // ----------------------------------------------------
  // 모드 1: 히라가나(발음) 맞추기
  // ----------------------------------------------------
  if (jMode === 'hiragana') {
    const isTargetPure = targetParsed.isPureKana;
    const correctOption = targetParsed.reading;
    const displayWord = isTargetPure
      ? (targetMeaningList[0] || targetWord.word)
      : targetParsed.kanji;
    const prompt = isTargetPure
      ? '알맞은 일본어 단어를 고르세요'
      : '단어의 올바른 히라가나(발음)를 고르세요';

    // 오답 후보 풀: 다른 단어들의 reading 추출
    const readingSet = new Set<string>();
    readingSet.add(correctOption.toLowerCase());
    const candidateReadings: string[] = [];

    const shuffledWords = prng.shuffle(wordList);
    for (const w of shuffledWords) {
      if (w.word.toLowerCase() === targetWord.word.toLowerCase()) continue;
      const parsed = parseJapaneseWord(w.word);
      const r = parsed.reading.trim();
      if (!r || readingSet.has(r.toLowerCase())) continue;
      readingSet.add(r.toLowerCase());
      candidateReadings.push(r);
      if (candidateReadings.length === 3) break;
    }

    if (candidateReadings.length < 3) return null;

    const rawOptions = [correctOption, ...candidateReadings];
    const shuffledOptions = prng.shuffle(rawOptions);
    const correctIndex = shuffledOptions.indexOf(correctOption);

    const question: QuizQuestion = {
      wordId: targetWord.id || targetWord.word,
      word: targetWord.word,
      displayWord,
      prompt,
      quizMode: 'hiragana',
      options: shuffledOptions,
      correctIndex,
      difficulty: targetWord.difficulty || 'medium',
      partOfSpeech: targetWord.partOfSpeech,
      meaning: targetMeaningList,
      exampleSentence: targetWord.exampleSentence,
      exampleTranslation: targetWord.exampleTranslation,
    };

    const validation = validateQuestionUniqueness(question, targetMeaningList);
    return validation.isValid ? question : null;
  }

  // ----------------------------------------------------
  // 모드 2: 히라가나 + 한글 뜻 같이 맞추기
  // ----------------------------------------------------
  if (jMode === 'combined') {
    const repMeaning = targetMeaningList[0] || '';
    const correctOption = `${targetParsed.reading} (${repMeaning})`;
    const displayWord = targetParsed.isPureKana ? targetParsed.reading : targetParsed.kanji;
    const prompt = '히라가나와 뜻이 바르게 연결된 것을 고르세요';

    const chosenOptions = new Set<string>();
    chosenOptions.add(correctOption);
    const chosenReadings = new Set<string>();
    chosenReadings.add(targetParsed.reading.toLowerCase());
    const candidateCombined: string[] = [];

    const shuffledWords = prng.shuffle(wordList);
    for (const w of shuffledWords) {
      if (w.word.toLowerCase() === targetWord.word.toLowerCase()) continue;
      const parsed = parseJapaneseWord(w.word);
      const r = parsed.reading.trim();
      const m = (Array.isArray(w.meaning) ? w.meaning[0] : w.meaning) || '';
      if (!r || !m) continue;
      if (chosenReadings.has(r.toLowerCase())) continue;

      const optStr = `${r} (${m})`;
      if (chosenOptions.has(optStr)) continue;

      // 의미 충돌 검사
      const safety = evaluateDistractorSafety(targetMeaningList, m);
      if (safety !== 'SAFE') continue;

      chosenOptions.add(optStr);
      chosenReadings.add(r.toLowerCase());
      candidateCombined.push(optStr);
      if (candidateCombined.length === 3) break;
    }

    if (candidateCombined.length < 3) return null;

    const rawOptions = [correctOption, ...candidateCombined];
    const shuffledOptions = prng.shuffle(rawOptions);
    const correctIndex = shuffledOptions.indexOf(correctOption);

    const question: QuizQuestion = {
      wordId: targetWord.id || targetWord.word,
      word: targetWord.word,
      displayWord,
      prompt,
      quizMode: 'combined',
      options: shuffledOptions,
      correctIndex,
      difficulty: targetWord.difficulty || 'medium',
      partOfSpeech: targetWord.partOfSpeech,
      meaning: targetMeaningList,
      exampleSentence: targetWord.exampleSentence,
      exampleTranslation: targetWord.exampleTranslation,
    };

    const validation = validateQuestionUniqueness(question, targetMeaningList);
    return validation.isValid ? question : null;
  }

  // ----------------------------------------------------
  // 모드 3: 기본 한글 뜻 맞추기 (TOEIC, 해사영어, 일본어 기본)
  // ----------------------------------------------------
  const correctOption = targetMeaningList[0];
  if (!correctOption) return null;

  const isCommQuestion = targetWord.topic === 'communication' || targetWord.partOfSpeech === '통신문';

  const selectedDistractors: string[] = [];
  const chosenNorm = new Set<string>();
  chosenNorm.add(normalizeMeaning(correctOption));

  // 1. 실전 통신문장: 약 50% 확률로 어렵고 헷갈리는 대칭 함정 문구 1개 추가 (예: 우현 대 우현 -> 좌현 대 좌현)
  if (isCommQuestion && prng.next() < 0.5) {
    const trap = generateMaritimeTrapSentence(correctOption);
    if (trap && trap !== correctOption) {
      const norm = normalizeMeaning(trap);
      if (!chosenNorm.has(norm) && evaluateDistractorSafety(targetMeaningList, trap) === 'SAFE') {
        selectedDistractors.push(trap);
        chosenNorm.add(norm);
      }
    }
  }

  // 2. 사전에 정의된 고품질 전용 오답(confusables/distractors)이 있는 경우 우선 채택
  if (targetWord.confusables && targetWord.confusables.length > 0) {
    const shuffledConfusables = prng.shuffle(targetWord.confusables);
    for (const conf of shuffledConfusables) {
      if (selectedDistractors.length >= 3) break;
      const norm = normalizeMeaning(conf);
      if (chosenNorm.has(norm)) continue;
      if (evaluateDistractorSafety(targetMeaningList, conf) !== 'SAFE') continue;

      let conflictWithChosen = false;
      for (const existing of selectedDistractors) {
        if (evaluateDistractorSafety([existing], conf) === 'BLOCK') {
          conflictWithChosen = true;
          break;
        }
      }
      if (conflictWithChosen) continue;

      selectedDistractors.push(conf);
      chosenNorm.add(norm);
    }
  }

  // 오답 후보 풀 생성: targetWord가 아니고 의미상 SAFE인 단어들만 선별
  const candidatePool: { word: WordEntry; meaning: string }[] = [];
  for (const w of wordList) {
    if (w.word.toLowerCase() === targetWord.word.toLowerCase()) continue;

    const meanings = Array.isArray(w.meaning) ? w.meaning : [w.meaning];
    for (const m of meanings) {
      if (!m || m.trim().length === 0) continue;

      // 정답 의미 집합과 비교하여 SAFE인 경우에만 오답 후보로 채택 (지시서 25항)
      const safety = evaluateDistractorSafety(targetMeaningList, m);
      if (safety === 'SAFE') {
        candidatePool.push({ word: w, meaning: m });
      }
    }
  }

  const filterPool = (matchPos: boolean, matchDiff: boolean) => {
    return candidatePool.filter((c) => {
      if (matchPos && targetWord.partOfSpeech && c.word.partOfSpeech !== targetWord.partOfSpeech) {
        return false;
      }
      if (matchDiff && targetWord.difficulty && c.word.difficulty !== targetWord.difficulty) {
        return false;
      }
      return true;
    });
  };

  const tryPickDistractors = (pool: { meaning: string }[]): void => {
    const shuffled = prng.shuffle(pool);

    for (const item of shuffled) {
      if (selectedDistractors.length >= 3) break;

      const norm = normalizeMeaning(item.meaning);
      if (chosenNorm.has(norm)) continue;

      let conflictWithChosen = false;
      for (const existing of selectedDistractors) {
        if (evaluateDistractorSafety([existing], item.meaning) === 'BLOCK') {
          conflictWithChosen = true;
          break;
        }
      }
      if (conflictWithChosen) continue;

      selectedDistractors.push(item.meaning);
      chosenNorm.add(norm);
    }
  };

  // 3. 부족한 오답이 있으면 후보 풀에서 보충
  if (selectedDistractors.length < 3) {
    // 1단계 시도 (조건 엄격)
    if (options.matchPartOfSpeech || options.matchDifficulty) {
      tryPickDistractors(
        filterPool(!!options.matchPartOfSpeech, !!options.matchDifficulty)
      );
    }

    // 2단계 시도 (난이도 완화: 지시서 26항)
    if (selectedDistractors.length < 3 && options.matchPartOfSpeech) {
      tryPickDistractors(filterPool(true, false));
    }

    // 3단계 시도 (전체 풀 완화)
    if (selectedDistractors.length < 3) {
      tryPickDistractors(candidatePool);
    }
  }

  if (selectedDistractors.length < 3) {
    return null;
  }

  const rawOptions = [correctOption, ...selectedDistractors];
  const shuffledOptions = prng.shuffle(rawOptions);
  const correctIndex = shuffledOptions.indexOf(correctOption);

  const prompt = isCommQuestion
    ? '실전 통신문장의 알맞은 한글 뜻을 고르세요'
    : '단어의 알맞은 한글 뜻을 고르세요';

  const question: QuizQuestion = {
    wordId: targetWord.id || targetWord.word,
    word: targetWord.word,
    displayWord: targetWord.word,
    prompt,
    quizMode: 'meaning',
    options: shuffledOptions,
    correctIndex,
    difficulty: targetWord.difficulty || 'medium',
    partOfSpeech: targetWord.partOfSpeech,
    meaning: targetMeaningList,
    exampleSentence: targetWord.exampleSentence,
    exampleTranslation: targetWord.exampleTranslation,
  };

  // 최종 Hard Gate 검증
  const validation = validateQuestionUniqueness(question, targetMeaningList);
  if (!validation.isValid) {
    return null;
  }

  return question;
}

