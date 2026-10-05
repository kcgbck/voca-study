import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { WordEntry, QuizQuestion, JapaneseQuizMode } from '../../types/word';
import { db } from '../../storage/db';
import { createQuizQuestion } from '../../quiz/quizEngine';
import { userService } from '../../services/userService';
import { speechService } from '../../services/speechService';
import { getExampleSentence, ExampleSentence } from '../../services/exampleSentenceService';
import { wrongNoteService, WrongWordItem } from '../../services/wrongNoteService';

interface Props {
  initialWords?: WordEntry[];
  bookTitle?: string;
  sourceType?: 'builtin' | 'maritime' | 'maritime_comm' | 'japanese_exam' | 'japanese_life' | 'wrong_notes' | 'photo' | 'pdf';
  languageMode?: 'en' | 'ja';
  instantGrading?: boolean;
  shuffleOrder?: boolean;
  onOpenRanking?: () => void;
  onBack?: () => void;
}

type SelectedDifficulty = 'all' | 'easy' | 'medium' | 'hard' | 'basic' | 'n5' | 'n4' | 'n3';
type QuestionCountOption = 10 | 20 | 30 | 50 | 'all';
export type BookCategory = 'builtin' | 'maritime' | 'maritime_comm' | 'japanese_exam' | 'japanese_life' | 'wrong_notes';


// Fisher-Yates 배열 셔플 함수
function shuffleArray(words: WordEntry[]): WordEntry[] {
  const arr = [...words];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// BuiltinWord 또는 MaritimeWordEntry를 WordEntry로 안전하게 변환
function toWordEntry(w: any): WordEntry {
  // 해사영어 또는 커스텀 형식 (meaning: string[] 보유)
  if (Array.isArray(w.meaning)) {
    return {
      id: String(w.id || w.word),
      word: w.word,
      meaning: w.meaning,
      partOfSpeech: w.partOfSpeech || '단어',
      difficulty: w.difficulty === 'high' ? 'high' : w.difficulty === 'low' ? 'low' : 'medium',
      topic: w.topic || 'maritime',
      exampleSentence: w.standardExample || w.exampleSentence || w.example,
      exampleTranslation: w.exampleMeaning || w.exampleTranslation || w.translation,
      confusables: w.distractors || w.confusables,
    };
  }

  // 기본 TOEIC BuiltinWord 형식 (mainMeaning + subMeanings)
  const sub = Array.isArray(w.subMeanings) ? w.subMeanings : [];
  const meanings = w.mainMeaning ? [w.mainMeaning, ...sub] : sub;
  return {
    id: String(w.id || w.word),
    word: w.word,
    meaning: meanings.length > 0 ? meanings : [w.word],
    partOfSpeech: w.partOfSpeech || '단어',
    difficulty: w.difficulty === 'easy' ? 'low' : w.difficulty === 'hard' ? 'high' : 'medium',
    topic: Array.isArray(w.topics) && w.topics.length > 0 ? w.topics[0] : (w.topic || 'general'),
    confusables: w.confusableWords || w.distractors,
    confidence: w.confidenceGrade === 'A' ? 'HIGH' : w.confidenceGrade === 'B' ? 'MEDIUM' : 'LOW',
    exampleSentence: w.standardExample || w.exampleSentence || w.example,
    exampleTranslation: w.exampleMeaning || w.exampleTranslation || w.translation,
  };
}

// 오답 수가 부족할 때(오답노트 단어가 1~3개인 경우) 보기를 채우기 위한 백업 어휘
const FALLBACK_DISTRACTOR_WORDS: WordEntry[] = [
  { word: 'acquire', meaning: ['인수하다', '획득하다'], partOfSpeech: '동사', difficulty: 'medium', topic: 'business' },
  { word: 'agreement', meaning: ['합의', '계약'], partOfSpeech: '명사', difficulty: 'low', topic: 'business' },
  { word: 'applicant', meaning: ['지원자', '신청자'], partOfSpeech: '명사', difficulty: 'medium', topic: 'business' },
  { word: 'budget', meaning: ['예산', '비용'], partOfSpeech: '명사', difficulty: 'low', topic: 'business' },
  { word: 'collaborate', meaning: ['협력하다'], partOfSpeech: '동사', difficulty: 'medium', topic: 'business' },
  { word: 'complaint', meaning: ['불만', '항의'], partOfSpeech: '명사', difficulty: 'low', topic: 'business' },
  { word: 'comply', meaning: ['준수하다'], partOfSpeech: '동사', difficulty: 'medium', topic: 'business' },
  { word: 'conference', meaning: ['회의', '학회'], partOfSpeech: '명사', difficulty: 'low', topic: 'business' },
  { word: 'confirm', meaning: ['확인하다'], partOfSpeech: '동사', difficulty: 'low', topic: 'business' },
  { word: 'contract', meaning: ['계약', '계약서'], partOfSpeech: '명사', difficulty: 'low', topic: 'business' },
  { word: 'deadline', meaning: ['마감 기한'], partOfSpeech: '명사', difficulty: 'low', topic: 'business' },
  { word: 'delegate', meaning: ['위임하다'], partOfSpeech: '동사', difficulty: 'high', topic: 'business' },
  { word: 'evaluate', meaning: ['평가하다'], partOfSpeech: '동사', difficulty: 'medium', topic: 'business' },
  { word: 'executive', meaning: ['경영진', '임원'], partOfSpeech: '명사', difficulty: 'medium', topic: 'business' },
  { word: 'implement', meaning: ['시행하다'], partOfSpeech: '동사', difficulty: 'medium', topic: 'business' },
  { word: 'inspect', meaning: ['점검하다'], partOfSpeech: '동사', difficulty: 'low', topic: 'business' },
  { word: 'negotiate', meaning: ['협상하다'], partOfSpeech: '동사', difficulty: 'medium', topic: 'business' },
  { word: 'postpone', meaning: ['연기하다'], partOfSpeech: '동사', difficulty: 'low', topic: 'business' },
  { word: 'refund', meaning: ['환불'], partOfSpeech: '명사', difficulty: 'low', topic: 'business' },
  { word: 'revenue', meaning: ['매출', '수익'], partOfSpeech: '명사', difficulty: 'medium', topic: 'business' },
];

export const QuizPreviewView: React.FC<Props> = ({
  initialWords,
  bookTitle,
  sourceType = 'builtin',
  languageMode,
  instantGrading = false,
  shuffleOrder = true,
  onOpenRanking,
  onBack: _onBack,
}) => {
  const [currentBook, setCurrentBook] = useState<BookCategory>(() => {
    if (sourceType === 'maritime') return 'maritime';
    if (sourceType === 'maritime_comm') return 'maritime_comm';
    if (sourceType === 'japanese_exam') return 'japanese_exam';
    if (sourceType === 'japanese_life') return 'japanese_life';
    if (sourceType === 'wrong_notes') return 'wrong_notes';
    return 'builtin';
  });
  const [allLoadedWords, setAllLoadedWords] = useState<WordEntry[]>(initialWords || []);
  const [selectedDifficulty, setSelectedDifficulty] = useState<SelectedDifficulty>('all');
  const [selectedCount, setSelectedCount] = useState<QuestionCountOption>(20);
  const [quizWords, setQuizWords] = useState<WordEntry[]>([]);
  const [currentQuiz, setCurrentQuiz] = useState<QuizQuestion | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [score, setScore] = useState<{ correct: number; wrong: number }>({ correct: 0, wrong: 0 });
  const [syncedScore, setSyncedScore] = useState<number | null>(null);
  const hasSyncedRef = useRef(false);
  const quizFooterRef = useRef<HTMLDivElement>(null);

  // 1. 이번 퀴즈 세션에서 틀린 단어들 (틀린 문제만 다시 풀기용)
  const [sessionWrongWords, setSessionWrongWords] = useState<WordEntry[]>([]);
  // 오답 전용 세션 단어 목록 (틀린 문제만 다시 풀 때 정확한 문항수 보장)
  const [customSessionWords, setCustomSessionWords] = useState<WordEntry[] | null>(null);

  // 2. 일본어 출제 모드 (한글뜻 맞추기 / 히라가나 맞추기 / 히라가나+뜻 같이 맞추기)
  const [japaneseMode, setJapaneseMode] = useState<JapaneseQuizMode>('meaning');

  // 현재 모드: 언어 기준 (영어 en vs 일본어 ja)
  const activeLangMode = useMemo<'en' | 'ja'>(() => {
    if (languageMode) return languageMode;
    if (currentBook === 'japanese_exam' || currentBook === 'japanese_life') return 'ja';
    return 'en';
  }, [languageMode, currentBook]);

  // 일본어 단어장 여부 감지
  const isJapanese = useMemo(() => {
    return currentBook === 'japanese_exam' || currentBook === 'japanese_life';
  }, [currentBook]);

  // 3. 오답노트에 영구 누적 저장된 단어들 (틀린 문제 모음집)
  const [wrongNoteWords, setWrongNoteWords] = useState<WrongWordItem[]>([]);
  const [showWrongNoteModal, setShowWrongNoteModal] = useState<boolean>(false);

  // 오답노트 최신 목록 갱신
  const refreshWrongNotes = async () => {
    try {
      const list = await wrongNoteService.getWrongWords();
      setWrongNoteWords(list);
      return list;
    } catch (_) {
      return [];
    }
  };

  useEffect(() => {
    refreshWrongNotes();
  }, []);

  const [activeBookTitle, setActiveBookTitle] = useState<string>(
    bookTitle || (
      sourceType === 'maritime'
        ? '해사 핵심단어'
        : sourceType === 'maritime_comm'
        ? '실전 통신문장'
        : sourceType === 'japanese_exam'
        ? '일본어 시험용'
        : sourceType === 'japanese_life'
        ? '생활일본어'
        : sourceType === 'wrong_notes'
        ? '오답노트'
        : 'TOEIC(1800단어)'
    )
  );

  const handleSwitchBook = (book: BookCategory) => {
    if (book === currentBook) return;
    speechService.stop();
    setCurrentBook(book);
    setCustomSessionWords(null);
    setAllLoadedWords([]);
    setQuizWords([]);
    setCurrentQuiz(null);


    // 비일본어 단어장 전환 시 일본어 전용 등급 필터 리셋
    if (book !== 'japanese_exam' && book !== 'japanese_life') {
      if (['basic', 'n5', 'n4', 'n3'].includes(selectedDifficulty)) {
        setSelectedDifficulty('all');
      }
    }

    if (book === 'wrong_notes') {
      refreshWrongNotes().then((list) => {
        setAllLoadedWords(list);
        setActiveBookTitle('오답노트');
      });
    }
  };


  // 외부 sourceType prop 변경 시 단어장 선택 동기화
  useEffect(() => {
    if (sourceType === 'maritime') {
      setCurrentBook('maritime');
    } else if (sourceType === 'maritime_comm') {
      setCurrentBook('maritime_comm');
    } else if (sourceType === 'japanese_exam') {
      setCurrentBook('japanese_exam');
    } else if (sourceType === 'japanese_life') {
      setCurrentBook('japanese_life');
    } else if (sourceType === 'wrong_notes') {
      setCurrentBook('wrong_notes');
    } else if (sourceType === 'builtin') {
      setCurrentBook('builtin');
    }
  }, [sourceType]);

  // 현재 퀴즈 단어 발음 언어 감지 (일본어 단어장은 ja-JP, 영단어는 en-US)
  const currentLang = useMemo(() => {
    if (currentBook === 'japanese_exam' || currentBook === 'japanese_life') {
      return 'ja-JP';
    }
    if (currentQuiz?.word && /[\u3040-\u309F\u30A0-\u30FF]/.test(currentQuiz.word)) {
      return 'ja-JP';
    }
    return 'en-US';
  }, [currentBook, currentQuiz]);

  // 발음 듣기 버튼 핸들러
  const handleSpeakCurrentWord = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!currentQuiz?.word) return;
    setIsSpeaking(true);
    speechService.speak(currentQuiz.word, currentLang, 0.9, {
      onEnd: () => setIsSpeaking(false),
    });
    // 최대 2초 후 자동 해제 (안전 타이머)
    setTimeout(() => setIsSpeaking(false), 2000);
  };

  // 현재 퀴즈 단어의 빈출 실전문장 계산
  const currentExample = useMemo<ExampleSentence | null>(() => {
    if (!currentQuiz?.word) return null;
    return getExampleSentence(
      currentQuiz.word,
      currentQuiz.meaning || [],
      currentQuiz.partOfSpeech || '단어',
      currentQuiz.exampleSentence,
      currentQuiz.exampleTranslation
    );
  }, [currentQuiz]);

  const [isSpeakingSentence, setIsSpeakingSentence] = useState(false);

  // 문장 전체 발음 듣기 핸들러
  const handleSpeakSentence = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!currentExample?.text) return;
    setIsSpeakingSentence(true);
    speechService.speak(currentExample.text, currentLang, 0.9, {
      onEnd: () => setIsSpeakingSentence(false),
    });
    setTimeout(() => setIsSpeakingSentence(false), 4000);
  };

  // 문장 내 학습 단어 하이라이트 렌더러
  const renderHighlightedSentence = (text: string, highlight: string) => {
    if (!highlight || !text) return text;
    const cleanWord = highlight.replace(/\s*[\(（][^\)）]+[\)）]/g, '').trim();
    if (!cleanWord) return text;

    try {
      const escaped = cleanWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escaped})`, 'gi');
      const parts = text.split(regex);
      if (parts.length === 1) return text;

      return parts.map((part, idx) =>
        regex.test(part) ? (
          <strong key={idx} className="quiz-example-highlight">
            {part}
          </strong>
        ) : (
          part
        )
      );
    } catch (_) {
      return text;
    }
  };

  // 난이도 및 일본어 등급 필터링된 단어 목록
  const filteredWords = useMemo(() => {
    if (selectedDifficulty === 'all') return allLoadedWords;
    if (isJapanese) {
      if (selectedDifficulty === 'basic') {
        return allLoadedWords.filter((w) => w.topic === 'basic' || w.topic === 'conversation');
      }
      if (selectedDifficulty === 'n5') {
        return allLoadedWords.filter((w) => w.topic === 'jlpt_n5');
      }
      if (selectedDifficulty === 'n4') {
        return allLoadedWords.filter((w) => w.topic === 'jlpt_n4');
      }
      if (selectedDifficulty === 'n3') {
        return allLoadedWords.filter((w) => w.topic === 'jlpt_n3');
      }
    }
    const diffMap: Record<string, string> = { easy: 'low', medium: 'medium', hard: 'high' };
    const targetDiff = diffMap[selectedDifficulty];
    if (targetDiff) {
      return allLoadedWords.filter((w) => w.difficulty === targetDiff);
    }
    return allLoadedWords;
  }, [allLoadedWords, selectedDifficulty, isJapanese]);

  // 총 문제 수 결정 (틀린 문제 다시 풀기 모드일 때는 정확히 틀린 단어 수만큼만 출제)
  const totalQuestions = useMemo(() => {
    if (customSessionWords) {
      return customSessionWords.length;
    }
    if (!filteredWords.length) return 0;
    if (selectedCount === 'all') return filteredWords.length;
    return Math.min(selectedCount, filteredWords.length);
  }, [customSessionWords, filteredWords, selectedCount]);

  const generateNextQuestion = (wordList: WordEntry[], targetIdx: number) => {
    if (!wordList || wordList.length === 0) {
      setCurrentQuiz(null);
      return;
    }

    const target = wordList[targetIdx % wordList.length];
    // 오답 보기를 만들 후보 풀 (오답노트 단어가 1~3개인 경우에도 4지선다 출제를 지원하기 위해 fallback pool 결합)
    const distractorPool = allLoadedWords.length >= 4
      ? allLoadedWords
      : [...allLoadedWords, ...FALLBACK_DISTRACTOR_WORDS];

    // quizEngine의 createQuizQuestion을 사용하여 정답 유일성 Hard Gate 통과 문제 생성
    let question = createQuizQuestion(distractorPool, target, {
      seed: Date.now() + targetIdx,
      matchPartOfSpeech: !isJapanese,
      japaneseMode: isJapanese ? japaneseMode : undefined,
    });

    if (!question) {
      // 품사 조건 완화 재시도
      question = createQuizQuestion(distractorPool, target, {
        seed: Date.now() + targetIdx + 1,
        matchPartOfSpeech: false,
        japaneseMode: isJapanese ? japaneseMode : undefined,
      });
    }

    if (question) {
      setCurrentQuiz(question);
      setSelectedIndex(null);
      setIsAnswered(false);
    } else {
      // 다른 단어로 재시도
      const fallbackIdx = (targetIdx + 1) % wordList.length;
      const fallbackTarget = wordList[fallbackIdx];
      const fallbackQuestion = createQuizQuestion(distractorPool, fallbackTarget, {
        seed: Date.now() + fallbackIdx,
        matchPartOfSpeech: false,
        japaneseMode: isJapanese ? japaneseMode : undefined,
      });
      if (fallbackQuestion) {
        setCurrentQuiz(fallbackQuestion);
        setSelectedIndex(null);
        setIsAnswered(false);
      }
    }
  };

  // 퀴즈 세션 초기화 (셔플 여부에 따라 단어 순서 재배치)
  const initQuizSession = (baseWords?: WordEntry[]) => {
    if (!baseWords) {
      setCustomSessionWords(null);
    }
    const source = baseWords || filteredWords;
    if (!source || source.length === 0) {
      setQuizWords([]);
      setCurrentQuiz(null);
      return;
    }
    const countToTake = baseWords
      ? baseWords.length
      : selectedCount === 'all'
      ? source.length
      : Math.min(selectedCount, source.length);
    const shuffled = shuffleOrder ? shuffleArray(source) : [...source];
    const finalWords = shuffled.slice(0, countToTake);
    setQuizWords(finalWords);
    setSessionWrongWords([]); // 새 세션 시작 시 이번 세션 오답 목록 초기화
    setCurrentIndex(0);
    setScore({ correct: 0, wrong: 0 });
    setSyncedScore(null);
    hasSyncedRef.current = false;
    generateNextQuestion(finalWords, 0);
  };

  // 틀린 문제만 다시 풀기 핸들러 (틀린 문제만 딱 출제)
  const handleReplayWrongQuestions = () => {
    if (!sessionWrongWords.length) return;
    const wordsToReplay = [...sessionWrongWords];
    setCustomSessionWords(wordsToReplay);
    initQuizSession(wordsToReplay);
  };


  // 단어 로드: initialWords가 없으면 currentBook에 따라 적절한 JSON 또는 오답노트 fetch
  useEffect(() => {
    if (initialWords && initialWords.length > 0) {
      setAllLoadedWords(initialWords);
      setActiveBookTitle(bookTitle || (sourceType === 'photo' ? '내 사진 문제집' : sourceType === 'pdf' ? '내 PDF 문제집' : '추출 단어장'));
      return;
    }

    if (currentBook === 'wrong_notes') {
      refreshWrongNotes().then((list) => {
        setAllLoadedWords(list);
        setActiveBookTitle('오답노트');
      });
      return;
    }

    let targetUrl = '/data/builtin_words_v1.json';
    let defaultTitle = 'TOEIC(1800단어)';

    if (currentBook === 'maritime') {
      targetUrl = '/data/maritime_smcp_v1.json';
      defaultTitle = '해사 핵심단어';
    } else if (currentBook === 'maritime_comm') {
      targetUrl = '/data/maritime_communication_v1.json';
      defaultTitle = '실전 통신문장';
    } else if (currentBook === 'japanese_exam') {
      targetUrl = '/data/builtin_japanese_exam.json';
      defaultTitle = '일본어 시험용';
    } else if (currentBook === 'japanese_life') {
      targetUrl = '/data/builtin_japanese_life.json';
      defaultTitle = '생활일본어';
    }

    fetch(targetUrl)
      .then((r) => r.json())
      .then((data: any) => {
        if (data.words && data.words.length > 0) {
          const entries = data.words.map(toWordEntry);
          setAllLoadedWords(entries);
          setActiveBookTitle(defaultTitle);
        }
      })
      .catch((err) => {
        console.warn('단어 로드 실패, IndexedDB 확인:', err);
        db.words.toArray().then((saved) => {
          if (saved && saved.length >= 4) {
            setAllLoadedWords(saved);
            setActiveBookTitle(`내 문제집 (${saved.length}단어)`);
          }
        });
      });
  }, [initialWords, bookTitle, currentBook]);

  // 필터, 문항수, 셔플, 출제모드 설정 변경 시 새 퀴즈 세션 생성
  useEffect(() => {
    if (filteredWords.length > 0) {
      initQuizSession();
    } else {
      setQuizWords([]);
      setCurrentQuiz(null);
    }
  }, [filteredWords, selectedCount, shuffleOrder, japaneseMode]);


  // 실제 채점 처리
  const processGrading = async (idx: number) => {
    if (!currentQuiz || isAnswered) return;
    setIsAnswered(true);

    const isCorrect = idx === currentQuiz.correctIndex;
    const currentWordEntry = quizWords[currentIndex % quizWords.length] || allLoadedWords.find(w => w.word === currentQuiz.word);

    if (isCorrect) {
      setScore((s) => ({ ...s, correct: s.correct + 1 }));
      // 정답 시 오답노트에 있던 단어라면 카운트 감소 또는 해결
      if (currentQuiz.word) {
        wrongNoteService.resolveWrongWord(currentQuiz.word).then(() => {
          refreshWrongNotes();
        });
      }
    } else {
      setScore((s) => ({ ...s, wrong: s.wrong + 1 }));
      // 1. 이번 퀴즈 세션 오답 목록에 추가 (틀린 문제만 다시 풀기용)
      if (currentWordEntry) {
        setSessionWrongWords((prev) => {
          if (prev.some((w) => w.word.toLowerCase() === currentWordEntry.word.toLowerCase())) {
            return prev;
          }
          return [...prev, currentWordEntry];
        });
        // 2. 오답노트 영구 저장소에 자동 등록
        wrongNoteService.addWrongWord(currentWordEntry).then(() => {
          refreshWrongNotes();
        });
      }
    }

    // IndexedDB에 학습 이력 기록
    try {
      await db.studyHistory.add({
        wordId: currentQuiz.wordId,
        isCorrect,
        selectedAnswer: currentQuiz.options[idx],
        studiedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('이력 저장 실패:', e);
    }
  };

  // 보기 터치 시
  const handleSelectOption = (idx: number) => {
    if (isAnswered || !currentQuiz) return;
    setSelectedIndex(idx);

    // 즉시 채점 옵션이 켜져 있는 경우에만 즉시 판정
    if (instantGrading) {
      processGrading(idx);
    }
  };

  // 정답 확인 버튼 클릭 (실수 방지 모드일 때)
  const handleConfirmAnswer = () => {
    if (selectedIndex === null || isAnswered || !currentQuiz) return;
    processGrading(selectedIndex);
  };

  const handleNext = () => {
    const wordListToUse = quizWords.length > 0 ? quizWords : filteredWords;
    if (!wordListToUse.length || !isAnswered) return;
    const nextIdx = currentIndex + 1;
    if (nextIdx >= totalQuestions) {
      // 퀴즈 완료 시
      setCurrentIndex(nextIdx);
      return;
    }
    setCurrentIndex(nextIdx);
    generateNextQuestion(wordListToUse, nextIdx);
  };

  const isCompleted = totalQuestions > 0 && currentIndex >= totalQuestions;

  // 퀴즈 완료 시 랭킹 점수 자동 동기화
  useEffect(() => {
    if (isCompleted && totalQuestions > 0 && !hasSyncedRef.current) {
      hasSyncedRef.current = true;
      const earned = Math.max(0, score.correct * 10 - score.wrong * 2);
      setSyncedScore(earned);
      const isJapaneseBook =
        activeLangMode === 'ja' ||
        languageMode === 'ja' ||
        currentBook === 'japanese_exam' ||
        currentBook === 'japanese_life' ||
        (quizWords.some((w) => /[\u3040-\u309F\u30A0-\u30FF]/.test(w.word))) ||
        Boolean(currentQuiz?.word && /[\u3040-\u309F\u30A0-\u30FF]/.test(currentQuiz.word));
      userService.addQuizResult(score.correct, score.wrong, isJapaneseBook ? 'ja' : 'en').catch(console.error);
    }
  }, [isCompleted, totalQuestions, score.correct, score.wrong, currentBook, currentQuiz, activeLangMode, languageMode, quizWords]);

  return (
    <div className="card quiz-card">
      {/* 단어장 선택 탭 (영어/일본어 3개 체제 최적화) */}
      {!initialWords ? (
        <div style={{ marginBottom: '8px' }}>
          {activeLangMode === 'en' ? (
            <div className="book-selector-tabs" style={{ width: '100%', margin: 0, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
              <button
                type="button"
                className={`book-tab-btn ${currentBook === 'builtin' ? 'active' : ''}`}
                onClick={() => handleSwitchBook('builtin')}
              >
                <span>📖</span>
                <span>토익</span>
              </button>
              <button
                type="button"
                className={`book-tab-btn ${(currentBook === 'maritime' || currentBook === 'maritime_comm') ? 'active' : ''}`}
                onClick={() => handleSwitchBook(currentBook === 'maritime_comm' ? 'maritime_comm' : 'maritime')}
              >
                <span>⚓</span>
                <span>해사영어</span>
              </button>
              <button
                type="button"
                className={`book-tab-btn ${currentBook === 'wrong_notes' ? 'active' : ''}`}
                onClick={() => handleSwitchBook('wrong_notes')}
              >
                <span>📝</span>
                <span>오답노트</span>
              </button>
            </div>
          ) : (
            <div className="book-selector-tabs" style={{ width: '100%', margin: 0, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
              <button
                type="button"
                className={`book-tab-btn ${currentBook === 'japanese_exam' ? 'active' : ''}`}
                onClick={() => handleSwitchBook('japanese_exam')}
              >
                <span>📝</span>
                <span>시험용</span>
              </button>
              <button
                type="button"
                className={`book-tab-btn ${currentBook === 'japanese_life' ? 'active' : ''}`}
                onClick={() => handleSwitchBook('japanese_life')}
              >
                <span>🍱</span>
                <span>생활일본어</span>
              </button>
              <button
                type="button"
                className={`book-tab-btn ${currentBook === 'wrong_notes' ? 'active' : ''}`}
                onClick={() => handleSwitchBook('wrong_notes')}
              >
                <span>📝</span>
                <span>오답노트</span>
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* 해사영어 선택 시 노출되는 2대 서브 탭 (핵심단어 vs 실전 통신문장) */}
      {!initialWords && activeLangMode === 'en' && (currentBook === 'maritime' || currentBook === 'maritime_comm') && (
        <div className="japanese-sub-tabs" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
          <button
            type="button"
            className={`japanese-sub-tab-btn ${currentBook === 'maritime' ? 'active' : ''}`}
            onClick={() => handleSwitchBook('maritime')}
          >
            <span>⚓ 해사 핵심단어</span>
          </button>
          <button
            type="button"
            className={`japanese-sub-tab-btn ${currentBook === 'maritime_comm' ? 'active' : ''}`}
            onClick={() => handleSwitchBook('maritime_comm')}
          >
            <span>📻 실전 통신문장</span>
          </button>
        </div>
      )}

      {/* 오답노트 모드일 때: 오답 목록 보기 툴바 */}
      {!initialWords && currentBook === 'wrong_notes' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', background: 'rgba(239, 68, 68, 0.1)', padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.25)' }}>
          <span style={{ fontSize: '12px', color: '#fca5a5', fontWeight: 'bold' }}>
            📝 저장된 오답 {wrongNoteWords.length}개
          </span>
          {wrongNoteWords.length > 0 && (
            <button
              type="button"
              onClick={() => setShowWrongNoteModal(true)}
              style={{
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '4px 8px',
                fontSize: '11px',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              📋 오답 모음집 보기
            </button>
          )}
        </div>
      )}

      {/* 난이도 및 문제 수 설정 툴바 (스마트폰 2줄 깨짐 완벽 방지 반응형) */}
      <div className="quiz-controls-toolbar">
        <div className="control-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="control-label">{isJapanese ? '난이도 / 등급' : '난이도'}</span>
            <button
              type="button"
              className="btn-text-shuffle"
              onClick={() => initQuizSession()}
              title="출제 순서를 무작위로 새로 섞습니다"
            >
              🔀 순서 섞기
            </button>
          </div>
          {isJapanese ? (
            <div className="control-btn-grid difficulty-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
              {[
                { id: 'all', label: '전체' },
                { id: 'basic', label: '🌱 기초' },
                { id: 'n5', label: '🥉 N5' },
                { id: 'n4', label: '🥈 N4' },
                { id: 'n3', label: '🥇 N3' },
              ].map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`control-btn ${selectedDifficulty === d.id ? 'active' : ''}`}
                  onClick={() => setSelectedDifficulty(d.id as SelectedDifficulty)}
                  style={{ fontSize: '11px', padding: '6px 2px' }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="control-btn-grid difficulty-grid">
              {(['all', 'easy', 'medium', 'hard'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`control-btn ${selectedDifficulty === d ? 'active' : ''}`}
                  onClick={() => setSelectedDifficulty(d)}
                >
                  {d === 'all' ? '전체' : d === 'easy' ? '하 (EASY)' : d === 'medium' ? '중 (MID)' : '상 (HARD)'}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 일본어 전용 출제 모드 선택 툴바 */}
        {isJapanese && (
          <div className="control-group" style={{ marginTop: '6px' }}>
            <span className="control-label" style={{ color: '#38bdf8' }}>🎯 출제 모드</span>
            <div className="control-btn-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
              {[
                { mode: 'meaning', icon: '💡', title: '한글뜻 맞추기' },
                { mode: 'hiragana', icon: '🔤', title: '히라가나 맞추기' },
                { mode: 'combined', icon: '🌟', title: '히라가나+뜻' },
              ].map((m) => (
                <button
                  key={m.mode}
                  type="button"
                  className={`control-btn ${japaneseMode === m.mode ? 'active' : ''}`}
                  onClick={() => setJapaneseMode(m.mode as JapaneseQuizMode)}
                  style={{ fontSize: '11px', padding: '6px 2px', fontWeight: 'bold' }}
                >
                  <span>{m.icon} {m.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}


        <div className="control-group">
          <span className="control-label">문항 수</span>
          <div className="control-btn-grid count-grid">
            {([10, 20, 30, 50, 'all'] as const).map((cnt) => (
              <button
                key={cnt}
                type="button"
                className={`control-btn ${selectedCount === cnt ? 'active' : ''}`}
                onClick={() => setSelectedCount(cnt)}
              >
                {cnt === 'all' ? '전체' : `${cnt}개`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isCompleted ? (
        <div style={{ textAlign: 'center', padding: '30px 16px' }}>
          <h2 style={{ fontSize: '22px', fontWeight: 'bold', marginBottom: '8px', color: '#38bdf8' }}>🎉 퀴즈 완료!</h2>
          
          {/* 점수 획득 배너 */}
          <div style={{ background: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '14px', padding: '14px', maxWidth: '320px', margin: '0 auto 16px' }}>
            <span style={{ fontSize: '12px', color: '#a5b4fc', display: 'block', fontWeight: 'bold' }}>🏆 랭킹 점수 반영</span>
            <span style={{ fontSize: '26px', fontWeight: '900', color: '#fbbf24', display: 'block', margin: '4px 0' }}>
              +{syncedScore !== null ? syncedScore : Math.max(0, score.correct * 10 - score.wrong * 2)}점
            </span>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              (맞춤 +10점 / 틀림 -2점 적용)
            </span>
          </div>

          <p style={{ fontSize: '15px', marginBottom: '16px', color: '#e2e8f0' }}>
            총 <strong>{totalQuestions}</strong>문제 중 <strong style={{ color: '#4ade80' }}>{score.correct}</strong>문제 정답 (<strong style={{ color: '#f87171' }}>{score.wrong}</strong>문제 오답)
          </p>

          {/* 틀린 문제가 있을 때: 틀린 문제만 한번 더 풀기 버튼 */}
          {sessionWrongWords.length > 0 ? (
            <div style={{ marginBottom: '16px' }}>
              <button
                type="button"
                className="btn btn-wrong-replay"
                onClick={handleReplayWrongQuestions}
                style={{
                  width: '100%',
                  maxWidth: '320px',
                  padding: '12px 18px',
                  fontSize: '15px',
                  fontWeight: '800',
                  background: 'linear-gradient(135deg, #ef4444, #ea580c)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(239, 68, 68, 0.4)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                <span>🔥 틀린 문제만 다시 풀기</span>
                <span style={{ background: 'rgba(0,0,0,0.25)', padding: '2px 8px', borderRadius: '10px', fontSize: '13px' }}>
                  {sessionWrongWords.length}문제
                </span>
              </button>
            </div>
          ) : (
            <div style={{ margin: '14px 0', color: '#4ade80', fontWeight: 'bold', fontSize: '15px' }}>
              ✨ 틀린 문제가 없습니다! 모든 문제를 완벽하게 맞히셨습니다! 👏
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              style={{ padding: '10px 18px', fontSize: '14px', fontWeight: 'bold' }}
              onClick={() => initQuizSession()}
            >
              전체 다시 풀기 🔄
            </button>
            {onOpenRanking && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '10px 18px', fontSize: '14px', fontWeight: 'bold', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
                onClick={onOpenRanking}
              >
                🏆 랭킹 확인
              </button>
            )}
          </div>
        </div>
      ) : !currentQuiz ? (
        <div style={{ textAlign: 'center', padding: '36px 16px' }}>
          {currentBook === 'wrong_notes' && wrongNoteWords.length === 0 ? (
            <div>
              <div style={{ fontSize: '38px', marginBottom: '10px' }}>📝</div>
              <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px', color: '#f8fafc' }}>
                오답노트가 비어 있습니다!
              </h3>
              <p style={{ color: '#94a3b8', fontSize: '13px', lineHeight: '1.6' }}>
                TOEIC, 해사영어, 일본어 문제를 풀다가<br />
                틀린 문제가 생기면 여기에 자동으로 차곡차곡 모입니다! ✨
              </p>
            </div>
          ) : (
            <div>
              <h3>단어 데이터를 준비 중입니다...</h3>
              <p style={{ color: '#94a3b8' }}>선택한 난이도({selectedDifficulty})의 출제 가능한 어휘를 불러오고 있습니다.</p>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* 어휘집 타이틀 1줄 + 진행 현황 1줄 분리 표기 */}
          <div className="quiz-header-card">
            <div className="quiz-header-title">
              📖 {activeBookTitle}
            </div>
            <div className="quiz-header-status">
              진행 {(currentIndex % totalQuestions) + 1}/{totalQuestions} | 정답: {score.correct}, 오답: {score.wrong}
            </div>
          </div>

          <div className="quiz-word-box">
            {/* 1. 단어 위로 올라간 난이도 뱃지 및 출제 모드 뱃지 */}
            <div className="quiz-badge-row">
              <span className="difficulty-badge">{(currentQuiz.difficulty || 'MEDIUM').toUpperCase()}</span>
              {currentQuiz.quizMode && currentQuiz.quizMode !== 'meaning' && (
                <span className="quiz-mode-badge" style={{ fontSize: '11px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', padding: '3px 8px', borderRadius: '6px', fontWeight: 'bold' }}>
                  {currentQuiz.quizMode === 'hiragana' ? '🔤 히라가나 맞추기' : '🌟 히라가나+뜻'}
                </span>
              )}
            </div>

            {/* 출제 프롬프트 안내 배너 */}
            {currentQuiz.prompt && (
              <div className="quiz-prompt-guide" style={{ fontSize: '13px', color: '#93c5fd', background: 'rgba(59, 130, 246, 0.12)', border: '1px solid rgba(59, 130, 246, 0.25)', borderRadius: '8px', padding: '6px 12px', margin: '6px 0 10px', textAlign: 'center', fontWeight: '600' }}>
                {currentQuiz.prompt}
              </div>
            )}

            <div className="quiz-headword-row">
              <h2
                className="quiz-headword"
                style={
                  (currentQuiz.word.length > 35 || (currentQuiz.displayWord && currentQuiz.displayWord.length > 35))
                    ? { fontSize: 'clamp(16px, 4.5vw, 21px)', lineHeight: 1.35, textAlign: 'center' }
                    : undefined
                }
              >
                {isAnswered ? currentQuiz.word : (currentQuiz.displayWord || currentQuiz.word)}
              </h2>
              <button
                type="button"
                className={`quiz-speak-btn ${isSpeaking ? 'speaking' : ''}`}
                onClick={handleSpeakCurrentWord}
                title={`발음 듣기 (${currentLang === 'ja-JP' ? '일본어' : '영어'} TTS)`}
                aria-label="발음 듣기"
              >
                🔊
              </button>
            </div>

            {/* 정답 확인 시: 문제 표제어가 한자만 노출되었던 경우(히라가나/복합 모드) 전체 표제어 + 뜻 안내 */}
            {isAnswered && currentQuiz.displayWord && currentQuiz.displayWord !== currentQuiz.word && (
              <div className="quiz-answered-detail" style={{ background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', padding: '6px 10px', margin: '8px 0', fontSize: '13px', color: '#6ee7b7', textAlign: 'center' }}>
                <strong style={{ color: '#a7f3d0' }}>📖 {currentQuiz.word}</strong>
                {currentQuiz.meaning && currentQuiz.meaning.length > 0 && (
                  <span style={{ color: '#d1fae5', marginLeft: '6px' }}>({currentQuiz.meaning.join(', ')})</span>
                )}
              </div>
            )}

            {/* 2. 원래 난이도 자리: 문제풀이 후 답이 나오면서 빈출 실전문장 표시 */}
            {isAnswered && currentExample && (

              <div className="quiz-example-box">
                <div className="quiz-example-header">
                  <span className="quiz-example-tag">💡 빈출 실전문장</span>
                  <button
                    type="button"
                    className={`quiz-example-speak-btn ${isSpeakingSentence ? 'speaking' : ''}`}
                    onClick={handleSpeakSentence}
                    title="문장 전체 발음 듣기"
                    aria-label="문장 전체 발음 듣기"
                  >
                    🔊 문장 듣기
                  </button>
                </div>
                <div className="quiz-example-text">
                  {renderHighlightedSentence(currentExample.text, currentExample.highlightWord)}
                </div>
                {currentExample.translation && (
                  <div className="quiz-example-translation">
                    {currentExample.translation}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="quiz-options-list">
            {currentQuiz.options.map((option, idx) => {
              let btnClass = 'quiz-option-btn';
              if (isAnswered) {
                if (idx === currentQuiz.correctIndex) {
                  btnClass += ' correct';
                } else if (idx === selectedIndex) {
                  btnClass += ' wrong';
                }
              } else if (selectedIndex === idx) {
                btnClass += ' selected';
              }

              return (
                <button
                  key={idx}
                  type="button"
                  className={btnClass}
                  onClick={() => handleSelectOption(idx)}
                  disabled={isAnswered}
                >
                  <span className="option-num">{idx + 1}.</span>
                  <span className="option-text">{option}</span>
                </button>
              );
            })}
          </div>

          {isAnswered && (
            <div className="quiz-feedback-box">
              {selectedIndex === currentQuiz.correctIndex ? (
                <p className="feedback-text correct">⭕ 정답입니다!</p>
              ) : (
                <p className="feedback-text wrong">
                  ❌ 오답입니다. 정답은 <strong>{currentQuiz.options[currentQuiz.correctIndex]}</strong> 입니다.
                </p>
              )}
            </div>
          )}

          {/* 하단 버튼: 즉시 채점 모드가 아닐 때 답 선택 후 [정답 확인] -> 채점 후 [다음 문제] */}
          <div className="quiz-footer" ref={quizFooterRef}>
            {!isAnswered && !instantGrading ? (
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', padding: '13px', fontSize: '15px', fontWeight: 'bold' }}
                onClick={handleConfirmAnswer}
                disabled={selectedIndex === null}
              >
                {selectedIndex === null ? '보기를 선택해주세요' : '정답 확인 →'}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', padding: '13px', fontSize: '15px', fontWeight: 'bold' }}
                onClick={handleNext}
                disabled={!isAnswered}
              >
                다음 문제 →
              </button>
            )}
          </div>
        </>
      )}
      {/* 오답노트 모음집 팝업 모달 */}
      {showWrongNoteModal && (
        <div
          className="ranking-modal-backdrop"
          onClick={() => setShowWrongNoteModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            className="ranking-modal-box"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card, #1e293b)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '16px',
              padding: '18px',
              width: '100%',
              maxWidth: '460px',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
            }}
          >
            {/* 모달 헤더 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 'bold', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>📝</span>
                  <span>오답노트 모음집</span>
                  <span style={{ fontSize: '12px', background: '#ef4444', color: '#fff', padding: '2px 8px', borderRadius: '10px' }}>
                    {wrongNoteWords.length}단어
                  </span>
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowWrongNoteModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '18px', cursor: 'pointer', padding: '4px' }}
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            {/* 단어 리스트 스크롤 영역 */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
              {wrongNoteWords.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 10px', color: '#94a3b8' }}>
                  오답노트에 저장된 단어가 없습니다.
                </div>
              ) : (
                wrongNoteWords.map((item) => (
                  <div
                    key={item.id || item.word}
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '10px',
                      padding: '10px 12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 'bold', fontSize: '15px', color: '#ffffff' }}>
                          {item.word}
                        </span>
                        <button
                          type="button"
                          onClick={() => speechService.speak(item.word, /[\u3040-\u309F\u30A0-\u30FF]/.test(item.word) ? 'ja-JP' : 'en-US')}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: 0 }}
                          title="발음 듣기"
                        >
                          🔊
                        </button>
                        <span style={{ fontSize: '10px', background: 'rgba(239,68,68,0.2)', color: '#fca5a5', padding: '1px 5px', borderRadius: '4px', fontWeight: 'bold' }}>
                          {item.wrongCount}회 오답
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#cbd5e1', marginTop: '3px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {item.meaning.join(', ')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await wrongNoteService.removeWrongWord(item.word);
                        refreshWrongNotes();
                      }}
                      style={{
                        background: 'rgba(255,255,255,0.06)',
                        border: 'none',
                        color: '#94a3b8',
                        borderRadius: '6px',
                        padding: '4px 8px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                      title="오답노트에서 삭제"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* 모달 푸터 액션 */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '14px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              {wrongNoteWords.length > 0 && (
                <button
                  type="button"
                  onClick={async () => {
                    if (window.confirm('오답노트를 모두 비우시겠습니까?')) {
                      await wrongNoteService.clearAll();
                      refreshWrongNotes();
                      setShowWrongNoteModal(false);
                    }
                  }}
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                  }}
                >
                  전체 비우기
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setShowWrongNoteModal(false);
                  if (wrongNoteWords.length > 0) {
                    handleSwitchBook('wrong_notes');
                    initQuizSession(wrongNoteWords);
                  }
                }}
                disabled={wrongNoteWords.length === 0}
                style={{
                  flex: 1,
                  background: 'linear-gradient(135deg, #ef4444, #ea580c)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 14px',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  cursor: wrongNoteWords.length === 0 ? 'default' : 'pointer',
                  opacity: wrongNoteWords.length === 0 ? 0.5 : 1,
                }}
              >
                🎯 오답 퀴즈 풀기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

