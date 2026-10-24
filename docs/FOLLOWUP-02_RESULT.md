# FOLLOWUP-02 검증 결과 — 2026-10-22 KST

Codex 작업 지시·검증, Gemini 구현. 코드 검증과 공급자/운영 검증을 분리한다.

## 판정

- `LOCAL_CODE_VERIFIED`: 51파일·462시험 PASS, FAIL0/SKIP0. 타입/lint(현재 TypeScript 별칭)/build/보호 경로/diff 공백 PASS.
- `AUTH_BUDGET_LOCAL_INTEGRATION_PASS`: 실제 RSA 서명 및 격리 SQLite로 조건부 Pages 경로 검증. 운영 Access·D1 배포 완료를 뜻하지 않는다.
- `REAL_PROVIDER_UNSTABLE`: 대화 실응답 성공 표본은 있으나 최종 재검증에서 시간 초과가 반복됐다. **대화 시간 초과가 완전히 해결됐다고 판정하지 않는다.**
- `PUBLIC_RELEASE_STATUS = NOT_APPROVED`. 모델 비교 시험과 운영 설정값에 대한 사용자 답변 대기.

## 시간 초과 조사와 수정

|증거|실측|의미|
|---|---|---|
|013_transport_probe.json|Interactions: HTTP200 헤더15.289초, 30초까지9청크14바이트·생성 이벤트0|대화 응답 경로 지연 재현|
|013_generate_control.json|동일 모델 generateContent: HTTP200·OK,13.711초|같은 키/모델의 공식 경로 대조 성공|
|014_live_router_smoke.json|실제 Google+수업 라우터:200·ACCEPT·폴백false,13.662초|구조화 평가·규칙 검증 성공 표본|
|020_integrated_live_smoke.json|클라이언트→가상 Access 서명→실 SQLite 예산→Google: 입문/고급2회 모두20초 시간 초과|인증·예산 연결 뒤 공급자 응답 안정성 미확인|
|021_long_probe.json|같은 앱 생성 요청을 별도60초 상한으로 계측: Google HTTP503,4.228초|앱 타이머와 구분되는 실제 공급자 실패 확인|
|023_final_live_smoke.json|이전 성공과 같은 짧은 합성 발화: 최종20초 시간 초과. 중복/상한429, 예약consumed 유지|성공 표본만으로 안정성을 승인하지 않음|

모든 파일은 `.agy-work/` 아래의 로컬 증거다. 이번 후속 조사에서 Google 생성 요청 시도는 총7회, 자동 재시도0회였다. 사용자 사진·PDF·실제 음성·학습 기록을 보내지 않았다. 이전 TTS/STT 합성 시험은 FOLLOWUP-01의 별도 기록이다.

확인된 앱 결함은 서버/브라우저 동일15초 마감, 본문 파싱 전에 타이머 해제, 취소 리스너 미정리, Google503의502 변환이었다. Gemini가 chat만 지정 모델의 `generateContent`로 분리하고 서버20초/브라우저25초 마감, 본문까지 유한 대기, 사전 취소·리스너 정리, STOP-only 응답 검증을 구현했다. 실제 503·업스트림 시간 초과·사용자 취소·전송 실패를 안전한 오류 코드로 구분한다. 재시도 안내는 수동이며 자동 추가 호출은 없다.

Google 내부의 개별 지연 원인은 확정하지 못했다. Google도 503 등 일시 실패와 재시도 전략을 별도로 안내한다. 현재 구현은 예산 밖 재시도나 다른 모델·유료 경로로 전환하지 않는다. [Google 공식 문제 해결 안내](https://ai.google.dev/gemini-api/docs/troubleshooting)

## 인증·예산 연결

- Access JWT: RS256 실제 서명, 고정 발급자/AUD, 만료·발급·유효 시작 시각 검사. 공개키 조회는 고정 도메인·64KiB·3초 제한. JWT/이메일 원문을 저장하지 않는다.
- 예산: 독립 D1용 단일 `INSERT ... SELECT ... WHERE`에서 중복과 모델별 rolling60초 호출/입력 예산·태평양 날짜 일일 제한·발신자 빈도를 함께 검사한다. 50개 예약 중 설정한 가상 한도만 허용하는 SQLite 시험을 포함한다.
- 호출 시도 후 실패·취소도 예약을 소진한다. 완료 저장 실패가 추가 여유를 만들지 않으며, 소진 후 환불하지 않는다. 실제 Google 사용량 및 다른 앱의 프로젝트 사용량을 정확히 측정한다고 주장하지 않는다.
- Pages는 현재 정책 버전·4개 literal 동의와 운영자 성인 내부 시험 설정을 함께 요구한다. 기기 코드나 Origin만으로 인증하지 않는다. 설정 누락은 기본403, 기존 사용자 DB 대체는 없다.
- 입력 원본은 최대3MiB로 한 번 읽고 새 내부 요청으로 전달한다. 크기 초과 도중 취소, 손상 JSON400, 초과413, 클론 스트림 취소 교착 방지를 검증했다.

운영 구성은 아직 하지 않았다. 필요한 비밀 아닌 설정과 순서는 [잔여 작업표](CONVERSATION_REMAINING.md)를 따른다. 원본 SQL은 `scripts/conversation/budget-schema.sql`이며 운영 DB에는 적용하지 않았다.

## 변경 파일

Gemini 신규 구현:

- `src/features/conversation/server/authAdapter.ts`
- `src/features/conversation/server/budgetAdapter.ts`
- `src/features/conversation/server/configFactory.ts`
- `scripts/conversation/budget-schema.sql`
- `tests/conversationAuthBudget.test.ts`
- `tests/conversationPagesIntegration.test.ts`

Gemini 보완: 서버 `geminiInteractionsClient.ts`, `chatHandler.ts`, `router.ts`, 클라이언트 `services/conversationApi.ts`, Pages `functions/api/conversation/[[action]].ts`, API/경계/사전점검 시험, 사전점검 스크립트 및 보드 canonical 자료·잔여 작업표. Codex는 진단 스크립트·직접 시험·생성기 실행·검증 기록을 담당했다. 의존성/잠금 파일/기존 사용자 DB/동결 단어 자료는 변경하지 않았다.

## 검증 근거

|검사|결과/증거|
|---|---|
|`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1`|종료0,51파일462시험,타입/lint/build/보호 경로/공백 PASS — `.agy-work/024_full_verify.log`|
|`wrangler pages functions build functions`|기존3.114.17 로컬 컴파일 PASS — `.agy-work/024_pages_build.log`|
|로컬 Pages 런타임|9/9 상태·Origin·메서드·cleanup 차단 PASS — `.agy-work/023_pages_runtime.json`; 서버 종료 완료|
|최신 공식 D1 타입 호환|Workers types5.20261021.1 참조로 구조 대입 tsc PASS; 임시 참조 다운로드만, 의존성 설치/변경 없음|
|사전점검|키 존재/형식 유효,네트워크0,예상 exit2(런타임 허가 아님) — `.agy-work/024_preflight.json`|
|키 비노출|소스·문서·빌드209파일에서 제공된 실제 키 값 복제0, Git 제외. 전체 노출 경로 부재를 보장하는 검사는 아님|
|보드 생성|2회 SHA 동일,18탭125노드52간선·기존98ID 보존,전체 시험에 보드12시험 포함 — `.agy-work/024_board_hashes.json`|

최종 보드 HTML SHA256: `05c9d3e8b3805064421a8bb2e974ebe41216b6af9515b03c553ea19c2953590b`.

최종 보드 MD SHA256: `da01f058ddce50d0c80bf2d55b9330730e362d4d1ce60eddbf0ae37306428a4e`.

초기 Gemini 초안의 타입 오류, 닫힌 스트림을 취소 대상으로 삼은 시험, Response 본문 재사용 시험, 안전 오류 코드와 원문 상태 단어를 혼동한 단언을 실제 실패→교정→재검증으로 처리했다. 시험 삭제·skip·타입 규칙 비활성화로 통과시키지 않았다.

## 남은 관문과 Git

공급자 안정성, 실제 모델별 한도, 운영 Access 정책/도메인/AUD·독립 예산 DB 구성, 실기기 음성/PWA, 사람 교사·독립 리뷰, 보드 첨부 원본 대조·직접 파일·전용 Markdown 시각 검증은 남아 있다. 새 보드의 레이아웃/동작 코드는 변경하지 않았으며 이번에는 내용·참조·생성 동기화만 재검증했다.

branch `main`, HEAD `8248697cb4702719dfe7191195bccba5851a9cd4`, staged0. 기존 변경 보존. commit/push/배포/원격 마이그레이션 없음.

DEBUG STATUS: **DONE_WITH_CONCERNS — 로컬 코드 검증 완료, 실공급자 안정성 미해결 및 운영 설정 미구성.**
