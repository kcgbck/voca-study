// tests/conversationCurriculum.test.ts
// 128차시 목차 무결성 및 32차시 실제 학습 콘텐츠 스키마 검증 테스트

import { describe, it, expect } from 'vitest';
import { CURRICULUM_MANIFEST } from '../src/features/conversation/content/manifest';
import {
  validateCurriculumManifest,
  validateLessonContent,
} from '../src/features/conversation/content/schema';
import { ALL_32_LESSONS, LESSON_MAP } from '../src/features/conversation/content/lessons';

describe('커리큘럼 128차시 Manifest 무결성 검증', () => {
  it('총 차시 수가 정확히 128차시(4레벨 × 8단원 × 4차시)여야 한다', () => {
    expect(CURRICULUM_MANIFEST.totalLessons).toBe(128);
    expect(CURRICULUM_MANIFEST.totalUnits).toBe(32);
    expect(CURRICULUM_MANIFEST.activeDraftLessons).toBe(32);
  });

  it('Manifest 스키마 유효성 검사 에러가 0건이어야 한다', () => {
    const errors = validateCurriculumManifest(CURRICULUM_MANIFEST);
    expect(errors).toHaveLength(0);
  });

  it('각 레벨별 1, 2단원(32차시)은 검수 대기이고 나머지 96차시는 준비 중으로 차단되어야 한다', () => {
    let draftCount = 0;
    let preparingCount = 0;

    const levels = ['intro', 'beginner', 'intermediate', 'advanced'] as const;
    for (const lvl of levels) {
      const levelData = CURRICULUM_MANIFEST.levels[lvl];
      expect(levelData.units).toHaveLength(8);

      for (const unit of levelData.units) {
        expect(unit.lessons).toHaveLength(4);
        for (const lesson of unit.lessons) {
          if (unit.unitNumber <= 2) {
            expect(lesson.status).toBe('HUMAN_CURRICULUM_REVIEW_PENDING');
            expect(lesson.hasDetailedContent).toBe(true);
            draftCount++;
          } else {
            expect(lesson.status).toBe('PREPARING');
            expect(lesson.hasDetailedContent).toBe(false);
            preparingCount++;
          }
        }
      }
    }

    expect(draftCount).toBe(32);
    expect(preparingCount).toBe(96);
  });
});

describe('32차시 실제 학습 콘텐츠 완전성 및 중복 배제 검증', () => {
  it('실제 작성된 32차시 콘텐츠 목록의 길이가 정확히 32개여야 한다', () => {
    expect(ALL_32_LESSONS).toHaveLength(32);
    expect(LESSON_MAP.size).toBe(32);
  });

  it('32차시 전수가 스키마 검증(목표, 3개 이상 표현, 예시대화 4턴, 3단계 힌트, 전이과제)을 통과해야 한다', () => {
    for (const lesson of ALL_32_LESSONS) {
      const errors = validateLessonContent(lesson);
      expect(
        errors,
        `차시 ${lesson.id} 검증 오류: ${JSON.stringify(errors)}`
      ).toHaveLength(0);
    }
  });

  it('모든 32차시는 임의 출시 승인 없이 HUMAN_CURRICULUM_REVIEW_PENDING 상태여야 한다', () => {
    for (const lesson of ALL_32_LESSONS) {
      expect(lesson.status).toBe('HUMAN_CURRICULUM_REVIEW_PENDING');
    }
  });

  it('단순 복제된 차시가 없어야 한다 (모든 차시의 id, 제목, 고유 상황이 유일해야 함)', () => {
    const ids = new Set<string>();
    const titles = new Set<string>();
    const situations = new Set<string>();

    for (const lesson of ALL_32_LESSONS) {
      expect(ids.has(lesson.id), `중복 ID 발견: ${lesson.id}`).toBe(false);
      ids.add(lesson.id);

      expect(titles.has(lesson.titleKo), `중복 제목 발견: ${lesson.titleKo}`).toBe(false);
      titles.add(lesson.titleKo);

      expect(situations.has(lesson.scenario.settingKo), `중복 상황 발견: ${lesson.scenario.settingKo}`).toBe(false);
      situations.add(lesson.scenario.settingKo);
    }

    expect(ids.size).toBe(32);
  });

  it('각 단원마다 4차시 흐름(이해/인지 -> 문장구성 -> 역할극 -> 전이평가)이 내용에서 명확히 드러나야 한다', () => {
    const expectedTypes = ['comprehension', 'controlled_practice', 'roleplay', 'transfer_assessment'] as const;

    for (let i = 0; i < ALL_32_LESSONS.length; i += 4) {
      const unitLessons = ALL_32_LESSONS.slice(i, i + 4);
      expect(unitLessons).toHaveLength(4);
      unitLessons.forEach((l, idx) => {
        expect(l.lessonNumber).toBe(idx + 1);
        expect(l.lessonType).toBe(expectedTypes[idx]);
        // 전이 과제 존재 여부 재확인
        expect(l.transferTask.taskId).toBeTruthy();
        expect(l.transferTask.promptKo.length).toBeGreaterThan(10);
      });
    }
  });
});
