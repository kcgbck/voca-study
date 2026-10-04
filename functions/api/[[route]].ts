// Cloudflare Pages Functions 엔트리포인트 (/api/* 모든 요청 처리)
import { validateNickname, generateCleanNickname } from '../../src/utils/profanityFilter';
import { calculateScore, calculateAccuracy, RankingItem, RankingResponse, RankingCategory } from '../../src/types/user';

interface D1PreparedStatement {
  bind: (...values: any[]) => D1PreparedStatement;
  first: <T = unknown>(colName?: string) => Promise<T | null>;
  run: () => Promise<{ success?: boolean; meta: { changes: number } }>;
  all: <T = unknown>() => Promise<{ results: T[] }>;
}

interface D1Database {
  prepare: (query: string) => D1PreparedStatement;
}

export interface Env {
  DB?: D1Database;
}

function getCorsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: getCorsHeaders(),
  });
}

function generateDeviceCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 4; i++) {
    part1 += chars.charAt(Math.floor(Math.random() * chars.length));
    part2 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `VOCA-${part1}-${part2}`;
}

let columnsChecked = false;
async function ensureD1Columns(db: D1Database): Promise<void> {
  if (columnsChecked) return;
  const statements = [
    'ALTER TABLE users ADD COLUMN correct_count_en INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN incorrect_count_en INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN total_score_en INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN correct_count_ja INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN incorrect_count_ja INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN total_score_ja INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN attendance_streak INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN last_attendance_date TEXT',
  ];
  for (const sql of statements) {
    try {
      await db.prepare(sql).run();
    } catch {
      // 이미 존재하는 컬럼 무시
    }
  }
  columnsChecked = true;
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders() });
  }

  // 0. 고음질 무료 TTS 오디오 프록시 (/api/tts?text=...&lang=...)
  if (url.pathname === '/api/tts' && request.method === 'GET') {
    const text = url.searchParams.get('text')?.trim();
    const lang = url.searchParams.get('lang')?.trim() || 'en';
    if (!text) {
      return jsonResponse({ error: 'Text parameter is required' }, 400);
    }

    const shortLang = lang.startsWith('ja') ? 'ja' : 'en';
    const targetUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${shortLang}&q=${encodeURIComponent(text)}`;

    try {
      const audioResponse = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://translate.google.com/',
        },
      });

      if (!audioResponse.ok) {
        return jsonResponse({ error: `TTS upstream returned ${audioResponse.status}` }, 502);
      }

      return new Response(audioResponse.body, {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'public, max-age=604800, immutable',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (err) {
      return jsonResponse({ error: `TTS fetch exception: ${String(err)}` }, 500);
    }
  }

  if (!env.DB) {
    return jsonResponse({
      error: 'D1 database binding is not configured in this environment.',
      fallback: true,
    }, 503);
  }

  try {
    // 1. 기기 코드 기반 로그인 또는 자동 회원가입
    // POST /api/auth/device-login
    if (url.pathname === '/api/auth/device-login' && request.method === 'POST') {
      await ensureD1Columns(env.DB);
      const body = (await request.json().catch(() => ({}))) as {
        deviceCode?: string;
        nickname?: string;
      };

      const now = new Date().toISOString();
      let targetCode = body.deviceCode?.trim().toUpperCase();

      if (targetCode) {
        const existing = await env.DB.prepare(
          'SELECT * FROM users WHERE device_code = ?'
        ).bind(targetCode).first<any>();

        if (existing) {
          await env.DB.prepare(
            'UPDATE users SET last_active_at = ? WHERE id = ?'
          ).bind(now, existing.id).run();

          return jsonResponse({
            success: true,
            user: {
              id: existing.id,
              deviceCode: existing.device_code,
              nickname: existing.nickname,
              correctCount: existing.correct_count,
              incorrectCount: existing.incorrect_count,
              totalScore: existing.total_score,
              accuracy: calculateAccuracy(existing.correct_count, existing.incorrect_count),
              totalScoreEn: existing.total_score_en ?? 0,
              totalScoreJa: existing.total_score_ja ?? 0,
              correctCountEn: existing.correct_count_en ?? 0,
              incorrectCountEn: existing.incorrect_count_en ?? 0,
              correctCountJa: existing.correct_count_ja ?? 0,
              incorrectCountJa: existing.incorrect_count_ja ?? 0,
              attendanceStreak: existing.attendance_streak ?? 0,
              lastAttendanceDate: existing.last_attendance_date || null,
              lastActiveAt: now,
              createdAt: existing.created_at,
            },
          });
        }
      }

      if (!targetCode) {
        targetCode = generateDeviceCode();
      }

      let nickname = body.nickname?.trim();
      const nickValidation = nickname ? validateNickname(nickname) : { isValid: false };
      if (!nickValidation.isValid) {
        const shortSuffix = targetCode.split('-').pop() || 'STUDY';
        nickname = generateCleanNickname(shortSuffix);
      }

      const newId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO users (
           id, device_code, nickname, 
           correct_count, incorrect_count, total_score,
           correct_count_en, incorrect_count_en, total_score_en,
           correct_count_ja, incorrect_count_ja, total_score_ja,
           attendance_streak, last_attendance_date,
           last_active_at, created_at
         )
         VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, ?, ?)`
      ).bind(newId, targetCode, nickname, now, now).run();

      return jsonResponse({
        success: true,
        isNew: true,
        user: {
          id: newId,
          deviceCode: targetCode,
          nickname,
          correctCount: 0,
          incorrectCount: 0,
          totalScore: 0,
          accuracy: 0,
          totalScoreEn: 0,
          totalScoreJa: 0,
          correctCountEn: 0,
          incorrectCountEn: 0,
          correctCountJa: 0,
          incorrectCountJa: 0,
          attendanceStreak: 0,
          lastAttendanceDate: null,
          lastActiveAt: now,
          createdAt: now,
        },
      });
    }

    // 2. 닉네임 변경 (비속어 검증)
    // POST /api/user/nickname
    if (url.pathname === '/api/user/nickname' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as {
        deviceCode?: string;
        nickname?: string;
      };

      const targetCode = body.deviceCode?.trim().toUpperCase();
      const targetNickname = body.nickname?.trim();

      if (!targetCode) {
        return jsonResponse({ error: '기기 코드가 필요합니다.' }, 400);
      }

      const validation = validateNickname(targetNickname || '');
      if (!validation.isValid) {
        return jsonResponse({ error: validation.error || '유효하지 않은 닉네임입니다.' }, 400);
      }

      const res = await env.DB.prepare(
        'UPDATE users SET nickname = ?, last_active_at = ? WHERE device_code = ?'
      ).bind(targetNickname, new Date().toISOString(), targetCode).run();

      if (res.meta.changes === 0) {
        return jsonResponse({ error: '사용자를 찾을 수 없습니다.' }, 404);
      }

      return jsonResponse({
        success: true,
        nickname: targetNickname,
      });
    }

    // 3. 점수 및 정답/오답 동기화 (언어별 분리 및 출석 통계 저장)
    // POST /api/score/sync
    if (url.pathname === '/api/score/sync' && request.method === 'POST') {
      await ensureD1Columns(env.DB);
      const body = (await request.json().catch(() => ({}))) as {
        deviceCode?: string;
        correctDelta?: number;
        incorrectDelta?: number;
        totalCorrect?: number;
        totalIncorrect?: number;
        lang?: 'en' | 'ja';
        totalCorrectEn?: number;
        totalIncorrectEn?: number;
        totalCorrectJa?: number;
        totalIncorrectJa?: number;
        attendanceStreak?: number;
        lastAttendanceDate?: string;
      };

      const targetCode = body.deviceCode?.trim().toUpperCase();
      if (!targetCode) {
        return jsonResponse({ error: '기기 코드가 필요합니다.' }, 400);
      }

      const user = await env.DB.prepare(
        'SELECT * FROM users WHERE device_code = ?'
      ).bind(targetCode).first<any>();

      if (!user) {
        return jsonResponse({ error: '사용자를 찾을 수 없습니다.' }, 404);
      }

      const cDelta = Math.max(0, body.correctDelta || 0);
      const iDelta = Math.max(0, body.incorrectDelta || 0);

      const newCorrect = (user.correct_count || 0) + cDelta;
      const newIncorrect = (user.incorrect_count || 0) + iDelta;
      const newScore = calculateScore(newCorrect, newIncorrect);

      let newCorrectEn = user.correct_count_en ?? 0;
      let newIncorrectEn = user.incorrect_count_en ?? 0;
      let newCorrectJa = user.correct_count_ja ?? 0;
      let newIncorrectJa = user.incorrect_count_ja ?? 0;

      if (body.lang === 'ja') {
        newCorrectJa += cDelta;
        newIncorrectJa += iDelta;
      } else {
        newCorrectEn += cDelta;
        newIncorrectEn += iDelta;
      }

      const newScoreEn = calculateScore(newCorrectEn, newIncorrectEn);
      const newScoreJa = calculateScore(newCorrectJa, newIncorrectJa);

      const newStreak = typeof body.attendanceStreak === 'number'
        ? Math.max(user.attendance_streak ?? 0, body.attendanceStreak)
        : (user.attendance_streak ?? 0);
      const newLastAttendance = body.lastAttendanceDate || user.last_attendance_date || null;
      const now = new Date().toISOString();

      await env.DB.prepare(
        `UPDATE users 
         SET correct_count = ?, incorrect_count = ?, total_score = ?,
             correct_count_en = ?, incorrect_count_en = ?, total_score_en = ?,
             correct_count_ja = ?, incorrect_count_ja = ?, total_score_ja = ?,
             attendance_streak = ?, last_attendance_date = ?,
             last_active_at = ?
         WHERE id = ?`
      ).bind(
        newCorrect, newIncorrect, newScore,
        newCorrectEn, newIncorrectEn, newScoreEn,
        newCorrectJa, newIncorrectJa, newScoreJa,
        newStreak, newLastAttendance,
        now, user.id
      ).run();

      return jsonResponse({
        success: true,
        user: {
          id: user.id,
          deviceCode: user.device_code,
          nickname: user.nickname,
          correctCount: newCorrect,
          incorrectCount: newIncorrect,
          totalScore: newScore,
          accuracy: calculateAccuracy(newCorrect, newIncorrect),
          totalScoreEn: newScoreEn,
          totalScoreJa: newScoreJa,
          correctCountEn: newCorrectEn,
          incorrectCountEn: newIncorrectEn,
          correctCountJa: newCorrectJa,
          incorrectCountJa: newIncorrectJa,
          attendanceStreak: newStreak,
          lastAttendanceDate: newLastAttendance,
          lastActiveAt: now,
        },
      });
    }

    // 4. 실시간 랭킹 조회 (종합 / 영어 / 일본어 / 연속 출석 분리)
    // GET /api/ranking?category=all|en|ja|streak&deviceCode=...
    if (url.pathname === '/api/ranking' && request.method === 'GET') {
      await ensureD1Columns(env.DB);
      const deviceCode = url.searchParams.get('deviceCode')?.trim().toUpperCase();
      const category = (url.searchParams.get('category')?.trim() || 'all') as RankingCategory;

      let orderByClause = 'ORDER BY total_score DESC, correct_count DESC, last_active_at DESC';
      if (category === 'en') {
        orderByClause = 'ORDER BY COALESCE(total_score_en, 0) DESC, COALESCE(correct_count_en, 0) DESC, last_active_at DESC';
      } else if (category === 'ja') {
        orderByClause = 'ORDER BY COALESCE(total_score_ja, 0) DESC, COALESCE(correct_count_ja, 0) DESC, last_active_at DESC';
      } else if (category === 'streak') {
        orderByClause = 'ORDER BY COALESCE(attendance_streak, 0) DESC, total_score DESC, last_active_at DESC';
      }

      const topRows = await env.DB.prepare(
        `SELECT id, nickname, device_code, correct_count, incorrect_count, total_score,
                COALESCE(total_score_en, 0) as total_score_en,
                COALESCE(correct_count_en, 0) as correct_count_en,
                COALESCE(incorrect_count_en, 0) as incorrect_count_en,
                COALESCE(total_score_ja, 0) as total_score_ja,
                COALESCE(correct_count_ja, 0) as correct_count_ja,
                COALESCE(incorrect_count_ja, 0) as incorrect_count_ja,
                COALESCE(attendance_streak, 0) as attendance_streak,
                last_attendance_date, last_active_at
         FROM users
         ${orderByClause}
         LIMIT 50`
      ).all<any>();

      const topRankers: RankingItem[] = (topRows.results || []).map((row: any, index: number) => {
        let displayScore = row.total_score;
        let displayCorrect = row.correct_count;
        let displayIncorrect = row.incorrect_count;

        if (category === 'en') {
          displayScore = row.total_score_en;
          displayCorrect = row.correct_count_en;
          displayIncorrect = row.incorrect_count_en;
        } else if (category === 'ja') {
          displayScore = row.total_score_ja;
          displayCorrect = row.correct_count_ja;
          displayIncorrect = row.incorrect_count_ja;
        }

        return {
          rank: index + 1,
          id: row.id,
          nickname: row.nickname,
          shortDeviceCode: row.device_code ? row.device_code.split('-').pop() || '****' : '****',
          totalScore: displayScore,
          correctCount: displayCorrect,
          incorrectCount: displayIncorrect,
          accuracy: calculateAccuracy(displayCorrect, displayIncorrect),
          totalScoreEn: row.total_score_en,
          totalScoreJa: row.total_score_ja,
          attendanceStreak: row.attendance_streak,
          lastActiveAt: row.last_active_at,
        };
      });

      const totalRes = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM users'
      ).first<{ count: number }>();
      const totalUsers = totalRes?.count || topRankers.length;

      let myRank: RankingItem | undefined;
      if (deviceCode) {
        const me = await env.DB.prepare(
          `SELECT id, nickname, device_code, correct_count, incorrect_count, total_score,
                  COALESCE(total_score_en, 0) as total_score_en,
                  COALESCE(correct_count_en, 0) as correct_count_en,
                  COALESCE(incorrect_count_en, 0) as incorrect_count_en,
                  COALESCE(total_score_ja, 0) as total_score_ja,
                  COALESCE(correct_count_ja, 0) as correct_count_ja,
                  COALESCE(incorrect_count_ja, 0) as incorrect_count_ja,
                  COALESCE(attendance_streak, 0) as attendance_streak,
                  last_attendance_date, last_active_at
           FROM users WHERE device_code = ?`
        ).bind(deviceCode).first<any>();

        if (me) {
          let rankNumber = 1;
          if (category === 'en') {
            const rRes = await env.DB.prepare(
              `SELECT COUNT(*) + 1 as rank FROM users 
               WHERE COALESCE(total_score_en, 0) > ? OR (COALESCE(total_score_en, 0) = ? AND COALESCE(correct_count_en, 0) > ?)`
            ).bind(me.total_score_en, me.total_score_en, me.correct_count_en).first<{ rank: number }>();
            rankNumber = rRes?.rank || 1;
          } else if (category === 'ja') {
            const rRes = await env.DB.prepare(
              `SELECT COUNT(*) + 1 as rank FROM users 
               WHERE COALESCE(total_score_ja, 0) > ? OR (COALESCE(total_score_ja, 0) = ? AND COALESCE(correct_count_ja, 0) > ?)`
            ).bind(me.total_score_ja, me.total_score_ja, me.correct_count_ja).first<{ rank: number }>();
            rankNumber = rRes?.rank || 1;
          } else if (category === 'streak') {
            const rRes = await env.DB.prepare(
              `SELECT COUNT(*) + 1 as rank FROM users 
               WHERE COALESCE(attendance_streak, 0) > ? OR (COALESCE(attendance_streak, 0) = ? AND total_score > ?)`
            ).bind(me.attendance_streak, me.attendance_streak, me.total_score).first<{ rank: number }>();
            rankNumber = rRes?.rank || 1;
          } else {
            const rRes = await env.DB.prepare(
              `SELECT COUNT(*) + 1 as rank FROM users 
               WHERE total_score > ? OR (total_score = ? AND correct_count > ?)`
            ).bind(me.total_score, me.total_score, me.correct_count).first<{ rank: number }>();
            rankNumber = rRes?.rank || 1;
          }

          let displayScore = me.total_score;
          let displayCorrect = me.correct_count;
          let displayIncorrect = me.incorrect_count;

          if (category === 'en') {
            displayScore = me.total_score_en;
            displayCorrect = me.correct_count_en;
            displayIncorrect = me.incorrect_count_en;
          } else if (category === 'ja') {
            displayScore = me.total_score_ja;
            displayCorrect = me.correct_count_ja;
            displayIncorrect = me.incorrect_count_ja;
          }

          myRank = {
            rank: rankNumber,
            id: me.id,
            nickname: me.nickname,
            shortDeviceCode: me.device_code.split('-').pop() || '****',
            totalScore: displayScore,
            correctCount: displayCorrect,
            incorrectCount: displayIncorrect,
            accuracy: calculateAccuracy(displayCorrect, displayIncorrect),
            totalScoreEn: me.total_score_en,
            totalScoreJa: me.total_score_ja,
            attendanceStreak: me.attendance_streak,
            lastActiveAt: me.last_active_at,
          };
        }
      }

      return jsonResponse({
        topRankers,
        myRank,
        totalUsers,
        category,
      });
    }

    return jsonResponse({ error: 'API 엔드포인트를 찾을 수 없습니다.' }, 404);
  } catch (err: any) {
    console.error('API Error:', err);
    return jsonResponse({ error: '서버 내부 오류', details: err?.message }, 500);
  }
}

