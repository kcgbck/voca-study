# [보카 스터디 AI 회화·보드 INTEGRATED-01 통합 작업 결과]

검증 기간: 2026-10-21~22 KST. 지시·검증·최소 교정은 Codex, 주 구현은 기존 로그인 agy 1.4.4의 Gemini가 맡았습니다. 개발 문서·소스·테스트 전달에 대한 사용자 명시 승인을 사용했고, 사용자 사진·PDF·개인 학습 기록은 전달하지 않았습니다.

## 1) 작업 기준

- 시작/종료 HEAD: `8248697cb4702719dfe7191195bccba5851a9cd4`, 브랜치 `main`. staged0. commit/push/배포 없음.
- 기존 사용자 미추적 문서와 ai회화 v2.2 문서, 기존 앱 6메뉴·상단3탭·1800단어·기존 DB를 보존했습니다. 사용자 문서 이동을 이번 코드 변경으로 취급하지 않습니다.
- 환경: Windows PowerShell, Node24.15.0, npm11.12.1, Vite6.4.3, Wrangler3.114 로컬 Pages, Chrome 데스크톱 및360px 에뮬레이션. 의존성·키·청구·운영 자원 변경 없음.

## 2) 구현 완료 범위

- 앱 셸: `C:/Users/YECHAN/workspace/TOEIC_STUDY/src/app/featureRegistry.ts`, `C:/Users/YECHAN/workspace/TOEIC_STUDY/src/app/App.tsx`. 기존 메뉴 뒤에7번째 회화 카드. 회화 홈/목록/수업/역할극/결과/복습 및 동의 설정.
- 교육과정: `C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/content/`. 4레벨×8단원×4차시=128목차, 첫2단원씩32차시 실제 초안·64목표, 나머지96준비중 잠금. 모든 초안은 HUMAN_CURRICULUM_REVIEW_PENDING.
- 엔진: `C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/engine/`. 6종 교정, 목표별 허용답, 상황 사실, 단계별 힌트, 서로 다른 실제 상황의 노힌트 증거2개 규칙, KST1→3→7→14일 복습. 같은 시나리오의 연습·역할극 반복은 두 상황으로 세지 않습니다. 새 전이 상황의 승인된 사실을 대입해 각 목표를 평가합니다.
- 서버/음성: `C:/Users/YECHAN/workspace/TOEIC_STUDY/functions/api/conversation/[[action]].ts` 및 회화 server/services. 공식3모델 어댑터(대화 gemini-3.8-flash / 축어 전사 gemini-3.5-transcribe / TTS gemini-3.8-flash-lite-tts), MIME 정규화, JSON·상황·텍스트 검증, 요청 취소·중복 잠금·제한 캐시·브라우저 재생 대체. Live는 문서 설계 슬롯만 있습니다.
- 접근 제한: 기본 비활성. 성인·정책 버전·4대 동의, 서버 인증·무료 프로젝트 확인·원자 예산 어댑터가 없으면 차단. 실제 인증/예산 어댑터 및 실계정 설정은 미구성입니다. 민감정보 자동 판별을 보장하지 않으며 안내와 필드 제한을 적용합니다.
- 데이터: `C:/Users/YECHAN/workspace/TOEIC_STUDY/src/storage/db.ts`, `C:/Users/YECHAN/workspace/TOEIC_STUDY/src/storage/backupService.ts`. 기존10테이블 보존+회화3테이블 가산 v3. 전체13테이블 백업v2·기존v1 읽기, Blob·충돌·멱등·롤백 검증. v1에 원래 없던 데이터를 복원했다고 주장하지 않습니다.
- cleanup: `C:/Users/YECHAN/workspace/TOEIC_STUDY/functions/api/[[route]].ts`에서 정리 경로 기본403, 로그인·랭킹의 자동 삭제 호출 제거. 운영 경로 요청·D1 변경·배포는 하지 않았습니다.

## 3) 실행한 검증 결과

- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1`: 종료0. typecheck PASS, lint PASS(현재tsc 별칭), 당시 `npm test` **48파일·388시험 PASS / FAIL0 / SKIP0**, build PASS, 보호 경로·diff 공백 PASS. 별도 포맷 검사 도구는 미설정.
- 최종 추가 검증: 32차시64목표의 전이 상황 도달성 검사를 추가한 뒤 `npm test -- --reporter=json --outputFile=.agy-work/010_final_all_tests.json` **48파일·389시험 PASS / FAIL0 / SKIP0**, `npm run typecheck` 재통과. 앱 소스 변경이 없어 이미 통과한 lint/build 근거는 재사용했습니다.
- 사전 기준: 기존35파일·158시험 PASS. 기존158시험을 보존했습니다. 백업 v1 시험의 버전 fixture만 상수2와 혼동하지 않도록 리터럴1로 고정했습니다.
- Pages: `wrangler pages functions build functions` 컴파일 PASS. 실제 로컬8788 요청7개: chat/STT/TTS POST 각403(유효 합성 동의·본문 포함), chat GET405, cleanup GET/POST403, 기존TTS 무본문400. 새 캐치올 경로 우선순위 확인. 운영·실 Google 요청 없음.
- 데이터: 이전 v1→v2→v3 보존, 백업v1 읽기, v2 전체 테이블/Blob 라운드트립, 같은 파일 병합·중복키 충돌·손상 거부·실패 롤백·중복 완료 방지 PASS(격리 fake-indexeddb).
- 교육 골든셋100: 4레벨 각25, 단답/명확 오류/전사 불확실/상황 충돌/힌트 각20 PASS. 별도로32차시64목표 매핑·다른 목표 귀속 금지 및 유효 문장6개 오교정 금지 PASS. 문법상 정상인 격식 표현을 명확한 문법 오류 fixture로 교체하고 원래 문장은 긍정 회귀에 남겼습니다.
- 수정 전 실패→교정: JSX 확장자·도구 반환 타입·중복 메서드·유효 Enum, 표시 예문 OFF_TOPIC, 과제/초안 저장, 역할극 연습턴 혼입, phase 저장 누락, 동의 구버전 재활성화, KST 경계, 모델의 모순된 교정 문구, 자동 힌트 노힌트 오기록, 취소된 음성의 늦은 콜백, 보드 가짜 참조·고아 탭·파일 끝 공백을 교정해 재시험했습니다. 중간 결과는 .agy-work/003~009 로그에 분리했습니다.
- Chrome: 기존 메뉴·4레벨·잠금 유지, 재수강→표현→과제1/2→저장 후 새로고침→역할극 첫/다음 질문→새 상황의 두 목표→결과2개 성취→결과 새로고침 보존 확인. 복습 회상 후 정답 확인, 명시 동의4개 기본 해제, ESC 포커스 복귀·Shift+Tab,360px 문서345px도 확인했습니다. 성공/실패 복습 평가와 실제 사용자 동의는 대신 선택하지 않았습니다.

## 4) 실제 연동 및 사용 제한

- 앱용 Google 모델별 실제 무료 계정 API: **NOT_VERIFIED**, 실호출 미실행. 개발용 agy 구독 연결 성공과 앱용 API 성공은 별개입니다.
- 프로젝트 RPM/TPM/RPD·청구 미연결·모델별 적격: **NOT_VERIFIED**. 한도 초과 유료 전환 없음. 키를 읽거나 추가하지 않았습니다.
- Android Chrome / iOS Safari 실제 마이크·TTS·설치PWA 완전 오프라인: **NOT_VERIFIED**. 자동시험은 모의 장치/응답이며360px는 데스크톱 에뮬레이션입니다.
- Google 약관상 실제 계정·지역·공개 제공 적합성: **NOT_VERIFIED**. 공식 정책 링크/제약은 CONVERSATION_POLICY.md에 기록했습니다.
- 콘텐츠: **HUMAN_CURRICULUM_REVIEW_PENDING**. 외부 독립 리뷰: **EXTERNAL_REVIEW_PENDING**. 감독자가 교정한 코드를 외부 리뷰 완료라고 표시하지 않습니다.

## 5) 잔여 결함·한계

- 로컬 확인 범위의 미해결 P0/P1 재현 결함 없음. 운영 cleanup 위험 후보는 로컬 보완만 완료했으므로 운영 반영 승인 전까지 해결됐다고 주장하지 않습니다.
- P2/제한: 고정 교재의 허용답·템플릿·유한 사실 검사 범위 밖 문장에 대한 의미 판정은 제한적입니다. 32초안의 교육 적절성과 변형 전이 문장은 교사 검수가 필요합니다. 마스터 표시는 앱의 기술 규칙 통과이며 공인 언어 능력 인증이 아닙니다.
- 브라우저 강제 종료 직전의 비동기 저장은 보장하지 않습니다. 화면의 저장됨을 확인해야 합니다. Vite 큰 번들 및 기존 PDF.js font/cMap 경고가 남으며 시험은 통과합니다.
- 되돌릴 때는 먼저 v2 백업을 보관하고 회화 메뉴 노출만 비활성화하는 방식을 우선합니다. 데이터 보존을 위해 v3 스키마·테이블 및 백업 호환, cleanup 차단을 유지해야 합니다. v2 코드로 무조건 강등하거나 IndexedDB를 삭제하지 않습니다. 실제 되돌리기는 실행하지 않았습니다.

## 6) 통합 판정

- LOCAL_INTEGRATION_STATUS = **PASS_WITH_LIMITATIONS**.
- PUBLIC_RELEASE_STATUS = **NOT_APPROVED**.
- 다음 결정: 교사·외부 리뷰, 실제 무료 프로젝트/청구/한도·인증/예산 구성 승인, 실기기·운영 보안 반영 승인. 각각 별도 관문입니다.

## 7) 변경 파일 및 증거

- 전체 경로·변경 구분은 `C:/Users/YECHAN/workspace/TOEIC_STUDY/docs/INTEGRATED-01_FILES.md`. 이번 작업의 사용자 파일 삭제 없음. 원래 사용자 문서·동결 데이터·운영 자원·Git 이력 보존.
- 최종 시험 JSON: `C:/Users/YECHAN/workspace/TOEIC_STUDY/.agy-work/010_final_all_tests.json`.
- 최종 검증: `C:/Users/YECHAN/workspace/TOEIC_STUDY/.agy-work/010_final_verify.log`.
- Pages: `C:/Users/YECHAN/workspace/TOEIC_STUDY/.agy-work/010_pages_build.log`, `C:/Users/YECHAN/workspace/TOEIC_STUDY/.agy-work/010_pages_runtime.json`.
- 보드: `C:/Users/YECHAN/workspace/TOEIC_STUDY/.agy-work/010_board_final_tests.json`, `C:/Users/YECHAN/workspace/TOEIC_STUDY/.agy-work/010_board_final_hashes.json`.
- 경계 회귀: `C:/Users/YECHAN/workspace/TOEIC_STUDY/.agy-work/009_final_boundaries.json`. 최초 오류와 중간 교정은 별도 로그이므로 최종 PASS와 혼동하지 않습니다.
- 브라우저 이미지: `C:/Users/YECHAN/workspace/TOEIC_STUDY/.agy-work/010_conversation_final.jpg`, `C:/Users/YECHAN/workspace/TOEIC_STUDY/.agy-work/010_board_final.jpg`. 합성 로컬 기록이며 사용자 운영 학습 성적이 아닙니다.

## 8) 알고리즘 보드 보강 결과

- 기준선: 로컬15탭·98노드·명시 간선0·P0중요도21. 첨부 비교본은 없음.
- 최종: **18탭·125노드·52간선·P0중요도32**. 기존98ID 보존, 신규3탭·27노드. 부록의44개 연결과 재개/복원/보안/동의 등8개 분기 보강.
- 원본 HTML SHA-256: `0edb5ba995c877fc19ba5f53bf9b5bd2a3b7855c710938bea2f651f8fdf050b7`.
- 원본 MD SHA-256: `ba596450d5da959f66ce5d97eaad8fb92fe9e4ce265ffa37f2f8fae2d04d31ae`.
- 최종 HTML SHA-256: `c052736fe646975bd3c4afd2bcd064c9ad654badcb2355a433a11ec4de3a97f7`.
- 최종 MD SHA-256: `47bcbc94afc5ec0d9fc9419290b919adf7beccff76324b274b7abecb21ad86d7`.
- 상세15항목·실제HTML↔MD 동기화 PASS, 2회 생성 SHA 동일. 95개 헤더 오표기 보정. 상태/근거 상충17건을 원문 보존한 채 분리했습니다. 원본의 미정의 tab16을 가리키던96/97/98은 이전 관계를 보존하고 기존탭11/1로 배치 교정해 새 회화탭16에 섞이지 않습니다.
- BOARD-02~11 = PASS. BOARD-01 = NOT_VERIFIED(첨부 부재, 로컬 보존 PASS). BOARD-12 = NOT_VERIFIED(file: 정책 차단·전용MD 시각시험 미실행, HTTP/360px/내용 동기화 PASS). 각 명령·근거는 `C:/Users/YECHAN/workspace/TOEIC_STUDY/docs/algorithm-board/BOARD_AUDIT_v2.2.md`.
- BOARD_STATUS = **PASS_WITH_LIMITATIONS**.

## 9) 개발·보드 최종 통합 판정

- 기존 자동 회귀 PASS / 회화 로컬 기술 통합 PASS_WITH_LIMITATIONS / 보드 PASS_WITH_LIMITATIONS.
- COMBINED_STATUS = **PASS_WITH_LIMITATIONS**.
- 실계정·실기기·사람 검수·외부 독립 리뷰·운영 배포는 보류입니다. stage·commit·push·배포는 수행하지 않았습니다.
