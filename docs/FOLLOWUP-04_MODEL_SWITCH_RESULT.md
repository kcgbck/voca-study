# FOLLOWUP-04 대화 모델 전환·검증 결과 — 2026-10-22 KST

사용자가 승인한 `gemini-3.5-flash-lite` 전환을 Gemini가 구현하고 Codex가 지시·검토·검증했다. 대화 모델과 예산 허용 목록은 전환됐으며 운영 호출 기본 차단은 유지한다.

## 결과

|검증|결과 및 근거|
|---|---|
|전체 검증|51파일·464시험 PASS, 실패0/skip0. 타입/lint(TypeScript 별칭)/build/보호 경로/diff 공백 PASS — `.agy-work/026_full_verify.log`|
|실제 Google 입문|앱 클라이언트→Pages→합성 RS256 인증→메모리 SQLite 예산→새 모델, ACCEPT·튜터 텍스트 존재, 1.206초|
|실제 Google 고급|같은 경로, ACCEPT·튜터 텍스트 존재, 1.182초|
|예산·중복|두 소진 행 모두 `gemini-3.5-flash-lite`. 중복 및 한도 초과429. 실제 생성2회, 자동 재시도0 — `.agy-work/026_integrated_live_smoke.json`|
|Pages 컴파일|기존 Wrangler3.114.17로 PASS — `.agy-work/026_pages_build.log`|
|로컬 Pages HTTP|기본 chat/STT/TTS 차단403, 메서드405·미지원404·Origin 누락403·OPTIONS204·기존 경로 경계 포함9/9 — `.agy-work/026_pages_runtime.json`|
|오프라인 사전점검|네트워크0, 새 모델 표시, 키 존재·형식 확인, 운영 미구성으로 예상 exit2 — `.agy-work/026_preflight.json`|
|보드|2회 생성 SHA 동일, 18탭·125노드·52간선·원본98ID 유지, 전체 시험에 보드12시험 포함 — `.agy-work/026_board_hashes.json`|
|비밀값·Git|제공 키 값의 소스·문서·빌드 복제0, 키 파일 Git 제외, staged0|

실제 Google 호출은 새 모델의 고정 엔드포인트로 발송했다. 운영 인증·실제 D1 대신 격리된 합성 서명과 메모리 DB를 사용했다. 운영 Access·DB·계정 한도를 확인한 시험은 아니다. 실제 호출 기록은 클라이언트의 평가 결과를 검증했으며 모델의 원문·생각·발화·JWT는 결과 파일에 저장하지 않았다. 사용자 사진·PDF·실제 음성·학습 기록 전송0.

이번 전환 후 두 표본에서는 시간 초과나503이 발생하지 않았다. 이전 모델과의 제한된 [비교 결과](FOLLOWUP-03_MODEL_COMPARISON.md)에 이어 새 모델의 통합 성공을 확인한 것이며, 장기 가용성·교육 품질·실기기 음성을 보장하지는 않는다. 이전 Google503의 내부 원인은 확정하지 않았다.

## 변경과 검토

- `src/features/conversation/server/geminiInteractionsClient.ts`: CHAT 상수와 generateContent 고정 URL 변경. 예산 어댑터와 Pages 설정 팩토리는 공통 상수를 참조하므로 새 모델로 연결된다.
- `src/features/conversation/server/chatHandler.ts`: 모델/API 설명 주석 정정. 기존 서버20초·브라우저25초, LOW thinking·출력1,024토큰, 구조화 응답/사실 검증, 취소·503 분류는 유지한다.
- `scripts/conversation/preflight.mjs`와 관련4시험 파일: 새 URL·모델·예산 행 검사, 예전 모델 허용 거절, 예전 chat 한도만 제공하면403/업스트림0 검증. 새 독립 시험2개와 기존 시험 단언을 보강했다. STT `gemini-3.5-transcribe`, TTS `gemini-3.8-flash-lite-tts` 불변도 검사했다.
- 정책·잔여 작업표와 보드 CONV-13 및 생성물을 새 승인 상태에 맞췄다. 원본 사용자 지시서와 과거 모델 비교 기록은 보존했다.

검증 중 Gemini 초안의 시험 파일에 중복 닫는 괄호가 있어 TS1128이 발생했다. Codex가 원인을 찾아 Gemini에 해당 한 줄 교정을 지시하고 재검증했다. Codex의 비교용 스냅샷이 Vitest 시험으로 수집된 별도 문제는 `.snapshot` 확장자로 보존하여 해결했다. 제품 시험 발견 설정·기존 시험 기대를 약화하거나 시험을 삭제/skip하지 않았다. 실패 수집 로그는 `.agy-work/026_full_verify_snapshot_collection_failure.log`에 보존했다.

최종 리뷰에서는 구형 한도 설정 거절 시험의 인증 누락으로 인한 거짓 통과 가능성도 교정했다. 유효한 합성 서명·충분한 가상 한도·동일한 요청 조건에서 구형 chat 키만 있으면403/예약0/업스트림0, 새 chat 키를 제공하면200/업스트림1을 확인한다. 이 보강 후 전체51파일464시험과 나머지 검증을 다시 통과했다. 시험만 보강했으므로 실제 Google 호출은 추가하지 않았다.

로컬 HTTP 검사의 샌드박스/호스트 localhost 연결 실패는 동일 호스트의 `--local` 실행으로 해소했다. 검증 서버는 종료했고 원격 DB 쿼리·마이그레이션·배포·의존성 업그레이드는 수행하지 않았다.

## 보드 해시와 남은 관문

- HTML SHA256: `7a35bce520be6732fe4fdbadde5d02c118fa4e13772e4a95cf499374166bda97`
- Markdown SHA256: `64d1ba0923ac32dddc4465c27db8c94697355b2c2218050f44b85b86a3894573`

이번 보드 검증은 내용·생성 일치·자동 시험이며 새 브라우저 시각 검증은 하지 않았다. BOARD-01 첨부 원본 대조, BOARD-12 직접 파일/전용 Markdown 시각 검증은 기존 미검증 상태를 유지한다.

실제 Access 도메인/AUD·정책, 독립 예산 DB 바인딩/스키마, 실제 모델 한도는 미구성이다. 실기기 음성/PWA·교사·독립 리뷰와 공개 승인도 남아 있다. `LOCAL_CODE_VERIFIED / NEW_MODEL_SYNTHETIC_INTEGRATION_PASS / PUBLIC_RELEASE_NOT_APPROVED`로 판정한다.

Git main / HEAD `8248697cb4702719dfe7191195bccba5851a9cd4`, staged0, 기존 변경 보존. commit/push/배포 없음.
