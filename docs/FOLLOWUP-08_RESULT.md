# FOLLOWUP-08 계량·90% 한도·실제 안정성 검증 — 2026-10-22

Codex가 작업지시·코드 검토·명령 실행·증거 판정을 맡고, Gemini 구독 CLI가 구현 및 수정했다. 운영 배포·환경변수 변경·D1 마이그레이션·stage·commit·push는 하지 않았다.

## 적용 결과

| 용도 / 모델 | RPM | 보수적 입력 유닛/분 | RPD | callerRpm |
|---|---:|---:|---:|---:|
| 대화 `gemini-3.5-flash-lite` | 13 | 225000 | 450 | 13 |
| 전사 `gemini-3.5-transcribe` | 2 | 9000 | 22 | 2 |
| 합성 `gemini-3.8-flash-lite-tts` | 2 | 9000 | 9 | 2 |

사용자 제공 및 AI Studio에서 확인한 프로젝트 한도에 `floor(0.9 × 한도)`를 적용했다. 서버는 환경 설정이 더 높아도 위 상한으로 클램핑하며, 더 낮은 설정은 존중한다. 프로필은 `CONVERSATION_MODEL_LIMITS_90_PERCENT.json`이다. 전역·모델별 발신자 제한을 원자적 D1 예약에 연결했고, 실패 시도도 소진한다. 자동 재시도·모델 대체는 0회다.

Chat은 요청+교재+16KiB 기존 추정을 유지한다. TTS는 실제 텍스트·옵션 바이트+1024, STT는 검증한 PCM16 RIFF/WAV의 `ceil(초×64)+1024`를 사용한다. 비WAV는 decodedBytes+1024로 보수적으로 계산한다. 이는 Google의 정확한 토큰 계량이 아니며, 같은 프로젝트의 다른 앱 사용량까지 합산하지 않는다. 전체 Google 프로젝트의 90% 사용을 보장한다는 뜻은 아니다.

브라우저 녹음은 기기 내 Web Audio로 16kHz mono PCM16 WAV로 변환한다. 변환 전 마이크를 정지하고, 8초 데드라인 및 취소 세션 경계를 검사한다. 미지원 API/코덱은 압축 원본으로 돌아가므로 큰 압축 오디오는 예산 차단될 수 있다. 30초 초과·빈 입력·2MiB 초과는 거절한다. 실제 휴대전화 마이크와 Safari 검증은 남아 있다.

## 실제 Google 합성 시험

기존 청구 미연결 무료 프로젝트 키를 격리 검증 프로세스의 메모리에서만 사용했다. 합성 RS256 Access·실제 SQLite 예산 어댑터·Pages 라우터·대화 클라이언트 경로를 거쳤으며 운영 Access/DB 검증과 구분한다. 개인 음성·사진·PDF·학습기록은 사용하지 않았다. 모델 변경·재시도 없이 대화12+TTS1+STT1, 총14회 호출했다.

- 대화: 6상황×2라운드, HTTP/정상 응답 12/12, 기대 평가 유형 12/12 일치. 중간 61초 간격.
- AI 직접 응답 10건; 힌트 요청 2건은 정책상 로컬 `NEEDS_HINT` 대체이며 클라이언트는 `SERVER_ERROR`로 분류했다. 이를 AI 직접 성공으로 계산하지 않았다.
- 지연: p50 1345ms, p95/최대 1596ms. 시간 초과·503·429 0건.
- TTS “Hello Alex.” 합성 1회(1.88초) 및 생성 음성 STT1회 성공, 정규화한 문구 완전 일치.
- 증거: `.agy-work/030_stability_live.json`. 장기·다중 사용자·운영 가용성 보장이 아닌 작은 합성 회귀 시험이다. 문장 교정·지도 품질의 사람 평가는 별도다.

## 로컬·브라우저 검증

- Pages Functions 컴파일 PASS, 실제 로컬 Pages 9/9: API 기본403, GET405, 미등록404, OPTIONS204, cleanup403, 기존 TTS 입력누락400. 운영 차단 유지. 증거 `.agy-work/032_pages_runtime.json`.
- Chrome 합성 Oscillator 녹음→WebM→WAV→실제 서버 파서/계량: 16kHz mono, 최종 1.02초, 1090유닛 ≤9000 PASS. 실제 마이크 권한 요청·외부 호출 없음. 증거 `.agy-work/033_audio_browser_final.json` 및 화면.
- Markdown 전용 GFM `marked 17.0.5` 렌더러로 데스크톱·360px 시각 확인. 노드 제목125, 상세 제목160, 간선표53행(헤더+52간선), 코드블록1. Mermaid는 안전한 코드블록 표시이며 도식 렌더링 시험이 아니다.
- 최종 `scripts/verify.ps1`: **53파일 496시험 PASS (실패0/건너뜀0)**, 타입/lint/build·보호경로·diff 공백 PASS. `.agy-work/035_full_verify.log`. 번들 크기 및 PDF.js의 기존 경고는 남아 있다. 상대 링크5개가 실제 앵커로 렌더링됨을 확인했으며, 링크 목적지로 클릭 이동하는 시험은 수행하지 않았다.

## 남은 관문

`BOARD-12B`는 위 전용 렌더러 한정 검증이다. `BOARD-01`은 사용자 첨부 비교본 부재, `BOARD-12A`는 직접 file 열람을 도구 정책상 실행하지 못해 NOT_VERIFIED 유지한다. HTTP로 file 검증을 대신하지 않았다.

운영 Cloudflare Access 팀/AUD·접근 정책 및 독립 `CONVERSATION_BUDGET_DB` 바인딩/스키마는 미구성이다. 계정·약관 검토, 실기기/PWA, 교재 사람 검수, 외부 독립 리뷰 및 운영 승인도 남아 있다. **기본 호출 차단 및 PUBLIC_RELEASE_STATUS=NOT_APPROVED 유지.**

## 최종 생성·보안·Git 기록

동일 입력 2회 생성 SHA256 일치(PASS).

- HTML: `87731fef25a816bb073ea04cb9627723e1b7a62e5fb967929ac31ac258e36b06`
- MD: `b5e2e8503a61fbc41bf3ce6a8450fa1e22d8e370a33726b4f4124c60ce772dd4`
- 제공 키 문자열 노출 검사: 소스·문서·빌드 222파일 일치0, PASS. 키 파일은 수정하지 않았으며 Git 제외 유지.
- 이번 작업 전 기준선 대비 변경 소스5개(budgetAdapter, configFactory, voiceInput, generateBoard, Pages통합시험), 신규4개(budgetPolicy, audioNormalization 및 각각 시험). 누락0. `.agy-work/036_source_scope.json`. 나머지 기존 작업물 보존.
- branch `main`, HEAD `8248697cb4702719dfe7191195bccba5851a9cd4`, staged0. dirty 작업트리 유지, stage/commit/push/배포 없음.
