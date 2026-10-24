// functions/api/conversation/[[action]].ts
// Cloudflare Pages Functions AI 회화 전용 엔드포인트 디스패처
// [보안 및 예산 정책]
// 1. allowExternalFreeGeminiCalls는 환경변수 및 모든 안전 조건 통과 시에만 활성화되며 기본 차단(Fail-Closed).
// 2. POST 요청 시 동일 Origin 검증(보조 CSRF 방어; 메인 인증은 Cloudflare Access RS256 JWT).
// 3. OPTIONS 프리플라이트는 동일 Origin에 한해 무해하게 204 허용. GET은 405, 알 수 없는 액션은 404.
// 4. 단일 스트림 Bounded Body 읽기로 tee 복제 교착을 방지하고, 본문 초과 시 413, JSON 파싱 오류 시 400으로 안전 차단.
// 5. 반환 CORS 헤더는 동일 Origin만 허용하며, Access-Control-Allow-Credentials 헤더를 임의로 추가하지 않습니다.

import { handleConversationAction } from '../../../src/features/conversation/server/router';
import { SecurityGuardError } from '../../../src/features/conversation/server/securityGuards';
import {
  createPagesConversationConfig,
  type ConversationEnv,
  type ConfigFactoryDependencies,
} from '../../../src/features/conversation/server/configFactory';

export type { ConversationEnv };

export interface PagesConversationDependencies extends ConfigFactoryDependencies {}

/**
 * 테스트 및 격리 환경을 위한 의존성 주입 가능 Pages 핸들러
 */
export async function handlePagesConversationRequest(
  context: {
    request: Request;
    env: ConversationEnv;
    params: { action?: string | string[] };
  },
  deps?: PagesConversationDependencies
): Promise<Response> {
  const { request, env, params } = context;

  // 1. URL 및 동일 Origin 분석
  let targetOrigin = '';
  try {
    targetOrigin = new URL(request.url).origin;
  } catch {
    targetOrigin = '';
  }

  // 2. 액션 정규화 및 라우팅 검증 (chat, transcribe, tts만 허용)
  const rawAction = Array.isArray(params.action)
    ? params.action.join('/')
    : params.action || '';
  const action = rawAction.replace(/^\/+|\/+$/g, '').toLowerCase();

  const allowedActions = ['chat', 'transcribe', 'tts'];
  if (!allowedActions.includes(action)) {
    return new Response(
      JSON.stringify({
        success: false,
        errorMessage: `알 수 없는 회화 API 액션입니다: ${rawAction}`,
      }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': targetOrigin || '*',
        },
      }
    );
  }

  // 3. HTTP 메서드 검증
  const originHeader = request.headers.get('Origin');

  if (request.method === 'OPTIONS') {
    // OPTIONS 프리플라이트: 동일 Origin인 경우에만 204 허용
    if (!originHeader || originHeader === 'null' || (targetOrigin && originHeader !== targetOrigin)) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': targetOrigin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Cf-Access-Jwt-Assertion',
      },
    });
  }

  if (request.method === 'GET') {
    return new Response(
      JSON.stringify({
        success: false,
        errorMessage: 'POST 요청만 지원됩니다.',
      }),
      {
        status: 405,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': targetOrigin || '*',
        },
      }
    );
  }

  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({
        success: false,
        errorMessage: 'POST 요청만 지원됩니다.',
      }),
      {
        status: 405,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': targetOrigin || '*',
        },
      }
    );
  }

  // 4. POST 요청의 동일 Origin 검증 (CSRF 방어)
  if (!originHeader || originHeader === 'null' || (targetOrigin && originHeader !== targetOrigin)) {
    return new Response(
      JSON.stringify({
        success: false,
        fallbackToRuleEngine: true,
        errorMessage: '유효하지 않거나 일치하지 않는 요청 Origin입니다.',
      }),
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': targetOrigin || '*',
        },
      }
    );
  }

  try {
    // 5. configFactory를 통한 안전한 ServerConfig 및 단일 읽기 forwardRequest 생성
    // 환경변수, 모델 한도, 동의 버전, 클라우드 assertion이 모두 충족되어야만 allowExternalFreeGeminiCalls=true 활성화
    const { config, forwardRequest } = await createPagesConversationConfig(env, action, request, deps);

    // 미구성, 동의 누락, 이전 버전 정책 등 fail-closed 분기 시 즉시 403 반환 (소비된 body 재조회 방지)
    if (!config.allowExternalFreeGeminiCalls) {
      return new Response(
        JSON.stringify({
          success: false,
          fallbackToRuleEngine: true,
          errorMessage: '외부 Gemini API 호출 전제 조건 또는 사용자 동의가 미충족되었습니다.',
        }),
        {
          status: 403,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': targetOrigin || '*',
          },
        }
      );
    }

    // 6. 코어 라우터 디스패치 (재직렬화된 forwardRequest 전달)
    const response = await handleConversationAction(forwardRequest, action, config);

    // 7. 응답 CORS 헤더 정리 (동일 Origin만 허용, Allow-Credentials 임의 추가 금지)
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', targetOrigin);
    headers.delete('Access-Control-Allow-Credentials');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (err: unknown) {
    let statusCode = 400;
    let errorMessage = '요청 처리 중 오류가 발생했습니다.';

    if (err instanceof SecurityGuardError) {
      statusCode = err.statusCode;
      errorMessage = err.message;
    }

    return new Response(
      JSON.stringify({
        success: false,
        fallbackToRuleEngine: true,
        errorMessage,
      }),
      {
        status: statusCode,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': targetOrigin || '*',
        },
      }
    );
  }
}

/**
 * Cloudflare Pages Functions 프로덕션 엔트리포인트 (외부 의존성 주입 없이 native 환경만 사용)
 */
export async function onRequest(context: {
  request: Request;
  env: ConversationEnv;
  params: { action?: string | string[] };
}): Promise<Response> {
  return handlePagesConversationRequest(context);
}
