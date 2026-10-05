import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createQuizQuestion, generateMaritimeTrapSentence } from '../src/quiz/quizEngine';
import type { WordEntry } from '../src/types/word';

describe('해사 통신 문장 문제집 (maritime_communication_v1.json) 검증', () => {
  const commPath = path.resolve('public/data/maritime_communication_v1.json');

  it('통신 문장 데이터 파일이 존재하고 최소 150문항 이상이어야 한다', () => {
    expect(fs.existsSync(commPath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(commPath, 'utf-8'));
    expect(data.category).toBe('maritime_communication');
    expect(data.words.length).toBeGreaterThanOrEqual(150);
    expect(data.wordCount).toBe(data.words.length);
  });

  it('모든 통신 문장은 영어 문장, 한국어 정답, 3개의 오답을 포함해야 한다', () => {
    const data = JSON.parse(fs.readFileSync(commPath, 'utf-8'));
    for (const item of data.words) {
      expect(item.word).toBeDefined();
      expect(item.word.length).toBeGreaterThan(5);
      expect(Array.isArray(item.meaning)).toBe(true);
      expect(item.meaning.length).toBeGreaterThanOrEqual(1);
      expect(item.meaning[0].length).toBeGreaterThan(2);
      expect(Array.isArray(item.distractors)).toBe(true);
      expect(item.distractors.length).toBe(3);
    }
  });

  it('4지선다 출제 엔진에서 정답 유일성 Hard Gate를 100% 통과해야 한다', () => {
    const data = JSON.parse(fs.readFileSync(commPath, 'utf-8'));
    const entries: WordEntry[] = data.words.map((w: any) => ({
      id: String(w.id),
      word: w.word,
      meaning: w.meaning,
      partOfSpeech: '통신문',
      difficulty: w.difficulty,
      topic: 'communication',
      confusables: w.distractors,
    }));

    // 전체 150문항 전수 테스트
    for (let i = 0; i < entries.length; i++) {
      const target = entries[i];
      const correctMeaning = target.meaning[0];
      const distractors = target.confusables || [];

      // 3개 오답이 정답과 일치하지 않는지 확인
      for (const d of distractors) {
        expect(d).not.toBe(correctMeaning);
      }
      // 3개 오답 간 중복이 없는지 확인
      expect(new Set(distractors).size).toBe(3);

      const question = createQuizQuestion(entries, target, {
        seed: 1000 + i,
        matchPartOfSpeech: false,
      });

      expect(question).toBeDefined();
      expect(question!.options.length).toBe(4);
      expect(question!.correctIndex).toBeGreaterThanOrEqual(0);
      expect(question!.correctIndex).toBeLessThan(4);
      expect(question!.options[question!.correctIndex]).toBe(correctMeaning);
      // 4개 선지에 중복이 없어야 함
      expect(new Set(question!.options).size).toBe(4);
    }
  });

  it('해사 대칭 함정 문구 생성기(generateMaritimeTrapSentence)가 의도한 대칭 문장을 생성해야 한다', () => {
    expect(generateMaritimeTrapSentence('우현 대 우현 통과에 동의하는가?')).toBe('좌현 대 좌현 통과에 동의하는가?');
    expect(generateMaritimeTrapSentence('좌현 대 좌현 통과에 동의하는가?')).toBe('우현 대 우현 통과에 동의하는가?');
    expect(generateMaritimeTrapSentence('선수에 예인선을 연결하라.')).toBe('선미에 예인선을 연결하라.');
    expect(generateMaritimeTrapSentence('메이데이. 본선은 침수 중이다.')).toBe('팬팬. 본선은 침수 중이다.');
    expect(generateMaritimeTrapSentence('전진 미속으로 항행하라.')).toBe('후진 미속으로 항행하라.');
  });
});

