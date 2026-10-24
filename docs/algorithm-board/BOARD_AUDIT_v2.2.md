# 알고리즘 보드 v2.2 감사 결과

검증일: 2026-10-22 KST. BOARD_STATUS = **PASS_WITH_LIMITATIONS**. P0는 중요도이며 현재 결함 수가 아닙니다.

## 기준선과 최종값

| 자료 | 탭 | 노드 | 명시 간선 | P0 |
|---|---:|---:|---:|---:|
| 실제 로컬 기준선 |15|98|0|21|
| 최종 |18|125|52|32|

- 원본 HTML SHA-256: `0edb5ba995c877fc19ba5f53bf9b5bd2a3b7855c710938bea2f651f8fdf050b7`
- 원본 MD SHA-256: `ba596450d5da959f66ce5d97eaad8fb92fe9e4ce265ffa37f2f8fae2d04d31ae`
- 최종 HTML SHA-256: `c052736fe646975bd3c4afd2bcd064c9ad654badcb2355a433a11ec4de3a97f7`
- 최종 MD SHA-256: `47bcbc94afc5ec0d9fc9419290b919adf7beccff76324b274b7abecb21ad86d7`
- 첨부 비교본: 작업 공간에 없음. 첨부 해시/동일성을 주장하지 않음.
- 원문·수기 부연·검사 이력: baseline.html / baseline.md / baseline.json에 불변 보존. 이전값과 고아 탭3개 배치 사유는 CHANGE_HISTORY.md에 기록.

## BOARD-01~12

|관문|판정|실제 근거·한계|
|---|---|---|
|BOARD-01|NOT_VERIFIED|첨부 비교본 부재. 로컬 기준선 98ID·원본 바이트 보존은 PASS.|
|BOARD-02|PASS|18탭·125노드·52간선 고유성/참조/조건 오류0. 고아 탭 관계3개 이력 보존 후 교정.|
|BOARD-03|PASS|27개 신규 노드 각각 canonical 제목·15개 상세·구현/미검증 근거 완비.|
|BOARD-04|PASS|실제 HTML 배열과 실제 MD를 파싱하여 메타데이터·15상세·전체 간선 필드 비교.|
|BOARD-05|PASS|헤더125/18/52/P032와 확인 수준·보류관문5를 데이터 계산. 검색·필터 결과11/2 실제 일치.|
|BOARD-06|PASS|Chrome 클릭·탭·전역검색·범주/위험 필터·드로어·상하 연결·Enter·ESC·포커스 복귀 확인.|
|BOARD-07|PASS|정상/오류/교정/힌트/전사 재확인/권한/429/오프라인/중단재개/복원/보안차단 연결 실재.|
|BOARD-08|PASS|충돌17개를 설계단계(코드 존재)·실행 미검증으로 분리. 원문 근거와 이전값 보존.|
|BOARD-09|PASS|신규 소스·심벌·테스트 실제 존재 확인. 기존 없는 경로는 과거 근거·미확인 계층으로 표시.|
|BOARD-10|PASS|기본 차단·서버 키·동의·인증/예산 어댑터 미구성·cleanup 로컬403 설명 대조.|
|BOARD-11|PASS|기존98개 ID·제목·15상세 보존(17개 확인 수준/근거 보충만 예외), 기존158시험 포함 최종 전체389 PASS.|
|BOARD-12|NOT_VERIFIED|HTTP 독립 정적 구동·외부CDN없음·360px 한열/내부스크롤 PASS. 도구의 file: 정책으로 직접 파일 열람 미실행. MD 내용 동기화 PASS, 전용 Markdown 렌더러 시각시험 미실행.|

## 실행 명령·브라우저 증거

- `node scripts/algorithm-board/generateBoard.mjs` 2회 연속 실행: HTML/MD SHA 동일. 생성기는 앱·학습 데이터·Git을 변경하지 않음.
- `npx vitest run tests/algorithmBoard.test.ts --reporter=json --outputFile=.agy-work/010_board_final_tests.json`: 12/12 PASS, FAIL0. 자동 항목의 이름이 실기기 PASS를 의미하지 않음.
- 전체 `scripts/verify.ps1`: 48파일·388시험 PASS. 보드 설명3문구 교정 후 보드12시험을 다시 통과. 이어서64목표 전이 도달성 검사 추가 후 최종 전체48파일·389시험도 통과.
- Chrome: CONV-27 검색1, 전체 CONV의 P0필터11, 데이터 추가필터2; 연결01→02 드로어 이동; 카드 Enter·ESC 포커스 복귀; 최종 tab-16은 회화8개만 표시.
- 모바일 에뮬레이션: viewport360 / 문서345 / 카드321px 단일열. 흐름도·간선 표는 내부 가로 스크롤. 콘솔 오류0(보드).
- file: 직접 열람은 브라우저 URL 정책이 차단하여 NOT_VERIFIED. 같은 동작을 우회하지 않았으며 HTTP 정적 동작만 검증.
- 이미지: C:/Users/YECHAN/workspace/TOEIC_STUDY/.agy-work/010_board_final.jpg

실계정·모바일 음성 하드웨어·사람 교사·외부 독립 리뷰·운영 공개 승인은 별도 보류입니다. Gemini 초안의 가짜 함수/실행 주장은 Codex가 교정했으므로 외부 독립 리뷰 COMPLETE로 표시하지 않습니다.

## FOLLOWUP-02 검증 보충 (2026-10-22)

CONV-13/14/21/22/23의 구현 근거와 운영 보류 설명을 갱신했다. 18탭·125노드·52간선·원본98ID 보존, 보드12시험을 포함한 전체51파일462시험 PASS. 생성2회 SHA 동일: HTML `05c9d3e8b3805064421a8bb2e974ebe41216b6af9515b03c553ea19c2953590b`, MD `da01f058ddce50d0c80bf2d55b9330730e362d4d1ce60eddbf0ae37306428a4e`. 이번에는 내용·참조·생성 동기화를 검증했으며 브라우저 시각 검증을 다시 수행하지 않았다. 이전 브라우저 관찰과 BOARD-01/12 미검증 관문은 그대로 유지한다. 인증·예산 로컬 통합과 Pages9/9는 PASS이나 실제 Google 503·시간 초과가 남아 공개 승인은 보류한다.

## FOLLOWUP-04 (2026-10-22)

사용자 승인으로 CONV-13 대화 모델을 gemini-3.5-flash-lite로 전환했다. 전체51파일464시험 및 보드12시험 PASS, 생성2회 SHA 동일. HTML `7a35bce520be6732fe4fdbadde5d02c118fa4e13772e4a95cf499374166bda97`, MD `64d1ba0923ac32dddc4465c27db8c94697355b2c2218050f44b85b86a3894573`. 새 모델 실제 합성 통합2/2(약1.2초), 로컬 Pages9/9 PASS. 운영 인증/한도/독립DB 미구성·기본 차단·공개 보류. 브라우저 시각 검증은 이번에 재수행하지 않았으며 BOARD-01/12 미검증은 유지한다. 상세는 ../FOLLOWUP-04_MODEL_SWITCH_RESULT.md.

## FOLLOWUP-08 (2026-10-22)

Gemini가 액션별 계량·90% 하드캡·모델별 callerRpm 격리·기기 내 WAV 정규화 및 시험을 구현했고 Codex가 검토·수정 지시·직접 검증했다. 전체53파일496시험 PASS, Pages9/9, 실제 합성 대화12/12 응답·판정 일치(직접AI10/로컬힌트2), TTS/STT 각1성공. BOARD-12B는 marked17.0.5 전용 렌더러의 데스크톱/360px 검증 PASS. 원본첨부 BOARD-01 및 file 직접열람12A 미검증·운영 미구성·공개승인 보류 유지. 생성2회 SHA 동일; 최신 해시는 verification.json. 신규 budgetPolicy.ts/audioNormalization.ts 및 시험2개, 프로필 CONVERSATION_MODEL_LIMITS_90_PERCENT.json, FOLLOWUP-07/08 보고서. source5개 및 CONV-22·보드 요약·생성물/상태 기록 갱신. 기존 역사와 원본98ID 보존. stage/commit/push/배포 없음.

## FOLLOWUP-09 (2026-10-22)

운영 Access/독립 D1 연결 안내 CONVERSATION_OPERATING_SETUP.md 작성. Gemini 구현의 Git 제외 네이티브 D1 하네스를 Codex가 실행하여8/8 PASS, 전체53파일496시험 재통과. 이번 턴 제품 소스·기존시험·생성보드 변경0. 운영 Access/DB·실기기·사람검수·독립리뷰·BOARD-01/12A 보류 유지. 상세 FOLLOWUP-09_RESULT.md. commit/push/배포 없음.
