import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { wrongNoteService } from '../src/services/wrongNoteService';
import type { WordEntry } from '../src/types/word';

// Mock localStorage for node environment
const storageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

describe('wrongNoteService (오답노트 및 틀린 문제 관리)', () => {
  const originalWindow = (globalThis as any).window;
  const originalLocalStorage = (globalThis as any).localStorage;

  beforeEach(async () => {
    (globalThis as any).window = globalThis;
    (globalThis as any).localStorage = storageMock;
    storageMock.clear();
    await wrongNoteService.clearAll();
  });

  afterEach(async () => {
    await wrongNoteService.clearAll();
    (globalThis as any).window = originalWindow;
    (globalThis as any).localStorage = originalLocalStorage;
  });

  it('초기 오답노트는 비어 있어야 한다', async () => {
    const list = await wrongNoteService.getWrongWords();
    expect(list).toEqual([]);
    const count = await wrongNoteService.getWrongCount();
    expect(count).toBe(0);
  });

  it('오답 단어를 추가하면 오답노트에 등록되고 wrongCount가 1이 되어야 한다', async () => {
    const sampleWord: WordEntry = {
      word: 'negotiate',
      meaning: ['협상하다'],
      partOfSpeech: 'verb',
      difficulty: 'medium',
      topic: 'biz',
    };

    await wrongNoteService.addWrongWord(sampleWord);

    const list = await wrongNoteService.getWrongWords();
    expect(list.length).toBe(1);
    expect(list[0].word).toBe('negotiate');
    expect(list[0].wrongCount).toBe(1);
    expect(list[0].sourceBookId).toBe('wrong_notes');
    expect(await wrongNoteService.getWrongCount()).toBe(1);
  });

  it('동일한 단어를 다시 틀리면 wrongCount가 누적 증가해야 한다', async () => {
    const sampleWord: WordEntry = {
      word: 'implement',
      meaning: ['시행하다', '도구'],
      partOfSpeech: 'verb',
      difficulty: 'high',
      topic: 'tech',
    };

    await wrongNoteService.addWrongWord(sampleWord);
    await wrongNoteService.addWrongWord(sampleWord);

    const list = await wrongNoteService.getWrongWords();
    expect(list.length).toBe(1);
    expect(list[0].word).toBe('implement');
    expect(list[0].wrongCount).toBe(2);
  });

  it('여러 다른 단어를 추가하면 오답 목록에 정상적으로 누적되어야 한다', async () => {
    const word1: WordEntry = { word: 'apple', meaning: ['사과'], partOfSpeech: 'noun', difficulty: 'low', topic: 'general' };
    const word2: WordEntry = { word: 'banana', meaning: ['바나나'], partOfSpeech: 'noun', difficulty: 'low', topic: 'general' };

    await wrongNoteService.addWrongWord(word1);
    await wrongNoteService.addWrongWord(word2);

    const list = await wrongNoteService.getWrongWords();
    expect(list.length).toBe(2);
    const words = list.map((w) => w.word);
    expect(words).toContain('apple');
    expect(words).toContain('banana');
  });

  it('2회 이상 틀린 단어를 맞히면 wrongCount가 1 감소해야 한다', async () => {
    const sampleWord: WordEntry = {
      word: 'collaborate',
      meaning: ['협력하다'],
      partOfSpeech: 'verb',
      difficulty: 'medium',
      topic: 'biz',
    };

    await wrongNoteService.addWrongWord(sampleWord);
    await wrongNoteService.addWrongWord(sampleWord); // wrongCount = 2

    const resolved = await wrongNoteService.resolveWrongWord('collaborate');
    expect(resolved).toBe(true);

    const list = await wrongNoteService.getWrongWords();
    expect(list.length).toBe(1);
    expect(list[0].wrongCount).toBe(1);
  });

  it('1회 남은 단어를 맞히면 오답노트에서 완전히 졸업(제거)되어야 한다', async () => {
    const sampleWord: WordEntry = {
      word: 'revenue',
      meaning: ['수익'],
      partOfSpeech: 'noun',
      difficulty: 'medium',
      topic: 'biz',
    };

    await wrongNoteService.addWrongWord(sampleWord); // wrongCount = 1

    const resolved = await wrongNoteService.resolveWrongWord('revenue');
    expect(resolved).toBe(true);

    const list = await wrongNoteService.getWrongWords();
    expect(list.length).toBe(0);
    expect(await wrongNoteService.getWrongCount()).toBe(0);
  });

  it('수동으로 removeWrongWord를 호출하면 즉시 오답노트에서 삭제되어야 한다', async () => {
    const sampleWord: WordEntry = {
      word: 'temporary',
      meaning: ['임시의'],
      partOfSpeech: 'adj',
      difficulty: 'medium',
      topic: 'biz',
    };

    await wrongNoteService.addWrongWord(sampleWord);
    expect(await wrongNoteService.getWrongCount()).toBe(1);

    await wrongNoteService.removeWrongWord('temporary');
    expect(await wrongNoteService.getWrongCount()).toBe(0);
  });

  it('clearAll을 호출하면 모든 오답 목록이 비워져야 한다', async () => {
    await wrongNoteService.addWrongWord({ word: 'cat', meaning: ['고양이'], partOfSpeech: 'noun', difficulty: 'low', topic: 'general' });
    await wrongNoteService.addWrongWord({ word: 'dog', meaning: ['개'], partOfSpeech: 'noun', difficulty: 'low', topic: 'general' });

    expect(await wrongNoteService.getWrongCount()).toBe(2);

    await wrongNoteService.clearAll();

    expect(await wrongNoteService.getWrongCount()).toBe(0);
    expect(await wrongNoteService.getWrongWords()).toEqual([]);
  });
});
