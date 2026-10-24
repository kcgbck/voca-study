// src/features/conversation/content/schema.ts
// 수업 스키마 런타임 유효성 검사기

import type { LessonContent, CurriculumManifest } from '../types';

export interface ValidationError {
  path: string;
  message: string;
}

export function validateLessonContent(lesson: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) {
    return [{ path: 'root', message: '수업 객체가 올바르지 않습니다.' }];
  }

  const l = lesson as Partial<LessonContent>;

  if (!l.id || typeof l.id !== 'string') {
    errors.push({ path: 'id', message: '수업 id가 누락되었거나 문자열이 아닙니다.' });
  }

  if (!l.level || !['intro', 'beginner', 'intermediate', 'advanced'].includes(l.level)) {
    errors.push({ path: 'level', message: '올바른 레벨(intro, beginner, intermediate, advanced)이 아닙니다.' });
  }

  if (typeof l.unitNumber !== 'number' || l.unitNumber < 1 || l.unitNumber > 8) {
    errors.push({ path: 'unitNumber', message: '단원 번호는 1에서 8 사이의 숫자여야 합니다.' });
  }

  if (typeof l.lessonNumber !== 'number' || l.lessonNumber < 1 || l.lessonNumber > 4) {
    errors.push({ path: 'lessonNumber', message: '차시 번호는 1에서 4 사이의 숫자여야 합니다.' });
  }

  if (!l.lessonType || !['comprehension', 'controlled_practice', 'roleplay', 'transfer_assessment'].includes(l.lessonType)) {
    errors.push({ path: 'lessonType', message: '올바른 4차시 흐름 유형이 아닙니다.' });
  }

  if (!l.titleKo || typeof l.titleKo !== 'string') {
    errors.push({ path: 'titleKo', message: '차시 한국어 제목이 필요합니다.' });
  }

  if (l.status !== 'HUMAN_CURRICULUM_REVIEW_PENDING' && l.status !== 'HUMAN_CURRICULUM_REVIEW_PASS') {
    errors.push({ path: 'status', message: '실제 수업 상태는 반드시 검수 대기 또는 승인 상태여야 합니다.' });
  }

  // 핵심 표현 3개 이상 검증 (각 요소가 null 또는 비객체일 때 예외 없이 안전 검사)
  if (!Array.isArray(l.keyExpressions) || l.keyExpressions.length < 3) {
    errors.push({ path: 'keyExpressions', message: '핵심 표현은 최소 3개 이상이어야 합니다.' });
  } else {
    l.keyExpressions.forEach((exp, idx) => {
      if (!exp || typeof exp !== 'object' || typeof exp.expressionEn !== 'string' || typeof exp.meaningKo !== 'string') {
        errors.push({ path: `keyExpressions[${idx}]`, message: '영어 표현과 한국어 뜻 문자열이 필수입니다.' });
      }
    });
  }

  // 예시 대화 4턴 이상 검증
  if (!Array.isArray(l.exampleDialogue) || l.exampleDialogue.length < 4) {
    errors.push({ path: 'exampleDialogue', message: '예시 대화는 최소 4턴 이상이어야 합니다.' });
  } else {
    l.exampleDialogue.forEach((d, idx) => {
      if (!d || typeof d !== 'object' || typeof d.speaker !== 'string' || typeof d.textEn !== 'string') {
        errors.push({ path: `exampleDialogue[${idx}]`, message: '화자와 영어 텍스트가 유효하지 않습니다.' });
      }
    });
  }

  // 상황 및 고정 사실 검증
  if (
    !l.scenario ||
    typeof l.scenario !== 'object' ||
    typeof l.scenario.settingKo !== 'string' ||
    !l.scenario.facts ||
    typeof l.scenario.facts !== 'object' ||
    Array.isArray(l.scenario.facts) ||
    Object.keys(l.scenario.facts).length === 0
  ) {
    errors.push({ path: 'scenario', message: '상황 설정 및 대화 일관성을 위한 고정 사실(facts) 객체가 필수입니다.' });
  }

  // 허용 답변 의도 검증
  if (!Array.isArray(l.acceptableIntents) || l.acceptableIntents.length === 0) {
    errors.push({ path: 'acceptableIntents', message: '최소 1개 이상의 허용 답변 의도가 정의되어야 합니다.' });
  } else {
    l.acceptableIntents.forEach((intent, idx) => {
      if (!intent || typeof intent !== 'object' || !intent.intentId || !Array.isArray(intent.exactMatches)) {
        errors.push({ path: `acceptableIntents[${idx}]`, message: '허용 의도 객체 형식이 올바르지 않습니다.' });
      }
    });
  }

  // 3단계 힌트 검증
  if (
    !l.hints ||
    typeof l.hints !== 'object' ||
    typeof l.hints.keywordHintKo !== 'string' ||
    typeof l.hints.frameHintEn !== 'string' ||
    typeof l.hints.modelSentenceEn !== 'string'
  ) {
    errors.push({ path: 'hints', message: '키워드(1단계), 문장틀(2단계), 모범문장(3단계) 힌트 문자열이 모두 필요합니다.' });
  }

  // 전이 평가 과제 검증
  if (
    !l.transferTask ||
    typeof l.transferTask !== 'object' ||
    typeof l.transferTask.taskId !== 'string' ||
    typeof l.transferTask.promptKo !== 'string' ||
    !Array.isArray(l.transferTask.acceptableIntents)
  ) {
    errors.push({ path: 'transferTask', message: '독립된 새로운 상황의 전이 과제가 필수입니다.' });
  }

  // 복습 태그
  if (!Array.isArray(l.reviewTags) || l.reviewTags.length === 0) {
    errors.push({ path: 'reviewTags', message: '최소 1개 이상의 복습 태그가 필요합니다.' });
  } else {
    l.reviewTags.forEach((tag, idx) => {
      if (typeof tag !== 'string' || tag.trim() === '') {
        errors.push({ path: `reviewTags[${idx}]`, message: '복습 태그는 비어있지 않은 문자열이어야 합니다.' });
      }
    });
  }

  return errors;
}

export function validateCurriculumManifest(manifest: CurriculumManifest): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!manifest || typeof manifest !== 'object' || manifest.totalLessons !== 128) {
    errors.push({ path: 'totalLessons', message: `총 차시 수는 128이어야 합니다` });
  }

  const levels: Array<'intro' | 'beginner' | 'intermediate' | 'advanced'> = ['intro', 'beginner', 'intermediate', 'advanced'];
  let count = 0;
  let activeCount = 0;

  for (const lvl of levels) {
    const levelData = manifest.levels ? manifest.levels[lvl] : undefined;
    if (!levelData || !Array.isArray(levelData.units) || levelData.units.length !== 8) {
      errors.push({ path: `levels.${lvl}`, message: `각 레벨은 8개 단원으로 구성되어야 합니다.` });
      continue;
    }
    for (const unit of levelData.units) {
      if (!Array.isArray(unit.lessons) || unit.lessons.length !== 4) {
        errors.push({ path: `levels.${lvl}.unit${unit.unitNumber}`, message: `각 단원은 4차시로 구성되어야 합니다.` });
      } else {
        for (const lesson of unit.lessons) {
          count++;
          if (lesson.hasDetailedContent) {
            activeCount++;
          }
        }
      }
    }
  }

  if (count !== 128) {
    errors.push({ path: 'countedLessons', message: `집계된 차시가 128개가 아닙니다 (${count})` });
  }
  if (activeCount !== 32) {
    errors.push({ path: 'activeDraftLessons', message: `실제 작성된 차시는 정확히 32개여야 합니다 (현재: ${activeCount})` });
  }

  return errors;
}
