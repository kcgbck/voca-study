# AI 회화 후속 미검증 관문 및 로컬 진단 가이드 (FOLLOWUP-01)

> **2026-10-24 FOLLOWUP-24 갱신**: 정답 반복 비교는 대소문자·말미 `. ! ?`·연속 공백·아포스트로피 모양 차이를 허용한다. 단어·숫자·부정 표현 및 내부 구두점 변화는 여전히 AI 평가 대상이다. 전체 725시험, 실제 입력 8회/차감 5건/재사용 3회 추가 차감 0, 배포 `d5cd97e6` 확인. [최신 표기 차이 재사용 검증](FOLLOWUP-24_FORMAT_REUSE_VALIDATION.md)을 우선한다. 아래 FOLLOWUP-23의 완전 일치 조건은 이전 동작의 기록이다.

> **2026-10-24 현재 상태 — FOLLOWUP-23 우선**: 현재 공개된 5문항 코치는 로그인 없이 성인 확인 1회, 브라우저 STT/TTS, 10초 음성창으로 운영한다. 독립 D1 예산의 90% 상한(대화 13RPM / 225000 안전 단위/분 / 450RPD)을 유지하며, 같은 질문의 AI가 확인한 완전한 정답을 정확히 반복하면 추가 호출·차감을 생략한다. 첫 답변과 달라진 답변은 AI가 평가한다. [실제 운영·예산 검증](FOLLOWUP-22_REPEAT_REUSE_VALIDATION.md), [Gemini 잔여 감사](FOLLOWUP-23_GEMINI_REMAINING_AUDIT.md), [S25 순서 및 최신 699시험 결과](FOLLOWUP-23_S25_CHECK_AND_RESULT.md)를 따른다. 아래의 Access/DB 미구성, 과거 음성창, 출시 보류 문장은 당시 상태 또는 구형 128차시 설계의 역사이며 현재 공개 5문항과 구별한다. 실기기·사람 검수·외부 독립 검토·BOARD-01/12A 미검증은 유지한다.

> **2026-10-22 최신 검증 — FOLLOWUP-08 우선**: 90% 서버 상한 CHAT 13/225000/450, STT 2/9000/22, TTS 2/9000/9 및 기기 내 WAV 정규화를 구현했다. 격리 실제 Google 합성 대화12/12 응답·기대판정 일치(직접 AI10, 정책상 로컬 힌트2), TTS/STT 각1회 성공. 실제 프로젝트 한도는 AI Studio 확인 완료, 청구 미연결 무료 상태는 사용자 확인 및 Free tier UI 확인이다. 운영 Access/독립 D1은 여전히 미구성으로 기본 차단한다. BOARD-12B 전용 GFM 렌더러 검증 진행 결과와 남은 BOARD-01/12A는 [최신 결과](FOLLOWUP-08_RESULT.md) 참조. 아래 이전 단계의 수치·미검증/실패 기록은 해당 시점의 역사이며 최신 판정은 이 보충과 FOLLOWUP-08을 따른다. Google 실제 토큰·다른 앱 합산·장기 가용성 보장 아님.


기준 일자: 2026-10-22 KST  
진행 원칙: Codex 감독 / Gemini 구현 / 사용자 결정  
현재 출시 판정: **PUBLIC_RELEASE_STATUS = NOT_APPROVED**  
통합 기술 상태: **LOCAL_CODE_VERIFIED** (로컬 코드 및 어댑터 검증 완료) / **NEW_MODEL_SYNTHETIC_INTEGRATION_PASS** (3.5 Flash-Lite 합성 통합2/2; 장기 안정성 미검증)

형상 관리: Git main HEAD `8248697cb4702719dfe7191195bccba5851a9cd4`, staged 0, commit/push/배포 없음.

> **[2026-10-22 사용자 명시 승인 — 대화 모델 `gemini-3.5-flash-lite` 채택]**
> - **승인 사항**: 앱 대화 모델, 예산 허용 모델 목록, 관련 테스트 fixture를 `gemini-3.5-flash-lite`로 전환 적용함. 음성 전사(`gemini-3.5-transcribe`) 및 음성 합성(`gemini-3.8-flash-lite-tts`)은 변경하지 않음.
> - **채택 근거**: FOLLOWUP-03 보고서의 기존 6회 합성 대조 시험 실측(`gemini-3.5-flash-lite` 2/2 통과 약 8.9~9.2초 / `gemini-3.6-flash` 1/2 통과 / `gemini-3.8-flash` 0/2 모두 Google HTTP 503(내부 원인 미확정))에 근거하여 후속 후보로 채택 승인됨.
> - **운영 설정 부재 및 기본 차단**: 운영 Cloudflare Access 팀 도메인·AUD, 독립 예산 D1 바인딩, 계정별 실제 한도값(RPM/TPM/RPD)은 아직 없으므로, 외부 호출 기본 차단(`BLOCKED_FAIL_CLOSED`, `readiness.isReadyForLiveCalls = false`)을 유지함.
> - **검증 상태 분리**: 전환 후 Codex가 전체51파일464시험 및 실제 통합 합성2요청(1.206초·1.182초), 로컬 Pages9/9를 검증함. 상세는 [FOLLOWUP-04 결과](FOLLOWUP-04_MODEL_SWITCH_RESULT.md). 과거 실측 기록(3.8-flash의 단일 13.6초 성공, 2회 20초 타임아웃, 60초 장기 계측 503 등)은 과거 사실로 보존하며 일괄 치환하지 않음.
> - **출시 판정 불변**: 첫 32차시 사람 검수(`HUMAN_CURRICULUM_REVIEW_PENDING`), 공개 출시 판정 `NOT_APPROVED`, 미검증 관문 일체를 유지함.

---

## 1. 최근 실호출 및 진단 증거 종합 (2026-10-22)

1. **실제 Google + 라우터 단일 호출 성공 (`.agy-work/014_live_router_smoke.json`, 1회 호출, 재시도 0회)**:
   - 공식 대화 모델(`gemini-3.8-flash`)에 대해 실제 라우터(`handleConversationAction`)를 거친 단일 실호출이 13.662초에 `HTTP 200 OK` 수신.
   - 턴 평가 결과 `ACCEPT`, `fallbackToRuleEngine: false`, 튜터 영어 응답 정상 수신 확인.

2. **통합 인증·예산 어댑터 실호출 검증 (`.agy-work/020_integrated_live_smoke.json`, 2회 실호출, 재시도 0회)**:
   - 가상 RS256 Access 서명 + 실제 SQLite D1 예산 어댑터 + 실제 Google 대화 2회 호출 실행.
   - 두 실호출 모두 서버 유한 데드라인(20초) 만료로 20.027초 및 20.007초에 안전하게 504 타임아웃 차단.
   - 중복 `requestId`에 대한 429 차단, 분당 한도 초과 429 차단 정상 동작.
   - 실패 턴에 대해서도 reservation이 `consumed`로 유지되어 무단 자동 재시도 및 중복 예약 방지 확인.

3. **동일 App 페이로드 60초 장기 진단 계측 (`.agy-work/021_long_probe.json`, 1회 호출, 재시도 0회)**:
   - 앱이 생성한 동일 4.2 KiB 실제 페이로드를 서버 20초 데드라인 밖인 60초 타임아웃 환경에서 단 1회 직접 계측.
   - Google 엔드포인트로부터 **4.228초만에 HTTP 503 Service Unavailable** 수신 (`PROVIDER_REJECTED`).
   - **결론**: 클라이언트나 로컬 서버의 버그뿐만 아니라, **Google 업스트림 제공자 측의 일시적 과부하/가용성 불안정(`503 UNAVAILABLE`)이 실제로 발생함**을 실측 확인.
   - 따라서 대화 기능을 "완전 해결(PASS)"로 승격하지 않고, 로컬 코드 규격 통과(`LOCAL_CODE_VERIFIED`)와 실제 공급자 가용성 한계(`REAL_PROVIDER_UNSTABLE`)를 정직하게 분리하여 관리합니다. 앱 코드 수정만으로 Google 서비스 가용성을 보장한다고 주장하지 않습니다.

4. **공급자 실패 분류 및 안전 오류 경계 분리**:
   - `503 UPSTREAM_UNAVAILABLE`: Google HTTP 503 수신 시 502로 왜곡하지 않고 정규 `HTTP 503` + 고정 안내 문구 + `errorCode: 'UPSTREAM_UNAVAILABLE'`, `retryable: true` 부여 (잠시 후 수동 재시도 안내 목적).
   - `504 UPSTREAM_TIMEOUT`: 서버 20초 유한 타이머 만료 시 부여.
   - `504 REQUEST_CANCELLED`: 클라이언트/외부 시그널에 의한 중단 시 부여 (사전 중단 시 upstream 0회).
   - `502 TRANSPORT_ERROR`: DNS 실패, 네트워크 단절 등 전송 계층 장애 시 부여.
   - `502 UPSTREAM_ERROR`: 기타 Google 5xx 응답 시 부여.
   - `429 RATE_LIMIT`: 기존 한도 초과 유지.
   - 자동 재시도 0회, 모델 자동 대체 0회, 유료 종량제 전환 0회 원칙을 유지하며, 모든 실패 응답 JSON 본문에 API 키, Google 내부 원문 에러 상세, 내부 생각, 사용자 발화 로그는 일체 노출되지 않습니다.

5. **Codex 검증 근거**:
   - Cloudflare Access RS256 JWT 인증 어댑터 14시험 PASS.
   - D1 단일 쓰기 원자적 예산 잠금 어댑터 13시험 PASS (총 27시험 PASS).
   - Cloudflare Pages 엔드포인트 통합 17시험 PASS.
   - 최신 D1 타입 구조 호환 및 Pages 컴파일 빌드 PASS.
   - 전체 테스트 건수는 최종 전체 실행 전 임의로 날조하지 않습니다.

---

## 2. 미검증 관문 종합 일람표 (Unverified Gates Table)

| 관문 ID | 구분 | 현재 증거 / 상태 | 누가 무엇을 확인하는가 | 정확한 완료 기준 | 대기 조건 (Waiting) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **GATE-API-01** | 대화 모델 실연동 | `PASS_SYNTHETIC_BENCH` (12/12 응답·판정, 직접AI10/로컬힌트2) | Codex: 현 3.5 Flash-Lite 격리 통합 합성 확인 | 장기·다중사용자·운영 경로는 별도 확인 | Access/AUD·독립 D1 미구성 |
| **GATE-API-02** | 음성 TTS/STT | `PASS_SYNTHETIC_ONLY` (이번 합성1라운드 완전일치, Chrome WebM→WAV 계량1090 통과) | Codex/테스터: 잡음·다양한 문장·실기기 확인 | 실제 기기/발음/길이별 확인 | 실기기 검증 |
| **GATE-ACC-01** | 프로젝트 청구 | `USER_CONFIRMED_FREE` + AI Studio Free tier 확인 | 사용자: 청구 미연결 상태 유지 | 운영 전 결제 계정 연결 없음을 재확인 | 운영 전 점검 |
| **GATE-ACC-02** | 모델별 실제 한도 | `VERIFIED_PROJECT_QUOTAS` + 90% 코드상한 적용 | AI Studio 확인, FOLLOWUP-06/08 기록 | 13/225k/450, 2/9k/22, 2/9k/9 | 운영 환경 주입·타 앱 사용량 별도 관리 |
| **GATE-TERMS-01** | 사용자 지역 및 약관 | `NOT_VERIFIED`<br>(정책 문서상 링크만 대조) | **사용자/운영자**: Google Generative AI 추가 약관, 한국 지역 서비스 적격성, 공개 제공 조건 검토 | 해당 Google 계정/지역에서 무료 API 결과물을 사용자 앱 기능으로 제공 가능한지 규정 준수 검토 완료 | 이용 약관 및 법적 요건 검토 |
| **GATE-DEV-01** | 실기기 마이크/STT | `NOT_VERIFIED`<br>(360px 에뮬레이션 및 모의 장치만 시험) | **사용자/테스터**: Android Chrome 및 iOS Safari 실기기에서 WebRTC 마이크 하드웨어 권한 획득 및 오디오 입력 | 실제 모바일 브라우저 환경에서 마이크 권한 요청 승인 및 유효한 오디오 청크 수집 동작 확인 | 실기기 테스트 환경 |
| **GATE-DEV-02** | 실기기 음성/PWA | `NOT_VERIFIED`<br>(모의 Web Speech 단위시험만 완료) | **사용자/테스터**: 실기기 브라우저 Web Speech Synthesis 음질, 지원 음성 엔진 유무, PWA 완전 오프라인 캐싱 동작 | 실기기 스피커를 통한 명확한 오디오 출력 및 비행기 탑승 모드(완전 오프라인) 구동 확인 | 실기기 테스트 환경 |
| **GATE-HUMAN-01** | 교재 교육 검수 | `HUMAN_CURRICULUM_REVIEW_PENDING`<br>(로컬 32차시 초안만 작성됨) | **영어 교육 전문가/교사**: 32개 차시 64개 세부 학습 목표, 표현, 허용답안, 전이 시나리오의 교육적 적절성 검수 | 실제 교사 검수 결과서 작성 및 검수 피드백 해결 이력 기록 (Gemini 자기검토로 완료 불가) | 전문 교사 검수 인력 |
| **GATE-HUMAN-02** | 외부 독립 리뷰 | `EXTERNAL_REVIEW_PENDING`<br>(내부 개발자-감독자 교정만 수행) | **외부 제3자 리뷰어**: 개인정보 처리(문맥 6턴), 보안 가드, 6대 평가 규칙의 공정성 검토 | 독립된 외부 검토자의 공식 리뷰 리포트 및 지적사항 조치 기록 (Gemini 자기검토로 완료 불가) | 외부 리뷰 일정 |
| **BOARD-01** | 보드 첨부 원본 대조 | `NOT_VERIFIED`<br>(로컬 기준선 98개 원본 보존은 PASS) | **Codex/사용자**: 외부 첨부 원본과 로컬 보드 18탭·125노드 간의 증분 구조 대조 검증 | 원본 98개 노드의 무손실 보존과 신규 27개 노드(총 125개)의 증분 확장이 원본 취지와 일치함을 비교 검증 | 첨부 원본 파일 확보 |
| **BOARD-12A** | 보드 file 프로토콜 열람 | `NOT_VERIFIED`<br>(HTTP/360px 검증만 완료) | **테스터**: 브라우저 보안 정책상 허용된 로컬 환경에서 `file://` 직접 열람 수동 시험 | 브라우저 file 정책을 우회하지 않고, 허용된 환경에서 HTML 파일 직접 열람 시 오류 유무 확인 | 로컬 파일 브라우징 시험 환경 |
| **BOARD-12B** | 보드 Markdown 렌더링 | `PASS_RENDERER_SCOPED` | Codex: marked17.0.5 GFM, Chrome1920/360 | 헤더·표·코드·5링크 렌더링 확인 | Mermaid 도식 및 다른 렌더러 호환 보장 아님 |
| **GATE-SEC-01** | 운영 서버 어댑터 | `CONFIGURATION_REQUIRED`<br>(Pages 기본403; 로컬 네이티브 D1 8/8 PASS, 원격 미검증) | **운영자/Codex**: Cloudflare Access 도메인/AUD, 독립 D1 바인딩, 모델 한도 JSON 주입 구성 | 프로덕션 환경에서 중복 요청 방지 및 호출자 검증이 정상 동작함 (운영 설정 미구성 시 fail-closed 기본 차단) | 운영 배포 및 보안 정책 승인 |
| **GATE-RELEASE** | 공개 출시 최종 승인 | `NOT_APPROVED` | **사용자**: 상기 모든 선행 관문 완료 후 최종 공개 서비스 전환 여부 결정 | 사용자의 명시적 승인 결정 | 전체 선행 관문 완료 |

---

## 3. 운영 환경설정 변수 목록 및 순서 필요조건

운영 환경에서 AI 회화 서버 기능을 안전하게 활성화하기 위해 필요한 설정 변수 목록입니다. (실제 값이나 비밀 키 파일을 저장소에 생성하지 않습니다.)

### 1) 환경변수 및 바인딩 목록 (모두 충족되어야 활성화)
1. `ALLOW_EXTERNAL_GEMINI_CALLS="true"`: 외부 호출 명시 허용 플래그
2. `CONVERSATION_FREE_TIER_CONFIRMED="true"`: 결제 미연결 무료 티어 프로젝트 확인 플래그
3. `CONVERSATION_ADULT_TESTERS_CONFIRMED="true"`: 내부 성인 테스터 운영 확인 플래그
4. `GEMINI_API_KEY`: Google AI Studio에서 발급받은 무료 API 키
5. `CONVERSATION_ACCESS_TEAM_DOMAIN`: Cloudflare Access 인증 팀 도메인 (`https://<team>.cloudflareaccess.com`)
6. `CONVERSATION_ACCESS_AUDIENCE`: Cloudflare Access Application의 고정 AUD 태그 문자열
7. `CONVERSATION_BUDGET_DB`: 독립 Cloudflare D1 데이터베이스 바인딩 (기존 앱 `env.DB` 절대 fallback 금지)
8. `CONVERSATION_MODEL_LIMITS_JSON`: 지정 3개 모델(`gemini-3.5-flash-lite`, `gemini-3.5-transcribe`, `gemini-3.8-flash-lite-tts`)의 `{ rpm, tpm, rpd, callerRpm }` 양의 safe 정수 JSON 매핑 문자열

### 2) 데이터 보호 및 예산 산정 원칙
- **원음·원문·발화 DB 미저장**: 예산 DB(`CONVERSATION_BUDGET_DB`)에는 오직 중복 방지용 `requestId`, 가명 식별자 `SHA-256(sub)`, 보수적 바이트 예산 숫자만 기록되며, 음성 데이터, 텍스트 전사문, 수업 학습 기록은 일체 기록되지 않습니다.
- **D1 스키마 사전 미적용**: 원본 스키마 파일(`scripts/conversation/budget-schema.sql`)은 아직 실제 운영 D1에 적용되지 않은 상태이며, 미구성 시 fail-closed로 upstream 0회 차단됩니다.
- **보수적 TPM 예산 산정**: 요청 시 산정되는 TPM 유닛은 wire body bytes + 수업 JSON bytes + 16 KiB 고정 프롬프트 마진의 보수적 합산치입니다. 이는 로컬 과소비 방지용 추정치이며, Google의 정확한 토큰 청구량 측정이나 타 애플리케이션의 할당량 소진까지 보장하지 않습니다.

---

## 4. 로컬 API 사전점검 도구 (`scripts/conversation/preflight.mjs`)

### 1) 주요 보안 원칙
- **네트워크 호출 0회**: 외부 API나 Google 엔드포인트를 호출하지 않습니다.
- **엄격한 1행 단위 dotenv 하위집합 파싱**:
  - 인라인 주석(`KEY= # comment`), 따옴표 불일치(`"val`, `'val"`), 변수 확장(`$VAR`, `${VAR}`), 등호 없는 행, 잘못된 키 식별자, 중복 키 감지 시 즉시 Fail-Closed 처리합니다.
  - 키의 실제 값, 마스킹된 문자열, 해시, 파일 경로, 시스템 오류 원문을 외부에 노출하지 않습니다.
- **클라이언트 번들 누출 방지**: `VITE_` 접두어가 포함된 API 키가 감지될 경우 클라이언트 노출 위험 플래그(`viteClientLeakRisk: true`)를 설정합니다.
- **조건부 팩토리 주입 진단**: 하드코딩된 소스 부재 대신 `CONFIGURATION_REQUIRED` 상태를 통해 실제 환경변수 주입 및 런타임 검증 필요성을 안내하며, 본 도구가 오프라인 정적 진단기일 뿐 실제 외부 호출 허가 판정이 아님을 명시합니다.

### 2) 사용 방법
```bash
# 기본 점검 (기본 docs/.env 대상)
node scripts/conversation/preflight.mjs

# 지정 파일 점검
node scripts/conversation/preflight.mjs --config-file <경로>
```

### 3) 종료 코드(Exit Code) 규격
- `0`: 모든 가드 및 운영 어댑터 완비 (현재 단계에서는 도달 불가).
- `1`: 도구 실행 실패, 잘못된 CLI 옵션 입력, 또는 파일 읽기 치명적 오류 (`ENV_READ_FAILED`).
- `2`: 파일 미존재(`ENV_FILE_NOT_FOUND`) 또는 실호출 준비 미충족 (`BLOCKED_FAIL_CLOSED`).

---

## 5. 공식 기술 참조 문서

- Google Gemini API Troubleshooting (503 UNAVAILABLE 지침): https://ai.google.dev/gemini-api/docs/troubleshooting
- Google Gemini Interactions API Overview: https://ai.google.dev/gemini-api/docs/interactions-overview
- Cloudflare Access JWT Validation: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- Google Gemini Rate Limits: https://ai.google.dev/gemini-api/docs/rate-limits

## 6. Codex 최종 검증 보충 (2026-10-22)

현재 전환·검증 결과는 [FOLLOWUP-04_MODEL_SWITCH_RESULT.md](FOLLOWUP-04_MODEL_SWITCH_RESULT.md)가 최신이다. 다음 문장은 FOLLOWUP-03 당시 기록이다: 운영 Access/모델 한도 설정은 아직 없다고 확인했다. 비교만 승인받아 실제 합성6요청을 실행했으며 3.5 Flash-Lite2/2, 3.6 Flash1/2, 현재3.8 Flash0/2 성공이었다. 실패3회는 Google503. 앱 모델 변경은 미승인·미실행이며 기본 차단을 유지한다. 아래 FOLLOWUP-02 결과는 이전 시점의 검증 기록이다.

최종 전체 검증은 51파일·462시험 PASS(FAIL0/SKIP0), 타입/lint/build·보호 경로·diff 공백 PASS이다. 로컬 Pages 실제 실행 9/9, 공식 D1 타입 호환도 PASS. 최종 합성 실호출은 `.agy-work/023_final_live_smoke.json`에서 서버20초 제한시간 만료(504, Google1회)를 다시 재현했다. 인증과 SQLite 예산 통합은 통과했지만 공급자 안정성은 미해결이다. 이번 후속 생성 시도는 총7회, 자동 재시도0이며 운영 Access·모델별 한도·독립 예산 DB 설정은 미구성이다. 상세는 [FOLLOWUP-02_RESULT.md](FOLLOWUP-02_RESULT.md).

## FOLLOWUP-08 최종 검증

53파일496시험 PASS, Pages9/9, 실제 합성14호출, BOARD-12B 전용 렌더러 PASS. BOARD-01/12A 및 실제 운영 인증·예산·기기·사람 검수·독립리뷰는 보류. 계량은 Chat만 기존16KiB, TTS 텍스트/옵션+1024, STT 검증WAV 초×64+1024 및 비WAV 바이트+1024다. 최신 상세는 FOLLOWUP-08_RESULT.md.

## FOLLOWUP-09 운영 준비 보충

[운영 설정 안내](CONVERSATION_OPERATING_SETUP.md): Zero Trust Free 팀·실제 접속 호스트 Access·성인 시험자 Allow 정책·AUD·독립 D1 스키마·Wrangler source-of-truth·Production 변수 및 Secret·재배포 순서를 정리했다. Gemini 작성 하네스를 Codex가 실제 로컬 D1에서 실행하여 중복·동시성·소진/환불금지·스키마 누락 차단 8/8 PASS. 전체53파일496시험 재통과. 원격 Access/D1·실기기·교사/독립리뷰·BOARD-01/12A 및 출시 승인은 보류. [결과](FOLLOWUP-09_RESULT.md).

2026-10-22 후속: 운영 인증JWKS 오류 원인 입증 및 수정, 브라우저 기본듣기/명시적클라우드TTS 분리 준비. 정식54파일502시험 PASS. 아직 사용자 재배포와 운영 실호출 재검증 필요. STT22/일·클라우드TTS9/일의 무료총량 문제는 완전 해결 아님. 상세 docs/CONVERSATION_OPERATING_SETUP.md 마지막 체크포인트 참조.


2026-10-23: 실제운영합성대화3/3 성공 및 독립DB consumed3건(62,847보수단위) 확인. 기기내STT와명시적클라우드분리·수동팩설치 구현, 최종57파일520시험PASS. 새음성입력 재배포/영어팩설치/실제마이크 검증은대기. 지원Chrome에서STTAPI미사용경로를준비했으며 모든기기한도해결/공개출시승인을뜻하지않음. 상세 FOLLOWUP-10_OPERATING_VALIDATION.md.

