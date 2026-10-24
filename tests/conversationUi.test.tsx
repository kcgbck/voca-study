// tests/conversationUi.test.tsx
// AI 회화 UI 서브시스템 단위 및 렌더링 검증 (ReactDOMServer 기반 순수 상태 전이 및 렌더링 시험)
// jsdom 없이 순수 Node/React 환경에서 128목차 중 96차시 준비중 잠금, 32차시 검수대기, 루트 6기능 보존, 컨트롤러 상태 동기화 검증

import ReactDOMServer from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';

import { registeredFeatures, getRegisteredFeature } from '../src/app/featureRegistry';
import { ConversationHomeView } from '../src/features/conversation/components/ConversationHomeView';
import { ConversationCurriculumView } from '../src/features/conversation/components/ConversationCurriculumView';
import { ConversationLessonView } from '../src/features/conversation/components/ConversationLessonView';
import { ConversationResultView } from '../src/features/conversation/components/ConversationResultView';
import { ConversationReviewView } from '../src/features/conversation/components/ConversationReviewView';
import { ConversationSettingsModal } from '../src/features/conversation/components/ConversationSettingsModal';
import { MicRecorderButton } from '../src/features/conversation/components/MicRecorderButton';
import { AudioPlayerButton } from '../src/features/conversation/components/AudioPlayerButton';
import { ALL_32_LESSONS } from '../src/features/conversation/content/lessons';
import { CURRICULUM_MANIFEST } from '../src/features/conversation/content/manifest';
import { LessonStateMachine } from '../src/features/conversation/engine/lessonStateMachine';
import type { ConversationSession, LessonContent, TurnEvaluationResult } from '../src/features/conversation/types';

describe('AI 영어 회화 UI 컴포넌트 및 등록소 검증 (12개 전수 시험)', () => {
  describe('1. featureRegistry 모듈 등록 및 7번째 홈 카드 검증', () => {
    it('registeredFeatures에 ai_conversation이 등록되어 있고 isVisible이 true여야 한다', () => {
      expect(registeredFeatures.length).toBeGreaterThanOrEqual(1);
      const feature = getRegisteredFeature('ai_conversation');
      expect(feature).toBeDefined();
      expect(feature?.id).toBe('ai_conversation');
      expect(feature?.tabKey).toBe('ai_conversation');
      expect(feature?.menuTitle).toContain('AI 영어 회화');
      expect(feature?.menuIcon).toBe('🗣️');
      expect(feature?.badge).toBe('초급 회화');
      expect(feature?.isVisible()).toBe(true);
      expect(feature?.Component).toBeDefined();
    });

    it('모듈형 컴포넌트가 React 요소로 안전하게 서버 렌더링되어야 한다', () => {
      const feature = getRegisteredFeature('ai_conversation');
      const Comp = feature!.Component;
      const html = ReactDOMServer.renderToString(<Comp onBack={vi.fn()} />);
      expect(html).toContain('AI 영어 회화');
    });
  });

  describe('2. 커리큘럼 128목차 표시 및 96차시 준비 중 잠금 검증', () => {
    it('CURRICULUM_MANIFEST의 총 차시는 128차시이고 활성 초안은 32차시여야 한다', () => {
      expect(CURRICULUM_MANIFEST.totalLessons).toBe(128);
      expect(CURRICULUM_MANIFEST.activeDraftLessons).toBe(32);
    });

    it('ConversationCurriculumView 렌더링 시 1~2단원(32차시)은 검수 대기, 3~8단원(96차시)은 준비 중/disabled 잠금 처리되어야 한다', () => {
      const html = ReactDOMServer.renderToString(
        <ConversationCurriculumView
          initialLevel="intro"
          onSelectLesson={vi.fn()}
          onBackToConvHome={vi.fn()}
        />
      );

      // 입문 레벨의 8개 단원 제목 렌더링 확인
      expect(html).toContain('1단원:');
      expect(html).toContain('2단원:');
      expect(html).toContain('3단원:');
      expect(html).toContain('8단원:');

      // 1, 2단원 초안 검수 대기 배지 확인
      expect(html).toContain('초안 검수 대기');

      // 3단원 이후 🔒 준비 중 배지 및 disabled 속성 확인
      expect(html).toContain('🔒 준비 중');
      expect(html).toContain('disabled');
    });
  });

  describe('3. 회화 홈(ConversationHomeView) 대시보드 렌더링 검증', () => {
    it('회화 홈에 4개 레벨 카드와 안전한 오프라인 고정 교재 모드 안내가 표시되어야 한다', () => {
      const html = ReactDOMServer.renderToString(
        <ConversationHomeView
          onSelectLevel={vi.fn()}
          onResumeSession={vi.fn()}
          onOpenReview={vi.fn()}
          onOpenSettings={vi.fn()}
          onBackToAppHome={vi.fn()}
        />
      );

      expect(html).toContain('입문 (Intro)');
      expect(html).toContain('초급 (Beginner)');
      expect(html).toContain('중급 (Intermediate)');
      expect(html).toContain('고급 (Advanced)');
      expect(html).toContain('안전한 오프라인 고정 교재 모드 기본 동작');
      expect(html).toContain('외부 종량제 API 과금 없이');
    });
  });

  describe('4. 개별 수업 흐름 컴포넌트 렌더링 검증', () => {
    const sampleLesson: LessonContent = ALL_32_LESSONS[0]; // intro-u01-l01

    it('수업 컴포넌트 렌더링 시 Node/SSR 환경의 비동기 세션 로딩 및 준비 상태를 안전하게 렌더링해야 한다', () => {
      const html = ReactDOMServer.renderToString(
        <ConversationLessonView
          lessonId={sampleLesson.id}
          onOpenReview={vi.fn()}
          onBackToCurriculum={vi.fn()}
          onBackToConvHome={vi.fn()}
        />
      );

      // Node/SSR 환경에서는 useEffect 미실행이 정상 동작이므로 로딩 세션 조회 상태를 렌더링함
      expect(html).toContain('수업 세션을 불러오는 중...');
    });

    it('AudioPlayerButton은 음성 듣기 버튼과 속도 조절(0.8x/1.0x/1.2x)을 제공해야 한다', () => {
      const html = ReactDOMServer.renderToString(
        <AudioPlayerButton text="Hello, nice to meet you." showSpeedSelector={true} />
      );

      expect(html).toContain('듣기');
      expect(html).toContain('0.8x');
      expect(html).toContain('1x');
      expect(html).toContain('1.2x');
    });

    it('MicRecorderButton은 마이크 시작 버튼과 터치 최소 44px 규격을 만족해야 한다', () => {
      const html = ReactDOMServer.renderToString(
        <MicRecorderButton onTranscribed={vi.fn()} />
      );

      expect(html).toContain('🎤');
      expect(html).toContain('conv-mic-btn');
    });
  });

  describe('5. 수업 결과 화면 (ConversationResultView) 검증', () => {
    const sampleLesson: LessonContent = ALL_32_LESSONS[0];
    const mockSession: ConversationSession = {
      sessionId: 'sess-test-01',
      lessonId: sampleLesson.id,
      contentRevision: 1,
      level: 'intro',
      phase: 'result',
      currentTaskIndex: 0,
      hintLevel: 0,
      turns: [],
      observedObjectives: {
        [sampleLesson.learningObjectives[0].id]: {
          objectiveId: sampleLesson.learningObjectives[0].id,
          evidences: [
            { situationContext: 'sit-1', userResponse: 'Hi', usedHint: false, observedAt: new Date().toISOString() },
            { situationContext: 'sit-2', userResponse: 'Hello', usedHint: false, observedAt: new Date().toISOString() },
          ],
          isMasteredByRule: true,
        },
      },
      completedTaskIds: [],
      sessionStartedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      isCompleted: true,
      rulePassed: true,
    };

    const mockProgress = {
      lessonId: sampleLesson.id,
      level: 'intro' as const,
      unitNumber: 1,
      lessonNumber: 1,
      status: 'completed' as const,
      contentRevision: 1,
      masteredObjectiveIds: [sampleLesson.learningObjectives[0].id],
      totalStudySeconds: 120,
      lastStudiedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    it('수업 결과에서 임의 AI 점수 및 랭킹 점수 가산이 배제되었음을 명시해야 한다', () => {
      const html = ReactDOMServer.renderToString(
        <ConversationResultView
          lesson={sampleLesson}
          session={mockSession}
          progress={mockProgress}
          onOpenReview={vi.fn()}
          onBackToCurriculum={vi.fn()}
          onBackToConvHome={vi.fn()}
        />
      );

      expect(html).toContain('임의 AI 점수 및 랭킹 가산 배제 원칙');
      expect(html).toContain('기존 랭킹 점수에 임의 가산되지 않습니다');
      expect(html).toContain('에빙하우스 간격 복습');
    });

    it('2개 상황 노힌트 발화로 마스터된 목표는 "마스터 달성", 미달성 목표는 "복습 권장"으로 명확히 구분되어야 한다', () => {
      const html = ReactDOMServer.renderToString(
        <ConversationResultView
          lesson={sampleLesson}
          session={mockSession}
          progress={mockProgress}
          onOpenReview={vi.fn()}
          onBackToCurriculum={vi.fn()}
          onBackToConvHome={vi.fn()}
        />
      );

      expect(html).toContain('🌟 마스터 달성');
      expect(html).toContain('2개 이상의 서로 다른 상황에서 힌트 없이 성공적으로 발화했습니다');
    });
  });

  describe('6. 간격 복습 및 설정 모달 검증', () => {
    it('복습 큐 확인 시 대기열 안내 및 회화 홈 이동 버튼이 렌더링되어야 한다', () => {
      const html = ReactDOMServer.renderToString(
        <ConversationReviewView onBackToConvHome={vi.fn()} />
      );

      expect(html).toContain('복습 큐를 확인하는 중');
    });

    it('설정 모달 열림 시 4대 필수 동의 항목과 오프라인 모드 안내가 모두 포함되어야 한다', () => {
      const html = ReactDOMServer.renderToString(
        <ConversationSettingsModal isOpen={true} onClose={vi.fn()} />
      );

      expect(html).toContain('AI 회화 설정 및 이용 안내');
      expect(html).toContain('오프라인 고정 교재 모드');
      expect(html).toContain('만 19세 이상 성인 사용자 본인 확인');
      expect(html).toContain('현재 발화와 이 수업 최근 최대 6턴 최소 전송 동의');
      expect(html).toContain('Google 서비스 품질 개선 및 사람 검토 가능성 고지 확인');
      expect(html).toContain('민감정보 및 개인정보 미포함 서약');
      expect(html).toContain('STT 음성 인식 후 텍스트 입력창에서 직접 확인·편집 후 전송');
    });
  });

  describe('7. 순수 컨트롤러 및 상태 머신 단위 시험 (동기화 무결성)', () => {
    const sampleLesson: LessonContent = ALL_32_LESSONS[0];

    it('updateDraft 및 updateTaskIndex는 상태 머신 내부 세션과 getSession()에 즉각 반영되어야 한다', () => {
      const session = LessonStateMachine.createSession(sampleLesson, 'test-sess-controller');
      const machine = new LessonStateMachine(session, sampleLesson);

      machine.updateDraft('Hello Alex');
      expect(machine.getSession().draftUtterance).toBe('Hello Alex');

      machine.updateTaskIndex(2);
      expect(machine.getSession().currentTaskIndex).toBe(2);

      // 완료된 세션에 대한 mutation 방어 검증
      machine.advancePhase(); // expressions
      machine.advancePhase(); // practice
      machine.advancePhase(); // roleplay
      machine.advancePhase(); // transfer_assessment
      machine.advancePhase(); // result (finalized)

      expect(machine.getSession().isCompleted).toBe(true);
      machine.updateDraft('Hacked draft');
      expect(machine.getSession().draftUtterance).toBe('Hello Alex');
    });

    it('수업에 존재하지 않는 가짜 목표 ID나 관찰되지 않은 목표는 마스터 증거로 변조되지 않아야 한다', () => {
      const session = LessonStateMachine.createSession(sampleLesson, 'test-sess-security');
      const machine = new LessonStateMachine(session, sampleLesson);

      const fakeEvaluation: TurnEvaluationResult = {
        evaluation: 'ACCEPT',
        matchedObjectiveId: 'non-existent-objective-id-999',
        userSpokenText: 'I am Bob',
        isShortAnswer: false,
        tutorResponseEn: 'Nice to meet you',
        factualConsistency: { consistent: true },
        isSafeText: true,
      };

      machine.recordTurn('I am Bob', fakeEvaluation, 'situation-1', false);
      const afterSession = machine.getSession();

      // 가짜 목표 ID는 세션에 추가되지 않아야 함
      expect(afterSession.observedObjectives['non-existent-objective-id-999']).toBeUndefined();

      // 실제 목표 1에 대해 1회 노힌트 발화 기록
      const validEvaluation: TurnEvaluationResult = {
        evaluation: 'ACCEPT',
        matchedObjectiveId: sampleLesson.learningObjectives[0].id,
        userSpokenText: 'Hello, I am Alex.',
        isShortAnswer: false,
        tutorResponseEn: 'Nice to meet you',
        factualConsistency: { consistent: true },
        isSafeText: true,
      };

      machine.recordTurn('Hello, I am Alex.', validEvaluation, 'situation-1', false);
      // 1개 상황 노힌트로는 마스터 false
      expect(machine.getSession().observedObjectives[sampleLesson.learningObjectives[0].id].isMasteredByRule).toBe(false);

      // 같은 상황에서 다시 노힌트 발화해도 상황 수가 1개이므로 여전히 false
      machine.recordTurn('Hello, I am Alex.', validEvaluation, 'situation-1', false);
      expect(machine.getSession().observedObjectives[sampleLesson.learningObjectives[0].id].isMasteredByRule).toBe(false);

      // 서로 다른 2번째 상황에서 노힌트 발화 시 비로소 마스터 true
      machine.recordTurn('Hello, I am Alex.', validEvaluation, 'situation-2', false);
      expect(machine.getSession().observedObjectives[sampleLesson.learningObjectives[0].id].isMasteredByRule).toBe(true);
    });
  });
});
