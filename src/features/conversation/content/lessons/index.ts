// src/features/conversation/content/lessons/index.ts
// 32개 검수 대상 실제 학습 콘텐츠 통합 수출 모듈

import type { LessonContent } from '../../types';
import { INTRO_LESSONS } from './intro';
import { BEGINNER_LESSONS } from './beginner';
import { INTERMEDIATE_LESSONS } from './intermediate';
import { ADVANCED_LESSONS } from './advanced';

export const ALL_32_LESSONS: LessonContent[] = [
  ...INTRO_LESSONS,
  ...BEGINNER_LESSONS,
  ...INTERMEDIATE_LESSONS,
  ...ADVANCED_LESSONS,
];

export const LESSON_MAP: Map<string, LessonContent> = new Map(
  ALL_32_LESSONS.map((lesson) => [lesson.id, lesson])
);

export function getLessonById(id: string): LessonContent | undefined {
  return LESSON_MAP.get(id);
}

export { INTRO_LESSONS, BEGINNER_LESSONS, INTERMEDIATE_LESSONS, ADVANCED_LESSONS };
