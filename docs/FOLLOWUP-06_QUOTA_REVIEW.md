# FOLLOWUP-06 Google AI Studio 실제 한도 확인 및 90% 예산안 진단 보고서 — 2026-10-22 KST

- **작업 원칙**: Codex 감독 / Gemini 작업자 / 사용자 결정
- **작업 범위**: Chrome AI Studio 실화면 확인 한도 진단, 90% 비활성 제안안 작성, 로컬 계량 호환 결함 분석, 단기/중기 대안 제시 (소스 변경 0, 기존 문서/보드 불변, 실호출 0)
- **현재 기술 상태**: `LOCAL_CODE_VERIFIED` / `NEW_MODEL_SYNTHETIC_INTEGRATION_PASS` (과거 3.5 Flash-Lite 2회 실호출 성공; FOLLOWUP-04 근거, 이번 턴 실호출 0)
- **현재 운영 상태**: `BLOCKED_FAIL_CLOSED` (Access AUD / 운영 DB / 한도 미구성으로 외부 호출 차단 유지)
- **최종 출시 판정**: **`PUBLIC_RELEASE_STATUS = NOT_APPROVED`**

---

## 1. Google AI Studio 화면 확인 실제 한도 및 90% 보수적 제안안

Codex가 로그인된 Chrome 환경의 Google AI Studio 콘솔에서 운영 3개 모델의 실제 한도 및 무료 등급(Unbilled Free Tier) 상태를 직접 확인했습니다.  
조회 과정에서 Google Quota 변경 요청이나 결제(Billing) 활성화 버튼 등 유료 전환 액션은 일체 수행하지 않았으며, 세 모델 모두 기존 승인 모델을 엄격히 유지합니다.

> [!IMPORTANT]
> **콘솔 화면 조회 시 주의사항 및 데이터 성격**:
> - **조회 기간**: 화면에 표시된 기간은 **최근 28일 집계**이며, 표에 표시된 사용량은 해당 기간 중 발생한 **기간 최대 피크값**입니다. **오늘 시점의 잔여 할당량이 아닙니다.**
> - **데이터 지연**: Google 콘솔의 지연 시간 정책에 따라 메트릭 데이터는 **최대 15분의 집계 지연**이 발생할 수 있습니다.
> - **개인정보 및 메타데이터 보호**: Gemini 작업 지시와 저장된 진단 요약에는 계정명·이메일·프로젝트 ID를 제외하고 비식별 모델별 한도 수치만 사용했습니다.

### 1) 공급자 실제 한도 vs 90% 정수 내림(Floor) 제안표

| 모델 구분 | 모델 ID (Allowlist) | Google 제공 한도 (Free Tier)<br>`RPM / TPM / RPD` | 90% 보수적 제안값 (Floor)<br>`RPM / TPM / RPD` | 계산 및 내림(Floor) 근거 |
| :--- | :--- | :---: | :---: | :--- |
| **대화 (CHAT)** | `gemini-3.5-flash-lite` | **15 / 250,000 / 500** | **13 / 225,000 / 450** | RPM: $15 \times 0.9 = 13.5 \rightarrow$ **13** (내림)<br>TPM: $250,000 \times 0.9 =$ **225,000**<br>RPD: $500 \times 0.9 =$ **450** |
| **전사 (STT)** | `gemini-3.5-transcribe` | **3 / 10,000 / 25** | **2 / 9,000 / 22** | RPM: $3 \times 0.9 = 2.7 \rightarrow$ **2** (내림)<br>TPM: $10,000 \times 0.9 =$ **9,000**<br>RPD: $25 \times 0.9 = 22.5 \rightarrow$ **22** (내림) |
| **합성 (TTS)** | `gemini-3.8-flash-lite-tts` | **3 / 10,000 / 10** | **2 / 9,000 / 9** | RPM: $3 \times 0.9 = 2.7 \rightarrow$ **2** (내림)<br>TPM: $10,000 \times 0.9 =$ **9,000**<br>RPD: $10 \times 0.9 =$ **9** |

- **정수 Floor 원칙**: 소수점이 발생하는 STT/TTS의 RPM (2.7)과 STT의 RPD (22.5)는 정수 요청 규격에 따라 각각 **2**와 **22**로 엄격히 내림(Floor)했습니다. 올림(Ceil) 시 90%를 초과하게 되므로 올림을 금지합니다.
- **RPM 2의 런타임 의미**: D1 예산 어댑터의 롤링 60초 윈도우(`created_ms > now - 60000`) 내에서 **최대 2회**까지만 호출이 허용됨을 의미합니다.
- **`callerRpm` 미지정 처리**: 사용자가 발신자당 한도(`callerRpm`)를 별도 지정하지 않았으므로, 임의의 기본값(예: 1 등)을 추측하여 채우지 않고 비활성 제안 JSON에서 `callerRpm: null`로 유지하여 Fail-Closed 차단 상태를 보존했습니다.
- **제안 파일 생성**: 본 제안 수치는 [docs/CONVERSATION_LIMITS_90_PERCENT_PROPOSAL.json](C:/Users/YECHAN/workspace/TOEIC_STUDY/docs/CONVERSATION_LIMITS_90_PERCENT_PROPOSAL.json)에 기록되었으며, 기존 운영 템플릿([docs/CONVERSATION_MODEL_LIMITS_TEMPLATE.json](C:/Users/YECHAN/workspace/TOEIC_STUDY/docs/CONVERSATION_MODEL_LIMITS_TEMPLATE.json))은 일체 덮어쓰지 않았습니다.

---

## 2. 턴당 할당량 병목 분석 (Chat 450 vs Voice 22/9)

학습자가 1턴을 대화할 때마다 클라우드 STT 1회와 클라우드 TTS 1회를 순차 호출한다고 가정할 경우의 일일 가용량입니다:

1. **프로젝트 공유 일일 가용 턴수 = 최대 9턴**:
   - CHAT 일일 한도(450 RPD)와 STT 일일 한도(22 RPD)에 비해, **TTS의 일일 한도는 9 RPD로 극히 협소**합니다.
   - 따라서 음성 대화 1턴마다 클라우드 TTS를 1회 사용하는 구조라면, **동일 Google Cloud 프로젝트 전체에서 하루에 진행할 수 있는 총 대화 턴수는 최대 9턴에 불과**합니다.
   - 만약 튜터 발화 외에 핵심 표현 다시 듣기, 초기 진입 안내 음성 등 다른 곳에서 TTS를 호출하거나, 업스트림 통신 실패로 쿼터만 소진된 경우가 있다면 실제 가용 턴수는 **9턴 미만**으로 더욱 축소됩니다.
2. **비대칭 병목 구조**:
   - 텍스트 대화(CHAT)는 하루 450회(분당 13회)로 1인 테스트나 소규모 검증에 충분한 여유가 있으나,
   - 음성 입출력(STT 22회 / TTS 9회)은 대화 모델과 동일한 비율로 1:1 결합하기에 극심한 병목을 유발합니다.

---

## 3. 코드 계량 호환 결함 분석 (`calculateConservativeEstimatedUnits`)

현재 소스 코드에 위 90% 제안값(STT TPM 9,000 / TTS TPM 9,000)을 그대로 주입할 경우, **모든 STT 및 TTS 요청이 로컬에서 100% 즉시 거절되는 기술적 결함**이 존재합니다.

### 1) 결함 위치 및 로직
- **대상 파일 및 함수**: [src/features/conversation/server/configFactory.ts](C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/server/configFactory.ts) `calculateConservativeEstimatedUnits`
```typescript
// src/features/conversation/server/configFactory.ts (Line 163~178)
export function calculateConservativeEstimatedUnits(
  action: string,
  rawBodyBytes: number,
  lessonId?: string
): number {
  let lessonJsonBytes = 0;
  if (action === 'chat' && typeof lessonId === 'string') {
    const lesson = getLessonById(lessonId);
    if (lesson) {
      lessonJsonBytes = new TextEncoder().encode(JSON.stringify(lesson)).byteLength;
    }
  }

  const fixedOverheadBytes = 16 * 1024; // 16 KiB 고정 프롬프트 및 JSON 스키마 마진
  return rawBodyBytes + lessonJsonBytes + fixedOverheadBytes;
}
```

### 2) 결함 메커니즘
1. `calculateConservativeEstimatedUnits`는 `action`의 종류(chat, transcribe, tts)와 무관하게 모든 요청에 **기본 16 KiB ($16 \times 1,024 = 16,384$ 유닛)의 고정 오버헤드(`fixedOverheadBytes`)**를 더합니다.
2. 음성 전사(STT)나 음성 합성(TTS)의 실제 HTTP 바디 바이트 수(`rawBodyBytes`)가 아무리 작더라도, 계산 결과는 **항상 최소 16,384 이상**이 됩니다.
3. [src/features/conversation/server/budgetAdapter.ts](C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/server/budgetAdapter.ts)의 원자적 예약 SQL 쿼리는 다음과 같이 TPM 한도를 검사합니다:
   ```sql
   AND (SELECT COALESCE(SUM(units), 0) FROM conversation_budget_reservations
        WHERE model = ? AND state != 'released' AND created_ms > ?) + ? <= ?
   ```
4. 바인딩되는 조건: `(기존 분당 누적 유닛 0 + 신규 예약 유닛 최소 16,384) <= TPM 한도(9,000)`.
5. $16,384 \le 9,000$은 항상 **False**이므로, 0개의 행이 INSERT되어 `reserve()`가 항상 `{ allowed: false, reason: 'BUDGET_LIMIT_EXCEEDED_OR_DUPLICATE_REQUEST' }`를 반환합니다.
6. 공급자 원래 한도인 10,000 TPM을 적용하더라도 $16,384 \le 10,000$은 성립하지 않으므로 전면 차단됩니다.
7. **결과**: 업스트림 Google API로 전달되는 실제 네트워크 호출은 0건이 되며, 모든 음성 요청은 로컬 D1 어댑터 단계에서 차단됩니다.

### 3) 분석 원칙 및 주의사항
- 이것은 Google의 공급자 쿼터 문제가 아닌, **앱 내부의 보수적 로컬 계량 로직이 음성 모델의 작은 TPM(10k / 9k)과 호환되지 않는 로컬 설계 결함**입니다.
- 단, 단순히 바이트를 토큰과 동일시하거나, 안전 마진인 `fixedOverheadBytes`를 무작정 0으로 지워서 억지로 통과시키는 임기응변은 금지됩니다. (현재 턴에서는 소스 코드를 일체 수정하지 않고 원인 위치만 인용 보고함).

---

## 4. 권장 단기 운용 방안 (텍스트 중심 + 기존 기능 활용)

현재 가용 쿼터(RPD 9)와 로컬 16k 호환 결함을 고려할 때, 당장 안정적으로 학습 서비스를 유지하기 위한 권장 단기 방안입니다:

1. **텍스트 대화(CHAT) 기본 운용**:
   - CHAT 모델은 일일 450회(분당 13회)의 요청 예산을 가지며, 텍스트 기반 롤플레잉 및 튜터 교정 학습을 핵심 축으로 유지합니다.
2. **입력 방식: 키보드 입력 및 기기 녹음 자기점검**:
   - 학습자의 음성은 브라우저의 [MediaRecorder](C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/services/voiceInput.ts)를 통해 로컬에서 녹음하고 학습자가 직접 자신의 발화를 다시 들어보며 자가 점검하는 방식을 기본으로 합니다.
   - 클라우드 STT는 학습자가 명시적으로 "AI 전사 확인"을 원할 때만 선택적으로 1회 호출하도록 분리합니다.
3. **출력 방식: 기존 [voiceOutput.ts](C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/services/voiceOutput.ts) 캐시 및 브라우저 TTS Fallback 활용**:
   - 이미 코드베이스에 구현되어 있는 고정 핵심 표현 메모리 캐시(`fixedExpressionCache`, 제한된 메모리 캐시)를 적극 재사용합니다 (새 기능이 아님).
   - 클라우드 TTS 쿼터 소진 시 브라우저 내장 음성 합성(`window.speechSynthesis`)으로 자연스럽게 폴백(Fallback)되도록 유도합니다.
4. **브라우저 음성 엔진의 보안·오프라인 한계 인식**:
   - 브라우저 STT(Web Speech API)는 기기 온디바이스 처리가 보장되지 않으며, 브라우저 벤더(Google/Apple 등)의 외부 서버로 음성이 자동 전송될 수 있으므로 자동 대체재로 사용하지 않습니다.
   - 브라우저 내장 TTS(`speechSynthesis`) 역시 OS 및 설치된 보이스 엔진에 따라 네트워크 통신을 수반할 수 있으므로 '완전 오프라인 안전'으로 왜곡하지 않으며, 개인정보 취급 원칙을 유지합니다.
5. **예산 소진 시 UI 진행 안내 (제안 사항)**:
   - 일일 9회 음성 예산 소진 시, 서비스가 멈추거나 에러로 튕기지 않고 "오늘의 AI 원어민 음성 쿼터가 소진되어 텍스트와 기기 음성으로 대화를 계속합니다"라는 명확한 진행 안내를 제공하는 UX가 필요합니다 (이는 향후 UI 구현 과제이며 현재 구현된 상태로 주장하지 않음).
6. **API TTS 호출 최적화 및 정적 오디오 사전 생성 검토**:
   - 매 턴마다 자동 재생(autoplay)으로 클라우드 API를 호출하는 정책은 금지하며, 학습자가 핵심 표현 듣기를 명시적으로 클릭할 때만 호출합니다.
   - 수업 고정 예문의 정적 오디오 사전 생성(Pre-generation) 및 CDN 배포는 API 비용, 약관, 콘텐츠 재사용 승인 검토가 선행되어야 하며, 사용자 승인 없이 임의 생성하지 않습니다. (클라우드 음성 기능 자체를 완전히 폐기한 것으로 왜곡하지 않음).

---

## 5. 중기 별도 선택지: AI Studio Live 모델 검토 (실제 관찰 및 제약사항)

Chrome AI Studio 콘솔 화면에서 확인한 결과, 양방향 실시간 모델(Live Models)은 표상에서 **RPM/RPD가 '무제한(Unlimited)'**으로 표시되고 **TPM만 유한(예: 3.8 Live 65K, 3.5 Transcribe Live 20K)**한 형태로 나타납니다.

### 1) 기술적 차이 및 주의사항
- **아키텍처 불일치**: 현재 앱의 통신 파이프라인은 REST 엔드포인트 기반의 `STT (Interactions) -> CHAT (generateContent) -> TTS (Interactions)` 순차 구조입니다.
- **Live API 규격**: [Google Live API 공식 문서](https://ai.google.dev/gemini-api/docs/live-api)에 따르면, Live API는 WebSocket 기반 양방향 세션, 실시간 오디오 스트리밍, 임시 자격증명(Ephemeral Tokens), 음성 개입(Voice Interruption) 처리를 전제로 합니다.
- **축어적 전사 왜곡 위험**: Live 모델은 대화형으로 응답하도록 튜닝되어 있어, 학습자의 발화를 있는 그대로 정확히 받아적는 축어적(Verbatim) 전사가 아니라 의미 중심 재해석이나 요약이 발생할 위험이 있습니다.
- **무제한 무료 보장 불가**: 콘솔의 'Unlimited' 표기는 분당/일일 요청 건수 제한이 고정되지 않았음을 뜻할 뿐, 동시 세션 수, 세션 최대 유지 시간, 오디오 스트리밍 대역폭 소진에 따른 실제 사용량 통제 정책이 따릅니다.

### 2) 운영 원칙
- 현재 단계에서 Live 모델로의 전환이나 시험은 **전혀 승인되지 않았습니다**.
- 쿼터가 부족하다고 해서 복수 계정 생성, 프로젝트 분산, 다중 API 키 라운드로빈 등 비정상적인 우회 방식을 취하지 않으며, 유료 종량제 결제 증설도 절대 진행하지 않습니다.
- 향후 Live 모델 검토는 공식 기술 사양 분석과 사용자 승인이 완비된 후 별도 과제로 다룹니다. (지금 몰래 모델을 바꾸거나 호출하지 않음).

---

## 6. 안전한 예산 후속 엔지니어링 계획 (소스 변경 0, 향후 과제)

향후 STT/TTS의 작은 한도(TPM 9,000 / RPD 9~22)를 수용하기 위해 필요한 엔지니어링 로드맵입니다:

1. **Action별 예산 산정 로직 분리**:
   - `calculateConservativeEstimatedUnits`에서 chat, transcribe, tts의 산정 공식을 완전히 분리.
   - STT: 오디오 길이(duration, 최대 30초) 및 실제 바디 바이트 기준 경량 산정.
   - TTS: 검증된 텍스트 길이와 실제 제공자 요청 바이트를 기준으로 산정하는 방안 조사(현재 500자 제한은 바이트 수와 다름).
2. **토큰 계량 공식 지원 여부 확인**:
   - Google Interactions API(`gemini-3.5-transcribe`, `gemini-3.8-flash-lite-tts`)가 `countTokens` 엔드포인트나 `usageMetadata`를 공식 지원하는지 공식 문서를 통해 선행 검증.
   - 단, 추가 계량 API 호출 자체가 쿼터 소진과 네트워크 지연을 유발할 수 있으므로, 정확한 토큰 수 예측을 맹신하지 않고 안전한 바이트 기반 오프라인 상한을 도출.
3. **기존 보안 가드 철저 보존**:
   - 요청 바디 크기 제한([MAX_BODY_BYTES](C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/server/securityGuards.ts)), 오디오 길이 제한(30초 / 2 MiB), 중복 요청 PK 방지, 원자적 D1 트랜잭션, 실패 시 쿼터 소진 처리 등 모든 보안 가드는 변함없이 유지.
   - 9k 범위 내에서 수용 가능한 작은 요청과 비정상적인 대용량 요청의 거절 경계를 의미 있는 오프라인 단위 테스트로 철저히 검증.
   - *(현재 턴 소스 변경은 0건으로 유지)*.

---

## 7. 예산 통제 경계 및 시스템 상태 보존 확인

1. **D1 예산 어댑터의 한계 인식**:
   - 본 애플리케이션의 D1 예산 시스템은 **오직 이 웹앱을 통해 인입되는 요청만 집계**합니다.
   - 동일한 Google Cloud 프로젝트 내에서 다른 도구, IDE 확장, 직접 CLI/curl 호출이 발생할 경우 D1은 이를 감지할 수 없으므로, Google 프로젝트 전체 사용량이 90% 이하로 유지됨을 보장하지 못합니다.
   - 새로 생성된 로컬 D1 데이터베이스는 오늘 이전에 외부에서 발생한 사용량 이력을 알지 못합니다.
   - 앱 내부의 한도 설정은 로컬 차단을 제어할 뿐, Google 업스트림 측의 일시적 과부하(`503 UNAVAILABLE`)나 글로벌 쿼터 부족을 해결해주지 않습니다.
2. **검증 관문 및 기준선 보존**:
   - **대화 안정성 시험**: 실제 잔여 쿼터와 사용자 호출 계획이 확정된 후, CHAT 모델 대상 합성 시험을 안전하게 실행합니다.
   - **음성 운영 활성화 불가**: 위의 16k 호환 결함이 코드상에서 해결되기 전까지 음성 모델(STT/TTS) 운영 활성화는 기술적으로 불가능합니다.
   - **인증 및 DB 대기**: Cloudflare Access AUD 및 프로덕션 D1 바인딩은 여전히 미구성 상태(`BLOCKED_FAIL_CLOSED`)를 유지합니다.
   - **알고리즘 보드 잔여 관문**:
     - `BOARD-01` (비교 원본 파일 미제공): `NOT_VERIFIED` 유지.
     - `BOARD-12A` (브라우저 `file://` 도구 제약): `BLOCKED` (`NOT_VERIFIED`) 유지.
     - `BOARD-12B` (Markdown 전용 뷰어 시각 렌더링): `NOT_VERIFIED` 유지.
   - **실호출 표본**: FOLLOWUP-04 당시의 2회 실호출 성공은 과거의 기준선 표본이며, 이번 턴에서의 새로운 실호출은 0회입니다.

---

## 8. 공식 기술 문서 근거 (Codex 2026-10-22 확인)

- [Google Gemini API Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits) (프로젝트 단위 Quota 공유, 태평양 시간 자정 RPD 리셋, 용량 미보장)
- [Google Gemini Live API Overview](https://ai.google.dev/gemini-api/docs/live-api) (WebSocket 기반 양방향 세션 구조)
- [Google Gemini Transcribe Guide](https://ai.google.dev/gemini-api/docs/transcribe) (축어적 음성 전사 엔드포인트)
- [Google Gemini Speech Generation Guide](https://ai.google.dev/gemini-api/docs/speech-generation) (오디오 생성 규격)

## Codex 검증 보충

메모리 SQLite의 실제 D1 어댑터로 최소 음성 예약량16384 > 9000을 재현했다. 두 모델 모두 예약 거절·예산행0·네트워크0이었다 (`.agy-work/028_quota_proof.json`). 이는 설정안을 활성화한 결과가 아니라 비호환성을 입증한 격리 시험이다. 90% 숫자는 정수 내림과 대조했으며 원래 공급자 한도·모델·예산 거절 사유·캐시 설명을 실제 코드와 재대조했다. 제품 소스 변경 및 새 실제 생성 호출 없음.
