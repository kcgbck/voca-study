# AI 회화 로컬 개발 정책

> **2026-10-22 최신 검증 — FOLLOWUP-08 우선**: 90% 서버 상한 CHAT 13/225000/450, STT 2/9000/22, TTS 2/9000/9 및 기기 내 WAV 정규화를 구현했다. 격리 실제 Google 합성 대화12/12 응답·기대판정 일치(직접 AI10, 정책상 로컬 힌트2), TTS/STT 각1회 성공. 실제 프로젝트 한도는 AI Studio 확인 완료, 청구 미연결 무료 상태는 사용자 확인 및 Free tier UI 확인이다. 운영 Access/독립 D1은 여전히 미구성으로 기본 차단한다. BOARD-12B 전용 GFM 렌더러 검증 진행 결과와 남은 BOARD-01/12A는 [최신 결과](FOLLOWUP-08_RESULT.md) 참조. 아래 이전 단계의 수치·미검증/실패 기록은 해당 시점의 역사이며 최신 판정은 이 보충과 FOLLOWUP-08을 따른다. Google 실제 토큰·다른 앱 합산·장기 가용성 보장 아님.


기준: `docs/ai회화/보카스터디_AI회화_보드통합_1차개발지시서_v2.2.md`.

> **[2026-10-22 사용자 명시 승인 — 대화 모델 `gemini-3.5-flash-lite` 채택]**
> - **승인 사항**: 앱 대화 모델·예산 허용 모델·관련 시험을 `gemini-3.5-flash-lite`로 변경함. 음성 전사(`gemini-3.5-transcribe`) 및 음성 합성(`gemini-3.8-flash-lite-tts`)은 변경하지 않음.
> - **비교 근거**: FOLLOWUP-03 보고서의 기존 6회 합성 대조 시험 실측(동일 교재 본문 기준 `gemini-3.5-flash-lite` 2/2 통과 약 8.9~9.2초 / `gemini-3.6-flash` 1/2 통과 / `gemini-3.8-flash` 0/2 모두 Google HTTP 503(내부 원인 미확정))에 근거하여 후속 후보로 채택 승인됨.
> - **운영 설정 부재 및 기본 차단**: 운영 Cloudflare Access 팀 도메인·AUD, 독립 예산 DB(`CONVERSATION_BUDGET_DB`) 바인딩, 계정별 실제 모델 한도값(RPM/TPM/RPD)은 아직 없으므로(미구성), 외부 호출 기본 차단(Fail-Closed 403) 및 무료 전용·동의·인증·예산 필수 원칙을 불변으로 유지함.
> - **검증 상태 분리**: 전환 후 Codex가 전체51파일464시험 및 실제 통합 합성2요청(1.206초·1.182초), 로컬 Pages9/9를 검증함. 상세는 [FOLLOWUP-04 결과](FOLLOWUP-04_MODEL_SWITCH_RESULT.md). 과거 실측 기록의 `gemini-3.8-flash` 및 실패 결과는 과거 사실로 보존하며 일괄 치환하지 않음.
> - **출시 판정 불변**: 첫 32차시 `HUMAN_CURRICULUM_REVIEW_PENDING`, 공개 출시 상태 `NOT_APPROVED`, 미검증 관문 유지를 지속함. 원본 사용자 지시서는 수정하지 않음.

- 기존 사진·PDF·단어장·개인 학습 이력의 외부 전송 금지는 유지한다.
- 좁은 예외는 성인 내부 시험자가 명시 동의한 현재 회화 발화와 해당 수업 최근 최대 6턴의 최소 대화 문맥이다 (정책 버전: `v2.2-20261021`). 정책 버전 갱신 시 과거 동의는 자동 재활용되지 않고 재동의를 거친다. 무료 Google 서비스는 입력·출력을 제품 개선 및 사람 검토에 사용할 수 있으므로 민감정보를 입력하지 않는다.
- 앱의 외부 Google API 호출은 운영 설정이 없으면 기본 차단한다. 2026-10-22 사용자가 청구 미연결 무료 프로젝트임을 확인한 뒤, 별도 격리 진단에서 모델 목록 조회와 합성 TTS·축어 전사 성공을 확인했다. 대화는 같은 지정 모델의 공식 `generateContent` 경로로 분리해 실제 라우터 응답 1회(약13.7초)를 확인했지만, 이후 통합 실호출 시간 초과와 Google HTTP503도 확인했다. **실제 공급자 가용성은 미해결**이며, 앱 수정만으로 안정성을 보장하지 않는다. STT/TTS는 기존 Interactions `store:false`를 유지한다.
- Cloudflare Access RS256 서명·발급자·대상·기한 검증과 독립 D1 예산 어댑터를 조건부 Pages 경로에 연결했다. 현재 버전의 4대 동의 및 성인 내부 시험 운영자 설정을 함께 검사한다. 이는 JWT로 나이를 검증했다는 의미가 아니다. 모델별 RPM/보수적 입력 예산/Pacific 자정 RPD/발신자 빈도를 원자적으로 예약하며, 호출 시도 후 실패도 차감 상태를 유지한다. 예산에는 발화·음성·수업·점수·JWT 원문을 저장하지 않고 가명 해시 및 소진 메타정보만 다룬다.
- 실제 Access 팀 도메인·AUD·허용 정책, 독립 `CONVERSATION_BUDGET_DB` 바인딩/스키마, 모델별 실제 RPM/TPM/RPD는 미구성·미검증이다. 기존 사용자 DB로 대체하거나 운영 스키마를 자동 생성하지 않는다. 보수적 입력 예산은 정확한 Google 토큰 사용량·청구 측정이 아니며 같은 프로젝트를 쓰는 다른 앱의 사용량까지 보장하지 않는다. 자동 재시도·모델 자동 전환·유료 전환은 하지 않는다.
- 사용자 승인: 개발 문서·소스·테스트를 기존 Antigravity/Gemini 서비스에 전달해 구현하는 것은 허용되었다. 비밀키·사진·PDF·개인 학습기록은 대상에서 제외한다.
- 서버 Secret만 사용하며 클라이언트 키, URL 키, 원문 로그, 원음 서버 저장, 유료 자동 전환을 금지한다. 기기 코드·Origin·CORS만으로 인증 완료라고 주장하지 않는다.
- 고정 교재·로컬 규칙 평가와 실제 AI 응답은 화면과 기록에서 구별한다. 실제 API·실기기·사람 교사 검수 결과를 모의 시험으로 대체하지 않는다.
- 첫 32차시는 초안이며 `HUMAN_CURRICULUM_REVIEW_PENDING`. 나머지 96차시는 준비중이다.
- 공개 출시 상태는 `NOT_APPROVED`. 배포·운영 DB 변경·삭제·Git stage/commit/push는 별도 요청이 필요하다.

## 공식 근거 확인 (2026-10-21 KST)

- [Google 모델 목록](https://ai.google.dev/gemini-api/docs/models): 지정 대화·전사·TTS 모델 식별자 확인.
- [Google 가격표](https://ai.google.dev/gemini-api/docs/pricing): 무료 등급 표시는 계정별 호출 가능·무료 한도를 보장하지 않는다. 실제 프로젝트 청구 연결과 할당량은 미확인.
- [구조화 응답](https://ai.google.dev/gemini-api/docs/structured-output): Interactions API의 `response_format`에 JSON schema를 지정하고 앱에서 별도 검증한다.
- [축어 전사](https://ai.google.dev/gemini-api/docs/transcribe): `generation_config.transcription_config.mode.type = verbatim`. smart 전사는 원 발화 교정에 사용하지 않는다.
- [공식 TTS](https://ai.google.dev/gemini-api/docs/speech-generation): 공식 음성 출력과 브라우저 재생 결과를 구별한다. 기존 Translate 프록시는 회화에서 재사용하지 않는다.
- [Google 약관](https://ai.google.dev/gemini-api/terms): 성인 및 이용 목적·공개 제공 조건 검토가 필요하다. 이번 개발에서 공개 적합성 승인을 선언하지 않는다.
- [Pages 라우팅](https://developers.cloudflare.com/pages/functions/routing/): 실제 Pages 엔트리와 로컬 런타임을 시험한다.

## 사전 기준

후속 실호출 증거와 남은 관문은 [CONVERSATION_REMAINING.md](CONVERSATION_REMAINING.md), 최종 검증은 [FOLLOWUP-02_RESULT.md](FOLLOWUP-02_RESULT.md)에 구분한다. 아래 항목은 최초 구현 당시의 사전 기준이다.

- main / `8248697cb4702719dfe7191195bccba5851a9cd4`, staged 0개.
- `scripts/verify.ps1`: 타입·lint·빌드, 기존 35개 파일·158개 테스트 통과. PDF.js 및 번들 크기 경고 존재.
- 로그와 보드 원본 스냅샷은 Git 제외된 `.agy-work/002_*`에 보존한다.
- 사용자 제공 비교본 references 파일은 현재 `docs/ai회화`에 없으므로 로컬 보드를 무손실 기준으로 사용한다. 첨부 원본 대조는 미검증이다.
