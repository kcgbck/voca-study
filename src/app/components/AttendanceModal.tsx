import React, { useState, useEffect } from 'react';
import { attendanceService } from '../../services/attendanceService';
import { userService } from '../../services/userService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onOpenRanking?: () => void;
}

export const AttendanceModal: React.FC<Props> = ({ isOpen, onClose, onOpenRanking }) => {
  const [currentDate] = useState(new Date());
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1); // 1-12
  const [stats, setStats] = useState(attendanceService.getStats());
  const [justChecked, setJustChecked] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStats(attendanceService.getStats());
      setJustChecked(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const calendarDays = attendanceService.getMonthCalendar(year, month);

  const handleCheckIn = () => {
    const res = attendanceService.recordAttendance();
    setStats(attendanceService.getStats());
    setJustChecked(true);

    // 유저 서비스에도 출석 스트릭 동기화
    userService.syncAttendance(res.streak).catch(() => {});
  };

  const handlePrevMonth = () => {
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else {
      setMonth(month - 1);
    }
  };

  const handleNextMonth = () => {
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(month + 1);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
      <div
        className="modal-card attendance-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '420px', width: '92%', padding: '20px' }}
      >
        {/* 모달 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '24px' }}>📅</span>
            <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#f8fafc', margin: 0 }}>
              매일 출석체크
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            ✕
          </button>
        </div>

        {/* 연속 출석 & 총 출석 요약 배너 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
          <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '12px', padding: '10px 12px', textAlign: 'center' }}>
            <span style={{ fontSize: '11px', color: '#fca5a5', display: 'block', fontWeight: 'bold' }}>연속 출석</span>
            <span style={{ fontSize: '20px', fontWeight: '900', color: '#f87171' }}>
              🔥 {stats.currentStreak}일째
            </span>
          </div>
          <div style={{ background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '12px', padding: '10px 12px', textAlign: 'center' }}>
            <span style={{ fontSize: '11px', color: '#93c5fd', display: 'block', fontWeight: 'bold' }}>누적 출석</span>
            <span style={{ fontSize: '20px', fontWeight: '900', color: '#60a5fa' }}>
              ⭐ 총 {stats.totalDays}일
            </span>
          </div>
        </div>

        {/* 출석체크 버튼 */}
        <div style={{ marginBottom: '16px' }}>
          {stats.isTodayChecked ? (
            <button
              type="button"
              disabled
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '14px',
                fontWeight: 'bold',
                background: 'rgba(16, 185, 129, 0.2)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                borderRadius: '12px',
                cursor: 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <span>✅ 오늘 출석 완료!</span>
              <span style={{ fontSize: '12px', color: '#a7f3d0' }}>({stats.currentStreak}일 연속 달성)</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCheckIn}
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '15px',
                fontWeight: '800',
                background: 'linear-gradient(135deg, #ef4444, #f59e0b)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(239, 68, 68, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'transform 0.15s ease',
              }}
            >
              <span>🔥 오늘 출석 도장 찍기!</span>
            </button>
          )}
          {justChecked && (
            <p style={{ fontSize: '12px', color: '#4ade80', textAlign: 'center', marginTop: '6px', fontWeight: 'bold' }}>
              🎉 출석 도장이 찍혔습니다! 연속 출석 랭킹에 반영됩니다.
            </p>
          )}
        </div>

        {/* 캘린더 네비게이션 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <button
            type="button"
            onClick={handlePrevMonth}
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}
          >
            ◀
          </button>
          <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#e2e8f0' }}>
            {year}년 {month}월
          </span>
          <button
            type="button"
            onClick={handleNextMonth}
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}
          >
            ▶
          </button>
        </div>

        {/* 달력 요일 헤더 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', marginBottom: '6px' }}>
          {['일', '월', '화', '수', '목', '금', '토'].map((dow, idx) => (
            <span
              key={dow}
              style={{
                fontSize: '11px',
                fontWeight: 'bold',
                color: idx === 0 ? '#f87171' : idx === 6 ? '#60a5fa' : '#94a3b8',
              }}
            >
              {dow}
            </span>
          ))}
        </div>

        {/* 달력 날짜 그리드 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
          {calendarDays.map((cell, idx) => {
            if (!cell.day) {
              return <div key={`empty-${idx}`} style={{ height: '36px' }} />;
            }
            return (
              <div
                key={cell.dateString}
                style={{
                  height: '36px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: cell.isToday ? '800' : '500',
                  background: cell.isChecked
                    ? 'rgba(16, 185, 129, 0.2)'
                    : cell.isToday
                    ? 'rgba(59, 130, 246, 0.2)'
                    : 'rgba(255, 255, 255, 0.03)',
                  border: cell.isToday
                    ? '1px solid #38bdf8'
                    : cell.isChecked
                    ? '1px solid rgba(16, 185, 129, 0.4)'
                    : '1px solid rgba(255, 255, 255, 0.05)',
                  color: cell.isChecked ? '#4ade80' : cell.isToday ? '#38bdf8' : '#cbd5e1',
                  position: 'relative',
                }}
              >
                <span>{cell.day}</span>
                {cell.isChecked && (
                  <span style={{ fontSize: '9px', lineHeight: 1, marginTop: '1px' }}>✔️</span>
                )}
              </div>
            );
          })}
        </div>

        {/* 모달 하단 랭킹 링크 */}
        {onOpenRanking && (
          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenRanking();
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#a5b4fc',
                fontSize: '13px',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              🔥 연속 출석 랭킹 확인하기 →
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
