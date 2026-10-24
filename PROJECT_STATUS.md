> 현재 공개 서비스명: 보카 스터디 / 이전 프로젝트명: 토익_스터디

# PROJECT_STATUS.md

## Current Stage
- `CURRENT_STAGE = MOBILE_UI_AND_NAVIGATION_REFINEMENT_COMPLETE`
- 자동 기술 검증: **PASS** (28개 테스트 파일 / 112개 테스트 100% 통과, 4/5지선다 20,000회 스트레스 테스트 무결점)
- 클라우드플레어 인프라: **Pages 전환 완료** (개인 계정 서브도메인 노출 원천 차단, Pages Functions D1 직결 연동)
- 모바일 UI/UX 최적화: **PASS** (메인 대시보드 이모지-제목 인라인 일치, 4대 메뉴 문구 1줄 정렬, 퀴즈 탭 50:50 정중앙 균형)
- 브라우저 뒤로가기 연동: **PASS** (History API pushState/popstate 연동, 안드로이드 뒤로가기 시 앱 꺼짐 방지 및 홈 복귀 완비)
- 상단 네비게이션: **4개 탭 통합** (홈 / 기본 문제 / 문제집 / 영단어)
- PWA 캐시 삭제 새로고침: **PASS** (Service Worker v5, CacheStorage 전체 퍼지, 강제 리로드 파이프라인 완비)
- 기기 ID & 실시간 랭킹 시스템: **RANK-01 PASS** (Cloudflare D1 연동, 비속어 필터, 가중 점수 산정, 모바일 1화면 UI)
- 범용 문제 제작 엔진: **GEN-01 PASS** (`QuestionItem`, `QuestionChoice`, `QuestionBook`, Dexie v2 무손실 마이그레이션)
- 해사영어 데이터베이스: **451어** (`databaseVersion: 3`, Phase 1~3 전과정 완비)
- 기본 토익 어휘 데이터베이스: **1,800어** (`databaseVersion: 4`)
- 전체 알고리즘 보드: **98개 노드** (16개 탭, 21개 P0, MD/HTML 100% 동기화)
- 사람 검토 상태: **HUMAN_REVIEW_PENDING** (실제 사람 승인 전까지 PASS 절대 금지)
- 1,800 Release Ready: **NO** (인간 검토자의 최종 서명 전까지 출시 동결 유지)
- 2,000+ 확장: **보류** (현재 1,800개 동결, 사용자 명시 지시 필요)
- 잔여 기술 P0: **없음**

## 배포 상태 (Live Deployment)
- **GitHub 원격 저장소**: [https://github.com/kcgbck/voca-study](https://github.com/kcgbck/voca-study)
- **Cloudflare Pages 실서비스 URL**: [https://voca-study-akf.pages.dev](https://voca-study-akf.pages.dev) (개인 계정 ID 비공개 완비)
- **구형 Workers URL**: `voca-study.heyruler0011.workers.dev` (영구 폐쇄 및 삭제 완료)
- **PWA 캐시 버전**: `voca-study-cache-v5`

## 최근 완료 항목
1. **스마트폰/브라우저 뒤로가기(Back Button) 완벽 연동 및 앱 종료 방지**:
   - `window.history.pushState` 및 `popstate` 리스너를 연계하여 퀴즈/문제집/영단어/랭킹 화면에서 물리/제스처 뒤로가기 키 입력 시 앱이 꺼지지 않고 홈 대시보드로 안전하게 복귀하도록 전면 수정
   - 퀴즈 뷰, 영단어 뷰, 일반 문제집 뷰 내부에도 일관된 `←` 인앱 뒤로가기 버튼 연동
2. **상단 네비게이션 탭 통합 (5개 → 4개)**:
   - 퀴즈 화면 내부에서 이미 토익과 해사영어를 상시 전환할 수 있으므로 상단 헤더 탭을 `[홈]`, `[기본 문제]`, `[문제집]`, `[영단어]` 4개로 통합
3. **토익 / 해사영어 탭 모바일 50:50 중앙 정렬 및 우측 쏠림 해결**:
   - CSS Grid 50:50 대칭 및 `display: flex; justify-content: center; align-items: center;`를 적용하여 해사영어 탭이 우측으로 밀리거나 쏠리는 현상 원천 차단
4. **홈 대시보드 카드 UI 최적화 (이모지-제목 동일 크기 인라인 정렬)**:
   - 상단에 분리되어 크던 이모지를 제목과 동일한 크기로 맞추어 `[이모지] [메뉴제목]` 한 줄 인라인으로 재배치
   - "내가 만드는 문제집": `사진·스캔·PDF로 4/5지선다 제작 및 풀이` ("어떤 문제집이든" 삭제 완료, 1줄 고정)
   - "내가 만드는 영단어 문제집": `사진·스캔·PDF로 영단어 제작 및 풀이` (동일 서식 1줄 고정)
5. **내가 만드는 문제집 내부 헤더 개선**:
   - "홈으로" 텍스트를 제거하고 간결한 `←` 화살표 버튼으로 변경
   - 제목("📚 일반 객관식 문제집 만들기")에 `clamp` 및 `nowrap`을 적용하여 초소형 모바일에서도 1줄 줄바꿈 없이 출력 보장

## Verification
- `npm run typecheck`: PASS (0 errors)
- `npm test`: PASS (28개 테스트 파일 / 112개 테스트 100% 통과)
- `npm run build`: PASS (Vite v6.4.3 프로덕션 번들 빌드 성공)
- `npx wrangler pages deploy`: PASS (`https://voca-study-akf.pages.dev` 실시간 배포 및 정상 응답 검증 완료)

<!-- CODING_PARTNER_V2_STATE_START -->
카페 실제운영추가검증에서carrier단독거절과carrier거절+sleeve요청은정상처리확인. 단답Coffeeplease에서AI가영어예문중복금지지시를어겨한국어피드백에영어문장을포함하는경우발견. Gemini가카페전용피드백형식가드구현: 영문알파벳혼입또는100자초과면짧은한국어표현으로만치환. AI meaning/sentenceComplete/영문예문/후속ID/후보/호출/계량은변경없고추가호출0. 정상구체한국어피드백과기존한국어필수/500자검증보존. 추가4시험포함전체86파일911시험/타입/린트/빌드/보호경로/diff PASS(506). 독립예산8프로브PASS. API90%13/225000/450/단일20초/noexternretry/16384기본계량/무료모델보존. 실제첫13평가소모73→86/STT TTS0,다음3평가에서부정범위2건PASS/단답형식QA실패를발견한상태이며현재수정재배포후4건재검증과브라우저동일반복확인예정. 제품외단어장/사용자저장소보존,실제S25마이크/Whisper비교미검증. 상세FOLLOWUP36. 이번사용자요청범위인표현가드2파일과검증기록만선택커밋하고main푸시운영반영한다.

Operation: followup36-cafe-korean-guard-20261024
Parent HEAD: 68ec52301e91d9924261933d0ffab44f0bcc841e
Attribution: baseline-compared
<!-- CODING_PARTNER_V2_STATE_END -->
