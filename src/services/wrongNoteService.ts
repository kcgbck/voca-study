/**
 * 보카 스터디 오답노트(틀린 문제 모음집) 관리 서비스
 * 
 * 퀴즈 풀이 중 틀린 단어를 자동으로 수집하고,
 * 오답노트 단어장으로 복습하거나 개별 삭제, 해결 처리를 지원합니다.
 * IndexedDB (db.words with sourceBookId='wrong_notes') 및 로컬스토리지 백업으로 무손실 영구 보존.
 */

import { db } from '../storage/db';
import type { WordEntry } from '../types/word';

export interface WrongWordItem extends WordEntry {
  wrongCount: number;
  lastWrongAt: string;
}

const STORAGE_KEY = 'voca_study_wrong_notes_v1';

export const wrongNoteService = {
  /**
   * 로컬 스토리지에서 오답 목록 동기적 조회 (캐시)
   */
  getWrongWordsSync(): WrongWordItem[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  },

  /**
   * 오답노트 전체 단어 목록 비동기 조회 (IndexedDB 및 캐시 동기화)
   */
  async getWrongWords(): Promise<WrongWordItem[]> {
    if (typeof window === 'undefined') return [];

    try {
      // 1. IndexedDB에서 sourceBookId === 'wrong_notes' 조회
      const dbWords = await db.words.where('sourceBookId').equals('wrong_notes').toArray();
      if (dbWords && dbWords.length > 0) {
        const syncList = this.getWrongWordsSync();
        const syncMap = new Map(syncList.map((w) => [w.word.toLowerCase(), w]));

        const merged: WrongWordItem[] = dbWords.map((w) => {
          const cached = syncMap.get(w.word.toLowerCase());
          return {
            ...w,
            wrongCount: cached?.wrongCount || 1,
            lastWrongAt: cached?.lastWrongAt || w.createdAt || new Date().toISOString(),
          };
        });

        // 최신 오답 순으로 정렬
        merged.sort((a, b) => new Date(b.lastWrongAt).getTime() - new Date(a.lastWrongAt).getTime());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        return merged;
      }
    } catch (e) {
      console.warn('[WrongNote] IndexedDB 조회 실패, 로컬스토리지 대체:', e);
    }

    // fallback
    return this.getWrongWordsSync();
  },

  /**
   * 오답노트에 틀린 단어 추가 또는 횟수 증가
   */
  async addWrongWord(word: WordEntry): Promise<void> {
    if (!word || !word.word) return;

    const currentList = this.getWrongWordsSync();
    const cleanWord = word.word.trim();
    const norm = cleanWord.toLowerCase();
    const now = new Date().toISOString();

    const existingIdx = currentList.findIndex((item) => item.word.toLowerCase() === norm);
    let updatedItem: WrongWordItem;

    if (existingIdx >= 0) {
      const existing = currentList[existingIdx];
      updatedItem = {
        ...existing,
        ...word,
        word: cleanWord,
        wrongCount: (existing.wrongCount || 1) + 1,
        lastWrongAt: now,
      };
      currentList[existingIdx] = updatedItem;
    } else {
      updatedItem = {
        ...word,
        id: `wrong_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        word: cleanWord,
        sourceBookId: 'wrong_notes',
        wrongCount: 1,
        lastWrongAt: now,
        createdAt: now,
      };
      currentList.unshift(updatedItem);
    }

    // 로컬스토리지 즉시 동기화
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentList));
    } catch (_) {}

    // IndexedDB 비동기 저장
    try {
      const existingInDb = await db.words
        .where('sourceBookId')
        .equals('wrong_notes')
        .and((w) => w.word.toLowerCase() === norm)
        .first();

      if (existingInDb && existingInDb.id) {
        await db.words.update(existingInDb.id, {
          meaning: word.meaning,
          partOfSpeech: word.partOfSpeech,
          difficulty: word.difficulty,
          topic: word.topic,
          exampleSentence: word.exampleSentence,
          exampleTranslation: word.exampleTranslation,
        });
      } else {
        await db.words.add({
          ...word,
          sourceBookId: 'wrong_notes',
          createdAt: now,
        });
      }
    } catch (e) {
      console.warn('[WrongNote] IndexedDB 저장 실패:', e);
    }
  },

  /**
   * 오답 단어를 맞혔을 때 (복습 성공 시 오답노트에서 해결 처리/카운트 감소)
   * 1회 남았을 때 맞히면 오답노트에서 자동 졸업!
   */
  async resolveWrongWord(wordText: string): Promise<boolean> {
    if (!wordText) return false;
    const norm = wordText.trim().toLowerCase();
    const currentList = this.getWrongWordsSync();
    const idx = currentList.findIndex((item) => item.word.toLowerCase() === norm);

    if (idx === -1) return false;

    const item = currentList[idx];
    if (item.wrongCount > 1) {
      item.wrongCount -= 1;
      currentList[idx] = item;
    } else {
      // 1번 남은 상태에서 맞히면 오답노트에서 완전히 제거 (졸업!)
      currentList.splice(idx, 1);
      await this.removeWrongWordFromDb(norm);
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentList));
    } catch (_) {}

    return true;
  },

  /**
   * 사용자가 수동으로 오답노트에서 단어 삭제
   */
  async removeWrongWord(wordText: string): Promise<void> {
    if (!wordText) return;
    const norm = wordText.trim().toLowerCase();
    const currentList = this.getWrongWordsSync();
    const filtered = currentList.filter((item) => item.word.toLowerCase() !== norm);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch (_) {}

    await this.removeWrongWordFromDb(norm);
  },

  /**
   * IndexedDB에서 오답 삭제 헬퍼
   */
  async removeWrongWordFromDb(normWord: string): Promise<void> {
    try {
      const match = await db.words
        .where('sourceBookId')
        .equals('wrong_notes')
        .and((w) => w.word.toLowerCase() === normWord)
        .first();

      if (match && match.id) {
        await db.words.delete(match.id);
      }
    } catch (e) {
      console.warn('[WrongNote] IndexedDB 단어 삭제 실패:', e);
    }
  },

  /**
   * 오답노트 전체 초기화 (모두 비우기)
   */
  async clearAll(): Promise<void> {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}

    try {
      await db.words.where('sourceBookId').equals('wrong_notes').delete();
    } catch (e) {
      console.warn('[WrongNote] 전체 삭제 실패:', e);
    }
  },

  /**
   * 현재 오답노트에 등록된 단어 수
   */
  async getWrongCount(): Promise<number> {
    const list = await this.getWrongWords();
    return list.length;
  },
};
