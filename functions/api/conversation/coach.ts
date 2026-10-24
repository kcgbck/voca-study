// functions/api/conversation/coach.ts
// Cloudflare Pages Functions 공개 AI 회화 코치 전용 라우터 (정적 라우트로 [[action]].ts보다 우선)

import {
  handlePublicCoach,
  type PublicCoachEnv,
} from '../../../src/features/conversation/server/publicCoachHandler';

export async function onRequest(context: {
  request: Request;
  env: PublicCoachEnv;
}): Promise<Response> {
  try {
    return await handlePublicCoach(context.request, context.env);
  } catch {
    return new Response(
      JSON.stringify({
        success: false,
        errorMessage: '요청 처리 중 오류가 발생했습니다.',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  }
}
