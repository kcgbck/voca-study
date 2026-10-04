import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createQuizQuestion, parseJapaneseWord } from '../src/quiz/quizEngine';
import type { WordEntry } from '../src/types/word';

describe('일본어 문제집 데이터 무결성 및 등급/모드 검증 (tests/japaneseWordbooks.test.ts)', () => {
  const examPath = path.join(__dirname, '../public/data/builtin_japanese_exam.json');
  const lifePath = path.join(__dirname, '../public/data/builtin_japanese_life.json');

  it('시험용 및 생활일본어 JSON 파일이 존재하고 150단어 이상 수록되어야 한다', () => {
    expect(fs.existsSync(examPath)).toBe(true);
    expect(fs.existsSync(lifePath)).toBe(true);

    const examData = JSON.parse(fs.readFileSync(examPath, 'utf-8'));
    const lifeData = JSON.parse(fs.readFileSync(lifePath, 'utf-8'));

    expect(examData.words.length).toBeGreaterThanOrEqual(250);
    expect(lifeData.words.length).toBeGreaterThanOrEqual(150);
  });

  it('기초, N5, N4, N3 자격증 등급별 어휘가 각각 50개 이상 풍부하게 분류되어 있어야 한다', () => {
    const examData = JSON.parse(fs.readFileSync(examPath, 'utf-8'));
    const words: any[] = examData.words;

    const basicCount = words.filter((w) => w.topic === 'basic').length;
    const n5Count = words.filter((w) => w.topic === 'jlpt_n5').length;
    const n4Count = words.filter((w) => w.topic === 'jlpt_n4').length;
    const n3Count = words.filter((w) => w.topic === 'jlpt_n3').length;

    expect(basicCount).toBeGreaterThanOrEqual(50);
    expect(n5Count).toBeGreaterThanOrEqual(50);
    expect(n4Count).toBeGreaterThanOrEqual(50);
    expect(n3Count).toBeGreaterThanOrEqual(50);
  });

  it('parseJapaneseWord가 한자 표기와 히라가나 읽기(reading)를 올바르게 분리해야 한다', () => {
    const res1 = parseJapaneseWord('約束 (やくそく)');
    expect(res1.kanji).toBe('約束');
    expect(res1.reading).toBe('やくそく');
    expect(res1.isPureKana).toBe(false);

    const res2 = parseJapaneseWord('こんにちは');
    expect(res2.kanji).toBe('こんにちは');
    expect(res2.reading).toBe('こんにちは');
    expect(res2.isPureKana).toBe(true);
  });

  it('시험용 일본어 단어장 4지선다 기본 뜻 맞추기 출제 시 정답 유일성이 100% 보장되어야 한다', () => {
    const examData = JSON.parse(fs.readFileSync(examPath, 'utf-8'));
    const entries: WordEntry[] = examData.words.map((w: any) => ({
      id: String(w.id),
      word: w.word,
      meaning: w.meaning,
      partOfSpeech: w.partOfSpeech,
      difficulty: w.difficulty,
      topic: w.topic,
    }));

    // 샘플 50개 단어에 대해 퀴즈 생성 테스트
    for (let i = 0; i < 50; i++) {
      const target = entries[i];
      const q = createQuizQuestion(entries, target, { seed: 1000 + i, japaneseMode: 'meaning' });
      expect(q).not.toBeNull();
      if (q) {
        expect(q.options.length).toBe(4);
        const correctMeaning = target.meaning[0];
        expect(q.options[q.correctIndex]).toBe(correctMeaning);
        const uniqueSet = new Set(q.options);
        expect(uniqueSet.size).toBe(4);
      }
    }
  });

  it('히라가나 맞추기 모드 출제 시 한자만 displayWord로 노출되고 보기는 히라가나 4개여야 한다', () => {
    const examData = JSON.parse(fs.readFileSync(examPath, 'utf-8'));
    const entries: WordEntry[] = examData.words.map((w: any) => ({
      id: String(w.id),
      word: w.word,
      meaning: w.meaning,
      partOfSpeech: w.partOfSpeech,
      difficulty: w.difficulty,
      topic: w.topic,
    }));

    // 한자가 있는 단어 샘플
    const kanjiWord = entries.find((w) => w.word.includes('('))!;
    expect(kanjiWord).toBeDefined();

    const q = createQuizQuestion(entries, kanjiWord, { seed: 3001, japaneseMode: 'hiragana' });
    expect(q).not.toBeNull();
    if (q) {
      expect(q.quizMode).toBe('hiragana');
      expect(q.prompt).toContain('히라가나');
      // displayWord에 괄호나 히라가나가 없어야 함 (한자만 노출)
      expect(q.displayWord).not.toContain('(');
      expect(q.displayWord).not.toContain(')');
      expect(q.options.length).toBe(4);
      // 정답이 올바른 reading인지 확인
      const parsed = parseJapaneseWord(kanjiWord.word);
      expect(q.options[q.correctIndex]).toBe(parsed.reading);
      // 보기 중복 0건
      const uniqueSet = new Set(q.options);
      expect(uniqueSet.size).toBe(4);
    }
  });

  it('히라가나+한글뜻 같이 맞추기 모드 출제 시 보기가 [히라가나 (뜻)] 형태여야 한다', () => {
    const examData = JSON.parse(fs.readFileSync(examPath, 'utf-8'));
    const entries: WordEntry[] = examData.words.map((w: any) => ({
      id: String(w.id),
      word: w.word,
      meaning: w.meaning,
      partOfSpeech: w.partOfSpeech,
      difficulty: w.difficulty,
      topic: w.topic,
    }));

    const targetWord = entries[0];
    const q = createQuizQuestion(entries, targetWord, { seed: 4001, japaneseMode: 'combined' });
    expect(q).not.toBeNull();
    if (q) {
      expect(q.quizMode).toBe('combined');
      expect(q.prompt).toContain('히라가나와 뜻');
      expect(q.options.length).toBe(4);
      // 모든 보기가 "(뜻)" 형태를 포함해야 함
      for (const opt of q.options) {
        expect(opt).toContain('(');
        expect(opt).toContain(')');
      }
      const uniqueSet = new Set(q.options);
      expect(uniqueSet.size).toBe(4);
    }
  });

  it('생활일본어 단어장 4지선다 출제 시 정답 유일성이 100% 보장되어야 한다', () => {
    const lifeData = JSON.parse(fs.readFileSync(lifePath, 'utf-8'));
    const entries: WordEntry[] = lifeData.words.map((w: any) => ({
      id: String(w.id),
      word: w.word,
      meaning: w.meaning,
      partOfSpeech: w.partOfSpeech,
      difficulty: w.difficulty,
      topic: w.topic,
    }));

    for (let i = 0; i < 50; i++) {
      const target = entries[i];
      const q = createQuizQuestion(entries, target, { seed: 2000 + i });
      expect(q).not.toBeNull();
      if (q) {
        expect(q.options.length).toBe(4);
        const correctMeaning = target.meaning[0];
        expect(q.options[q.correctIndex]).toBe(correctMeaning);
        const uniqueSet = new Set(q.options);
        expect(uniqueSet.size).toBe(4);
      }
    }
  });
});
