import { CONVERSATION_POLICY_VERSION } from '../types';
// src/features/conversation/services/storageService.ts
// AI 회화 세션, 진도, 복습 큐, 설정 로컬 IndexedDB 저장소 서비스

import { db, type ToeicStudyDatabase } from '../../../storage/db';
import type {
  ConversationSession,
  LessonProgress,
  ConversationReviewItem,
  ConversationSettings,
  LessonContent,
} from '../types';
import {
  scheduleNextReviewOnSuccess,
  scheduleNextReviewOnFailure,
  isReviewDue,
  toKSTDateString,
} from '../engine/reviewScheduler';

export const CONVERSATION_SETTINGS_KEY = 'voca_study_conversation_settings';

export const DEFAULT_CONVERSATION_SETTINGS: ConversationSettings = {
  allowExternalFreeGeminiCalls: false, // 기본 차단
  useSpeechInput: true,
  speechConfirmationRequired: true,
  audioAutoPlay: false,
  engineMode: 'local_rule_engine',
};

export class ConversationStorageService {
  private dbInstance: ToeicStudyDatabase;

  constructor(customDb?: ToeicStudyDatabase) {
    this.dbInstance = customDb || db;
  }

  /**
   * 진행 중인 세션 조회 (이어하기 지원 - lessonId 생략 시 가장 최근 세션 반환)
   */
  async getActiveSession(lessonId?: string): Promise<ConversationSession | undefined> {
    const sessions = lessonId
      ? await this.dbInstance.conversationSessions
          .where('lessonId')
          .equals(lessonId)
          .filter((s) => !s.isCompleted)
          .toArray()
      : await this.dbInstance.conversationSessions
          .filter((s) => !s.isCompleted)
          .toArray();

    if (sessions.length === 0) return undefined;

    // 가장 최근 활동 세션 반환
    sessions.sort(
      (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
    );
    return sessions[0];
  }

  /**
   * 가장 최근 활동 중인 세션 조회 (전체 차시 대상 이어하기 지원)
   */
  async getLatestActiveSession(): Promise<ConversationSession | undefined> {
    return this.getActiveSession();
  }

  /**
   * 세션 ID 단건 조회
   */
  async getSessionById(sessionId: string): Promise<ConversationSession | undefined> {
    return await this.dbInstance.conversationSessions.get(sessionId);
  }

  /**
   * 해당 차시의 가장 최근 세션 조회 (완료 세션 포함)
   */
  async getLatestSessionByLessonId(lessonId: string): Promise<ConversationSession | undefined> {
    const sessions = await this.dbInstance.conversationSessions
      .where('lessonId')
      .equals(lessonId)
      .toArray();

    if (sessions.length === 0) return undefined;

    sessions.sort(
      (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
    );
    return sessions[0];
  }

  /**
   * 세션 삭제 (다시 시작 시 기존 세션 정리)
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.dbInstance.conversationSessions.delete(sessionId);
  }

  /**
   * 세션 저장 (사용자 원음 Blob 저장 금지 - 텍스트 및 메타데이터만 직렬화, 완료 세션 역행 방지)
   */
  async saveSession(session: ConversationSession): Promise<void> {
    const existing = await this.dbInstance.conversationSessions.get(session.sessionId);
    if (existing?.isCompleted && !session.isCompleted) {
      // 이미 완료된 세션을 오래된 미완료 드래프트로 덮어써서 in_progress로 되돌리는 현상 방지
      return;
    }

    // 음원 바이너리/Blob 객체 포함 여부 원천 배제
    const sanitizedSession: ConversationSession = {
      ...session,
      turns: session.turns.map((t) => ({
        turnId: t.turnId,
        speaker: t.speaker,
        text: typeof t.text === 'string' ? t.text : '',
        timestamp: t.timestamp,
        phase: t.phase,
        evaluation: t.evaluation ? { ...t.evaluation } : undefined,
      })),
      lastActiveAt: new Date().toISOString(),
    };

    await this.dbInstance.conversationSessions.put(sanitizedSession);
  }


  /**
   * 수업 세션 완료 확정 및 진도/복습 동기화 (멱등 저장: 동일 세션 반복 호출에도 중복 생성 없음)
   */
  async completeSession(
    session: ConversationSession,
    lesson: LessonContent
  ): Promise<{
    progress: LessonProgress;
    createdReviews: ConversationReviewItem[];
  }> {
    return await this.dbInstance.transaction(
      'rw',
      [
        this.dbInstance.conversationSessions,
        this.dbInstance.conversationProgress,
        this.dbInstance.conversationReviewItems,
      ],
      async () => {
        const now = new Date().toISOString();

        // 기존 세션 및 기존 진도 확인 (중복 완료 방지)
        const existingSession = await this.dbInstance.conversationSessions.get(session.sessionId);
        const existingProgress = await this.dbInstance.conversationProgress.get(lesson.id);

        if (existingSession?.isCompleted && existingProgress) {
          // 이미 완료 처리된 세션은 추가 시간 누적이나 중복 복습 생성 없이 기존 진도 즉시 반환
          return {
            progress: existingProgress,
            createdReviews: [],
          };
        }

        // 학습 소요 시간 계산 (180초 하드코딩 금지, 실제 시작~종료 시간으로 계산)
        const startTime = new Date(session.sessionStartedAt).getTime();
        const endTime = new Date(session.completedAt || now).getTime();
        let durationSec = Math.floor((endTime - startTime) / 1000);
        if (isNaN(durationSec) || durationSec < 0 || durationSec > 86400) {
          durationSec = 0; // 음수나 비정상 날짜는 거부 및 0초 처리
        }

        // 1. 세션 완료 상태 갱신
        const updatedSession: ConversationSession = {
          ...session,
          isCompleted: true,
          completedAt: session.completedAt || now,
          lastActiveAt: now,
        };
        await this.dbInstance.conversationSessions.put(updatedSession);

        // 2. 규칙 증거 재계산: 조작된 불리언(isMasteredByRule, rulePassed)을 그대로 신뢰하지 않고
        // 현재 revision과 실제 수업 목표에 부합하는 '서로 다른 2개 상황에서의 노힌트 발화 증거' 재계산
        const isRevisionMatched = session.contentRevision === lesson.contentRevision && !session.needsReReview;
        const newlyVerifiedObjectiveIds: string[] = [];

        if (isRevisionMatched && session.observedObjectives) {
          for (const obj of lesson.learningObjectives) {
            const obs = session.observedObjectives[obj.id];
            if (!obs || !Array.isArray(obs.evidences)) continue;

            const validEvidences = obs.evidences.filter((e) =>
              e &&
              e.usedHint === false &&
              typeof e.userResponse === 'string' &&
              e.userResponse.trim().length > 0 &&
              typeof e.situationContext === 'string' &&
              e.situationContext.trim().length > 0
            );

            const distinctSituations = new Set(
              validEvidences.map((e) => e.situationContext.trim().toLowerCase())
            );

            // 서로 다른 2개 이상의 상황에서 힌트 없이 발화한 증거가 존재할 때만 인정
            if (distinctSituations.size >= 2) {
              newlyVerifiedObjectiveIds.push(obj.id);
            }
          }
        }

        // 3. 진도 보존 및 revision 변경 처리
        let mergedMasteredIds: string[] = [];
        if (existingProgress && existingProgress.contentRevision === lesson.contentRevision) {
          // 동일 revision인 경우 기존 마스터 목록과 병합
          mergedMasteredIds = Array.from(
            new Set([
              ...(existingProgress.masteredObjectiveIds || []),
              ...newlyVerifiedObjectiveIds,
            ])
          );
        } else {
          // revision이 달라진 경우 과거 마스터 자동 승계 금지 (새 revision 기준으로 재계산)
          mergedMasteredIds = newlyVerifiedObjectiveIds;
        }

        const allObjectivesMastered =
          lesson.learningObjectives.length > 0 &&
          lesson.learningObjectives.every((obj) => mergedMasteredIds.includes(obj.id));

        // 미완료 세션이거나 목표 미달성인 경우 completed로 승격 불가
        const newStatus: LessonProgress['status'] =
          session.isCompleted && allObjectivesMastered ? 'completed' : 'in_progress';

        const progress: LessonProgress = {
          lessonId: lesson.id,
          level: lesson.level,
          unitNumber: lesson.unitNumber,
          lessonNumber: lesson.lessonNumber,
          status: newStatus,
          contentRevision: lesson.contentRevision,
          masteredObjectiveIds: mergedMasteredIds,
          totalStudySeconds: (existingProgress?.totalStudySeconds || 0) + durationSec,
          lastStudiedAt: now,
          completedAt: newStatus === 'completed' ? existingProgress?.completedAt || now : undefined,
          reviewScheduledDate: toKSTDateString(new Date(Date.now() + 86400000)),
        };

        await this.dbInstance.conversationProgress.put(progress);

        // 4. 복습 아이템 생성: 취약/미달성 표현 중심 1~3개만 선별 (결정적 ID로 중복 방지)
        const existingReviews = await this.dbInstance.conversationReviewItems
          .where('lessonId')
          .equals(lesson.id)
          .toArray();

        const existingExprSet = new Set(
          existingReviews.map((r) => r.expressionEn.toLowerCase().trim())
        );

        const unmasteredObjIds = new Set(
          lesson.learningObjectives
            .filter((obj) => !mergedMasteredIds.includes(obj.id))
            .map((obj) => obj.id)
        );

        // 취약 목표와 연계된 표현 우선 선별, 없으면 전체 중 최대 1~3개
        const candidateExpressions = lesson.keyExpressions.filter((exp) => {
          const targetObjId = lesson.acceptableIntents.find(
            (intent) =>
              intent.exactMatches.some((em) => em.toLowerCase() === exp.expressionEn.toLowerCase()) ||
              intent.allowedShortAnswers.some((sa) => sa.toLowerCase() === exp.expressionEn.toLowerCase())
          )?.targetObjectiveId;
          return targetObjId ? unmasteredObjIds.has(targetObjId) : unmasteredObjIds.size > 0;
        });

        const targetKeyExpressions =
          candidateExpressions.length > 0
            ? candidateExpressions.slice(0, 3)
            : (allObjectivesMastered ? [] : lesson.keyExpressions.slice(0, 2));

        const createdReviews: ConversationReviewItem[] = [];
        const tomorrowStr = toKSTDateString(new Date(Date.now() + 86400000));

        for (const exp of targetKeyExpressions) {
          const normExpr = exp.expressionEn.toLowerCase().trim();
          if (!existingExprSet.has(normExpr)) {
            const deterministicId = `rev-${lesson.id}-${normExpr.replace(/[^a-z0-9]/g, '_')}`;
            const reviewItem: ConversationReviewItem = {
              id: deterministicId,
              lessonId: lesson.id,
              expressionEn: exp.expressionEn,
              meaningKo: exp.meaningKo,
              targetObjectiveId: lesson.learningObjectives[0]?.id || 'obj-default',
              repetitionCount: 0,
              intervalDays: 1,
              nextReviewDate: tomorrowStr,
              lastReviewedAt: now,
              consecutiveSuccessCount: 0,
              isDue: false,
            };
            await this.dbInstance.conversationReviewItems.put(reviewItem);
            createdReviews.push(reviewItem);
            existingExprSet.add(normExpr);
          }
        }

        return { progress, createdReviews };
      }
    );
  }

  /**
   * 차시 진도 단건 조회
   */
  async getProgress(lessonId: string): Promise<LessonProgress | undefined> {
    return await this.dbInstance.conversationProgress.get(lessonId);
  }

  /**
   * 전체 진도 목록 조회
   */
  async getAllProgress(): Promise<LessonProgress[]> {
    return await this.dbInstance.conversationProgress.toArray();
  }

  /**
   * 오늘 날짜 기준 복습 대상(Due) 아이템 목록 조회
   */
  async getDueReviewItems(currentDate: Date = new Date()): Promise<ConversationReviewItem[]> {
    const all = await this.dbInstance.conversationReviewItems.toArray();
    return all.filter((item) => isReviewDue(item, currentDate));
  }

  /**
   * 복습 결과 기록 (1, 3, 7, 14일 증가 또는 실패 시 1일 앞당김, 당일 중복 기록 스킵 방어)
   */
  async recordReviewResult(
    reviewItemId: string,
    success: boolean,
    currentDate: Date = new Date()
  ): Promise<ConversationReviewItem> {
    const item = await this.dbInstance.conversationReviewItems.get(reviewItemId);
    if (!item) {
      throw new Error(`복습 아이템을 찾을 수 없습니다: ${reviewItemId}`);
    }

    // 동일 일자 중복 호출 시 일정 과도 증가 방지 (일별 관문)
    if (item.lastReviewedAt) {
      const lastDateStr = toKSTDateString(new Date(item.lastReviewedAt));
      const curDateStr = toKSTDateString(currentDate);
      if (lastDateStr === curDateStr && item.repetitionCount > 0) {
        return item;
      }
    }

    const updated = success
      ? scheduleNextReviewOnSuccess(item, currentDate)
      : scheduleNextReviewOnFailure(item, currentDate);

    await this.dbInstance.conversationReviewItems.put(updated);
    return updated;
  }

  /**
   * 회화 설정 조회
   */
  async getSettings(): Promise<ConversationSettings> {
    const row = await this.dbInstance.appSettings.get(CONVERSATION_SETTINGS_KEY);
    if (!row || typeof row.value !== 'string') {
      return { ...DEFAULT_CONVERSATION_SETTINGS };
    }
    try {
      const settings = { ...DEFAULT_CONVERSATION_SETTINGS, ...JSON.parse(row.value) } as ConversationSettings;
      const consent = settings.cloudConsent;
      if (!consent || consent.policyVersion !== CONVERSATION_POLICY_VERSION || !consent.isAdult || !consent.sendCurrentTurnOnlyAgreed || !consent.googleReviewDisclosureAgreed || !consent.noSensitiveInfoAgreed) {
        settings.allowExternalFreeGeminiCalls = false;
        settings.engineMode = 'local_rule_engine';
      }
      return settings;
    } catch {
      return { ...DEFAULT_CONVERSATION_SETTINGS };
    }
  }

  /**
   * 회화 설정 저장 (민감 키/토큰 포함 금지)
   */
  async saveSettings(settings: Partial<ConversationSettings>): Promise<ConversationSettings> {
    const current = await this.getSettings();
    const updated: ConversationSettings = {
      ...current,
      ...settings,
    };

    await this.dbInstance.appSettings.put({
      key: CONVERSATION_SETTINGS_KEY,
      value: JSON.stringify(updated),
    });

    return updated;
  }
}

export const storageService = new ConversationStorageService();
