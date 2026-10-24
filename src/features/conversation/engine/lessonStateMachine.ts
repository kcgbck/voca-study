// src/features/conversation/engine/lessonStateMachine.ts
// 수업 상태 머신 (Phase Transitions & 2-Situation Objective Master Rule)

import type {
  LessonContent,
  LessonPhase,
  ConversationSession,
  ObjectiveObservation,
  TurnEvaluationResult,
  HintLevel,
} from '../types';

export class LessonStateMachine {
  private session: ConversationSession;
  private lesson: LessonContent;

  constructor(session: ConversationSession, lesson: LessonContent) {
    this.session = structuredClone(session);
    this.lesson = structuredClone(lesson);
  }

  public getSession(): ConversationSession {
    return structuredClone(this.session);
  }

  /**
   * 새 수업 세션 초기화 (crypto.randomUUID 지원)
   */
  public static createSession(
    lesson: LessonContent,
    sessionId?: string
  ): ConversationSession {
    const id =
      sessionId ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `sess-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

    const initialObservations: Record<string, ObjectiveObservation> = {};
    lesson.learningObjectives.forEach((obj) => {
      initialObservations[obj.id] = {
        objectiveId: obj.id,
        evidences: [],
        isMasteredByRule: false,
      };
    });

    return {
      sessionId: id,
      lessonId: lesson.id,
      contentRevision: lesson.contentRevision,
      level: lesson.level,
      phase: 'intro',
      currentTaskIndex: 0,
      hintLevel: 0,
      turns: [],
      observedObjectives: initialObservations,
      completedTaskIds: [],
      sessionStartedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      isCompleted: false,
      rulePassed: false,
      needsReReview: false,
    };
  }

  /**
   * 다음 단계(Phase)로의 전이
   * 표준 순서: intro -> expressions -> practice -> roleplay -> transfer_assessment -> result
   */
  public advancePhase(): LessonPhase {
    if (this.session.isCompleted) {
      return 'result';
    }

    const phaseFlow: LessonPhase[] = [
      'intro',
      'expressions',
      'practice',
      'roleplay',
      'transfer_assessment',
      'result',
    ];

    const currentIndex = phaseFlow.indexOf(this.session.phase);
    if (currentIndex >= 0 && currentIndex < phaseFlow.length - 1) {
      this.session.phase = phaseFlow[currentIndex + 1];
      this.session.hintLevel = 0; // 새 단계 진입 시 힌트 레벨 리셋
    }

    if (this.session.phase === 'result') {
      this.finalizeSession();
    }

    this.session.lastActiveAt = new Date().toISOString();
    return this.session.phase;
  }

  /**
   * 사용자 입력 드래프트 업데이트 (이어하기 지원)
   */
  public updateDraft(draft: string): void {
    if (this.session.isCompleted) return;
    this.session.draftUtterance = draft;
    this.session.lastActiveAt = new Date().toISOString();
  }

  /**
   * 연습 과제 인덱스 업데이트 (이어하기 지원)
   */
  public updateTaskIndex(taskIndex: number): void {
    if (this.session.isCompleted) return;
    this.session.currentTaskIndex = taskIndex;
    this.session.lastActiveAt = new Date().toISOString();
  }

  /**
   * 한 턴의 사용자 발화 및 평가 결과 기록 + 규칙 기반 목표 성취 누적
   * 완료된 세션에서는 추가 기록을 방지(no-op)하여 완료 상태 변조를 원천 차단
   */
  public recordTurn(
    userText: string,
    evaluation: TurnEvaluationResult,
    situationContextName: string,
    usedHint: boolean,
    phase?: LessonPhase
  ): void {
    if (this.session.isCompleted) {
      return; // 완료 후 no-op
    }

    // An offered hint/correction is assistance even if the caller forgot its flag.
    if (evaluation.offeredHintLevel || evaluation.evaluation === 'NEEDS_HINT' || evaluation.evaluation === 'ERROR_CORRECTION') {
      this.session.hintLevel = Math.max(this.session.hintLevel, Math.min(3, evaluation.offeredHintLevel || 1)) as HintLevel;
    }
    const usedAssistance = usedHint || this.session.hintLevel > 0;

    const currentPhase = phase || this.session.phase;
    const turnId = `turn-${this.session.turns.length + 1}`;
    const timestamp = new Date().toISOString();

    // 턴 기록 추가
    this.session.turns.push({
      turnId,
      speaker: 'user',
      text: userText,
      timestamp,
      evaluation,
      phase: currentPhase,
    });

    // 튜터 응답 턴 추가
    this.session.turns.push({
      turnId: `turn-${this.session.turns.length + 1}`,
      speaker: 'tutor',
      text: evaluation.tutorResponseEn,
      timestamp,
      phase: currentPhase,
    });

    // 안전하지 않거나(XSS/HTML) 상황 고정 사실과 모순(consistency === false)되거나
    // 평가가 ACCEPT/OPTIONAL_EXPANSION이 아닌 경우 성취 증거로 인정하지 않음
    if (
      !evaluation.isSafeText ||
      (evaluation.factualConsistency && !evaluation.factualConsistency.consistent) ||
      (evaluation.evaluation !== 'ACCEPT' && evaluation.evaluation !== 'OPTIONAL_EXPANSION')
    ) {
      this.session.lastActiveAt = timestamp;
      return;
    }

    // 목표 유효성 검사: 수업에 실제로 존재하는 목표 id여야만 증거로 기록 (unknown objective 차단)
    const validObjectiveIds = new Set(this.lesson.learningObjectives.map((o) => o.id));
    if (this.lesson.transferTask?.targetObjectiveId) {
      validObjectiveIds.add(this.lesson.transferTask.targetObjectiveId);
    }

    const objId = evaluation.matchedObjectiveId;
    if (!objId || !validObjectiveIds.has(objId)) {
      this.session.lastActiveAt = timestamp;
      return;
    }

    if (!this.session.observedObjectives[objId]) {
      this.session.observedObjectives[objId] = {
        objectiveId: objId,
        evidences: [],
        isMasteredByRule: false,
      };
    }

    const obs = this.session.observedObjectives[objId];
    obs.evidences.push({
      situationContext: situationContextName,
      userResponse: userText,
      usedHint: usedAssistance,
      observedAt: timestamp,
    });

    // 핵심 규칙: '서로 다른 2개 이상의 실제 상황'에서 '노힌트(usedHint === false)'로 증명된 경우만 마스터
    const noHintSituations = new Set(
      obs.evidences
        .filter((e) => !e.usedHint)
        .map((e) => e.situationContext)
    );

    if (noHintSituations.size >= 2) {
      obs.isMasteredByRule = true;
    }

    this.session.lastActiveAt = timestamp;
  }

  /**
   * 힌트 단계 상승 (0 -> 1 -> 2 -> 3)
   */
  public requestHint(): HintLevel {
    if (this.session.isCompleted) return this.session.hintLevel;
    const next = Math.min(3, this.session.hintLevel + 1) as HintLevel;
    this.session.hintLevel = next;
    return next;
  }

  /**
   * 수업 세션 완료 확정 (중복 완료 방지)
   */
  private finalizeSession(): void {
    if (this.session.isCompleted) {
      return;
    }

    // 모든 필수 학습 목표가 2개 상황 노힌트 규칙을 충족했는지 검사
    const allObjectives = this.lesson.learningObjectives;
    const allPassed = allObjectives.every((obj) => {
      const obs = this.session.observedObjectives[obj.id];
      return obs && obs.isMasteredByRule;
    });

    this.session.isCompleted = true;
    this.session.completedAt = new Date().toISOString();
    this.session.rulePassed = allPassed;
  }

  /**
   * 콘텐츠 개정(revision) 감지 시 기존 증거를 보존하면서 재검토 필요 플래그 설정 및 과거 마스터 재평가
   */
  public checkContentRevision(): boolean {
    if (this.session.contentRevision !== this.lesson.contentRevision) {
      this.session.contentRevision = this.lesson.contentRevision;
      this.session.needsReReview = true;

      // 무비판적 자동 인정 해제 및 2상황 규칙 재엄격 검증
      for (const objId of Object.keys(this.session.observedObjectives)) {
        const obs = this.session.observedObjectives[objId];
        obs.isMasteredByRule = false;
        const noHintSituations = new Set(
          obs.evidences.filter((e) => !e.usedHint).map((e) => e.situationContext)
        );
        if (noHintSituations.size >= 2) {
          obs.isMasteredByRule = true;
        }
      }
      return true;
    }
    return false;
  }

  /**
   * UI가 현재 단계에 맞춰 표시할 과제 및 안내 정보 유틸리티
   */
  public getCurrentPhaseTaskInfo(): {
    phase: LessonPhase;
    promptKo: string;
    settingKo: string;
    targetObjectiveId?: string;
  } {
    switch (this.session.phase) {
      case 'intro':
        return {
          phase: 'intro',
          promptKo: `${this.lesson.titleKo} 수업을 시작합니다. 목표와 상황을 확인하세요.`,
          settingKo: this.lesson.scenario.settingKo,
        };
      case 'expressions':
        return {
          phase: 'expressions',
          promptKo: '핵심 표현을 듣고 의미를 익혀보세요.',
          settingKo: this.lesson.scenario.settingKo,
          targetObjectiveId: this.lesson.learningObjectives[0]?.id,
        };
      case 'practice':
        return {
          phase: 'practice',
          promptKo: '문장을 구성하여 천천히 말해보세요.',
          settingKo: this.lesson.scenario.settingKo,
          targetObjectiveId: this.lesson.learningObjectives[0]?.id,
        };
      case 'roleplay':
        return {
          phase: 'roleplay',
          promptKo: `${this.lesson.scenario.aiRoleKo}와의 상황극 대화에 참여하세요.`,
          settingKo: this.lesson.scenario.settingKo,
          targetObjectiveId: this.lesson.learningObjectives[1]?.id || this.lesson.learningObjectives[0]?.id,
        };
      case 'transfer_assessment':
        return {
          phase: 'transfer_assessment',
          promptKo: this.lesson.transferTask.promptKo,
          settingKo: this.lesson.transferTask.titleKo,
          targetObjectiveId: this.lesson.transferTask.targetObjectiveId,
        };
      case 'result':
        return {
          phase: 'result',
          promptKo: this.session.rulePassed
            ? '모든 학습 목표를 서로 다른 2개 상황에서 완벽하게 증명했습니다!'
            : '수업이 종료되었습니다. 미달성 목표는 복습 큐에 등록됩니다.',
          settingKo: '학습 성취 결과 리포트',
        };
    }
  }
}
