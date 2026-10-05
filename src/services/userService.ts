import { UserProfile, RankingResponse, RankingCategory, calculateScore, calculateAccuracy } from '../types/user';
import { validateNickname, generateCleanNickname } from '../utils/profanityFilter';
import { attendanceService, getKSTDateString } from './attendanceService';


const LOCAL_STORAGE_KEY = 'voca_user_profile_v1';
const PENDING_SCORE_KEY = 'voca_pending_score_v1';

// 기기 코드 생성기 (오프라인 fallback용)
function generateLocalDeviceCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 4; i++) {
    part1 += chars.charAt(Math.floor(Math.random() * chars.length));
    part2 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `VOCA-${part1}-${part2}`;
}

export class UserService {
  private static instance: UserService;
  private currentProfile: UserProfile | null = null;
  private isSyncing = false;

  private constructor() {
    this.loadFromStorage();
  }

  public static getInstance(): UserService {
    if (!UserService.instance) {
      UserService.instance = new UserService();
    }
    return UserService.instance;
  }

  /**
   * 영어/일어 분리 정합성 보정 (총 정답수가 언어별 합보다 클 경우 누락 갭을 일본어로 할당)
   */
  private reconcileProfileGap(profile: UserProfile): UserProfile {
    const cEn = profile.correctCountEn || 0;
    const cJa = profile.correctCountJa || 0;
    const iEn = profile.incorrectCountEn || 0;
    const iJa = profile.incorrectCountJa || 0;
    const totalC = profile.correctCount || 0;
    const totalI = profile.incorrectCount || 0;

    if (totalC > (cEn + cJa)) {
      const gapC = totalC - (cEn + cJa);
      const gapI = Math.max(0, totalI - (iEn + iJa));
      profile.correctCountJa = cJa + gapC;
      profile.incorrectCountJa = iJa + gapI;
    }

    profile.totalScoreEn = profile.totalScoreEn && profile.totalScoreEn > 0 
      ? profile.totalScoreEn 
      : calculateScore(profile.correctCountEn || 0, profile.incorrectCountEn || 0);
    profile.totalScoreJa = calculateScore(profile.correctCountJa || 0, profile.incorrectCountJa || 0);
    profile.totalScore = calculateScore(profile.correctCount || 0, profile.incorrectCount || 0);
    profile.accuracy = calculateAccuracy(profile.correctCount || 0, profile.incorrectCount || 0);

    return profile;
  }

  /**
   * 로컬 스토리지에서 프로필 로드
   */
  private loadFromStorage(): void {
    try {
      const data = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (data) {
        this.currentProfile = JSON.parse(data);
        if (this.currentProfile) {
          this.reconcileProfileGap(this.currentProfile);
        }
      }
    } catch (err) {
      console.warn('로컬 프로필 로드 실패:', err);
    }
  }

  /**
   * 로컬 스토리지에 프로필 저장
   */
  private saveToStorage(profile: UserProfile): void {
    this.currentProfile = profile;
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(profile));
    } catch (err) {
      console.warn('로컬 프로필 저장 실패:', err);
    }
  }

  /**
   * 미전송 점수 큐 가져오기 (영어 및 일본어 분리 저장)
   */
  private getPendingScore(): { correctEn: number; incorrectEn: number; correctJa: number; incorrectJa: number } {
    try {
      const data = localStorage.getItem(PENDING_SCORE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        return {
          correctEn: parsed.correctEn ?? (parsed.lang !== 'ja' ? parsed.correct ?? 0 : 0),
          incorrectEn: parsed.incorrectEn ?? (parsed.lang !== 'ja' ? parsed.incorrect ?? 0 : 0),
          correctJa: parsed.correctJa ?? (parsed.lang === 'ja' ? parsed.correct ?? 0 : 0),
          incorrectJa: parsed.incorrectJa ?? (parsed.lang === 'ja' ? parsed.incorrect ?? 0 : 0),
        };
      }
    } catch {}
    return { correctEn: 0, incorrectEn: 0, correctJa: 0, incorrectJa: 0 };
  }

  /**
   * 미전송 점수 큐 저장
   */
  private setPendingScore(score: { correctEn: number; incorrectEn: number; correctJa: number; incorrectJa: number }): void {
    try {
      localStorage.setItem(PENDING_SCORE_KEY, JSON.stringify(score));
    } catch {}
  }

  /**
   * 현재 사용자 프로필 가져오기
   */
  public getProfile(): UserProfile | null {
    return this.currentProfile;
  }

  /**
   * 최초 접속 세션 초기화 및 자동 로그인
   */
  public async initSession(): Promise<UserProfile> {
    if (this.currentProfile) {
      // 이미 로컬 프로필이 있으면 백그라운드에서 서버 동기화 시도
      this.syncWithServer(this.currentProfile.deviceCode).catch(() => {});
      return this.currentProfile;
    }

    // 신규 프로필 생성 시도
    try {
      const res = await fetch('/api/auth/device-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          const profile: UserProfile = this.reconcileProfileGap({
            id: data.user.id,
            deviceCode: data.user.deviceCode,
            nickname: data.user.nickname,
            correctCount: data.user.correctCount || 0,
            incorrectCount: data.user.incorrectCount || 0,
            totalScore: data.user.totalScore || 0,
            accuracy: data.user.accuracy || 0,
            totalScoreEn: data.user.totalScoreEn ?? 0,
            totalScoreJa: data.user.totalScoreJa ?? 0,
            correctCountEn: data.user.correctCountEn ?? 0,
            incorrectCountEn: data.user.incorrectCountEn ?? 0,
            correctCountJa: data.user.correctCountJa ?? 0,
            incorrectCountJa: data.user.incorrectCountJa ?? 0,
            attendanceStreak: data.user.attendanceStreak ?? 0,
            lastAttendanceDate: data.user.lastAttendanceDate || undefined,
            lastActiveAt: data.user.lastActiveAt,
            createdAt: data.user.createdAt,
          });
          this.saveToStorage(profile);
          return profile;
        }
      }
    } catch (err) {
      console.warn('서버 로그인 실패, 로컬 오프라인 프로필 생성:', err);
    }

    // 오프라인 fallback 프로필 생성
    const fallbackCode = generateLocalDeviceCode();
    const fallbackNickname = generateCleanNickname(fallbackCode.split('-').pop());
    const now = new Date().toISOString();
    const fallbackProfile: UserProfile = {
      id: 'local-' + Date.now(),
      deviceCode: fallbackCode,
      nickname: fallbackNickname,
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
      lastAttendanceDate: undefined,
      lastActiveAt: now,
      createdAt: now,
    };
    this.saveToStorage(fallbackProfile);
    return fallbackProfile;
  }

  /**
   * 기존 기기 코드로 계정 연동 / 복구
   */
  public async linkDeviceCode(deviceCode: string): Promise<{ success: boolean; error?: string; profile?: UserProfile }> {
    const trimmed = deviceCode.trim().toUpperCase();
    if (!trimmed) {
      return { success: false, error: '기기 코드를 입력해 주세요.' };
    }

    try {
      const res = await fetch('/api/auth/device-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceCode: trimmed }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return { success: false, error: errData.error || '계정을 찾을 수 없습니다.' };
      }

      const data = await res.json();
      if (data.user) {
        const profile: UserProfile = this.reconcileProfileGap({
          id: data.user.id,
          deviceCode: data.user.deviceCode,
          nickname: data.user.nickname,
          correctCount: data.user.correctCount || 0,
          incorrectCount: data.user.incorrectCount || 0,
          totalScore: data.user.totalScore || 0,
          accuracy: data.user.accuracy || 0,
          totalScoreEn: data.user.totalScoreEn ?? 0,
          totalScoreJa: data.user.totalScoreJa ?? 0,
          correctCountEn: data.user.correctCountEn ?? 0,
          incorrectCountEn: data.user.incorrectCountEn ?? 0,
          correctCountJa: data.user.correctCountJa ?? 0,
          incorrectCountJa: data.user.incorrectCountJa ?? 0,
          attendanceStreak: data.user.attendanceStreak ?? 0,
          lastAttendanceDate: data.user.lastAttendanceDate || undefined,
          lastActiveAt: data.user.lastActiveAt,
          createdAt: data.user.createdAt,
        });
        this.saveToStorage(profile);
        return { success: true, profile };
      }
      return { success: false, error: '유효하지 않은 계정 응답입니다.' };
    } catch (err: any) {
      return { success: false, error: '서버와 통신할 수 없습니다. 네트워크를 확인해 주세요.' };
    }
  }

  /**
   * 닉네임 변경 (클라이언트 및 서버 비속어 검증)
   */
  public async updateNickname(newNickname: string): Promise<{ success: boolean; error?: string }> {
    if (!this.currentProfile) {
      return { success: false, error: '로그인 세션이 없습니다.' };
    }

    // 1. 클라이언트 비속어 & 길이 검증
    const validation = validateNickname(newNickname);
    if (!validation.isValid) {
      return { success: false, error: validation.error };
    }

    const trimmed = newNickname.trim();

    // 2. 서버 전송
    try {
      const res = await fetch('/api/user/nickname', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceCode: this.currentProfile.deviceCode,
          nickname: trimmed,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { success: false, error: data.error || '닉네임 변경에 실패했습니다.' };
      }

      // 로컬 프로필 갱신
      this.currentProfile.nickname = trimmed;
      this.saveToStorage(this.currentProfile);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: '서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.' };
    }
  }

  /**
   * 문제 풀이 결과(맞춘 수, 틀린 수) 누적 및 점수 동기화
   * @param lang 'en' (영어) | 'ja' (일본어)
   */
  public async addQuizResult(correctDelta: number, incorrectDelta: number, lang: 'en' | 'ja' = 'en'): Promise<UserProfile> {
    if (!this.currentProfile) {
      await this.initSession();
    }

    const cDelta = Math.max(0, correctDelta);
    const iDelta = Math.max(0, incorrectDelta);

    // 1. 출석체크 자동 연동
    const attResult = attendanceService.recordAttendance();
    const today = getKSTDateString();

    if (this.currentProfile) {
      // 언어별 세부 성적 누적
      if (lang === 'ja') {
        this.currentProfile.correctCountJa = (this.currentProfile.correctCountJa || 0) + cDelta;
        this.currentProfile.incorrectCountJa = (this.currentProfile.incorrectCountJa || 0) + iDelta;
        this.currentProfile.totalScoreJa = calculateScore(this.currentProfile.correctCountJa, this.currentProfile.incorrectCountJa);
      } else {
        this.currentProfile.correctCountEn = (this.currentProfile.correctCountEn || 0) + cDelta;
        this.currentProfile.incorrectCountEn = (this.currentProfile.incorrectCountEn || 0) + iDelta;
        this.currentProfile.totalScoreEn = calculateScore(this.currentProfile.correctCountEn, this.currentProfile.incorrectCountEn);
      }

      // 종합 성적: 두 언어의 합계 또는 기존 누적 값 중 큰 값
      const totalC = (this.currentProfile.correctCountEn || 0) + (this.currentProfile.correctCountJa || 0);
      const totalI = (this.currentProfile.incorrectCountEn || 0) + (this.currentProfile.incorrectCountJa || 0);
      this.currentProfile.correctCount = Math.max(this.currentProfile.correctCount + cDelta, totalC);
      this.currentProfile.incorrectCount = Math.max(this.currentProfile.incorrectCount + iDelta, totalI);
      this.currentProfile.totalScore = calculateScore(this.currentProfile.correctCount, this.currentProfile.incorrectCount);
      this.currentProfile.accuracy = calculateAccuracy(this.currentProfile.correctCount, this.currentProfile.incorrectCount);

      // 출석 통계
      this.currentProfile.attendanceStreak = attResult.streak;
      this.currentProfile.lastAttendanceDate = today;
      this.currentProfile.lastActiveAt = new Date().toISOString();

      this.saveToStorage(this.currentProfile);
    }

    // 미전송 큐에 언어별 델타 누적
    const pending = this.getPendingScore();
    if (lang === 'ja') {
      pending.correctJa += cDelta;
      pending.incorrectJa += iDelta;
    } else {
      pending.correctEn += cDelta;
      pending.incorrectEn += iDelta;
    }
    this.setPendingScore(pending);

    // 백그라운드 서버 동기화 시작 (에러는 무시)
    this.flushPendingScore(lang).catch(() => {});

    return this.currentProfile!;
  }

  /**
   * 수동 출석체크 완료 시 서버 동기화
   */
  public async syncAttendance(streak: number): Promise<void> {
    if (!this.currentProfile) return;
    this.currentProfile.attendanceStreak = streak;
    this.currentProfile.lastAttendanceDate = getKSTDateString();
    this.saveToStorage(this.currentProfile);

    try {
      await fetch('/api/score/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceCode: this.currentProfile.deviceCode,
          attendanceStreak: streak,
          lastAttendanceDate: this.currentProfile.lastAttendanceDate,
        }),
      });
    } catch (_) {}
  }

  /**
   * 미전송 점수 서버 동기화 (영어 및 일본어 점수 동시 지원)
   */
  public async flushPendingScore(lang: 'en' | 'ja' = 'en'): Promise<void> {
    if (this.isSyncing || !this.currentProfile) return;
    const pending = this.getPendingScore();
    const hasPendingEn = pending.correctEn > 0 || pending.incorrectEn > 0;
    const hasPendingJa = pending.correctJa > 0 || pending.incorrectJa > 0;
    if (!hasPendingEn && !hasPendingJa) return;

    this.isSyncing = true;
    try {
      const res = await fetch('/api/score/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceCode: this.currentProfile.deviceCode,
          correctDelta: hasPendingJa ? pending.correctJa : pending.correctEn,
          incorrectDelta: hasPendingJa ? pending.incorrectJa : pending.incorrectEn,
          lang: hasPendingJa && !hasPendingEn ? 'ja' : lang,
          correctDeltaEn: pending.correctEn,
          incorrectDeltaEn: pending.incorrectEn,
          correctDeltaJa: pending.correctJa,
          incorrectDeltaJa: pending.incorrectJa,
          totalCorrectEn: this.currentProfile.correctCountEn || 0,
          totalIncorrectEn: this.currentProfile.incorrectCountEn || 0,
          totalCorrectJa: this.currentProfile.correctCountJa || 0,
          totalIncorrectJa: this.currentProfile.incorrectCountJa || 0,
          attendanceStreak: this.currentProfile.attendanceStreak || 0,
          lastAttendanceDate: this.currentProfile.lastAttendanceDate || null,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          // 서버 응답으로 로컬 프로필 안전하게 최신화 (Math.max 및 calculateScore로 0 덮어쓰기 방지)
          this.currentProfile.correctCount = Math.max(this.currentProfile.correctCount, data.user.correctCount || 0);
          this.currentProfile.incorrectCount = Math.max(this.currentProfile.incorrectCount, data.user.incorrectCount || 0);
          this.currentProfile.totalScore = calculateScore(this.currentProfile.correctCount, this.currentProfile.incorrectCount);
          this.currentProfile.accuracy = calculateAccuracy(this.currentProfile.correctCount, this.currentProfile.incorrectCount);

          if (typeof data.user.correctCountEn === 'number') {
            this.currentProfile.correctCountEn = Math.max(this.currentProfile.correctCountEn || 0, data.user.correctCountEn);
          }
          if (typeof data.user.incorrectCountEn === 'number') {
            this.currentProfile.incorrectCountEn = Math.max(this.currentProfile.incorrectCountEn || 0, data.user.incorrectCountEn);
          }
          this.currentProfile.totalScoreEn = calculateScore(this.currentProfile.correctCountEn || 0, this.currentProfile.incorrectCountEn || 0);

          if (typeof data.user.correctCountJa === 'number') {
            this.currentProfile.correctCountJa = Math.max(this.currentProfile.correctCountJa || 0, data.user.correctCountJa);
          }
          if (typeof data.user.incorrectCountJa === 'number') {
            this.currentProfile.incorrectCountJa = Math.max(this.currentProfile.incorrectCountJa || 0, data.user.incorrectCountJa);
          }
          this.currentProfile.totalScoreJa = calculateScore(this.currentProfile.correctCountJa || 0, this.currentProfile.incorrectCountJa || 0);

          if (typeof data.user.attendanceStreak === 'number') {
            this.currentProfile.attendanceStreak = Math.max(this.currentProfile.attendanceStreak || 0, data.user.attendanceStreak);
          }
          this.reconcileProfileGap(this.currentProfile);
          this.saveToStorage(this.currentProfile);
        }
        // 전송 성공 시 큐 비우기
        this.setPendingScore({ correctEn: 0, incorrectEn: 0, correctJa: 0, incorrectJa: 0 });
      }
    } catch (err) {
      console.warn('점수 서버 동기화 보류 (네트워크 미연결):', err);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * 서버와 프로필 최신화 (0점 덮어쓰기 방지)
   */
  private async syncWithServer(deviceCode: string): Promise<void> {
    try {
      const res = await fetch('/api/auth/device-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceCode }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user && this.currentProfile) {
          this.currentProfile.nickname = data.user.nickname;
          this.currentProfile.correctCount = Math.max(this.currentProfile.correctCount, data.user.correctCount || 0);
          this.currentProfile.incorrectCount = Math.max(this.currentProfile.incorrectCount, data.user.incorrectCount || 0);
          this.currentProfile.totalScore = calculateScore(this.currentProfile.correctCount, this.currentProfile.incorrectCount);
          this.currentProfile.accuracy = calculateAccuracy(this.currentProfile.correctCount, this.currentProfile.incorrectCount);

          if (typeof data.user.correctCountEn === 'number') {
            this.currentProfile.correctCountEn = Math.max(this.currentProfile.correctCountEn || 0, data.user.correctCountEn);
          }
          if (typeof data.user.incorrectCountEn === 'number') {
            this.currentProfile.incorrectCountEn = Math.max(this.currentProfile.incorrectCountEn || 0, data.user.incorrectCountEn);
          }
          this.currentProfile.totalScoreEn = calculateScore(this.currentProfile.correctCountEn || 0, this.currentProfile.incorrectCountEn || 0);

          if (typeof data.user.correctCountJa === 'number') {
            this.currentProfile.correctCountJa = Math.max(this.currentProfile.correctCountJa || 0, data.user.correctCountJa);
          }
          if (typeof data.user.incorrectCountJa === 'number') {
            this.currentProfile.incorrectCountJa = Math.max(this.currentProfile.incorrectCountJa || 0, data.user.incorrectCountJa);
          }
          this.currentProfile.totalScoreJa = calculateScore(this.currentProfile.correctCountJa || 0, this.currentProfile.incorrectCountJa || 0);

          if (typeof data.user.attendanceStreak === 'number') {
            this.currentProfile.attendanceStreak = Math.max(this.currentProfile.attendanceStreak || 0, data.user.attendanceStreak);
          }
          if (data.user.lastAttendanceDate) this.currentProfile.lastAttendanceDate = data.user.lastAttendanceDate;
          this.reconcileProfileGap(this.currentProfile);
          this.saveToStorage(this.currentProfile);
        }
      }
    } catch {}
  }

  /**
   * 카테고리별 실시간 랭킹 목록 조회
   * @param category 'all' | 'en' | 'ja' | 'streak'
   */
  public async getRanking(category: RankingCategory = 'all'): Promise<RankingResponse> {
    const deviceCode = this.currentProfile?.deviceCode || '';
    try {
      const res = await fetch(`/api/ranking?category=${category}&deviceCode=${encodeURIComponent(deviceCode)}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn('랭킹 조회 실패 (오프라인 모드):', err);
    }

    // 오프라인 fallback
    const myRankItem = this.currentProfile ? {
      rank: 1,
      id: this.currentProfile.id,
      nickname: this.currentProfile.nickname,
      shortDeviceCode: this.currentProfile.deviceCode.split('-').pop() || '****',
      totalScore: category === 'en'
        ? (this.currentProfile.totalScoreEn || 0)
        : category === 'ja'
        ? (this.currentProfile.totalScoreJa || 0)
        : this.currentProfile.totalScore,
      correctCount: category === 'en'
        ? (this.currentProfile.correctCountEn || 0)
        : category === 'ja'
        ? (this.currentProfile.correctCountJa || 0)
        : this.currentProfile.correctCount,
      incorrectCount: category === 'en'
        ? (this.currentProfile.incorrectCountEn || 0)
        : category === 'ja'
        ? (this.currentProfile.incorrectCountJa || 0)
        : this.currentProfile.incorrectCount,
      accuracy: this.currentProfile.accuracy,
      totalScoreEn: this.currentProfile.totalScoreEn || 0,
      totalScoreJa: this.currentProfile.totalScoreJa || 0,
      attendanceStreak: this.currentProfile.attendanceStreak || 0,
      lastActiveAt: this.currentProfile.lastActiveAt,
    } : undefined;

    return {
      topRankers: myRankItem ? [myRankItem] : [],
      myRank: myRankItem,
      totalUsers: myRankItem ? 1 : 0,
      category,
    };
  }
}

export const userService = UserService.getInstance();

