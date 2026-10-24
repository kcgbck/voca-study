// src/features/conversation/server/transcribeHandler.ts
// 음성 전사(STT) 처리기 (gemini-3.5-transcribe, verbatim 모드)

import type {
  ConversationTranscribeRequestBody,
  ConversationTranscribeResponseBody,
  ServerConfig,
} from './types';
import {
  readBoundedJsonBody,
  verifyServerCallPrerequisites,
  validateAudioPayload,
  SecurityGuardError,
} from './securityGuards';
import { isAllowedAudioMime, normalizeInteractionsAudioMime } from './audioUtils';
import {
  callGeminiInteractionsApi,
  GEMINI_MODELS,
  GeminiApiError,
} from './geminiInteractionsClient';

export async function handleConversationTranscribe(
  request: Request,
  config: ServerConfig
): Promise<Response> {
  // 1. 요청 본문 유한 스트림(3 MiB) 읽기 및 기본 구조 검증 (검증 우선 -> upstream 0회)
  const body = await readBoundedJsonBody<ConversationTranscribeRequestBody>(request);

  if (body.userConsentToCloud !== true) {
    throw new SecurityGuardError('사용자 클라우드 전송 명시 동의(userConsentToCloud)가 필요합니다.', 403);
  }

  if (!body.requestId || typeof body.requestId !== 'string' || body.requestId.trim().length === 0) {
    throw new SecurityGuardError('requestId가 누락되었거나 유효하지 않습니다.', 400);
  }

  // 2. 오디오 페이로드 크기, 지속시간, MIME 유효성 사전 검증 (upstream 0회)
  validateAudioPayload(body.audioBase64, body.durationSeconds);

  if (!isAllowedAudioMime(body.mimeType)) {
    throw new SecurityGuardError(`지원하지 않는 오디오 MIME 타입입니다: ${body.mimeType}`, 400);
  }

  // 3. 보안 전제 조건 검증 (Fail-Closed)
  const callerId = await verifyServerCallPrerequisites(request, config);
  const budgetKey = `${callerId}:${body.requestId}`;

  // 4. 원자적 예산 예약 및 중복 요청 차단
  const reservation = await config.budgetAdapter!.reserve(budgetKey, 1);
  if (!reservation.allowed) {
    throw new SecurityGuardError(
      reservation.reason || '동시 중복 요청이 감지되었거나 예산이 초과되었습니다.',
      429
    );
  }

  let upstreamInitiated = false;

  try {
    const normalizedMime = normalizeInteractionsAudioMime(body.mimeType);

    const requestPayload = {
      model: GEMINI_MODELS.TRANSCRIBE,
      input: [
        {
          type: 'audio',
          data: body.audioBase64.trim(),
          mime_type: normalizedMime,
        },
      ],
      store: false,
      generation_config: {
        transcription_config: {
          mode: {
            type: 'verbatim',
          },
        },
      },
    };

    upstreamInitiated = true;

    // 5. Gemini API 단일 호출
    const apiResult = await callGeminiInteractionsApi(
      requestPayload,
      config.geminiApiKey!,
      config.fetchFn,
      15000,
      request.signal
    );

    // 6. 전사 텍스트 파싱
    let transcriptionText = '';
    if (Array.isArray(apiResult.steps)) {
      for (const step of apiResult.steps) {
        if (Array.isArray(step.content)) {
          for (const c of step.content) {
            if (typeof c.text === 'string' && c.text.trim().length > 0) {
              transcriptionText += c.text + ' ';
            }
          }
        }
      }
    }

    transcriptionText = transcriptionText.trim();
    if (transcriptionText.length === 0) {
      throw new GeminiApiError('음성에서 텍스트를 인식할 수 없습니다.', 502);
    }

    const responseBody: ConversationTranscribeResponseBody = {
      success: true,
      transcription: transcriptionText,
      mimeType: body.mimeType,
    };

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    if (upstreamInitiated) {
      try {
        await config.budgetAdapter!.consume(budgetKey, 1);
      } catch {
        // ignore consume error
      }
    } else {
      try {
        await config.budgetAdapter!.release(budgetKey);
      } catch {
        // ignore release error
      }
    }
  }
}
