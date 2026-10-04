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
   * 로컬 스토리지에서 프로필 로드
   */
  private loadFromStorage(): void {
    try {
      const data = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (data) {
        this.currentProfile = JSON.parse(data);
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
   * 미전송 점수 큐 가져오기
   */
  private getPendingScore(): { correct: number; incorrect: number } {
    try {
      const data = localStorage.getItem(PENDING_SCORE_KEY);
      if (data) return JSON.parse(data);
    } catch {}
    return { correct: 0, incorrect: 0 };
  }

  /**
   * 미전송 점수 큐 저장
   */
  private setPendingScore(score: { correct: number; incorrect: number }): void {
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
          const profile: UserProfile = {
            id: data.user.id,
            deviceCode: data.user.deviceCode,
            nickname: data.user.nickname,
            correctCount: data.user.correctCount || 0,
            incorrectCount: data.user.incorrectCount || 0,
            totalScore: data.user.totalScore || 0,
            accuracy: data.user.accuracy || 0,
            lastActiveAt: data.user.lastActiveAt,
            createdAt: data.user.createdAt,
          };
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
        const profile: UserProfile = {
          id: data.user.id,
          deviceCode: data.user.deviceCode,
          nickname: data.user.nickname,
          correctCount: data.user.correctCount || 0,
          incorrectCount: data.user.incorrectCount || 0,
          totalScore: data.user.totalScore || 0,
          accuracy: data.user.accuracy || 0,
          lastActiveAt: data.user.lastActiveAt,
          createdAt: data.user.createdAt,
        };
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
      // 종합 성적
      this.currentProfile.correctCount += cDelta;
      this.currentProfile.incorrectCount += iDelta;
      this.currentProfile.totalScore = calculateScore(this.currentProfile.correctCount, this.currentProfile.incorrectCount);
      this.currentProfile.accuracy = calculateAccuracy(this.currentProfile.correctCount, this.currentProfile.incorrectCount);

      // 언어별 세부 성적
      if (lang === 'ja') {
        this.currentProfile.correctCountJa = (this.currentProfile.correctCountJa || 0) + cDelta;
        this.currentProfile.incorrectCountJa = (this.currentProfile.incorrectCountJa || 0) + iDelta;
        this.currentProfile.totalScoreJa = calculateScore(this.currentProfile.correctCountJa, this.currentProfile.incorrectCountJa);
      } else {
        this.currentProfile.correctCountEn = (this.currentProfile.correctCountEn || 0) + cDelta;
        this.currentProfile.incorrectCountEn = (this.currentProfile.incorrectCountEn || 0) + iDelta;
        this.currentProfile.totalScoreEn = calculateScore(this.currentProfile.correctCountEn, this.currentProfile.incorrectCountEn);
      }

      // 출석 통계
      this.currentProfile.attendanceStreak = attResult.streak;
      this.currentProfile.lastAttendanceDate = today;
      this.currentProfile.lastActiveAt = new Date().toISOString();

      this.saveToStorage(this.currentProfile);
    }

    // 미전송 큐 누적
    const pending = this.getPendingScore();
    pending.correct += cDelta;
    pending.incorrect += iDelta;
    this.setPendingScore(pending);

    // 비동기 백그라운드 서버 동기화
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
   * 미전송 점수 서버 동기화
   */
  public async flushPendingScore(lang: 'en' | 'ja' = 'en'): Promise<void> {
    if (this.isSyncing || !this.currentProfile) return;
    const pending = this.getPendingScore();
    if (pending.correct === 0 && pending.incorrect === 0) return;

    this.isSyncing = true;
    try {
      const res = await fetch('/api/score/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceCode: this.currentProfile.deviceCode,
          correctDelta: pending.correct,
          incorrectDelta: pending.incorrect,
          lang,
          totalCorrectEn: this.currentProfile.correctCountEn,
          totalIncorrectEn: this.currentProfile.incorrectCountEn,
          totalCorrectJa: this.currentProfile.correctCountJa,
          totalIncorrectJa: this.currentProfile.incorrectCountJa,
          attendanceStreak: this.currentProfile.attendanceStreak || 0,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          this.currentProfile.correctCount = data.user.correctCount;
          this.currentProfile.incorrectCount = data.user.incorrectCount;
          this.currentProfile.totalScore = data.user.totalScore;
          this.currentProfile.accuracy = data.user.accuracy;
          if (typeof data.user.totalScoreEn === 'number') this.currentProfile.totalScoreEn = data.user.totalScoreEn;
          if (typeof data.user.totalScoreJa === 'number') this.currentProfile.totalScoreJa = data.user.totalScoreJa;
          if (typeof data.user.attendanceStreak === 'number') this.currentProfile.attendanceStreak = data.user.attendanceStreak;
          this.saveToStorage(this.currentProfile);
        }
        // 전송 성공 시 큐 비우기
        this.setPendingScore({ correct: 0, incorrect: 0 });
      }
    } catch (err) {
      console.warn('점수 서버 동기화 보류 (네트워크 미연결):', err);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * 서버와 프로필 최신화
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
          if (typeof data.user.totalScoreEn === 'number') this.currentProfile.totalScoreEn = data.user.totalScoreEn;
          if (typeof data.user.totalScoreJa === 'number') this.currentProfile.totalScoreJa = data.user.totalScoreJa;
          if (typeof data.user.attendanceStreak === 'number') this.currentProfile.attendanceStreak = data.user.attendanceStreak;
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

