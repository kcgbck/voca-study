// tests/securityCleanup.test.ts
// 데이터베이스 정리 엔드포인트 보안 및 자동 삭제 제거 검증 (DELETE 0건 보장)

import { describe, it, expect, vi } from 'vitest';
import { onRequest, type Env } from '../functions/api/[[route]]';

describe('보안 정리 정책 및 무단 삭제 차단 검증', () => {
  function createMockDb() {
    const preparedQueries: string[] = [];

    const mockDb = {
      prepare: vi.fn((query: string) => {
        preparedQueries.push(query);
        return {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockImplementation(async () => {
            if (query.includes('FROM users WHERE device_code = ?')) {
              return {
                id: 'user-1',
                device_code: 'VOCA-TEST-1234',
                nickname: '테스터',
                correct_count: 5,
                incorrect_count: 1,
                total_score: 48,
                correct_count_en: 5,
                incorrect_count_en: 1,
                total_score_en: 48,
                correct_count_ja: 0,
                incorrect_count_ja: 0,
                total_score_ja: 0,
                attendance_streak: 2,
                last_attendance_date: '2026-10-20',
                last_active_at: '2026-10-20T10:00:00Z',
              };
            }
            if (query.includes('SELECT COUNT(*)')) {
              return { count: 1, rank: 1 };
            }
            return null;
          }),
          run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
          all: vi.fn().mockResolvedValue({
            results: [
              {
                id: 'user-1',
                nickname: '테스터',
                device_code: 'VOCA-TEST-1234',
                total_score: 48,
                correct_count: 5,
                incorrect_count: 1,
                attendance_streak: 2,
                last_active_at: '2026-10-20T10:00:00Z',
              },
            ],
          }),
        };
      }),
      preparedQueries,
    };

    return mockDb;
  }

  it('인증 토큰이 없는 /api/admin/cleanup 공개 요청은 DB 참조 전에 403을 반환해야 한다', async () => {
    const mockDb = createMockDb();
    const env: Env = { DB: mockDb as any };

    const request = new Request('https://toeic.app/api/admin/cleanup', {
      method: 'GET',
    });

    const response = await onRequest({ request, env });
    expect(response.status).toBe(403);

    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('인증 토큰 필요');

    // DB prepare가 전혀 호출되지 않아야 함 (DB 참조 전 즉시 403)
    expect(mockDb.prepare).not.toHaveBeenCalled();
    expect(mockDb.preparedQueries.length).toBe(0);
  });

  it('관리자 토큰이 있더라도 사용자 데이터 안전을 위해 cleanup 삭제 실행은 403으로 차단되어야 한다', async () => {
    const mockDb = createMockDb();
    const env: Env = { DB: mockDb as any };

    const request = new Request('https://toeic.app/api/admin/cleanup', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-test-token-12345',
      },
    });

    const response = await onRequest({ request, env });
    expect(response.status).toBe(403);

    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('영구 비활성화');

    // DELETE 쿼리가 전혀 prepare되지 않아야 함
    const deleteQueries = mockDb.preparedQueries.filter((q) => q.toUpperCase().includes('DELETE'));
    expect(deleteQueries.length).toBe(0);
  });

  it('기기 코드 로그인(/api/auth/device-login) 시 어떠한 DELETE 쿼리도 실행되지 않아야 한다 (DELETE 0건)', async () => {
    const mockDb = createMockDb();
    const env: Env = { DB: mockDb as any };

    const request = new Request('https://toeic.app/api/auth/device-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode: 'VOCA-TEST-1234' }),
    });

    const response = await onRequest({ request, env });
    expect(response.status).toBe(200);

    const deleteQueries = mockDb.preparedQueries.filter((q) => q.toUpperCase().includes('DELETE'));
    expect(deleteQueries.length).toBe(0); // DELETE 0건 보장!
  });

  it('랭킹 조회(/api/ranking) 시 어떠한 DELETE 쿼리도 실행되지 않아야 한다 (DELETE 0건)', async () => {
    const mockDb = createMockDb();
    const env: Env = { DB: mockDb as any };

    const request = new Request('https://toeic.app/api/ranking?category=all&deviceCode=VOCA-TEST-1234', {
      method: 'GET',
    });

    const response = await onRequest({ request, env });
    expect(response.status).toBe(200);

    const deleteQueries = mockDb.preparedQueries.filter((q) => q.toUpperCase().includes('DELETE'));
    expect(deleteQueries.length).toBe(0); // DELETE 0건 보장!
  });
});
