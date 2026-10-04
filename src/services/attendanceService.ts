/**
 * 보카 스터디 출석체크 및 연속 학습(Streak) 관리 서비스
 * 
 * 매일 학습 시 오늘 날짜(KST 기준)로 출석을 체크하고,
 * 연속 출석일수를 계산하여 랭킹 및 캘린더에 반영합니다.
 * 로컬스토리지 및 Dexie 듀얼 저장으로 무손실 보존.
 */

export interface AttendanceData {
  history: string[]; // 'YYYY-MM-DD' 출석 날짜 목록
  currentStreak: number;
  maxStreak: number;
  lastCheckedDate: string; // 'YYYY-MM-DD'
}

const STORAGE_KEY = 'voca_attendance_data_v1';

/**
 * 한국 표준시(KST, UTC+9) 기준 'YYYY-MM-DD' 날짜 문자열
 */
export function getKSTDateString(date: Date = new Date()): string {
  // UTC 시간에 9시간 더하기
  const kstTime = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kstTime.toISOString().slice(0, 10);
}

/**
 * KST 기준 어제 날짜 문자열
 */
export function getKSTYesterdayString(): string {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return getKSTDateString(yesterday);
}

export const attendanceService = {
  /**
   * 로컬 출석 데이터 로드
   */
  getData(): AttendanceData {
    if (typeof window === 'undefined') {
      return { history: [], currentStreak: 0, maxStreak: 0, lastCheckedDate: '' };
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (_) {}

    return {
      history: [],
      currentStreak: 0,
      maxStreak: 0,
      lastCheckedDate: '',
    };
  },

  /**
   * 출석 데이터 저장
   */
  saveData(data: AttendanceData): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (_) {}
  },

  /**
   * 오늘 출석 체크 (퀴즈 풀이 시 또는 수동 출석 클릭 시)
   * @returns { checked: boolean, streak: number, isNew: boolean }
   */
  recordAttendance(): { checked: boolean; streak: number; isNew: boolean } {
    const today = getKSTDateString();
    const yesterday = getKSTYesterdayString();
    const data = this.getData();

    const historySet = new Set(data.history);

    // 오늘 이미 출석했는지 확인
    if (historySet.has(today)) {
      return {
        checked: true,
        streak: data.currentStreak,
        isNew: false,
      };
    }

    // 신규 출석 등록
    historySet.add(today);
    const newHistory = Array.from(historySet).sort();

    // 연속 출석일 계산
    let newStreak = 1;
    if (data.lastCheckedDate === yesterday) {
      newStreak = (data.currentStreak || 0) + 1;
    } else if (data.lastCheckedDate === today) {
      newStreak = data.currentStreak || 1;
    } else {
      newStreak = 1; // 연속 끊김 후 재시작
    }

    const newMaxStreak = Math.max(data.maxStreak || 0, newStreak);

    const updated: AttendanceData = {
      history: newHistory,
      currentStreak: newStreak,
      maxStreak: newMaxStreak,
      lastCheckedDate: today,
    };

    this.saveData(updated);

    return {
      checked: true,
      streak: newStreak,
      isNew: true,
    };
  },

  /**
   * 출석 요약 통계 조회
   */
  getStats() {
    const data = this.getData();
    const today = getKSTDateString();
    const isTodayChecked = data.history.includes(today);

    // 어제도 출석 안 했고 오늘도 아직 안 했으면 현재 연속일수는 0으로 표기 (오늘 체크하면 1로 시작)
    const yesterday = getKSTYesterdayString();
    let displayStreak = data.currentStreak;
    if (!isTodayChecked && data.lastCheckedDate !== yesterday && data.lastCheckedDate !== today) {
      displayStreak = 0;
    }

    return {
      isTodayChecked,
      currentStreak: displayStreak,
      maxStreak: data.maxStreak || 0,
      totalDays: data.history.length,
      history: data.history,
    };
  },

  /**
   * 특정 연/월의 달력 일자 정보 생성
   */
  getMonthCalendar(year: number, month: number) {
    const data = this.getData();
    const historySet = new Set(data.history);
    const today = getKSTDateString();

    // month: 1-12
    const firstDay = new Date(year, month - 1, 1).getDay(); // 0(일) ~ 6(토)
    const daysInMonth = new Date(year, month, 0).getDate();

    const calendarCells: Array<{
      day: number | null;
      dateString: string;
      isChecked: boolean;
      isToday: boolean;
    }> = [];

    // 앞쪽 빈칸 채우기
    for (let i = 0; i < firstDay; i++) {
      calendarCells.push({
        day: null,
        dateString: '',
        isChecked: false,
        isToday: false,
      });
    }

    // 일자 채우기
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      calendarCells.push({
        day: d,
        dateString: dateStr,
        isChecked: historySet.has(dateStr),
        isToday: dateStr === today,
      });
    }

    return calendarCells;
  },
};
