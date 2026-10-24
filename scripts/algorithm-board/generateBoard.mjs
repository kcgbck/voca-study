import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

// 1. Load baseline
const baselinePath = path.join(ROOT_DIR, 'docs/algorithm-board/baseline.json');
if (!fs.existsSync(baselinePath)) {
  throw new Error(`docs/algorithm-board/baseline.json not found at ${baselinePath}`);
}
const baselineRaw = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

const conflictingNodeIds = new Set([
  'NODE-02', 'NODE-03', 'NODE-04', 'NODE-05', 'NODE-06', 'NODE-07', 'NODE-17',
  'NODE-29', 'NODE-33', 'NODE-44', 'NODE-60', 'NODE-61', 'NODE-62', 'NODE-65',
  'NODE-66', 'NODE-67', 'NODE-70'
]);

// 2. Clone baseline tabs (1-15) and nodes (1-98)
const tabs = JSON.parse(JSON.stringify(baselineRaw.data.tabs));
const nodes = JSON.parse(JSON.stringify(baselineRaw.data.nodes));

// Fix conflicting 17 nodes
for (const node of nodes) {
  if (conflictingNodeIds.has(node.id)) {
    node.badge = '설계 단계 (코드 존재)';
    node.verification = '코드로 확인 (실행 미검증)';
    if (node.details) {
      node.details.확인_수준 = '코드로 확인 (실행 미검증)';
      if (!node.details.실행_근거.includes('작동 중 자동 승격 금지')) {
        node.details.실행_근거 += ' [현황 근거] 코드는 저장소에 존재하나 엔드투엔드 운영 동작이 아직 미검증된 설계 단계 상태임. (작동 중 자동 승격 금지 원칙 적용)';
      }
    }
  }

}

// 3. Define 3 new conversation tabs
const newTabs = [
  {
    id: 'tab-16',
    num: 16,
    name: 'AI 회화 / 수업 실행',
    desc: '도입·레벨·128차시 교육과정·상황극·발화 판단·단계적 힌트·성취도 평가 및 수업 완료 파이프라인',
    p0_count: 1
  },
  {
    id: 'tab-17',
    num: 17,
    name: 'AI 회화 / 음성·Gemini',
    desc: '마이크 권한·오디오 검증·Gemini 축어 전사·학생 편집 승인·수업 맥락 구성·Gemini 3.8 대화·JSON 스키마 검증·로컬 TTS·오프라인 대체 파이프라인',
    p0_count: 4
  },
  {
    id: 'tab-18',
    num: 18,
    name: 'AI 회화 / 기록·안전·검증',
    desc: 'Dexie v3 세션 보존·에빙하우스 망각곡선 복습·v2 백업 복원·API 키 은닉·무료 티어 비용 차단·개인정보 동의 게이트·/api/admin/cleanup 영구 차단·100건 골든셋 전주기 검증·출시 동결 게이트',
    p0_count: 6
  }
];

tabs.push(...newTabs);

// 4. Define 27 new conversation nodes (CONV-01 ~ CONV-27)
const newNodes = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'docs/algorithm-board/conversationNodes.json'), 'utf8'));
nodes.push(...newNodes);

// Baseline NODE-96..98 pointed at tab-16 although only tab-1..15 existed.
// Preserve that orphan relation as history; avoid colliding with the new course tab.
for (const node of nodes) {
  if (['NODE-96', 'NODE-97', 'NODE-98'].includes(node.id)) {
    node.originalTab = { id: node.tab_id, name: node.tab_name };
    const destination = tabs.find(tab => tab.id === (node.id === 'NODE-98' ? 'tab-1' : 'tab-11'));
    node.tab_id = destination.id;
    node.tab_name = destination.name;
  }
}

// Historical prose remains intact. Current source availability is a separate evidence layer.
for (const node of nodes) {
  const paths = node.details.파일.split(/[,\n]/).map(p => p.replace(/`/g, '').trim()).filter(Boolean);
  node.referenceChecks = paths.map(source => ({ source, exists: fs.existsSync(path.join(ROOT_DIR, source)) }));
  if (node.id.startsWith('NODE-')) node.currentNote = '기준선 원문/검사 이력 보존. 이 카드의 과거 실행·운영 주장은 이번 작업에서 재검증하지 않았습니다. 현재는 Pages Functions 로컬 시험·Dexie v3·상단3탭 구조이며, 없는 경로는 과거 근거·미확인으로 취급합니다.' + (node.originalTab ? ' 과거 존재하지 않던 탭 ' + node.originalTab.id + ' (' + node.originalTab.name + ') 참조를 보존하고 현재 탐색 위치를 ' + node.tab_id + ' (' + node.tab_name + ')로 교정했습니다.' : '');
}

// 5. Define 44 explicit edges (matching Appendix E)
const edges = [
  { id: 'EDGE-01', from: 'NODE-01', to: 'CONV-01', type: '사용자 흐름', condition: '홈 7번째 카드 터치', summary: 'PWA 메인 대시보드에서 AI 영어 회화 메뉴 선택 진입' },
  { id: 'EDGE-02', from: 'CONV-01', to: 'CONV-02', type: '처리 흐름', condition: '회화 홈 진입', summary: '회화 메인 화면에서 4단계 128차시 교육과정 목록 로드' },
  { id: 'EDGE-03', from: 'CONV-02', to: 'CONV-03', type: '데이터 조회', condition: '32차시 중 1개 선택', summary: '선택한 차시의 고정 교재 콘텐츠(목표/표현/상황/역할) 로드' },
  { id: 'EDGE-04', from: 'CONV-03', to: 'CONV-04', type: '상태 초기화', condition: '수업 시작 버튼 클릭', summary: '수업 세션 생성 및 유한 상태 머신 intro 단계 진입' },
  { id: 'EDGE-05', from: 'CONV-04', to: 'CONV-05', type: '사용자 흐름', condition: '학습/역할극 단계 활성화', summary: '대화 입력 UI 렌더링 및 사용자 발화 대기' },
  { id: 'EDGE-06', from: 'CONV-05', to: 'CONV-13', type: '텍스트 흐름', condition: '텍스트 직접 입력 후 전송', summary: '사용자 입력 텍스트와 최근 대화 이력 캡슐화' },
  { id: 'EDGE-07', from: 'CONV-13', to: 'CONV-21', type: '보안 흐름', condition: '서버 API 요청', summary: 'Cloudflare Pages Functions 엔드포인트 경유 및 서버 환경변수 키 보호' },
  { id: 'EDGE-08', from: 'CONV-21', to: 'CONV-22', type: '요금 차단', condition: 'Google AI 요청 전', summary: '무료 프로젝트 확인 플래그·예산 어댑터 검사. 실계정 한도·실제 어댑터 미구성으로 기본 차단.' },
  { id: 'EDGE-09', from: 'CONV-22', to: 'CONV-23', type: '개인정보 보호', condition: '데이터 전송 전', summary: '4대 명시 동의와 허용 필드 최소 전송. 자유 입력의 민감정보 자동 판별을 보장하지 않음.' },
  { id: 'EDGE-10', from: 'CONV-23', to: 'CONV-14', type: 'API 호출', condition: '검증 완료', summary: 'Gemini 3.8 Flash 모델로 대화 및 교정 피드백 요청' },
  { id: 'EDGE-11', from: 'CONV-05', to: 'CONV-09', type: '음성 흐름', condition: '마이크 버튼 클릭', summary: '마이크 장치 접근 권한 요청 및 녹음 시작' },
  { id: 'EDGE-12', from: 'CONV-09', to: 'CONV-10', type: '데이터 검증', condition: '녹음 중지 시', summary: '오디오 Blob 크기/길이/MIME 형식 게이트 검증' },
  { id: 'EDGE-13', from: 'CONV-10', to: 'CONV-11', type: '전사 요청', condition: '오디오 유효', summary: 'Gemini 전사 API로 오디오 전달 및 축어적 STT 수행' },
  { id: 'EDGE-14', from: 'CONV-11', to: 'CONV-12', type: '사용자 확인', condition: '전사 완료', summary: '전사된 텍스트를 학생에게 표시하여 직접 확인/편집 기회 제공' },
  { id: 'EDGE-15', from: 'CONV-12', to: 'CONV-13', type: '발화 제출', condition: '학생 확인/승인 완료', summary: '승인된 발화 텍스트를 대화 맥락과 결합하여 전송 큐에 투입' },
  { id: 'EDGE-16', from: 'CONV-09', to: 'CONV-05', type: '오류 복구', condition: '마이크 권한 거부', summary: '마이크 권한 거부 또는 미지원 기기 시 텍스트 입력 모드로 즉시 복구' },
  { id: 'EDGE-17', from: 'CONV-12', to: 'CONV-05', type: '재시도', condition: '전사 재녹음 필요', summary: '전사 결과 오인식 시 녹음 취소 후 재녹음 또는 텍스트 전환' },
  { id: 'EDGE-18', from: 'CONV-14', to: 'CONV-15', type: '응답 수신', condition: '모델 응답 도착', summary: 'Gemini 응답 JSON 스키마 및 고정 사실 일관성 검증' },
  { id: 'EDGE-19', from: 'CONV-15', to: 'CONV-06', type: '교육 판단', condition: '유효한 AI 응답', summary: '학습자 발화의 의미 우선 평가 및 6종 판정 분류 실행' },
  { id: 'EDGE-20', from: 'CONV-06', to: 'CONV-07', type: '힌트 분기', condition: '오류/막힘 판정', summary: '즉시 정답 노출 없이 단계적 힌트(키워드/틀/예문) 제공' },
  { id: 'EDGE-21', from: 'CONV-07', to: 'CONV-05', type: '재발화 유도', condition: '힌트 제공 후', summary: '학습자가 스스로 수정 발화하도록 입력 대기' },
  { id: 'EDGE-22', from: 'CONV-06', to: 'CONV-08', type: '목표 달성', condition: '의미 허용/정상 발화', summary: '학습 목표 달성 여부 규칙 기반 평가 및 성취도 갱신' },
  { id: 'EDGE-23', from: 'CONV-08', to: 'CONV-18', type: '데이터 저장', condition: '수업 완료 판정', summary: '완료 세션 및 진도율을 Dexie v3 IndexedDB에 멱등 저장' },
  { id: 'EDGE-24', from: 'CONV-18', to: 'CONV-19', type: '복습 스케줄', condition: '취약 표현 감지', summary: '교정받은 표현을 1/3/7/14일 간격의 복습 큐로 자동 예약' },
  { id: 'EDGE-25', from: 'CONV-19', to: 'CONV-02', type: '진도 반영', condition: '복습/학습 완료', summary: '교육과정 목차에 복습 태그 및 달성도 실시간 반영' },
  { id: 'EDGE-26', from: 'CONV-15', to: 'CONV-16', type: '음성 출력', condition: 'AI 영어 문장 도착', summary: '공식 TTS 어댑터와 브라우저 대체 재생 (실계정·음질 미검증)' },
  { id: 'EDGE-27', from: 'CONV-16', to: 'CONV-05', type: '상호작용', condition: 'TTS 재생 완료', summary: 'AI 응답 청취 완료 후 사용자 다음 턴 입력 대기' },
  { id: 'EDGE-28', from: 'CONV-14', to: 'CONV-17', type: '오류 복구', condition: '무료 한도 초과(429)/네트워크 오류', summary: 'Gemini 호출 실패 시 고정 교재 기반 오프라인 규칙 학습으로 전환' },
  { id: 'EDGE-29', from: 'CONV-11', to: 'CONV-17', type: '오류 복구', condition: '전사 API 오류', summary: 'STT 장애 시 텍스트 모드 안내 및 오프라인 규칙 전환' },
  { id: 'EDGE-30', from: 'CONV-17', to: 'CONV-05', type: '대체 학습', condition: '규칙 대체 응답 생성', summary: '오프라인 고정 피드백 제공 후 계속 학습 진행' },
  { id: 'EDGE-31', from: 'CONV-18', to: 'CONV-20', type: '데이터 백업', condition: '사용자 백업 내보내기', summary: '회화 세션/진도/복습 데이터를 v2 백업 JSON으로 묶어 내보내기' },
  { id: 'EDGE-32', from: 'CONV-03', to: 'CONV-25', type: '검증 연계', condition: '교재 로드', summary: '32차시 교재 계약 및 무결성 자동 검증' },
  { id: 'EDGE-33', from: 'CONV-14', to: 'CONV-25', type: '검증 연계', condition: 'API 핸들러', summary: 'Gemini API 요청/응답 계약 및 보안 게이트 검증' },
  { id: 'EDGE-34', from: 'CONV-18', to: 'CONV-25', type: '검증 연계', condition: '스토리지 트랜잭션', summary: 'Dexie v3 스키마 및 마이그레이션 무결성 검증' },
  { id: 'EDGE-35', from: 'CONV-24', to: 'CONV-26', type: '보안 게이트', condition: '출시 관문', summary: '파괴적 cleanup 차단 확인 후 출시 적합성 판정' },
  { id: 'EDGE-36', from: 'CONV-25', to: 'CONV-26', type: '품질 게이트', condition: '출시 관문', summary: '자동 검증 100% 통과 확인 후 사람 검수 단계로 인계' },
  { id: 'EDGE-37', from: 'NODE-49', to: 'CONV-18', type: '기존 결합', condition: 'DB 마이그레이션', summary: '기존 IndexedDB v1/v2 테이블과 v3 회화 테이블의 무손실 공존' },
  { id: 'EDGE-38', from: 'NODE-58B', to: 'CONV-17', type: '기존 결합', condition: '네트워크 단절', summary: '기존 PWA 오프라인 기반과 회화 고정 학습 대체의 연결. 완전 오프라인 실기기 시험은 별도.' },
  { id: 'EDGE-39', from: 'NODE-96', to: 'CONV-21', type: '기존 결합', condition: '배포 보안', summary: 'Cloudflare Pages/Workers 인프라 보안 및 환경변수 격리 공유' },
  { id: 'EDGE-40', from: 'NODE-91', to: 'CONV-21', type: '보안 구별', condition: '인증 분리', summary: '랭킹용 기기 식별 코드와 서버 API 접근 제어 분리' },
  { id: 'EDGE-41', from: 'NODE-65', to: 'CONV-25', type: '검증 보존', condition: '회귀 방지', summary: '기존 관문 1~3 검증 체계와 회화 자동 검증 슈트 결합' },
  { id: 'EDGE-42', from: 'NODE-66', to: 'CONV-25', type: '검증 보존', condition: '회귀 방지', summary: '기존 관문 4~6 검증 체계와 회화 자동 검증 슈트 결합' },
  { id: 'EDGE-43', from: 'NODE-67', to: 'CONV-25', type: '검증 보존', condition: '회귀 방지', summary: '기존 관문 7~9 검증 체계와 회화 자동 검증 슈트 결합' },
  { id: 'EDGE-44', from: 'CONV-27', to: 'CONV-14', type: '설계 확장', condition: '미래 실시간 음성 스트리밍 (현재 미구현)', summary: '향후 Gemini Live 연결 위치만 표시. 현재 스트리밍 인터페이스 구현 없음.' }
];

// Recalculate P0 counts per tab
edges.push(
  { id: 'EDGE-45', from: 'CONV-18', to: 'CONV-04', type: '중단 재개', condition: '저장된 활성 세션 재진입', summary: '단계·과제 위치·입력 초안 복원; 저장 완료 전 강제 종료는 제한' },
  { id: 'EDGE-46', from: 'CONV-20', to: 'CONV-18', type: '복원', condition: '백업 검증·충돌 검사 통과', summary: '트랜잭션 병합 복원; 실패 시 전체 롤백' },
  { id: 'EDGE-47', from: 'CONV-04', to: 'CONV-18', type: '중단 저장', condition: '입력·단계·과제 변경', summary: '세션 저장 큐에 스냅샷 등록' },
  { id: 'EDGE-48', from: 'CONV-21', to: 'CONV-17', type: '보안 차단', condition: '인증·서버 키·성인 관문 없음 401/403', summary: 'Google 호출 없이 고정 교재 안내' },
  { id: 'EDGE-49', from: 'CONV-22', to: 'CONV-17', type: '비용 차단', condition: '무료 적격 미확인403 또는 예산 거절429', summary: '유료 승급·다른 API 대체 없음' },
  { id: 'EDGE-50', from: 'CONV-10', to: 'CONV-17', type: '음성 오류', condition: '빈 오디오·길이·용량·MIME 거부', summary: '전사 요청 전 텍스트 대체' },
  { id: 'EDGE-51', from: 'CONV-15', to: 'CONV-17', type: '응답 거부', condition: '손상 JSON·상황 왜곡·안전성 실패', summary: '검증 실패를 성공 대화로 표시하지 않음' },
  { id: 'EDGE-52', from: 'CONV-23', to: 'CONV-17', type: '동의 차단', condition: '명시 동의 없음', summary: '외부 전송 없이 텍스트 고정 교재 이용' }
);

// Recalculate P0 counts per tab
for (const tab of tabs) {
  tab.p0_count = nodes.filter(n => n.tab_id === tab.id && (n.risk.includes('P0') || (n.details && n.details.위험도 && n.details.위험도.includes('P0')))).length;
}

const totalP0 = nodes.filter(n => n.risk.includes('P0') || (n.details && n.details.위험도 && n.details.위험도.includes('P0'))).length;

const gates = ['콘텐츠 사람 검수','Google 무료 계정·청구·한도','Android/iOS 음성','외부 독립 코드 리뷰','운영 공개 승인'].map(name => ({name, status:'보류'}));
const verificationCounts = Object.fromEntries([...new Set(nodes.map(n => n.verification))].map(level => [level, nodes.filter(n => n.verification === level).length]));
const boardData = {
  gates,
  version: '2.2',
  updated_at: '2026-10-21',
  summary: {
    verification_counts: verificationCounts,
    pending_gates: gates.filter(g => g.status === '보류').length,
    total_tabs: tabs.length,
    total_nodes: nodes.length,
    total_edges: edges.length,
    p0_nodes: totalP0,
    active_nodes: nodes.filter(n => n.badge === '작동 중').length,
    design_nodes: nodes.filter(n => n.badge.includes('설계 단계')).length
  },
  tabs,
  nodes,
  edges
};

// 6. Save Single Source of Truth JSON
const boardDataDir = path.join(ROOT_DIR, 'docs/algorithm-board');
if (!fs.existsSync(boardDataDir)) {
  fs.mkdirSync(boardDataDir, { recursive: true });
}
const boardDataPath = path.join(boardDataDir, 'boardData.json');
fs.writeFileSync(boardDataPath, JSON.stringify(boardData, null, 2), 'utf8');

// 7. Generate Deterministic HTML
function generateHtml() {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>토익_스터디 앱 전체 알고리즘 보드 v2.2</title>
  <style>
    :root {
      --bg-primary: #0a0e17;
      --bg-secondary: #111827;
      --bg-card: #162032;
      --bg-card-hover: #1e2d45;
      --border-color: #24344d;
      --border-focus: #3b82f6;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --text-dim: #64748b;

      /* 범주별 테마 색상 */
      --color-input: #0284c7;
      --color-input-bg: rgba(2, 132, 199, 0.15);
      --color-process: #6366f1;
      --color-process-bg: rgba(99, 102, 241, 0.15);
      --color-judge: #d97706;
      --color-judge-bg: rgba(217, 119, 6, 0.15);
      --color-data: #059669;
      --color-data-bg: rgba(5, 150, 105, 0.15);
      --color-output: #16a34a;
      --color-output-bg: rgba(22, 163, 74, 0.15);
      --color-risk: #dc2626;
      --color-risk-bg: rgba(220, 38, 38, 0.15);
      --color-system: #8b5cf6;
      --color-system-bg: rgba(139, 92, 246, 0.15);

      /* 위험도 */
      --risk-p0: #ef4444;
      --risk-p0-bg: rgba(239, 68, 68, 0.2);
      --risk-p1: #f59e0b;
      --risk-p1-bg: rgba(245, 158, 11, 0.2);
      --risk-p2: #64748b;
      --risk-p2-bg: rgba(100, 116, 139, 0.2);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-primary);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
      line-height: 1.6;
      padding: 24px;
      min-height: 100vh;
    }

    .container {
      max-width: 1560px;
      margin: 0 auto;
    }

    /* 헤더 */
    header {
      background: linear-gradient(135deg, #111827 0%, #1e1b4b 100%);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 32px;
      margin-bottom: 24px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }

    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 20px;
    }

    .project-tag {
      display: inline-block;
      background: #4338ca;
      color: #e0e7ff;
      font-weight: 700;
      font-size: 13px;
      padding: 4px 12px;
      border-radius: 9999px;
      margin-bottom: 8px;
    }

    h1 {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #ffffff;
      margin-bottom: 6px;
    }

    .header-subtitle {
      font-size: 14px;
      color: var(--text-muted);
    }

    .header-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
    }

    .badge-p0 { background: var(--risk-p0-bg); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-p1 { background: var(--risk-p1-bg); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-p2 { background: var(--risk-p2-bg); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3); }
    .badge-success { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-frozen { background: rgba(99, 102, 241, 0.2); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.4); }

    /* 통계 그리드 */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      padding-top: 16px;
      border-top: 1px solid var(--border-color);
    }

    .stat-item {
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 12px 16px;
    }

    .stat-label {
      font-size: 12px;
      color: var(--text-dim);
      margin-bottom: 4px;
    }

    .stat-value {
      font-size: 20px;
      font-weight: 800;
      color: var(--text-main);
    }

    /* 흐름도 네비게이션 섹션 */
    .flow-section {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
    }

    .flow-title {
      font-size: 16px;
      font-weight: 700;
      color: #93c5fd;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .flow-chart-container {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 18px;
      overflow-x: auto;
      margin-bottom: 16px;
    }

    .flow-chart-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 900px;
      margin-bottom: 10px;
    }

    .flow-node-chip {
      background: #1e293b;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-main);
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }

    .flow-node-chip:hover {
      background: #334155;
      border-color: var(--border-focus);
      transform: translateY(-1px);
    }

    .flow-node-chip.p0 {
      border-color: rgba(239, 68, 68, 0.5);
      color: #fca5a5;
    }

    .flow-arrow {
      color: var(--text-dim);
      font-weight: 700;
      font-size: 13px;
    }

    /* 컨트롤 영역: 검색 및 필터 */
    .controls-panel {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .search-input {
      width: 100%;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 12px 18px;
      border-radius: 10px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }

    .search-input:focus {
      border-color: var(--border-focus);
    }

    .filter-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
    }

    .filter-label {
      font-size: 13px;
      font-weight: 700;
      color: var(--text-muted);
      min-width: 65px;
    }

    .filter-btn-group {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .filter-btn {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .filter-btn:hover {
      background: var(--bg-card-hover);
      color: var(--text-main);
    }

    .filter-btn.active {
      background: var(--border-focus);
      border-color: var(--border-focus);
      color: #ffffff;
    }

    /* 탭 바 */
    .tabs-bar {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 8px;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--border-color);
    }

    .tab-btn {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      padding: 10px 16px;
      border-radius: 10px 10px 0 0;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .tab-btn:hover {
      background: var(--bg-card);
      color: var(--text-main);
    }

    .tab-btn.active {
      background: var(--border-focus);
      border-color: var(--border-focus);
      color: #ffffff;
    }

    .tab-badge {
      background: rgba(0, 0, 0, 0.3);
      padding: 2px 6px;
      border-radius: 9999px;
      font-size: 11px;
    }

    .tab-p0-badge {
      background: #ef4444;
      color: #ffffff;
      padding: 2px 6px;
      border-radius: 9999px;
      font-size: 11px;
    }

    /* 활성 탭 헤더 */
    .tab-info-header {
      margin-bottom: 20px;
    }

    .tab-info-title {
      font-size: 20px;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 4px;
    }

    .tab-info-desc {
      font-size: 14px;
      color: var(--text-muted);
    }

    /* 카드 그리드 */
    .nodes-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }

    .node-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: all 0.25s ease;
      position: relative;
      cursor: pointer;
    }

    .node-card:hover {
      border-color: var(--border-focus);
      transform: translateY(-3px);
      box-shadow: 0 10px 20px -5px rgba(0, 0, 0, 0.4);
    }

    .node-card::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      border-radius: 14px 14px 0 0;
    }

    .cat-사용자-입력::before { background: var(--color-input); }
    .cat-처리::before { background: var(--color-process); }
    .cat-판단::before { background: var(--color-judge); }
    .cat-데이터::before { background: var(--color-data); }
    .cat-출력::before { background: var(--color-output); }
    .cat-위험::before { background: var(--color-risk); }
    .cat-화면::before { background: var(--color-system); }
    .cat-배포::before { background: #06b6d4; }
    .cat-저장::before { background: #10b981; }
    .cat-시스템::before { background: #8b5cf6; }
    .cat-설계::before { background: #64748b; }

    .node-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .node-id {
      font-family: monospace;
      font-size: 13px;
      font-weight: 700;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
      padding: 2px 8px;
      border-radius: 4px;
    }

    .node-badges {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .badge-category {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-muted);
    }

    .badge-state {
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-dim);
    }

    .node-title {
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 8px;
      line-height: 1.4;
    }

    .node-summary {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.5;
      margin-bottom: 16px;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .node-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      font-size: 12px;
    }

    .node-tech {
      color: var(--text-dim);
      max-width: 200px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .btn-detail {
      background: transparent;
      border: 1px solid var(--border-color);
      color: #38bdf8;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-detail:hover {
      background: #38bdf8;
      color: #0f172a;
    }

    /* 드로어 */
    .drawer-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 1000;
      opacity: 0;
      visibility: hidden;
      transition: all 0.3s ease;
    }

    .drawer-overlay.open {
      opacity: 1;
      visibility: visible;
    }

    .drawer-panel {
      position: fixed;
      top: 0; right: 0; bottom: 0;
      width: 100%;
      max-width: 640px;
      background: var(--bg-secondary);
      border-left: 1px solid var(--border-color);
      z-index: 1001;
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
      box-shadow: -10px 0 30px rgba(0, 0, 0, 0.6);
    }

    .drawer-panel.open {
      transform: translateX(0);
    }

    .drawer-header {
      padding: 24px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }

    .drawer-close {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      width: 36px;
      height: 36px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      cursor: pointer;
      transition: all 0.2s;
      flex-shrink: 0;
    }

    .drawer-close:hover {
      background: #ef4444;
      border-color: #ef4444;
      color: #ffffff;
    }

    .detail-list {
      padding: 24px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .detail-item {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 14px 16px;
    }

    .detail-item-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }

    .detail-item-num {
      width: 20px;
      height: 20px;
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
    }

    .detail-item-label {
      font-size: 13px;
      font-weight: 700;
      color: #e2e8f0;
    }

    .detail-item-content {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.5;
      word-break: break-all;
    }

    /* 간선 섹션 */
    .edge-box {
      margin-top: 12px;
      padding: 12px;
      background: rgba(0, 0, 0, 0.2);
      border: 1px dashed var(--border-color);
      border-radius: 8px;
    }

    .edge-pill-group {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
    }

    .edge-pill {
      background: #1e293b;
      border: 1px solid #334155;
      color: #38bdf8;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .edge-pill:hover {
      background: #38bdf8;
      color: #0f172a;
    }

    /* 푸터 */
    footer {
      text-align: center;
      padding: 30px;
      border-top: 1px solid var(--border-color);
      color: var(--text-dim);
      font-size: 13px;
    }

    /* 간선 디렉토리 테이블 */
    .edges-table-container {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 40px;
      overflow-x: auto;
    }

    .edges-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-align: left;
    }

    .edges-table th {
      background: var(--bg-card);
      color: #93c5fd;
      padding: 10px 14px;
      border-bottom: 2px solid var(--border-color);
      white-space: nowrap;
    }

    .edges-table td {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-color);
      color: var(--text-muted);
    }

    .edges-table tr:hover td {
      background: var(--bg-card);
      color: var(--text-main);
    }

    .edges-table-container, .flow-chart-container { max-width:100%; overflow-x:auto; }
    button { color:inherit; font:inherit; }
    .flow-node-chip, .edge-pill, .drawer-close { min-height:44px; }
    .node-card:focus-visible, button:focus-visible { outline:3px solid #93c5fd; outline-offset:2px; }
    @media (max-width: 768px) {
      body { padding: 12px; }
      header { padding: 20px; }
      .drawer-panel { max-width: 100%; }
      .nodes-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

<div class="container">
  <!-- 상단 헤더 -->
  <header>
    <div class="header-top">
      <div>
        <span class="project-tag">보카 스터디 (토익_스터디) 알고리즘 보드 v2.2</span>
        <h1>토익_스터디 앱 전체 알고리즘 보드</h1>
        <p class="header-subtitle">“입력 → 처리 → 판단 → 저장 → 문제 생성 → 학습 → AI 회화 → 기록” 전주기 아키텍처 및 검증 명세서</p>
      </div>
      <div class="header-badges">
        <span class="badge badge-success">실환경·사람 검수 별도</span>
        <span class="badge badge-frozen">이전 128차시 설계: RELEASE_FROZEN (사람 검수 대기)</span>
      </div>
    </div>

    <!-- 현재 공개 코치 현황 (2026-10-23) -->
    <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid #38bdf8; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px;">
      <h3 style="font-size: 16px; font-weight: 700; color: #38bdf8; margin-bottom: 8px;">현재 공개 코치 (2026-10-23 운영 현황)</h3>
      <p style="font-size: 13px; color: #cbd5e1; line-height: 1.6; margin-bottom: 8px;">
        • <strong>배포 현황</strong>: 만 18세 이상 성인 확인 1회(localStorage 저장 후 숨김) 기반의 무로그인 5개 핵심 일상 질문 코치 운영 중.<br>
        • <strong>대화 흐름</strong>: 영어 질문 → 브라우저 내장 Web Speech API 기반 10초 단일 발화 캡처(또는 타이머 없는 텍스트 모드) → 전사 확인(네/아니요) 생략 직접 1회 AI 평가 (초기 답변 및 변경 답변은 항상 AI 평가, 반복 연습에서 기검증된 정답과 대소문자·말미 종결부호 차이를 제외하고 일치 시 중복 호출 없이 안전 재사용) → 한국어 1문장 원포인트 피드백 및 영문 모범 문장 제시 → 완전 문장 1회 / 미완성 단답 2회 연습 후 다음 질문 이동. 음성 인식/합성은 브라우저 내장 기능을 사용하여 Gemini STT/TTS API 호출을 일절 소모하지 않음 (FOLLOWUP-19 D1 예산 확인 시 STT/TTS 0건 기록).<br>
        • <strong>독립 D1 예산 및 안정화</strong>: 독립 D1 예산 DB(CONVERSATION_BUDGET_DB) 연동. Gemini 3.5 Flash Lite CHAT 모델 적용, <strong>13 RPM</strong> / 225,000 안전 유닛/분 / <strong>450 RPD</strong>의 전체 90% 하드캡 보호. 고정 발신자 3/분 클램프 제거 완료.<br>
        • <strong>로컬 페이싱 (FOLLOWUP-19)</strong>: 분당 한도 초과 시 답변을 보존하며 61초 대기 후 최대 2회 자동 재시도 (일일/제공자 오류는 재시도 없음).<br>
        • <strong>검증 근거</strong>: FOLLOWUP-19 이력 검증 기준 670개 단위/통합 자동화 테스트 통과, 동일 발신자 17.260초 내 4회 연속 호출 200 OK 성공 (<a href="FOLLOWUP-18_DIRECT_COACH.md" style="color: #38bdf8;">FOLLOWUP-18</a>, <a href="FOLLOWUP-19_PACED_COACH.md" style="color: #38bdf8;">FOLLOWUP-19</a>). <a href="FOLLOWUP-20_S25_CHECK_AND_RESULT.md" style="color: #38bdf8;">FOLLOWUP-20 최신 검증·배포 결과</a>.<br>
        • <strong>주의 사항</strong>: 최신 S25 실기기 전주기 평가는 사용자 수동 피드백 대기 중이며, 모든 기기나 고부하 환경의 작동을 단정하지 않습니다.
      </p>
    </div>

    <!-- 통계 요약 -->
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-label">전체 탭 수</div>
        <div class="stat-value" id="statTabs">${tabs.length}개 탭</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">전체 노드 수</div>
        <div class="stat-value" id="statNodes">${nodes.length}개 노드</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">명시적 간선 (Edges)</div>
        <div class="stat-value" id="statEdges">${edges.length}개 연결</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">P0 핵심 위험 노드</div>
        <div class="stat-value" style="color: #f87171;" id="statP0">${totalP0}개 관리</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">확인 수준</div>
        <div class="stat-value" style="font-size: 15px; color: #34d399;">${Object.entries(verificationCounts).map(([level,count]) => level + ' ' + count).join(' / ')} · 보류 관문 ${boardData.summary.pending_gates}</div>
      </div>
    </div>
  </header>

  <!-- 전주기 핵심 흐름 시각화 섹션 -->
  <section class="flow-section">
    <h2 class="flow-title">🧭 이전 128차시 설계 파이프라인 (Interactive Flow — 레거시 아키텍처)</h2>
    <div class="flow-chart-container">
      <div class="flow-chart-row">
        <span style="color: #60a5fa; font-weight: 700; width: 80px;">[메인/교재]</span>
        <button class="flow-node-chip" onclick="focusNode('NODE-01')">NODE-01 앱 진입</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip" onclick="focusNode('CONV-01')">CONV-01 회화 메뉴</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip" onclick="focusNode('CONV-02')">CONV-02 128목차</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip" onclick="focusNode('CONV-03')">CONV-03 32과 교재</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip" onclick="focusNode('CONV-04')">CONV-04 FSM 머신</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip" onclick="focusNode('CONV-05')">CONV-05 대답 입력</button>
      </div>
      <div class="flow-chart-row">
        <span style="color: #38bdf8; font-weight: 700; width: 80px;">[음성 경로]</span>
        <button class="flow-node-chip" onclick="focusNode('CONV-05')">CONV-05 발화</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip" onclick="focusNode('CONV-09')">CONV-09 마이크</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip" onclick="focusNode('CONV-10')">CONV-10 오디오게이트</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip p0" onclick="focusNode('CONV-11')">CONV-11 축어전사(P0)</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip" onclick="focusNode('CONV-12')">CONV-12 학생확인</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip p0" onclick="focusNode('CONV-13')">CONV-13 맥락조립</button>
      </div>
      <div class="flow-chart-row">
        <span style="color: #f59e0b; font-weight: 700; width: 80px;">[서버/AI]</span>
        <button class="flow-node-chip p0" onclick="focusNode('CONV-13')">CONV-13 맥락</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip p0" onclick="focusNode('CONV-21')">CONV-21 키은닉</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip p0" onclick="focusNode('CONV-22')">CONV-22 무료한도</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip p0" onclick="focusNode('CONV-23')">CONV-23 4대동의</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip p0" onclick="focusNode('CONV-14')">CONV-14 Gemini호출</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip p0" onclick="focusNode('CONV-15')">CONV-15 응답검증</button>
      </div>
      <div class="flow-chart-row">
        <span style="color: #34d399; font-weight: 700; width: 80px;">[교육/저장]</span>
        <button class="flow-node-chip p0" onclick="focusNode('CONV-15')">CONV-15 검증응답</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip p0" onclick="focusNode('CONV-06')">CONV-06 의미판단</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip" onclick="focusNode('CONV-08')">CONV-08 성취평가</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip p0" onclick="focusNode('CONV-18')">CONV-18 Dexie v3</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip" onclick="focusNode('CONV-19')">CONV-19 망각복습</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip" onclick="focusNode('CONV-02')">CONV-02 진도반영</button>
      </div>
      <div class="flow-chart-row">
        <span style="color: #f87171; font-weight: 700; width: 80px;">[보안/대체]</span>
        <button class="flow-node-chip p0" onclick="focusNode('CONV-24')">CONV-24 cleanup 403 영구차단</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip" onclick="focusNode('CONV-26')">CONV-26 출시게이트</button>
        <span style="margin-left: 20px; color: var(--text-dim);">|</span>
        <span style="margin-left: 10px; color: #a5b4fc; font-weight: 700;">[오프라인]</span>
        <button class="flow-node-chip" onclick="focusNode('CONV-17')">CONV-17 무료한도/오류대체학습</button>
        <span class="flow-arrow">➔</span>
        <button class="flow-node-chip" onclick="focusNode('CONV-05')">CONV-05 텍스트 계속</button>
      </div>
    </div>
    <p style="font-size: 12px; color: var(--text-dim);">💡 칩을 클릭하면 해당 알고리즘 노드의 상세 15개 항목과 전후 연결 간선 드로어가 열립니다.</p>
  </section>

  <!-- 검색 및 필터 패널 -->
  <section class="controls-panel">
    <div class="search-box">
      <input type="text" id="searchInput" class="search-input" placeholder="🔍 알고리즘 제목, ID, 기술 스택, 함수명, 역할 검색... (예: Gemini, Dexie, FSM, 403, 128목차)" oninput="applyFilters()">
    </div>

    <!-- 범주 필터 -->
    <div class="filter-row">
      <span class="filter-label">범주 필터</span>
      <div class="filter-btn-group" id="categoryFilters">
        <button class="filter-btn active" data-cat="all" onclick="setCategoryFilter('all')">전체</button>
        <button class="filter-btn" data-cat="사용자 입력" onclick="setCategoryFilter('사용자 입력')">사용자 입력</button>
        <button class="filter-btn" data-cat="처리" onclick="setCategoryFilter('처리')">처리</button>
        <button class="filter-btn" data-cat="판단" onclick="setCategoryFilter('판단')">판단</button>
        <button class="filter-btn" data-cat="데이터" onclick="setCategoryFilter('데이터')">데이터</button>
        <button class="filter-btn" data-cat="출력" onclick="setCategoryFilter('출력')">출력</button>
        <button class="filter-btn" data-cat="위험" onclick="setCategoryFilter('위험')">위험</button>
      </div>
    </div>

    <!-- 위험도 필터 -->
    <div class="filter-row">
      <span class="filter-label">위험도</span>
      <div class="filter-btn-group" id="riskFilters">
        <button class="filter-btn active" data-risk="all" onclick="setRiskFilter('all')">전체</button>
        <button class="filter-btn" data-risk="P0" onclick="setRiskFilter('P0')">P0 · 즉시 해결 (${totalP0})</button>
        <button class="filter-btn" data-risk="P1" onclick="setRiskFilter('P1')">P1 · 중요 개선</button>
        <button class="filter-btn" data-risk="P2" onclick="setRiskFilter('P2')">P2 · 정리 대상</button>
        <button class="filter-btn" data-risk="일반" onclick="setRiskFilter('일반')">일반</button>
      </div>
    </div>
  </section>

  <!-- 탭 바 -->
  <nav class="tabs-bar" id="tabsBar">
    <!-- 자바스크립트로 탭 18개 렌더링 -->
  </nav>

  <!-- 활성 탭 헤더 정보 -->
  <div class="tab-info-header">
    <h2 class="tab-info-title" id="currentTabTitle">탭 1. 전체 구조</h2>
    <p class="tab-info-desc" id="currentTabDesc">앱의 처음부터 끝까지 전체 파이프라인 및 최상위 아키텍처</p>
  </div>

  <!-- 카드 그리드 -->
  <p id="resultCount" role="status" aria-live="polite"></p><div class="nodes-grid" id="nodesGrid">
    <!-- 자바스크립트로 노드 카드 렌더링 -->
  </div>

  <!-- 전체 간선 디렉토리 테이블 -->
  <section class="edges-table-container">
    <h2 class="flow-title">🔗 전체 명시적 방향성 간선 디렉토리 (Explicit Edges Directory — 총 ${edges.length}건)</h2>
    <table class="edges-table">
      <thead>
        <tr>
          <th>간선 ID</th>
          <th>출발 노드 (From)</th>
          <th>도착 노드 (To)</th>
          <th>흐름 유형 (Type)</th>
          <th>분기 조건 (Condition)</th>
          <th>흐름 요약 (Summary)</th>
        </tr>
      </thead>
      <tbody id="edgesTableBody">
        <!-- 자바스크립트로 렌더링 -->
      </tbody>
    </table>
  </section>

  <!-- 푸터 -->
  <footer>
    <p>보카 스터디 알고리즘 보드 v2.2 · P0는 중요도이며 현재 결함 수가 아닙니다. 이전 128차시 설계의 기기·사람 검수·독립 리뷰·출시 관문은 별도 보류. 현재 공개 코치는 상단 운영 현황 참조.</p>
    <p style="margin-top: 4px; font-size: 12px;">한국어 보드 · 실환경·사람 검수 별도 • ${tabs.length}개 탭 • ${nodes.length}개 노드 • ${edges.length}개 간선 • 단일 진실 공급원 (boardData.json) 결정론적 빌드</p>
  </footer>
</div>

<!-- 상세 패널 (모달 / 슬라이드 드로어) -->
<div class="drawer-overlay" id="drawerOverlay" onclick="closeDrawer()"></div>
<aside class="drawer-panel" id="drawerPanel" role="dialog" aria-modal="true" aria-labelledby="drawerNodeTitle" aria-hidden="true">
  <div class="drawer-header">
    <div>
      <span class="node-id" id="drawerNodeId">NODE-01</span>
      <h3 style="font-size: 20px; font-weight: 800; color: #ffffff; margin-top: 4px;" id="drawerNodeTitle">노드 제목</h3>
    </div>
    <button class="drawer-close" onclick="closeDrawer()" title="닫기 (ESC)">✕</button>
  </div>

  <!-- 15개 상세 항목 목록 -->
  <div class="detail-list" id="drawerDetailList">
    <!-- 자바스크립트로 15개 항목 렌더링 -->
  </div>
</aside>

<script>
  // 단일 진실 공급원 주입
  const TABS = ${JSON.stringify(tabs, null, 2)};
  const NODES = ${JSON.stringify(nodes, null, 2)};
  const EDGES = ${JSON.stringify(edges, null, 2)};

  let currentTabId = "tab-1";
  let currentCategory = "all";
  let currentRisk = "all";
  let searchQuery = "";
  let drawerTrigger = null;
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[c])); }

  // 초기화
  window.addEventListener("DOMContentLoaded", () => {
    renderTabs();
    switchTab("tab-1");
    renderEdgesTable();

    // ESC 키로 드로어 닫기
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDrawer();
      const panel = document.getElementById("drawerPanel");
      if (e.key === "Tab" && panel.classList.contains("open")) {
        const focusable = Array.from(panel.querySelectorAll("button, [tabindex='0']"));
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  });

  // 탭 렌더링
  function renderTabs() {
    const tabsBar = document.getElementById("tabsBar");
    tabsBar.innerHTML = "";
    TABS.forEach(tab => {
      const count = NODES.filter(n => n.tab_id === tab.id).length;
      const btn = document.createElement("button");
      btn.className = \`tab-btn \${tab.id === currentTabId ? "active" : ""}\`;
      btn.id = \`btn-\${tab.id}\`;
      btn.onclick = () => switchTab(tab.id);

      let p0BadgeHtml = "";
      if (tab.p0_count > 0) {
        p0BadgeHtml = \`<span class="tab-p0-badge">P0 \${tab.p0_count}</span>\`;
      }

      btn.innerHTML = \`
        <span>탭 \${tab.num}. \${tab.name}</span>
        \${p0BadgeHtml}
        <span class="tab-badge">\${count}</span>
      \`;
      tabsBar.appendChild(btn);
    });
  }

  // 탭 전환
  function switchTab(tabId) {
    currentTabId = tabId;
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    const activeBtn = document.getElementById(\`btn-\${tabId}\`);
    if (activeBtn) activeBtn.classList.add("active");

    const tabMeta = TABS.find(t => t.id === tabId);
    if (tabMeta) {
      document.getElementById("currentTabTitle").textContent = \`탭 \${tabMeta.num}. \${tabMeta.name}\`;
      document.getElementById("currentTabDesc").textContent = tabMeta.desc;
    }

    renderNodes();
  }

  // 카테고리 필터
  function setCategoryFilter(cat) {
    currentCategory = cat;
    document.querySelectorAll("#categoryFilters .filter-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.cat === cat);
    });
    renderNodes();
  }

  // 위험도 필터
  function setRiskFilter(risk) {
    currentRisk = risk;
    document.querySelectorAll("#riskFilters .filter-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.risk === risk);
    });
    renderNodes();
  }

  // 검색
  function applyFilters() {
    searchQuery = document.getElementById("searchInput").value.trim().toLowerCase();
    renderNodes();
  }

  // 특정 노드로 직접 이동 및 드로어 열기
  function focusNode(nodeId) {
    const node = NODES.find(n => n.id === nodeId);
    if (!node) return;
    if (node.tab_id !== currentTabId) {
      switchTab(node.tab_id);
    }
    openDrawer(node);
  }

  // 노드 카드 렌더링
  function renderNodes() {
    const grid = document.getElementById("nodesGrid");
    grid.innerHTML = "";

    const filtered = NODES.filter(node => {
      const matchTab = searchQuery || node.tab_id === currentTabId;
      const matchCat = (currentCategory === "all" || node.category === currentCategory);
      let matchRisk = true;
      if (currentRisk !== "all") {
        matchRisk = node.risk.includes(currentRisk);
      }
      let matchSearch = true;
      if (searchQuery) {
        const text = (node.id + " " + node.title + " " + node.summary + " " + (node.details.기술_스킬 || "") + " " + (node.details.역할 || "") + " " + (node.details.파일 || "")).toLowerCase();
        matchSearch = text.includes(searchQuery);
      }
      return matchTab && matchCat && matchRisk && matchSearch;
    });

    document.getElementById("resultCount").textContent = "표시 " + filtered.length + " / 전체 " + NODES.length;
    if (filtered.length === 0) {
      grid.innerHTML = \`
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-dim);">
          <p style="font-size: 16px; margin-bottom: 8px;">조건에 일치하는 알고리즘 노드가 없습니다.</p>
          <p style="font-size: 13px;">검색어나 필터 조건을 재조정해 보세요.</p>
        </div>
      \`;
      return;
    }

    filtered.forEach(node => {
      const card = document.createElement("div");
      const catClass = "cat-" + node.category.replace(/\\s+/g, "-");
      card.className = \`node-card \${catClass}\`;
      card.onclick = () => openDrawer(node);
      card.tabIndex = 0; card.setAttribute("role", "button"); card.setAttribute("aria-label", node.id + " " + node.title);
      card.onkeydown = e => { if (e.target === card && (e.key === "Enter" || e.key === " ")) {e.preventDefault(); openDrawer(node);} };

      let riskBadgeClass = "badge-p2";
      if (node.risk.includes("P0")) riskBadgeClass = "badge-p0";
      else if (node.risk.includes("P1")) riskBadgeClass = "badge-p1";

      card.innerHTML = \`
        <div>
          <div class="node-header">
            <span class="node-id">\${escapeHtml(node.id)}</span>
            <div class="node-badges">
              <span class="badge badge-category">\${escapeHtml(node.category)}</span>
              <span class="badge \${riskBadgeClass}">\${escapeHtml(node.risk)}</span>
              <span class="badge badge-state">\${escapeHtml(node.badge)}</span>
            </div>
          </div>
          <h3 class="node-title">\${escapeHtml(node.title)}</h3>
          <p class="node-summary">\${escapeHtml(node.summary)}</p>
        </div>
        <div class="node-footer">
          <span class="node-tech" title="\${escapeHtml(node.details.기술_스킬)}">⚙ \${escapeHtml(node.details.기술_스킬)}</span>
          <button class="btn-detail">상세 15개 항목 ▸</button>
        </div>
      \`;
      grid.appendChild(card);
    });
  }

  // 상세 드로어 열기 (15개 필수 항목 + 연결 간선 표시)
  function openDrawer(node) {
    if (!document.getElementById("drawerPanel").classList.contains("open")) drawerTrigger = document.activeElement;
    document.getElementById("drawerNodeId").textContent = \`\${escapeHtml(node.id)} • \${escapeHtml(node.category)} • \${escapeHtml(node.risk)}\`;
    document.getElementById("drawerNodeTitle").textContent = node.title;

    const list = document.getElementById("drawerDetailList");
    list.innerHTML = "";
    const evidence = document.createElement("p");
    evidence.textContent = (node.currentNote || "현재 로컬 구현의 근거; 실계정·기기·사람 검수 별도.") + " 경로 확인: " + node.referenceChecks.map(r => r.source + (r.exists ? " [존재]" : " [과거 근거·미확인]")).join("; ");
    list.appendChild(evidence);

    // 15개 필수 항목
    const fields = [
      { key: "역할", label: "역할" },
      { key: "기술_스킬", label: "기술 / 스킬" },
      { key: "입력", label: "입력" },
      { key: "처리_분기", label: "처리 / 분기" },
      { key: "출력", label: "출력" },
      { key: "실패_시_처리", label: "실패 시 처리" },
      { key: "상태_읽기", label: "상태 읽기" },
      { key: "상태_저장", label: "상태 저장" },
      { key: "출처", label: "출처" },
      { key: "파일", label: "파일" },
      { key: "함수", label: "함수" },
      { key: "관련_테스트", label: "관련 테스트" },
      { key: "실행_근거", label: "실행 근거" },
      { key: "확인_수준", label: "확인 수준" },
      { key: "위험도", label: "위험도" }
    ];

    fields.forEach((f, idx) => {
      const val = node.details[f.key] || "미확인";
      const item = document.createElement("div");
      item.className = "detail-item";

      let contentHtml = escapeHtml(val);
      if (val === "미구현" || val === "미작성") {
        contentHtml = \`<span class="tag-not-implemented" style="color: #94a3b8; font-style: italic;">\${escapeHtml(val)}</span>\`;
      } else if (f.key === "위험도" && val.includes("P0")) {
        contentHtml = \`<span style="color: #f87171; font-weight: 700;">\${escapeHtml(val)}</span>\`;
      }

      item.innerHTML = \`
        <div class="detail-item-header">
          <span class="detail-item-num">\${idx + 1}</span>
          <span class="detail-item-label">\${f.label}</span>
        </div>
        <div class="detail-item-content">\${contentHtml}</div>
      \`;
      list.appendChild(item);
    });

    // 연결 간선 (Incoming / Outgoing)
    const incoming = EDGES.filter(e => e.to === node.id);
    const outgoing = EDGES.filter(e => e.from === node.id);

    if (incoming.length > 0 || outgoing.length > 0) {
      const edgeBox = document.createElement("div");
      edgeBox.className = "edge-box";

      let incomingHtml = "";
      if (incoming.length > 0) {
        incomingHtml = \`
          <div style="margin-bottom: 8px;">
            <span style="font-size: 12px; font-weight: 700; color: #93c5fd;">▲ 선행(상위) 노드</span>
            <div class="edge-pill-group">
              \${incoming.map(e => \`<button class="edge-pill" onclick="focusNode('\${e.from}')">\${e.from} (\${e.type})</button>\`).join("")}
            </div>
          </div>
        \`;
      }

      let outgoingHtml = "";
      if (outgoing.length > 0) {
        outgoingHtml = \`
          <div>
            <span style="font-size: 12px; font-weight: 700; color: #34d399;">▼ 후속(하위) 노드</span>
            <div class="edge-pill-group">
              \${outgoing.map(e => \`<button class="edge-pill" onclick="focusNode('\${e.to}')">\${e.to} (\${e.type})</button>\`).join("")}
            </div>
          </div>
        \`;
      }

      edgeBox.innerHTML = \`
        <div style="font-size: 13px; font-weight: 700; color: #ffffff; margin-bottom: 6px;">🔗 연결된 간선 (Edges)</div>
        \${incomingHtml}
        \${outgoingHtml}
      \`;
      list.appendChild(edgeBox);
    }

    document.getElementById("drawerOverlay").classList.add("open");
    document.getElementById("drawerPanel").classList.add("open");
    document.getElementById("drawerPanel").setAttribute("aria-hidden", "false");
    document.querySelector(".drawer-close").focus();
  }

  // 상세 드로어 닫기
  function closeDrawer() {
    document.getElementById("drawerOverlay").classList.remove("open");
    document.getElementById("drawerPanel").classList.remove("open");
    document.getElementById("drawerPanel").setAttribute("aria-hidden", "true");
    if (drawerTrigger && drawerTrigger.isConnected) drawerTrigger.focus();
  }

  // 간선 테이블 렌더링
  function renderEdgesTable() {
    const tbody = document.getElementById("edgesTableBody");
    tbody.innerHTML = "";
    EDGES.forEach(e => {
      const tr = document.createElement("tr");
      tr.innerHTML = \`
        <td style="font-family: monospace; font-weight: 700; color: #38bdf8;">\${e.id}</td>
        <td><button class="edge-pill" onclick="focusNode('\${e.from}')">\${e.from}</button></td>
        <td><button class="edge-pill" onclick="focusNode('\${e.to}')">\${e.to}</button></td>
        <td><span class="badge badge-category">\${e.type}</span></td>
        <td style="color: #fbbf24; font-size: 12px;">\${e.condition}</td>
        <td>\${e.summary}</td>
      \`;
      tbody.appendChild(tr);
    });
  }
</script>

</body>
</html>
`;
}

// 8. Generate Deterministic Markdown
function generateMarkdown() {



  let md = `> 현재 공개 서비스명: 보카 스터디 / 이전 프로젝트명: 토익_스터디

# 토익_스터디 앱 전체 알고리즘 보드 v2.2

> “입력 → 처리 → 판단 → 저장 → 문제 생성 → 학습 → AI 회화 → 기록” 전주기 아키텍처 및 검증 명세서

- 프로젝트명: **보카 스터디 (토익_스터디)**
- 전체 노드 수: **${nodes.length}개 노드** (기존 98 + 신규 27)
- 전체 탭 수: **${tabs.length}개 탭** (기존 15 + 신규 3)
- 명시적 간선 수: **${edges.length}개 간선**
- P0 중요도: **${totalP0}개** (현재 결함 개수가 아님)
- 확인 수준: ${Object.entries(verificationCounts).map(([level,count]) => level + ' ' + count).join(' / ')}
- 보류 관문: ${boardData.summary.pending_gates}개 (사람 검수·Google 계정·기기·독립 리뷰·운영 승인)
- 128목차 / 32초안 HUMAN_CURRICULUM_REVIEW_PENDING / 96준비중
- **현재 공개 코치 (2026-10-23 운영 현황)**:
  - 성인 18+ 확인 1회(localStorage 저장 후 카드 숨김) 기반 무로그인 5개 핵심 일상 질문 코치 배포 운영.
  - 브라우저 내장 Web Speech API 기반 10초 단일 발화 캡처(또는 타이머 없는 텍스트 모드) → 전사 확인(네/아니요) 생략 직접 1회 AI 평가 (초기 답변 및 변경 답변은 항상 AI 평가, 반복 연습에서 기검증된 정답과 대소문자·말미 종결부호 차이를 제외하고 일치 시 중복 호출 없이 안전 재사용) → 한국어 피드백 및 영문 모범 문장 제시 → 완전 문장 1회 / 미완성 단답 2회 연습 후 다음 질문. 음성 인식/합성은 브라우저 내장 기능을 사용하여 Gemini STT/TTS API 호출을 일절 소모하지 않음 (FOLLOWUP-19 D1 예산 확인 시 STT/TTS 0건 기록).
  - 독립 D1 예산 DB(CONVERSATION_BUDGET_DB) 연동. Gemini 3.5 Flash Lite CHAT 모델 적용, **13 RPM** / 225,000 안전 유닛/분 / **450 RPD**의 전체 90% 하드캡 보호. 고정 발신자 3/분 클램프 제거 완료.
  - 로컬 페이싱 (**FOLLOWUP-19**): 분당 한도 초과 시 답변을 보존하며 61초 대기 후 최대 2회 자동 재시도 (일일/제공자 오류는 재시도 없음).
  - 검증 근거: FOLLOWUP-19 이력 검증 기준 670개 단위/통합 자동화 테스트 통과, 동일 발신자 17.260초 내 4회 연속 호출 200 OK 성공 ([FOLLOWUP-18](FOLLOWUP-18_DIRECT_COACH.md), [FOLLOWUP-19](FOLLOWUP-19_PACED_COACH.md)). [FOLLOWUP-20 최신 검증·배포 결과](FOLLOWUP-20_S25_CHECK_AND_RESULT.md).
  - 주의: 최신 **S25** 실기기 전주기 평가는 사용자 수동 피드백 대기 중이며, 모든 기기나 고부하 환경의 작동을 단정하지 않습니다.
- **이전 128차시 설계**:
  - cleanup: 로컬 코드 기본403 및 자동 정리 호출 제거.
  - 128차시 교육과정 교육 내용 사람 검수, iOS/PWA 및 외부 독립 리뷰 대기 상태로 이전 설계에 대한 PUBLIC_RELEASE_STATUS=NOT_APPROVED 동결 유지 (현재 승인된 공개 5문항 코치는 독립 운영).
  - 첨부 파일 원문 대조 관문(BOARD-01) 및 직접 파일 렌더링 검증(BOARD-12A)은 미검증(NOT_VERIFIED) 상태 유지.
- 실제 명령·수치: [통합 결과](INTEGRATED-01_RESULT.md), [보드 감사](algorithm-board/BOARD_AUDIT_v2.2.md).

---

## 이전 128차시 설계 최상위 실행 구조 (ASCII & Mermaid 파이프라인)

\`\`\`mermaid
flowchart TD
    subgraph S1 ["1. 최상위 앱 셸"]
        N01["NODE-01: PWA 웹앱 실행 및 메인 메뉴"]
        N98["NODE-98: 모바일 4대 메뉴 대시보드"]
        N01 --> N98
    end

    subgraph S2 ["2. 기존 학습 트랙"]
        N02["경로 A: 기본 TOEIC (1,800단어)"]
        N79["경로 B: 해사영어 (451단어)"]
        N03["경로 C: 사진/PDF 문제집 제작"]
        N98 --> N02
        N98 --> N79
        N98 --> N03
    end

    subgraph S3 ["3. AI 회화 트랙 (신규)"]
        C01["CONV-01: AI 회화 메뉴 진입"]
        C02["CONV-02: 4단계 128차시 탐색"]
        C03["CONV-03: 32차시 고정교재 계약"]
        C04["CONV-04: FSM 수업상태머신"]
        C05["CONV-05: 텍스트/음성 대답입력"]

        N98 -->|7번째 홈 카드| C01
        C01 --> C02 --> C03 --> C04 --> C05
    end

    subgraph S4 ["4. 음성/AI 게이트웨이"]
        C09["CONV-09: 마이크 녹음"]
        C10["CONV-10: 오디오 게이트"]
        C11["CONV-11: Gemini 축어전사 (P0)"]
        C12["CONV-12: 학생 확인/편집"]
        C13["CONV-13: 맥락 조립/주입방어 (P0)"]
        C21["CONV-21: Pages API키 은닉 (P0)"]
        C22["CONV-22: 무료티어 비용차단 (P0)"]
        C23["CONV-23: 4대동의 게이트 (P0)"]
        C14["CONV-14: Gemini 대화호출 (P0)"]
        C15["CONV-15: JSON 응답검증 (P0)"]

        C05 -->|음성| C09 --> C10 --> C11 --> C12 --> C13
        C05 -->|텍스트| C13
        C13 --> C21 --> C22 --> C23 --> C14 --> C15
        C09 -.->|권한거부| C05
        C14 -.->|429/오류| C17["CONV-17: 오프라인 대체"]
        C17 --> C05
    end

    subgraph S5 ["5. 교육엔진 및 스토리지"]
        C06["CONV-06: 발화의미판단 (P0)"]
        C07["CONV-07: 3단계 힌트"]
        C08["CONV-08: 성취도평가"]
        C18["CONV-18: Dexie v3 저장 (P0)"]
        C19["CONV-19: 망각곡선 복습"]
        C20["CONV-20: JSON 백업 v2 (P0)"]

        C15 --> C06
        C06 -->|교정필요| C07 --> C05
        C06 -->|목표달성| C08 --> C18 --> C19 --> C02
        C18 --> C20
    end
\`\`\`

---
`;

  md += '\n## 원본·변경 이력\n\n기존 원문과 수기 부연은 [원본 MD](algorithm-board/baseline.md) 및 [원본 HTML](algorithm-board/baseline.html)에 바이트 그대로 보존합니다. 현재 노드의 상세는 원본을 유지하며 17개 상태 충돌과 노후 경로의 현재 해석은 [변경 이력](algorithm-board/CHANGE_HISTORY.md)을 참조하세요. 원본의 95개 표기·Workers URL·과거 검증 수치는 역사 기록이며 현재 운영 확인이 아닙니다. 현재는 Pages Functions 로컬 시험, Dexie v3, 상단3탭·기존6메뉴+회화카드 구조입니다.\n';
  // Render tabs and nodes
  for (const tab of tabs) {
    const tabNodes = nodes.filter(n => n.tab_id === tab.id);
    md += `\n## [탭 ${tab.num}] ${tab.name}\n`;
    md += `**설명**: ${tab.desc} (총 ${tabNodes.length}개 노드 / P0 ${tab.p0_count}개)\n\n`;

    for (const node of tabNodes) {
      md += `### [${node.id}] ${node.title}\n`;
      md += `- **범주**: ${node.category}\n`;
      md += `- **상태 배지**: ${node.badge}\n`;
      md += `- **위험도**: ${node.risk}\n`;
      md += `- **확인 수준**: ${node.verification}\n`;
      md += `- **요약**: ${node.summary}\n\n`;

      md += `#### 상세 15개 항목 (지시서 30항)\n`;
      md += `1. **역할**: ${node.details.역할 || '미확인'}\n`;
      md += `2. **기술 / 스킬**: ${node.details.기술_스킬 || '미확인'}\n`;
      md += `3. **입력**: ${node.details.입력 || '미확인'}\n`;
      md += `4. **처리 / 분기**: ${node.details.처리_분기 || '미확인'}\n`;
      md += `5. **출력**: ${node.details.출력 || '미확인'}\n`;
      md += `6. **실패 시 처리**: ${node.details.실패_시_처리 || '미확인'}\n`;
      md += `7. **상태 읽기**: ${node.details.상태_읽기 || '미확인'}\n`;
      md += `8. **상태 저장**: ${node.details.상태_저장 || '미확인'}\n`;
      md += `9. **출처**: ${node.details.출처 || '미확인'}\n`;
      md += `10. **파일**: \`${node.details.파일 || '미확인'}\`\n`;
      md += `11. **함수**: \`${node.details.함수 || '미확인'}\`\n`;
      md += `12. **관련 테스트**: \`${node.details.관련_테스트 || '미확인'}\`\n`;
      md += `13. **실행 근거**: ${node.details.실행_근거 || '미확인'}\n`;
      md += `14. **확인 수준**: ${node.details.확인_수준 || '미확인'}\n`;
      md += `15. **위험도**: ${node.details.위험도 || '미확인'}\n\n`;
      md += `현재 근거: ${node.currentNote || '로컬 구현·시험 근거. 실환경 별도.'}\n경로 확인: ${node.referenceChecks.map(r => r.source + (r.exists ? ' [존재]' : ' [과거 근거·미확인]')).join('; ')}\n\n`;

      const incoming = edges.filter(e => e.to === node.id);
      const outgoing = edges.filter(e => e.from === node.id);
      if (incoming.length > 0 || outgoing.length > 0) {
        md += `#### 연결 간선 (Edges)\n`;
        if (incoming.length > 0) {
          md += `- **선행(상위) 노드**: ${incoming.map(e => `[${e.from}] (${e.type}: ${e.condition})`).join(', ')}\n`;
        }
        if (outgoing.length > 0) {
          md += `- **후속(하위) 노드**: ${outgoing.map(e => `[${e.to}] (${e.type}: ${e.condition})`).join(', ')}\n`;
        }
        md += `\n`;
      }
      md += `---\n\n`;
    }
  }

  // Append full edges directory table
  md += `## 명시적 연결 간선 디렉토리 (Full Edges Directory — 총 ${edges.length}건)\n\n`;
  md += `| 간선 ID | 출발 노드 (From) | 도착 노드 (To) | 흐름 유형 (Type) | 분기 조건 (Condition) | 흐름 요약 (Summary) |\n`;
  md += `|---|---|---|---|---|---|\n`;
  for (const e of edges) {
    md += `| ${e.id} | ${e.from} | ${e.to} | ${e.type} | ${e.condition} | ${e.summary} |\n`;
  }

  return md;
}

// 9. Generate Audit Report
// 10. Write outputs
const cleanOutput = text => text.split(/\r?\n/).map(line => line.trimEnd()).join('\n').trimEnd() + '\n';
const htmlOutput = cleanOutput(generateHtml());
const mdOutput = cleanOutput(generateMarkdown());

const htmlPath = path.join(ROOT_DIR, 'docs/토익_스터디_앱_전체_알고리즘_보드.html');
const mdPath = path.join(ROOT_DIR, 'docs/토익_스터디_앱_전체_알고리즘_보드.md');

fs.writeFileSync(htmlPath, htmlOutput, 'utf8');
fs.writeFileSync(mdPath, mdOutput, 'utf8');

const htmlSha = crypto.createHash('sha256').update(fs.readFileSync(htmlPath)).digest('hex');
const mdSha = crypto.createHash('sha256').update(fs.readFileSync(mdPath)).digest('hex');

const auditPath = path.join(boardDataDir, 'BOARD_AUDIT_v2.2.md');

console.log(`[Success] Board generated deterministically:`);
console.log(`- HTML: ${htmlPath} (SHA256: ${htmlSha})`);
console.log(`- Markdown: ${mdPath} (SHA256: ${mdSha})`);
console.log(`- Audit: ${auditPath}`);
