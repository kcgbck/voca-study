> 현재 공개 서비스명: 보카 스터디 / 이전 프로젝트명: 토익_스터디

# 보카 스터디 현재 상태 (영어/일본어 TTS 음성 지원 & 일본어 문제집 2탭 완비)

## 아키텍처
PWA (Progressive Web App, 모바일 맞춤 설치형 오프라인 우선 웹앱, Web Speech API 음성 지원, Cloudflare Pages + Pages Functions, Cloudflare D1 Serverless SQLite, Dexie v2 무손실 로컬 DB, History API popstate 제어)

## 배포
- GitHub main: https://github.com/kcgbck/voca-study
- Cloudflare Pages 실서비스: https://voca-study-akf.pages.dev (개인 계정 ID 비공개 완비)
- 구형 Workers URL: `voca-study.heyruler0011.workers.dev` (영구 폐쇄 및 삭제 완료)
- 캐시 버전: `voca-study-cache-v6`

## 현재 상태 판정
- `NAME-01 = PASS`
- `PDF_IMPORT_BASELINE = PASS` (100/100 무손실)
- `PHOTO_OCR_EXTRACTION = PASS`
- `QUIZ_SEMANTIC_UNIQUENESS = PASS`
- `BASELINE_500_FREEZE = PASS` (removed=0, modified=0)
- `DB_03_1800_TECH_PASS = PASS` (1,800개 구축, 54,000회 스트레스 테스트 결함 0)
- `QA_02_SEMANTIC_NORMALIZATION = PASS`
- `MARITIME_PHASE_1_SMCP = PASS` (IMO SMCP 공식 표준 174어)
- `MARITIME_PHASE_2_OFFICER_EXAM = PASS` (해기사 3·4급 항해/기관 빈출 171어)
- `MARITIME_PHASE_3_CONVENTIONS = PASS` (COLREGs/SOLAS/MARPOL/STCW/ISM 실무 106어)
- `MARITIME_TOTAL_WORDS = 451` (중복 0건, 정답 유일성 100% 통과)
- `JAPANESE_EXAM_WORDS = 277` (기초 61단어, N5 66단어, N4 65단어, N3 85단어 등급별 수집 및 보강 완비)
- `JAPANESE_LIFE_WORDS = 160` (여행/식당/교통/호텔/쇼핑/일상 실전 어휘, 정답 유일성 100% 통과)
- `JAPANESE_TOTAL_WORDS = 437` (정답 유일성 및 4지선다 출제 100% 무결점 통과)
- `JAPANESE_QUIZ_MODES = PASS` (한글뜻 맞추기, 히라가나 맞추기, 히라가나+한글뜻 같이 맞추기 3대 모드 완비)
- `TTS_SPEECH_SUPPORT = PASS` (비용 0원 브라우저 내장 Web Speech API + Cloudflare Functions 프록시 듀얼 엔진)
- `RETRY_WRONG_WORDS = PASS` (퀴즈 완료 시 틀린 문제만 정확한 개수로 100% 분리 출제, 타 문제 혼입 버그 수정 완료)
- `WRONG_NOTE_COLLECTION = PASS` (오답노트 틀린 문제 모음집 구축, Dexie IndexedDB + 로컬스토리지 영구 보존, 복습 정답 시 자동 졸업, 4지선다 안전 출제 보장)
- `RANKING_CATEGORIES = PASS` (종합 / 영어 / 일본어 / 연속 출석 4대 분리 랭킹 및 D1 DB 컬럼 자동 확장)
- `ATTENDANCE_SYSTEM = PASS` (KST 기준 매일 출석체크 캘린더, 연속 스트릭 계산, 연속 출석 랭킹 연동)
- `MOBILE_UI_ALIGNMENT = PASS` (360~380px 초소형 모바일 화면에서도 글자 튀어나감 및 깨짐 없는 칸맞춤 최적화)
- `GEN_01_GENERAL_QUIZ_ENGINE = PASS` (4지/5지선다 20,000회 셔플 스트레스 테스트 무결점)
- `RANK_01_DEVICE_LOGIN_AND_RANKING = PASS` (기기 코드 자동발급, 비속어 필터, 가중 점수, D1 랭킹 완비)
- `MOBILE_UI_REVAMP = PASS` (Tailwind 제거 순수 CSS, 랭킹 모바일 깨짐 해결, 상단 헤더 3버튼 정렬)
- `PWA_CACHE_PURGE_UPDATE = PASS` (Service Worker v6, CacheStorage 삭제, 강제 리로드, 일본어 자산 오프라인 프리캐시 완비)
- `NAVIGATION_BACK_BUTTON = PASS` (History API popstate 연동, 안드로이드 뒤로가기 시 홈 대시보드 복귀)
- `PAGES_MIGRATION = PASS` (voca-study-akf.pages.dev 이전 완료, Workers 폐쇄)
- `ALGORITHM_BOARD_98_NODES = PASS` (16개 탭, 98개 노드, 21개 P0 동기화 완료)
- `HUMAN_REVIEW_STATUS = HUMAN_REVIEW_PENDING` (실제 사람 검토 전까지 승인 금지)
- `1800_RELEASE_READY = NO` (인간 검토자의 최종 서명 전까지 출시 동결 유지)
- `CURRENT_STAGE = ATTENDANCE_AND_RANKING_CATEGORIES_COMPLETE`

## 최근 완료 작업
1. **틀린 문제만 다시 풀기 정확성 및 타 문제 혼입 버그 수정 완료**:
   - `handleNext`에서 `quizWords.length < 4`일 때 일반 단어 목록으로 강제 fallback되던 로직 수정
   - `initQuizSession`에서 `customSessionWords`를 사용할 때 정확히 틀린 단어 수만큼만 `quizWords`를 슬라이스하도록 개선
   - 예: 10/20문제 세트에서 3문제를 틀린 경우, 다른 문제 없이 정확히 그 3문제만 1/3, 2/3, 3/3으로 출제되고 즉시 완료됨
2. **랭킹보드 영어 vs 일본어 vs 연속 출석 분리**:
   - `src/types/user.ts`: `RankingCategory` ('all' | 'en' | 'ja' | 'streak'), 언어별 점수 필드(`totalScoreEn`, `totalScoreJa` 등) 확장
   - `functions/api/[[route]].ts`: D1 데이터베이스 컬럼 자동 확장(`ensureD1Columns`), 언어별 점수 및 출석일수 누적(`/api/score/sync`), 카테고리별 랭킹 쿼리 및 내 순위 계산(`/api/ranking?category=...`)
   - `RankingView.tsx`: 상단 4대 탭(`[🏆 종합]`, `[📖 영어]`, `[🇯🇵 일본어]`, `[🔥 연속 출석]`) 추가 및 탭별 지표(점수 vs 출석일수) 출력
   - `QuizPreviewView.tsx`: 퀴즈 풀이 완료 시 풀었던 언어(영어 vs 일본어)를 서버로 전달하여 언어별 성적 정확히 분리 누적
3. **출석체크 캘린더 생성 및 연속 출석 랭킹 신규 구축**:
   - `src/services/attendanceService.ts`: KST(한국 표준시) 기준 일자 계산, `recordAttendance()`, 연속 출석일수(Streak) 및 최장 출석일수 계산, 당월 달력 그리드 생성 헬퍼 완비
   - `src/app/components/AttendanceModal.tsx`: 이번 달 7열 달력 그리드(출석 도장, 오늘 표시), 연속 출석일수(`🔥 N일째`) 및 누적 출석일수 요약, 오늘 출석 도장 찍기 버튼, 연속 출석 랭킹 바로가기 링크 완비
   - `src/app/App.tsx`: 홈 상단 랭킹 요약 배너에 `🔥 N일 연속` 뱃지 노출, 홈 바로가기 메뉴 4번째에 `📅 출석체크 캘린더` 카드 배치
4. **전체적인 모바일 UI 칸맞춤 및 레이아웃 점검 완료**:
   - 360px ~ 380px 초소형 스마트폰 화면에서 단어장 선택 탭(4개), 일본어 서브 탭(2개), 등급 버튼(5개), 출제 모드 버튼(3개), 랭킹 프로필 4분할 지표 그리드가 줄바꿈되거나 글자가 튀어나가지 않도록 `clamp()`, `min-width: 0`, `text-overflow: ellipsis`, 여백 최적화 완료
   - 출석체크 모달이 화면 세로폭을 넘어가지 않도록 `max-height: 92dvh`, 스크롤 및 터치 최적화 적용

## 검증
- `npm run typecheck`: 통과 (0 errors)
- `npm test`: 통과 (34개 테스트 파일 / 151개 테스트 100% PASS)
- `npm run build`: 통과 (Vite v6.4.3 프로덕션 번들 생성 완료)
- `npx wrangler pages deploy`: 통과 (`https://voca-study-akf.pages.dev` 실시간 배포 완료)


