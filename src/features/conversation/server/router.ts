// src/features/conversation/server/router.ts
// AI 회화 서버 디스패처 (chat / transcribe / tts 분기 라우팅 및 정확한 HTTP 상태 코드 매핑)

import type { ServerConfig } from './types';
import { handleConversationChat } from './chatHandler';
import { handleConversationTranscribe } from './transcribeHandler';
import { handleConversationTts } from './ttsHandler';
import { SecurityGuardError } from './securityGuards';
import { GeminiApiError } from './geminiInteractionsClient';

export function getConversationCorsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

export async function handleConversationAction(
  request: Request,
  action: string,
  config: ServerConfig
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: getConversationCorsHeaders() });
  }

  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, errorMessage: 'POST 요청만 지원됩니다.' }),
      { status: 405, headers: getConversationCorsHeaders() }
    );
  }

  const normalizedAction = action.replace(/^\/+|\/+$/g, '').toLowerCase();

  try {
    let response: Response;

    if (normalizedAction === 'chat') {
      response = await handleConversationChat(request, config);
    } else if (normalizedAction === 'transcribe') {
      response = await handleConversationTranscribe(request, config);
    } else if (normalizedAction === 'tts') {
      response = await handleConversationTts(request, config);
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          errorMessage: `알 수 없는 회화 API 액션입니다: ${action}`,
        }),
        { status: 404, headers: getConversationCorsHeaders() }
      );
    }

    // CORS 헤더 부착
    const responseHeaders = new Headers(response.headers);
    Object.entries(getConversationCorsHeaders()).forEach(([key, value]) => {
      responseHeaders.set(key, value as string);
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (err: unknown) {
    let statusCode = 500;
    let errorMessage = '서버 내부 처리 오류';
    let errorCode: string | undefined;

    if (err instanceof SecurityGuardError) {
      statusCode = err.statusCode;
      errorMessage = err.message;
    } else if (err instanceof GeminiApiError) {
      statusCode = err.statusCode;
      errorMessage = err.message;
      if (err.failureKind) {
        errorCode = err.failureKind;
      }
    }

    const responsePayload: Record<string, unknown> = {
      success: false,
      fallbackToRuleEngine: true,
      errorMessage,
    };

    if (errorCode) {
      responsePayload.errorCode = errorCode;
    }

    if (statusCode === 503) {
      responsePayload.retryable = true;
    }

    return new Response(
      JSON.stringify(responsePayload),
      { status: statusCode, headers: getConversationCorsHeaders() }
    );
  }
}
