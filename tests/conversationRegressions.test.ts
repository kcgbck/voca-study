import { describe, expect, it } from 'vitest';
import { ALL_32_LESSONS, getLessonById } from '../src/features/conversation/content/lessons';
import { evaluateUserUtterance } from '../src/features/conversation/engine/pedagogyEvaluator';
import { validateAndSanitizeEvaluationResult } from '../src/features/conversation/engine/responseValidator';
import { LessonStateMachine } from '../src/features/conversation/engine/lessonStateMachine';
import { validateLessonContent } from '../src/features/conversation/content/schema';

describe('Codex 독립 검토에서 발견한 교육 경계 회귀', () => {
  const lesson = getLessonById('intro-u01-l01')!;
  it.each(["I don't know.", 'I don’t know.', '???', '...'])('막힘/불확실성 표식을 보존한다: %s', text => {
    const result = evaluateUserUtterance(text, lesson);
    expect(['NEEDS_HINT', 'TRANSCRIPT_UNCERTAIN']).toContain(result.evaluation);
  });
  it.each(['Not hello.', 'I refuse to say hello.', 'This is totally unrelated hello.'])('허용 단어의 부분 일치만으로 목표 달성을 만들지 않는다: %s', text => {
    const result = evaluateUserUtterance(text, lesson);
    expect(['ACCEPT', 'OPTIONAL_EXPANSION']).not.toContain(result.evaluation);
    expect(result.matchedObjectiveId).toBeUndefined();
  });
  it('손상된 응답의 필드 타입을 예외 없이 거부한다', () => {
    expect(() => validateAndSanitizeEvaluationResult({ evaluation: 'ACCEPT', userSpokenText: {}, tutorResponseEn: 42 })).not.toThrow();
    expect(validateAndSanitizeEvaluationResult({ evaluation: 'ACCEPT', userSpokenText: {}, tutorResponseEn: 42 }).isValid).toBe(false);
  });
  it('손상된 콘텐츠 배열 요소를 예외 없이 거부한다', () => {
    expect(() => validateLessonContent({ ...lesson, keyExpressions: [null, null, null] })).not.toThrow();
    expect(validateLessonContent({ ...lesson, keyExpressions: [null, null, null] }).length).toBeGreaterThan(0);
  });
  it('완료 후 추가 턴이 완료 기록을 변조하지 않는다', () => {
    const machine = new LessonStateMachine(LessonStateMachine.createSession(lesson), lesson);
    for (let index = 0; index < 5; index++) machine.advancePhase();
    const before = structuredClone(machine.getSession());
    machine.recordTurn('Hello.', evaluateUserUtterance('Hello.', lesson), 'forged context', false);
    expect(machine.getSession()).toEqual(before);
  });
  it('공개된 세션 스냅샷을 바꿔도 내부 목표 증거가 바뀌지 않는다', () => {
    const machine = new LessonStateMachine(LessonStateMachine.createSession(lesson), lesson);
    const snapshot = machine.getSession();
    snapshot.observedObjectives[lesson.learningObjectives[0].id].isMasteredByRule = true;
    expect(machine.getSession().observedObjectives[lesson.learningObjectives[0].id].isMasteredByRule).toBe(false);
  });
});

describe('32개 전체 차시 각 학습 목표 실제 예시 평가 및 부정 매핑 방지 회귀 검증', () => {
  it('모든 32차시의 각 목표는 유효한 의도(intent)와 매핑되어 실제 정답 발화 시 해당 목표를 달성해야 한다', () => {
    expect(ALL_32_LESSONS.length).toBe(32);

    for (const l of ALL_32_LESSONS) {
      expect(l.learningObjectives.length).toBeGreaterThanOrEqual(1);

      for (const obj of l.learningObjectives) {
        // 각 목표에 대응하는 acceptableIntent가 반드시 존재해야 함
        const matchingIntent = l.acceptableIntents.find(i => i.targetObjectiveId === obj.id);
        expect(
          matchingIntent,
          `수업 ${l.id}의 목표 ${obj.id}에 대응하는 acceptableIntent가 누락되었습니다`
        ).toBeDefined();

        // 대표 발화 예시 추출 (intent의 exactMatches 또는 patterns의 첫 번째 샘플)
        const sampleUtterance = matchingIntent!.exactMatches?.[0]
          || matchingIntent!.allowedShortAnswers?.[0]
          || '';

        expect(sampleUtterance, `수업 ${l.id} 목표 ${obj.id}의 검증 샘플 발화가 비어 있습니다`).toBeTruthy();

        // 현재 목표가 obj.id일 때 정답 발화 평가
        const result = evaluateUserUtterance(sampleUtterance, l, 'controlled_practice', 0, [], obj.id);
        expect(
          ['ACCEPT', 'OPTIONAL_EXPANSION'],
          `수업 ${l.id} 목표 ${obj.id} 발화 "${sampleUtterance}" 평가 실패 (${result.evaluation})`
        ).toContain(result.evaluation);
        expect(
          result.matchedObjectiveId,
          `수업 ${l.id} 발화 "${sampleUtterance}"는 ${obj.id}로 귀속되어야 함`
        ).toBe(obj.id);
      }
    }
  });

  it('부정 검증: 현재 진행 중인 목표와 다른 목표의 정답을 말했을 때 현재 목표에 강제 귀속되지 않아야 한다', () => {
    for (const l of ALL_32_LESSONS) {
      if (l.learningObjectives.length < 2) continue;
      const targetObj = l.learningObjectives[0];
      const otherObj = l.learningObjectives[1];

      const otherIntent = l.acceptableIntents.find(i => i.targetObjectiveId === otherObj.id);
      if (!otherIntent) continue;

      const otherUtterance = otherIntent.exactMatches?.[0] || otherIntent.allowedShortAnswers?.[0];
      if (!otherUtterance) continue;

      // 현재 목표는 targetObj.id인데, 다른 목표(otherObj.id)의 정답을 발화했을 때
      const result = evaluateUserUtterance(otherUtterance, l, 'controlled_practice', 0, [], targetObj.id);

      // 현재 목표인 targetObj.id로 성취 증거를 강제 부여해서는 안 됨 (matchedObjectiveId !== targetObj.id)
      expect(result.matchedObjectiveId).toBeUndefined();
    }
  });
});

describe('기존 교재 6개 유효 문장에 대한 보수적 평가 회귀 검증 (ERROR_CORRECTION 금지)', () => {
  const validCases = [
    { lessonId: 'intro-u01-l01', input: 'Nice meeting you.', desc: '인사 교환 단답/자연스러운 표현' },
    { lessonId: 'beginner-u01-l01', input: 'Give me coffee.', desc: '격식 부족 단답이나 문법상 성립' },
    { lessonId: 'beginner-u01-l04', input: 'Chicken sandwich, remove onion.', desc: '키워드 주문 단답이나 문법상 오류 아님' },
    { lessonId: 'advanced-u01-l01', input: 'Today I will explain three things simply.', desc: '자연스러운 발표 시작 문장' },
    { lessonId: 'advanced-u01-l03', input: 'You are wrong, our company is fine.', desc: '단도직입적 반론 단답이나 문법 오류 아님' },
    { lessonId: 'advanced-u02-l02', input: 'You are wrong, you don’t understand.', desc: '직설적 표현이나 문법 자체는 완전한 문장' },
  ];

  validCases.forEach(({ lessonId, input, desc }) => {
    it(`[${lessonId}] "${input}" (${desc}) -> ERROR_CORRECTION으로 오판되지 않아야 한다`, () => {
      const lesson = getLessonById(lessonId);
      expect(lesson, `수업 ${lessonId} 없음`).toBeDefined();

      const result = evaluateUserUtterance(input, lesson!);
      expect(
        result.evaluation,
        `"${input}"은 유효한 표현 또는 확장 대상이며 ERROR_CORRECTION이 아니어야 함`
      ).not.toBe('ERROR_CORRECTION');

      expect(['ACCEPT', 'OPTIONAL_EXPANSION']).toContain(result.evaluation);
    });
  });
});
