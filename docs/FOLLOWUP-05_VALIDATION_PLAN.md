# FOLLOWUP-05 대화 모델 운영한도 가이드 및 후속 검증 계획서 — 2026-10-22 KST

- **작업 원칙**: Codex 감독 / Gemini 구현 / 사용자 결정
- **작업 범위**: 모델별 한도 산정 가이드, 안정성 시험 절차, 보드 잔여 미검증 관문 처리 계획 수립 (소스 변경 0, 실제 호출 0)
- **Git 형상**: main HEAD `8248697cb4702719dfe7191195bccba5851a9cd4`, staged 0, 기존 변경 완전 보존
- **현재 기술 상태**: `LOCAL_CODE_VERIFIED` (로컬 코드 및 어댑터 검증 완료) / `NEW_MODEL_SYNTHETIC_INTEGRATION_PASS` (과거 3.5 Flash-Lite 합성 통합 2/2 통과; FOLLOWUP-04 근거)
- **현재 운영 상태**: `BLOCKED_FAIL_CLOSED` (운영 환경변수 및 한도 미구성으로 외부 호출 차단 유지)
- **최종 출시 판정**: **`PUBLIC_RELEASE_STATUS = NOT_APPROVED`**

---

## 1. 모델별 할당량 및 callerRpm 앱 정책 가이드

사용자가 직접 운영 한도를 설정하기 위해 필요한 공식 모델 목록과 앱의 예산 정책 가이드입니다.  
개발 작업 환경(agy 도구)은 `gemini-3.8-flash-medium` 구독형 인터페이스를 사용 중이며, 본 운영 API 한도 관리 대상이 아닙니다.  
이전 대화 모델(`gemini-3.8-flash`) 및 비교 모델(`gemini-3.6-flash`)은 사용하지 않으며, 대체 모델을 임의로 추가하지 않습니다.

### 1) 운영 대상 3개 모델 목록 및 역할

| 기능 (Action) | 모델 ID (Allowlist) | 엔드포인트 / 용도 |
| :--- | :--- | :--- |
| **대화 (CHAT)** | `gemini-3.5-flash-lite` | `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent`<br>대화 턴 평가(ACCEPT/ERROR_CORRECTION 등 유효 EvaluationCategory) 및 튜터 응답 생성 |
| **음성 전사 (STT)** | `gemini-3.5-transcribe` | `https://generativelanguage.googleapis.com/v1beta/interactions`<br>사용자 녹음 오디오의 축어적(Verbatim) 텍스트 전사 |
| **음성 합성 (TTS)** | `gemini-3.8-flash-lite-tts` | `https://generativelanguage.googleapis.com/v1beta/interactions`<br>튜터 텍스트의 오디오 생성 |

### 2) Google API Quota 특성 및 공식 정책 근거

- **공식 기술 문서 근거**: [Google Gemini Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits) (2026-10-22 Codex 확인)
- **프로젝트 단위 공유**: Google AI Studio의 Quota는 개별 API Key가 아니라 **Google Cloud Project 전체에 공유**됩니다. 동일 프로젝트 내에서 다른 도구나 작업이 API를 호출할 경우 할당량이 함께 소진될 수 있습니다.
- **제한 축 (Quota Dimensions)**:
  - **RPM (Requests Per Minute)**: 분당 총 요청 건수
  - **TPM (Tokens Per Minute)**: 분당 입력 토큰 수 (일부 모델은 입력/출력 별도 계량)
  - **RPD (Requests Per Day)**: 일일 총 요청 건수
- **RPD 리셋 기준 시점**: Google의 일일 한도(RPD)는 **태평양 시간(서머타임 반영 America/Los_Angeles) 자정**에 리셋됩니다. 한국 표준시(KST, UTC+9)와 시차가 발생하므로, 앱의 D1 예산 어댑터(`toPacificDateString()`)도 엄격히 태평양 시간을 기준으로 일일 사용량을 집계합니다.
- **무료 티어 프로젝트(Unbilled Free Tier) 유지 원칙**:
  - 본 프로젝트는 유료 종량제(Pay-as-you-go) 결제 계정이 연결되지 않은 무료 프로젝트 유지를 절대 원칙으로 합니다.
  - 한도 수치를 앱에 설정한다고 해서 Google의 자동 무료 유지나 서비스 가용성(SLA)이 보장되는 것은 아닙니다. Google 측의 사정으로 일시적 과부하(`503 UNAVAILABLE`)나 쿼터 고갈(`429 RATE_LIMIT`)이 발생할 수 있습니다.

### 3) 앱의 한도 파라미터 및 callerRpm 정책

운영자가 제공할 JSON의 각 모델별 파라미터 규격은 다음과 같습니다:

- `rpm`: 모델의 분당 최대 전체 호출 수 (양의 safe 정수)
- `tpm`: 모델의 분당 최대 입력 유닛 수 (양의 safe 정수)
- `rpd`: 모델의 태평양 일일 최대 전체 호출 수 (양의 safe 정수)
- `callerRpm`: **발신자(가명화된 동일 사용자)당 분당 최대 호출 수** (양의 safe 정수)
  - **앱 정책 목적**: 단일 악의적 사용자나 클라이언트의 연속 클릭 루프로 인해 프로젝트 전체의 분당 RPM/TPM이 즉시 고갈되어 다른 학습자가 차단되는 것을 방지하기 위한 안전장치입니다.
  - 일반적으로 전체 `rpm` 이하의 보수적인 값으로 구성합니다. (미승인 임의 제안 수치 배제)

### 4) 앱의 보수적 TPM 산정 공식과 주의사항

- **산정 공식 (`calculateConservativeEstimatedUnits`)**:
  $$\text{Estimated Units} = \text{Wire Body Bytes} + \text{Approved Lesson JSON Bytes} + 16\,\text{KiB (고정 프롬프트/스키마 마진)}$$
- **비(非)토큰 계량 특성 및 주의사항**:
  - 앱이 D1 예산 어댑터에 예약하는 단위(`units`)는 바이트 기반 보수적 추정량이며, Google 토크나이저의 엄밀한 상한이나 BPE 같은 미확인 기술 사양이 아닙니다.
  - 앱의 `tpm`은 공급자가 제공한 TPM 이하로 보수적으로 설정하되, 과소 설정 시 정상적인 입력도 로컬에서 차단될 수 있습니다. 또한 이 방식이 정확한 토큰 환산이나 공급자 측 429 차단 방지를 완전히 보장하지는 못합니다.

### 5) 비활성 템플릿 안내 (`docs/CONVERSATION_MODEL_LIMITS_TEMPLATE.json`)

- 생성된 템플릿 파일은 3개 운영 모델 ID를 루트 키로 갖고 모든 필드가 `null`로 지정되어 있습니다.
- 소스 코드의 `validateModelLimitsJson()` 검증기는 양의 정수(`isPosSafeInt`)가 아닌 `null`을 엄격히 거절(Fail-Closed)하므로, 실제 운영 한도로 동작하지 않는 안전한 템플릿입니다.
- 실제 운영 환경변수(`.env` 또는 Cloudflare Secret)는 운영자가 실제 콘솔 수치를 확인한 후 안전하게 주입해야 합니다.

---

## 2. 대화 안정성 실호출 검증 계획 (한도값 수신 후 실행)

본 시험은 사용자가 실제 3개 모델의 한도값을 공식 제공하고, Codex가 이를 검토하여 지시한 이후에만 실행합니다. (현재는 준비 단계이며 이번 턴 실행 0회)

### 1) 시험 실행 환경 및 전제 조건
- **환경**: 격리된 로컬 테스트 러너 (합성 RS256 서명 JWT + 메모리 SQLite D1 예산 어댑터 + 실제 Google API 엔드포인트)
- **실계정 및 사용자 자료 보호**:
  - 실제 사용자의 계정, 실제 개인정보, 음성, 학습 기록은 일체 전송하지 않음 (순수 합성 fixture 페이로드 사용).
  - API 키는 Codex 실행 환경의 메모리와 공식 Google 인증 헤더에만 사용하며, Gemini 개발 작업자/문서/로그/클라이언트에 전달하지 않음. 운영 Access JWT 요구 없음.
- **추측 한도 및 임의 실행 금지**:
  - 남은 사용량을 알지 못하면 추측으로 충분하다고 주장하지 않음.
  - 최대 12회 시도는 상한이며 실제 제공 한도·남은 할당량·보수적 예약량·순차 간격(spacing)을 검토하여 12 / 6 / 3 / 0 중 축소 결정함 (계획 확정 전에는 실호출 일체 없음).

### 2) 6대 발화 조건 및 2라운드 구성 (최대 12회 호출 상한)

6가지 핵심 사용자 시나리오에 대해 최대 12회(2라운드) 순차 호출 상한으로 구성합니다 (자동 재시도 0회).  
(단, 구체적인 발화 fixture 조건 없이 판정을 정답처럼 미리 확정하지 않으며, 교육적 평가와 수송 성공 여부는 독립적으로 기록합니다.)

| 번호 | 발화 시나리오 조건 | 시험 목적 및 평가 기대치 (도메인 스키마 준수) |
| :---: | :--- | :--- |
| **C1** | **초급 합성 발화** (`intro-u01-l01`) | 입문 목표 표현의 정확한 사용 검증 (`ACCEPT`) |
| **C2** | **고급 합성 발화** (`advanced-u01-l01`) | 복합 문장 및 고급 어휘에 대한 적절한 응답 (`ACCEPT`) |
| **C3** | **자연스러운 짧은 답 (Short Answer)** | 단답형이지만 상황에 부합하는 응답 허용 검증 (`ACCEPT` 또는 `OPTIONAL_EXPANSION`) |
| **C4** | **오류 교정 대상 발화** | 문법/어휘 오류 포함 발화에 대한 교정 피드백 (`ERROR_CORRECTION`; 구체 발화 fixture와 로컬 평가 선행 확인 후 기대 확정) |
| **C5** | **힌트 요청 발화** | 학습자의 표현 도움 요청 (`NEEDS_HINT`; 요청 hintLevel 포함 구체 fixture 확인 후 기대 확정) |
| **C6** | **오프토픽 발화 (Off-topic Boundary)** | 수업 주제와 완전히 무관한 발화에 대한 안전한 경계 처리 (`OFF_TOPIC`) |

- **라운드 구성 및 호출 상한**: Round 1 (C1 ~ C6, 6회) $\rightarrow$ Round 2 (C1 ~ C6, 6회) = 최대 12회 순차 호출.
- **할당량 기반 호출 축소 규칙**: 최대 12회 시도는 상한이며, 실제 제공 한도·남은 할당량·보수적 예약량·순차 간격(spacing)을 면밀히 검토하여 12 / 6 / 3 / 0 중 축소 결정합니다. 계획 확정 전에는 실호출이 일체 없으며, 남은 사용량을 확인하기 전에는 충분하다고 추측하지 않습니다.

### 3) 호출 실행 규격 및 지연시간/상태 분류

- **타이머 규격**: 서버 유한 데드라인 20초, 브라우저 클라이언트 타임아웃 25초 유지.
- **순차 실행**: 동시성 경쟁으로 인한 불필요한 429 유발을 막기 위해 모든 호출은 단일 스레드로 순차 실행.
- **관측 및 결과 보고 지표**:
  1. **HTTP 상태 코드**: 200, 429, 503, 504 분리 기록
  2. **지연시간 통계**: 각 호출별 소요 시간, p50 지연, p95 지연, 최대(Max) 지연시간 보고
  3. **실패 유형 분류**: 시간 초과(Timeout), 스키마 파싱 거절(Schema Reject), 로컬 룰엔진 폴백(Local Fallback) 여부 분리
  4. **교육적 평가 결과**: 도메인 유효 스키마(`ACCEPT`, `OPTIONAL_EXPANSION`, `ERROR_CORRECTION`, `TRANSCRIPT_UNCERTAIN`, `NEEDS_HINT`, `OFF_TOPIC`) 및 사실 일치성(`factualConsistency`) 정상 반환 확인 (교육적 평가 결과와 수송 성공 여부는 독립적으로 기록)
- **공급자 장애 대응 원칙**:
  - Google 업스트림 `429 RATE_LIMIT` 또는 `503 UNAVAILABLE` 발생 시 즉시 실패로 기록하며, **자동 재시도(Retry) 0회 및 모델 자동 대체(Fallback) 0회**를 엄격히 준수합니다.
- **결과 해석 주의사항**:
  - 최대 12회의 합성 호출 통과가 장기적인 서비스 가용성이나 품질을 보증하지 않음을 명확히 보고서에 기록합니다.

---

## 3. 알고리즘 보드 잔여 미검증 관문 처리 계획

알고리즘 보드(v2.2)의 잔여 미검증 관문 3종을 성격에 따라 명확히 분류하고 후속 처리 절차를 정의합니다.

### 1) 미검증 관문 3대 분류

| 관문 ID | 구분 | 사유 및 현황 | 후속 처리 계획 및 원칙 |
| :--- | :--- | :--- | :--- |
| **BOARD-01** | **외부 자료 필요** | 사용자의 최초 첨부 비교 원본이 작업 공간에 부재함 | 로컬 기준선 98개 원본 ID 및 원본 바이트 보존(PASS)과 독립적으로, 원본 비교 파일이 제공되기 전까지 **`NOT_VERIFIED` 유지**. (임의 PASS 주장 금지) |
| **BOARD-12A** | **도구 제약** | 브라우저 보안 정책상 `file://` 직접 열람이 도구 수준에서 차단됨 | HTTP 독립 정적 구동 PASS를 `file://` 대체 PASS로 왜곡하지 않음. 우회 복사나 프로토콜 변조를 하지 않으며, 향후 허용된 로컬 뷰어가 직접 `file://`을 지원할 때만 후속 수동 검증 수행. 그 전까지 **`BLOCKED` (`NOT_VERIFIED`) 유지**. |
| **BOARD-12B** | **실행 가능 (후속 계획)** | 보드 Markdown 문서의 전용 뷰어 시각 렌더링 미실행 상태 | MD 데이터 파싱 일치(PASS)는 시각적 PASS가 아님. Codex 앱 미리보기 또는 허용된 브라우저 렌더러의 지원 여부를 확인한 후, 한글 렌더링, 15개 상세 항목, 표 정렬, 링크, 모바일 가독성 시각 검증 계획 수립. 필요 시 Gemini가 로컬 검증용 렌더 아티팩트를 작성하고 Codex가 실제 시각 검증 수행 (외부 전송 및 새 패키지 설치 0). |

### 2) 보드 해시(SHA-256) 기준선과 최신값 구별

- **최신 보드 동기화 해시 (FOLLOWUP-04 기준)**:
  - HTML SHA-256: `7a35bce520be6732fe4fdbadde5d02c118fa4e13772e4a95cf499374166bda97`
  - Markdown SHA-256: `64d1ba0923ac32dddc4465c27db8c94697355b2c2218050f44b85b86a3894573`
- **초기 감사 시점 기준선 (BOARD_AUDIT_v2.2 초기 상단)**:
  - HTML SHA-256: `c052736fe646975bd3c4afd2bcd064c9ad654badcb2355a433a11ec4de3a97f7`
  - Markdown SHA-256: `47bcbc94afc5ec0d9fc9419290b919adf7beccff76324b274b7abecb21ad86d7`
- **보존 확인**: 초기 해시는 과거 이력으로 보존되며, 최신 보드는 18개 탭, 125개 노드, 52개 명시 간선, 98개 원본 ID 무손실 보존, 15개 상세 항목 및 원본 바이트 검사 근거를 온전히 유지하고 있습니다. 새로운 실기기나 외부 교사 리뷰 PASS를 날조하지 않습니다.

---

## 4. 현재 준비 상태 종합 및 향후 단계

### 1) 기술적 검증 기준선 (과거 완료 근거 종합)
- **전체 단위/통합 테스트**: 51개 파일, 464개 시험 전체 PASS (실패 0, skip 0).
- **정적 품질 검증**: TypeScript 타입체크, lint(tsc 별칭), 프로덕션 빌드, 보호 경로 검사, diff 공백 검사 모두 PASS.
- **Cloudflare Pages 로컬 런타임**: 엔드포인트 9개 케이스(기본 403 차단, 404, 405, CORS 등) 정상 응답 PASS.
- **새 모델 실제 통합 시험**: `gemini-3.5-flash-lite` 대상 2회 실호출(1,206ms, 1,182ms)에서 유효한 구조화 JSON 및 ACCEPT 평가 확인 완료.
- *(주의: 상기 결과는 모두 FOLLOWUP-04 당시 완료된 과거 근거이며, 이번 준비 턴에서 새로 실행한 것이 아닙니다.)*

### 2) 현재 운영 미구성 및 보안 가드
- 실제 운영 Cloudflare Access 팀 도메인 및 AUD 미구성.
- 실제 프로덕션 D1 데이터베이스 바인딩 및 원격 스키마 미적용.
- 실제 계정 모델별 한도값 미주입.
- $\rightarrow$ **운영 엔드포인트 기본 차단(`BLOCKED_FAIL_CLOSED`) 상태 엄격히 유지**.

### 3) 향후 진행 절차
1. **사용자**: Google AI Studio 콘솔에서 운영 3개 모델의 실제 한도(RPM/TPM/RPD) 및 Access/D1 준비 정보 확인 및 제공.
2. **Codex**: 사용자 제공 값을 기반으로 본 검증 계획(`FOLLOWUP-05_VALIDATION_PLAN.md`)을 검토하고 최소 단위의 작은 작업 지시서로 분리.
3. **Gemini**: 지시서에 따라 오프라인 검증 도구, 합성 발화 fixture 데이터셋, 보드 시각 검증용 렌더 아티팩트 구현 (Gemini가 직접 네트워크/외부 API를 호출하지 않음).
4. **Codex**: 실제 네트워크 호출 실행, 시각 렌더링 검증, 결과 실측 및 최종 판정.

## Codex 준비 검증 결과

Gemini 초안의 존재하지 않는 평가 이름과 임의 한도 비율을 교정 지시하고 실제 스키마와 재대조했다. null 템플릿은 실제 validateModelLimitsJson 함수가 거절함을 확인했다 (`.agy-work/027_template_validation.json`). 앱·시험·의존성167파일 및 보드3개 생성물 해시 불변. 제공 키 값의 소스·문서·빌드213파일 복제0, diff 공백 PASS. 이번 생성 호출0이며 전체464시험은 FOLLOWUP-04 이력으로 유지(이번 재실행 아님). 사용자 한도값을 기다리며 운영 차단 유지, stage/commit/push/배포 없음.
