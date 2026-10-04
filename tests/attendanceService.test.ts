import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attendanceService, getKSTDateString, getKSTYesterdayString } from '../src/services/attendanceService';

// Mock localStorage for node environment
const storageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

describe('attendanceService (출석체크 및 연속 출석 관리)', () => {
  const originalLocalStorage = (globalThis as any).localStorage;
  const originalWindow = (globalThis as any).window;

  beforeEach(() => {
    (globalThis as any).window = {};
    (globalThis as any).localStorage = storageMock;
    storageMock.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    (globalThis as any).localStorage = originalLocalStorage;
    (globalThis as any).window = originalWindow;
  });

  it('KST 날짜 문자열(YYYY-MM-DD)을 정확히 반환해야 한다', () => {
    // 2026-10-04T05:00:00Z -> KST 기준 2026-10-04 14:00
    const fixedDate = new Date('2026-10-04T05:00:00Z');
    const kst = getKSTDateString(fixedDate);
    expect(kst).toBe('2026-10-04');
  });

  it('최초 출석 시 streak 1일로 기록되고 누적 1일이어야 한다', () => {
    const res = attendanceService.recordAttendance();
    expect(res.checked).toBe(true);
    expect(res.streak).toBe(1);
    expect(res.isNew).toBe(true);

    const stats = attendanceService.getStats();
    expect(stats.isTodayChecked).toBe(true);
    expect(stats.currentStreak).toBe(1);
    expect(stats.totalDays).toBe(1);
  });

  it('당일 중복 출석 시 streak이 증가하지 않고 isNew=false를 반환해야 한다', () => {
    const first = attendanceService.recordAttendance();
    expect(first.isNew).toBe(true);

    const second = attendanceService.recordAttendance();
    expect(second.checked).toBe(true);
    expect(second.streak).toBe(1);
    expect(second.isNew).toBe(false);

    const stats = attendanceService.getStats();
    expect(stats.totalDays).toBe(1);
  });

  it('어제 출석한 상태에서 오늘 출석하면 streak이 1 증가해야 한다', () => {
    const yesterdayStr = getKSTYesterdayString();
    attendanceService.saveData({
      history: [yesterdayStr],
      currentStreak: 4,
      maxStreak: 4,
      lastCheckedDate: yesterdayStr,
    });

    const res = attendanceService.recordAttendance();
    expect(res.streak).toBe(5);
    expect(res.isNew).toBe(true);

    const stats = attendanceService.getStats();
    expect(stats.currentStreak).toBe(5);
    expect(stats.maxStreak).toBe(5);
    expect(stats.totalDays).toBe(2);
  });

  it('출석이 끊긴 상태(그저께 이전 출석)에서 오늘 출석하면 streak이 1로 리셋되어야 한다', () => {
    attendanceService.saveData({
      history: ['2026-09-01'],
      currentStreak: 10,
      maxStreak: 10,
      lastCheckedDate: '2026-09-01',
    });

    const res = attendanceService.recordAttendance();
    expect(res.streak).toBe(1);

    const stats = attendanceService.getStats();
    expect(stats.currentStreak).toBe(1);
    expect(stats.maxStreak).toBe(10); // 최대 스트릭은 보존
    expect(stats.totalDays).toBe(2);
  });

  it('getMonthCalendar는 해당 월의 일자 배열과 출석 여부, 오늘 여부를 정확히 계산해야 한다', () => {
    const today = getKSTDateString();
    const [yStr, mStr] = today.split('-');
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);

    attendanceService.recordAttendance();

    const calendar = attendanceService.getMonthCalendar(year, month);
    expect(calendar.length).toBeGreaterThanOrEqual(28);

    const todayCell = calendar.find((c) => c.isToday);
    expect(todayCell).toBeDefined();
    expect(todayCell?.isChecked).toBe(true);
  });
});
