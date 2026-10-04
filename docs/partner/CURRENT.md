> 현재 공개 서비스명: 보카 스터디 / 이전 프로젝트명: 토익_스터디

# 보카 스터디 현재 상태 (홈/영어/일본어 3개 체제 & 빈출문장 다양화 & 하단 스틱키 다음버튼 & 출석체크 최상단)

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
- `MARITIME_TOTAL_WORDS = 451` (중복 0건, 기계적 템플릿 제로, 실무 운항/점검/규정 12패턴 순환 다양화)
- `MARITIME_COMMUNICATION_WORDS = 150` (VHF 교신, VTS 관제, 조난/긴급/도선/예선/조타/기관/묘박/계류 150선 4지선다 완비)
- `JAPANESE_EXAM_WORDS = 277` (기초 61단어, N5 66단어, N4 65단어, N3 85단어 등급별 수집 및 보강 완비)
- `JAPANESE_LIFE_WORDS = 160` (여행/식당/교통/호텔/쇼핑/일상 실전 어휘, 정답 유일성 100% 통과)
- `JAPANESE_TOTAL_WORDS = 437` (정답 유일성 및 4지선다 출제 100% 무결점 통과)
- `JAPANESE_QUIZ_MODES = PASS` (한글뜻 맞추기, 히라가나 맞추기, 히라가나+한글뜻 같이 맞추기 3대 모드 완비)
- `TTS_SPEECH_SUPPORT = PASS` (비용 0원 브라우저 내장 Web Speech API + Cloudflare Functions 프록시 듀얼 엔진)
- `RETRY_WRONG_WORDS = PASS` (퀴즈 완료 시 틀린 문제만 정확한 개수로 100% 분리 출제, 타 문제 혼입 버그 수정 완료)
- `WRONG_NOTE_COLLECTION = PASS` (오답노트 틀린 문제 모음집 구축, Dexie IndexedDB + 로컬스토리지 영구 보존, 복습 정답 시 자동 졸업, 4지선다 안전 출제 보장)
- `THREE_TAB_SYSTEM = PASS` (상단 헤더 [홈] [영어] [일본어] 3개 체제로 완벽 개편)
- `CUSTOM_MAKER_UNIFIED = PASS` (홈 화면 "내가 만드는 문제집" 내 4/5지선다 제작 + 영단어장 사진/PDF 제작 하부 탭 통합)
- `STICKY_NEXT_BUTTON_AND_AUTOSCROLL = PASS` (문제 풀이 후 다음 문제 버튼 화면 하단 고정 + 뷰포트 최하단 자동 부드러운 스크롤 완비)
- `TOP_ATTENDANCE_BUTTON = PASS` (홈 화면 최상단에 오늘 출석체크 대형 배너 배치)
- `RANKING_CATEGORIES = PASS` (종합 / 영어 / 일본어 / 연속 출석 4대 분리 랭킹 및 D1 DB 컬럼 자동 확장, 영어 풀이 점수 누락 버그 해결)
- `ATTENDANCE_SYSTEM = PASS` (KST 기준 매일 출석체크 캘린더, 연속 스트릭 계산, 연속 출석 랭킹 연동)
- `MOBILE_UI_ALIGNMENT = PASS` (상단 컨트롤 툴바 압축으로 스크롤 없이 문제 카드 즉시 노출, 360~380px 초소형 모바일 화면 글자 튐 제로)
- `GEN_01_GENERAL_QUIZ_ENGINE = PASS` (4지/5지선다 20,000회 셔플 스트레스 테스트 무결점)
- `RANK_01_DEVICE_LOGIN_AND_RANKING = PASS` (기기 코드 자동발급, 비속어 필터, 가중 점수, D1 랭킹 완비)
- `PWA_CACHE_PURGE_UPDATE = PASS` (Service Worker v6, CacheStorage 삭제, 강제 리로드, 일본어 자산 오프라인 프리캐시 완비)
- `NAVIGATION_BACK_BUTTON = PASS` (History API popstate 연동, 안드로이드 뒤로가기 시 홈 대시보드 복귀)
- `PAGES_MIGRATION = PASS` (voca-study-akf.pages.dev 이전 완료, Workers 폐쇄)
- `ALGORITHM_BOARD_98_NODES = PASS` (16개 탭, 98개 노드, 21개 P0 동기화 완료)
- `HUMAN_REVIEW_STATUS = HUMAN_REVIEW_PENDING` (실제 사람 검토 전까지 승인 금지)
- `1800_RELEASE_READY = NO` (인간 검토자의 최종 서명 전까지 출시 동결 유지)
- `CURRENT_STAGE = THREE_TAB_AND_QUIZ_UX_REVAMP_COMPLETE`

## 최근 완료 작업
1. **상단 탭 구조 3개 체제로 전면 개편 ([홈] [영어] [일본어])**:
   - 기존의 `문제집`, `영단어` 상단 메뉴를 상단 내비게이션 바에서 삭제하고 `[ 🏠 홈 ]`, `[ 🔤 영어 ]`, `[ 🇯🇵 일본어 ]` 3개 메인 탭으로 개편.
   - `[ 🔤 영어 ]` 진입 시: 토익(TOEIC), 해사영어, 오답노트 탭 제공. 해사영어 선택 시 하부에 `[⚓ 해사 핵심단어 (451어)]` vs `[📻 실전 통신문장 (150선)]` 서브 탭 제공.
   - `[ 🇯🇵 일본어 ]` 진입 시: `[📝 시험용 (JLPT N5~N3)]` vs `[🍱 완전 생활일본어]` vs `[📝 오답노트]` 서브 탭과 히라가나/한글뜻 맞추기 출제 모드 제공.
2. **홈 화면 "내가 만드는 문제집"에 커스텀 제작 기능 하부 메뉴로 통합**:
   - `CustomMakerUnifiedView.tsx`: 상단에 `[📚 4/5지선다 문제집 제작]` vs `[🔤 영단어장 제작 (사진/PDF)]` 2대 제작 모드 서브 탭을 탑재하여 홈 메뉴의 "내가 만드는 문제집" 클릭 하나로 진입 가능하도록 완전 통합.
3. **홈 화면 최상단에 출석체크 진입 버튼 배치**:
   - 홈 대시보드 맨 위에 `[📅 오늘 출석체크 하기 (연속 N일 출석 중 🔥)]` 대형 카드를 배치하여 앱 실행 즉시 출석 도장을 누를 수 있도록 사용자 동선 최우선화.
4. **상단 메뉴 과도화로 문제 카드가 화면 아래로 밀리던 현상 및 드래그 스크롤 해결**:
   - 헤더 탭 및 상단 서브 탭을 언어별 1~2줄로 슬림화하고, `quiz-controls-toolbar`와 `quiz-card`의 마진/패딩을 대폭 압축하여 모바일 뷰포트 첫 화면에 문제 카드와 보기 4개가 즉시 안착되도록 레이아웃 정돈.
5. **문제 풀이 후 UX 및 스크롤 편의성 고도화 (하단 다음 문제 버튼 고정 & 자동 최하단 스크롤)**:
   - 문제를 풀고 나면 빈출 실전문장이 펼쳐지며 단어 카드 높이가 확장되더라도, `.quiz-footer`를 `position: sticky; bottom: 0;`로 화면 최하단에 고정하여 "다음 문제 →" 버튼이 뷰포트 맨 아래에 항상 대기.
   - 정답 선택 시 `scrollIntoView({ behavior: 'smooth', block: 'end' })`를 자동 호출하여 화면 스크롤 자체가 최하단으로 부드럽게 이동. 사용자가 손가락으로 드래그할 필요 없이 원터치로 다음 문제를 누를 수 있도록 완벽 개선. 다음 문제 클릭 시 화면 상단으로 부드럽게 복귀.
6. **빈출문장 다양화 및 기계적 반복 템플릿 완전 제거**:
   - `The officer emphasized the importance of understanding 'Plimsoll mark' during bridge watch navigation.`처럼 단어만 갈아 끼우던 어색한 템플릿을 전면 제거.
   - `Plimsoll mark`, `bow thruster`, `stern thruster`, `freeboard`, `bilge` 등 핵심 어휘별 고유 실무 예문 사전 탑재 및 12개 실무 운항/기관/점검 패턴 순환 다양화 적용.
7. **실전 해사 통신 문장 150문항 고난도 오답 선지(Distractors) 전면 보강 완료**:
   - `public/data/maritime_communication_v1.json`: 150개 실전 해사 통신 문장의 4지선다 보기 중 오답선지 3개가 정답과 동떨어져 정답이 쉽게 드러나던 문제를 전면 해결.
   - 150문항 전수 450개 오답에 대해 동일 해사 도메인 키워드를 부여하되, **좌현(Port) vs 우현(Starboard), 선수(Bow) vs 선미(Stern/Quarter), 전진(Ahead) vs 후진(Astern), 줄 묶기(Make fast) vs 풀기/방출(Slack/Cast off), 수치(1.5m vs 2.5m, 8% vs 21%), 신호 등급(MAYDAY vs PAN PAN)** 등 실제 해사 실무 디테일을 정교하게 비튼 매력적 고난도 오답으로 100% 개편.
   - `tests/maritimeCommunication.test.ts`: 150문항 전수에 대해 정답 유일성(Single Correct Answer) 100% 보장, 오답 중복 0건, 정답-오답 불일치 Hard Gate 전수 통과.
8. **일본어 랭킹 누적/동기화/0점 덮어쓰기 버그 전면 해결 및 실시간 반영 완료**:
   - `QuizPreviewView.tsx`: 퀴즈 완료 시 언어 판정 조건에 `activeLangMode === 'ja'` 및 `languageMode === 'ja'`를 최우선 적용하여 일본어 퀴즈 세트 완료 시 100% 확실하게 `ja` 카테고리로 채점 결과 전달.
   - `GeneralQuizPlayerView.tsx`: 문제집 타이틀 및 지문 텍스트 내 일본어 감지(`[\u3040-\u309F\u30A0-\u30FF]`) 로직을 추가하여 일반 문제집 풀이 시에도 일본어 랭킹에 정상 반영되도록 개선.
   - `userService.ts`:
     - 미전송 점수 큐(`PENDING_SCORE_KEY`)를 영어(`correctEn`, `incorrectEn`)와 일본어(`correctJa`, `incorrectJa`)로 완전 분리.
     - `syncWithServer` 및 `flushPendingScore` 응답 수신 시, 서버 값이 0일 때 로컬 점수를 0으로 강제 덮어쓰던 치명적 결함을 `Math.max` 및 `calculateScore` 재계산으로 완벽 차단.
     - `fallbackProfile` 및 `linkDeviceCode`에 언어별 필드 기본값(0) 완비.
   - `RankingView.tsx`: 랭킹 화면 진입 시 `loadData` 첫 단계에서 미전송 큐를 서버에 선제 flush 동기화한 후 랭킹 목록을 조회하도록 개선.
   - `functions/api/[[route]].ts`:
     - `/api/score/sync`: 클라이언트로부터 언어별 델타(`correctDeltaJa`, `incorrectDeltaJa`)를 정확히 수신하여 `correct_count_ja`, `total_score_ja` 및 종합 점수(`total_score`)에 누실 없이 가산.
     - `/api/ranking`: `category === 'ja'` 쿼리 시, 과거에 `total_score_ja`가 미계산(0) 상태인 행도 `MAX(0, correct_count_ja * 10 - incorrect_count_ja * 2)`로 실시간 보정 계산하여 랭킹 및 내 순위에 즉시 노출.
     - `ensureD1Columns`: `total_score_ja` 자동 계산 보정 마이그레이션 쿼리 추가.

## 검증
- `npm run typecheck`: 통과 (0 errors)
- `npm test`: 통과 (35개 테스트 파일 / 155개 테스트 100% PASS, 일본어 점수 분리 누적 및 랭킹 정렬 테스트 통과)
- `npm run build`: 통과 (Vite v6.4.3 프로덕션 번들 생성 완료)
- `npx wrangler pages deploy`: 통과 (`https://voca-study-akf.pages.dev` 실시간 배포 완료)




