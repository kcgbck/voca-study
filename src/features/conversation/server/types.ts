// src/features/conversation/server/types.ts
// AI 회화 서버 측 엔드포인트 및 어댑터 공통 인터페이스

import type {
  TurnEvaluationResult,
  HintLevel,
} from '../types';

export interface ServerAuthAdapter {
  verifyCaller(request: Request): Promise<{
    authorized: boolean;
    callerId?: string;
    reason?: string;
  }>;
}

export interface ServerBudgetAdapter {
  reserve(requestId: string, estimatedUnits: number): Promise<{
    allowed: boolean;
    remaining?: number;
    reason?: string;
  }>;
  consume(requestId: string, actualUnits: number): Promise<void>;
  release(requestId: string): Promise<void>;
}

export interface ServerConfig {
  allowExternalFreeGeminiCalls: boolean; // 기본값 false
  geminiApiKey?: string;
  isAdultConfirmed?: boolean;
  isFreeTierProjectConfirmed?: boolean;
  authAdapter?: ServerAuthAdapter;
  budgetAdapter?: ServerBudgetAdapter;
  fetchFn?: typeof fetch; // 주입형 모의 fetch 지원
}

export interface ConversationChatRequestBody {
  requestId: string;
  userConsentToCloud: boolean; // 클라이언트 동의 필수 플래그
  lessonId: string;
  contentRevision: number;
  userSpokenText: string;
  currentPhase: 'intro' | 'expressions' | 'practice' | 'roleplay' | 'transfer_assessment' | 'result';
  currentTaskId?: string;
  requestedHintLevel?: HintLevel;
  recentTurns?: Array<{
    turnId: string;
    speaker: 'tutor' | 'user';
    text: string;
    timestamp: string;
  }>;
}

export interface ConversationChatResponseBody {
  success: boolean;
  evaluation: TurnEvaluationResult;
  fallbackToRuleEngine?: boolean;
  errorMessage?: string;
}

export interface ConversationTranscribeRequestBody {
  requestId: string;
  userConsentToCloud: boolean;
  audioBase64: string;
  mimeType: string;
  durationSeconds?: number;
}

export interface ConversationTranscribeResponseBody {
  success: boolean;
  transcription: string;
  mimeType: string;
  errorMessage?: string;
}

export interface ConversationTtsRequestBody {
  requestId: string;
  userConsentToCloud: boolean;
  text: string;
  voiceName?: string;
}

export interface ConversationTtsResponseBody {
  success: boolean;
  audioBase64: string;
  mimeType: string;
  errorMessage?: string;
}
