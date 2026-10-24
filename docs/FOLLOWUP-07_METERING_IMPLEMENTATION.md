# FOLLOWUP-07 액션별 안전 계량 구현 및 90% 하드캡 적용 보고서 — 2026-10-22 KST

- **작업 원칙**: Codex 감독 / Gemini 구현 / 사용자 결정
- **작업 범위**: 액션별(Chat/STT/TTS) 안전 계량 로직 구현, 90% 하드캡 클램핑 정책 도입, 런타임 JSON 작성, 검증 단위/통합 테스트 추가 (기존 문서/보드 불변, 실제 API 호출 0)
- **현재 기술 상태**: `LOCAL_CODE_VERIFIED` (과거 기준) / **`METERING_CODE_VERIFIED`** (Codex의 로컬·실제 합성 검증 결과는 [FOLLOWUP-08](FOLLOWUP-08_RESULT.md) 참조)
- **현재 운영 상태**: `BLOCKED_FAIL_CLOSED` (운영 Access AUD / 프로덕션 D1 바인딩 미구성으로 외부 호출 차단 유지)
- **최종 출시 판정**: **`PUBLIC_RELEASE_STATUS = NOT_APPROVED`**

---

## 1. 구현 개요 및 모델·타이머 불변 정책

1. **운영 3개 모델 불변 유지**:
   - 대화 (CHAT): `gemini-3.5-flash-lite` (generateContent)
   - 전사 (STT): `gemini-3.5-transcribe` (Interactions, verbatim 모드)
   - 합성 (TTS): `gemini-3.8-flash-lite-tts` (Interactions, voice: 'Kore')
2. **타이머 및 재시도 정책 불변**:
   - 서버 데드라인: CHAT 20초, STT/TTS 15초 유지
   - 자동 재시도(Retry): 0회 엄격 유지
3. **작업 및 보안 제약**:
   - 명령어 실행, git 변경/커밋, 패키지 설치, 외부 네트워크 호출, 환경변수(`.env`/`.dev.vars`) 직접 변경 일체 없음.
   - 사용자 개인정보, 음성, 학습 기록 접근 없음.

---

## 2. 90% 하드캡 정책 및 클램핑 설계 ([budgetPolicy.ts](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/server/budgetPolicy.ts))

사용자의 90% 적용 승인에 따라 공급자 공식 한도 대비 정수 내림(floor) 하드캡을 정의하고, 설정 검증 시 자동 클램핑되도록 구현했습니다.

### 1) 공급자 공식 한도 vs 90% 하드캡

| 기능 | 모델 ID | 공급자 공식 한도<br>`RPM / TPM / RPD` | 90% 하드캡 (`MODEL_HARD_CAPS_90_PERCENT`)<br>`RPM / TPM / RPD / callerRpm` |
| :--- | :--- | :---: | :---: |
| **대화 (CHAT)** | `gemini-3.5-flash-lite` | 15 / 250,000 / 500 | **13 / 225,000 / 450 / 13** |
| **전사 (STT)** | `gemini-3.5-transcribe` | 3 / 10,000 / 25 | **2 / 9,000 / 22 / 2** |
| **합성 (TTS)** | `gemini-3.8-flash-lite-tts` | 3 / 10,000 / 10 | **2 / 9,000 / 9 / 2** |

- **Floor 내림 원칙**: 2.7 rpm 및 22.5 rpd는 올림 시 90%를 초과하므로 엄격히 각각 **2**와 **22**로 내림 처리.
- **callerRpm 상한**: 사용자의 별도 선호가 없으므로 각 모델의 effective RPM 상한과 동일한 **13 / 2 / 2**로 명시.
- **클램핑 로직 (`clampModelLimitsToPolicy`)**:
  - `effectiveRpm = min(configured.rpm, hardCap.rpm)`
  - `effectiveTpm = min(configured.tpm, hardCap.tpm)`
  - `effectiveRpd = min(configured.rpd, hardCap.rpd)`
  - `effectiveCallerRpm = min(configured.callerRpm, hardCap.callerRpm, effectiveRpm)`
  - 하드캡보다 큰 사용자/테스트 fixture 설정값(예: 1e6 TPM)은 90% 하드캡(225k, 9k)으로 안전하게 제한.
  - 사용자가 더 보수적으로 지정한 작은 한도는 그대로 존중.
  - 음수, 0, null, NaN, unknown 모델, 필수 3모델 누락 시 기존과 동일하게 Fail-Closed (`null` 반환).
- **즉시 적용 가능한 JSON 프로필 생성**: [docs/CONVERSATION_MODEL_LIMITS_90_PERCENT.json](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/docs/CONVERSATION_MODEL_LIMITS_90_PERCENT.json)에 기록 (단, 파일 생성 자체가 운영 환경에 활성화되거나 크리덴셜을 주입하는 것은 아님).

---

## 3. 액션별 보수적 안전 계량 구현 ([configFactory.ts](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/server/configFactory.ts) & [budgetPolicy.ts](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/server/budgetPolicy.ts))

기존 코드에서 모든 action에 무조건 16 KiB (16,384 bytes)를 가산하여 음성 모델(9,000 TPM)이 로컬에서 100% 거절되던 결함을 해결하고, 각 액션의 특성에 맞게 계량을 분리했습니다.

### 1) CHAT 계량 (기존 안전 및 회귀 완전 보존)
- **산정 공식**: $\text{rawBodyBytes} + \text{approvedLessonJsonBytes} + 16\,\text{KiB (고정 프롬프트/스키마 마진)}$
- 기존 16 KiB 고정 마진을 온전히 유지하여, 비정상적으로 큰 본문(예: 2 MiB)이 유입될 때 225,000 TPM 상한을 초과하여 안전하게 차단되는 회귀 보호를 그대로 보존했습니다.

### 2) TTS 계량 (텍스트 UTF-8 바이트 + 고정 1,024 로컬 유닛)
- **입력 검증**: 텍스트 최대 500자([MAX_USER_TEXT_LENGTH](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/server/securityGuards.ts)) 및 비어있지 않은 문자열 선행 검증 (위반 시 즉시 `SecurityGuardError(400)`).
- **voiceName 엄격 검증 및 바이트 계량**:
  - `voiceName` 미지정 또는 빈 문자열(`""`)은 기본 voice인 `'Kore'`로 안전 매핑.
  - 객체, 숫자 등 비문자열 타입이나 공백 전용 문자열(`"   "`)은 즉시 400 거절.
  - 문자열 옵션의 길이를 trim으로 임의 할인하지 않고, 핸들러가 실제 전송하는 원본 바이트를 그대로 계량에 반영하여 긴 옵션 악용 시 9,000 TPM 상한 초과로 안전 차단.
- **산정 공식**:
  $$\text{Units} = \text{textUtf8Bytes} + \text{optionsJsonBytes (voiceName 등)} + 1024\,\text{local units}$$
- 클라이언트가 허위의 `estimatedTokens`나 `duration`을 전송하여 예약을 줄이려는 우회를 원천 차단.
- 일반적인 50~100자 발화 시 약 1,100~1,200 유닛이 산정되어, TTS 9,000 TPM 한도 내에서 안정적으로 예약 허용.

### 3) STT practical 안전 계량 (PCM16 WAV 구조 검증 + 비WAV 폴백)
- **사전 보안 가드**: Base64 2 MiB 상한, 본문 3 MiB 상한, metadata duration 30초 상한 검증.
- **PCM16 RIFF/WAV 헤더 구조 엄격 검증 (`parseAndValidateWavPcm16`)**:
  - RIFF/WAVE 매직 바이트 시그니처 판별로 MIME 위장 우회 방지 (`isRiffWaveSignature` 진입 필수 검증).
  - `riffChunkSize + 8 === audioBytes.length` 엄격 검증 (과소 축소 또는 과대 RIFF 크기 전면 차단).
  - 최대 32개 청크 순회 상한, 완전한 8바이트 헤더 검사, 파일 끝 0~7 잔여 바이트 junk 거절.
  - 홀수 크기 청크의 1바이트 패딩 정렬 검증 (누락 시 400), 유효한 패딩을 포함한 `JUNK` 등 비필수 청크는 정상 통과.
  - 중복 `fmt ` 또는 `data` 청크 거절, 지원 포맷(Linear PCM = 1), 채널 수(1~8), 16-bit 샘플, 샘플레이트(8k~192k) 검증.
  - `dataSize % blockAlign === 0` 검증 (비정렬 PCM 데이터 차단).
  - `expectedBlockAlign = numChannels * 2`, `expectedByteRate = sampleRate * blockAlign` 상호 일치 검증.
  - 실제 데이터 크기(`dataSize`)와 `byteRate`를 통해 서버에서 실제 재생 지속시간(`verifiedDuration = dataSize / byteRate`) 직접 계산.
  - **위조 메타데이터 차단**: 실제 파일 길이가 30초를 초과(예: 31초)하는 경우, 클라이언트가 JSON에 `durationSeconds: 1`로 거짓말을 해도 서버 계산에 의해 즉시 400 에러로 거절 (업스트림 호출 0, D1 예약 0).
  - **엄격 WAV 파싱 트리거**: `MIME 타입에 wav 포함` OR `처음 4바이트가 RIFF` OR `RIFF/WAVE 시그니처 일치` 시 strict WAV 파싱을 수행하여, 잘린 WAV나 WebM으로 위장한 31초 WAV가 비WAV 폴백으로 할인되는 것을 방지.
  - **WAV 예산 산정**:
    $$\text{Units} = \lceil \text{verifiedDuration} \times 64 \rceil + 1024\,\text{local units}$$
    *(Google 문서의 오디오 초당 32토큰 기준 대비 2배를 로컬 안전 계수로 적용. 3초 WAV의 경우 $\lceil 3 \times 64 \rceil + 1024 = 1,216$ 유닛으로 9,000 TPM 이내)*.
- **비WAV 압축 오디오 폴백 (WebM, OGG, raw L16 등)**:
  - 헤더 검증이 불가능한 압축 오디오는 클라이언트의 `durationSeconds`로 할인하지 않음.
  - $\text{Units} = \text{decodedBytes} + 1024$ 보수적 바이트 폴백 적용.
  - 작은 압축 오디오(예: 2~3 KB)는 9,000 TPM 내에서 수용 가능하나, 7,976바이트를 초과하는 압축 오디오는 로컬 예산 초과(429)로 안전하게 차단.
  - 단순 16 KiB 마진 삭제나 바이트를 정확한 토큰과 동일시하는 오류를 배제.

### 4) D1 원자적 예약의 모델별 발신자 격리 ([budgetAdapter.ts](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/server/budgetAdapter.ts))
- **문제점 교정**: 기존 `callerRpm` 쿼리가 `caller_hash = ?` 조건만 검사하여 서로 다른 모델 간의 호출이 합산되던 간섭 결함 수정.
- **모델별 격리 조건 추가**:
  ```sql
  AND (SELECT COUNT(*) FROM conversation_budget_reservations
       WHERE caller_hash = ? AND model = ? AND state != 'released' AND created_ms > ?) < ?;
  ```
- **효과**: 동일 발신자가 STT(분당 2회)를 소진한 후에도 독립적인 모델인 TTS(분당 2회)나 CHAT(분당 13회)이 상호 간섭 없이 독립적으로 각자의 `callerRpm` 정책에 따라 동작.

---

## 4. 추가 검증 테스트 구성

기존 테스트 스위트의 모든 단언 기대를 온전히 보존한 상태에서, 아래 두 테스트 파일에 정밀 검증을 완료했습니다:

1. **[tests/conversationBudgetPolicy.test.ts](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/tests/conversationBudgetPolicy.test.ts) (단위 테스트)**:
   - `GEMINI_PROVIDER_LIMITS`를 활용하여 90% floor 하드캡이 공급자 공식 한도(rpm, tpm, rpd)의 `Math.floor(x * 0.9)`와 정확히 일치함을 단언.
   - 1e6 등 대형 fixture 입력 시 90% 하드캡 클램핑 및 작은 사용자 한도 존중 검증.
   - CHAT 2 MiB 계량의 정확한 `rawBodyBytes + 16KiB` (`toBe`) 일치 및 225,000 TPM 초과 검증.
   - 3초 16kHz PCM16 WAV 파싱 및 1,216 유닛 정확 산정 자기검증.
   - 과소 RIFF size(<4), 4로 축소된 RIFF, 불일치 크기, 32 청크 초과, 홀수 패딩 누락, PCM blockAlign 비정렬 거절 검증.
   - 정상 `JUNK` 청크 및 1바이트 패딩이 포함된 WAV의 정상 파싱 및 지속시간 계산 검증.
   - WAV MIME 잘린 파일(10바이트) 및 WebM으로 위장한 31초 WAV의 400 거절 검증.
   - TTS voiceName 객체 및 공백 전용 문자열 400 거절, 원본 옵션 바이트 보존(공백 미할인), 8000자 초과 voice 9000 한도 초과 검증.
2. **[tests/conversationPagesIntegration.test.ts](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/tests/conversationPagesIntegration.test.ts) (엔드포인트 통합 테스트)**:
   - **테스트 21**: 미사용 `url` 인자를 실제 Interactions 엔드포인트(`https://generativelanguage.googleapis.com/v1beta/interactions`)와 비교 검증. 모의 TTS 오디오를 `pcm16ToWav`로 생성한 유효 WAV로 교체. 응답 필드를 실제 반환값인 `sttData.transcription`으로 정정.
   - **테스트 22**: 동일 caller에 대해 STT 2회 통과 후 3번째 429 차단, 중복 requestId 429 차단 검증. 이어서 동일 caller로 TTS 2회 정상 통과 후 3번째 429 차단(모델별 `callerRpm` 독립 격리) 검증.
   - **테스트 23**: 90% 프로필(RPD=9)에서 가상 clock을 매 요청마다 61,000ms씩 이동하여 RPM/TPM 영향을 분리한 상태로 일일 호출 수행. 1회차 업스트림 500 오류 실패 시에도 `consumed` 상태로 남아 쿼터가 소진(환불 0)되고, 9회 소진 후 10번째 호출이 429로 차단됨을 검증.
   - **테스트 24**: 업스트림 500 장애 시 D1 예약 상태 `consumed` 유지 및 동일 requestId 재시도 429 차단 검증.
   - **테스트 25**: 31초 초과 WAV, WebM으로 위장한 31초 WAV, 2 MiB 초과 오디오 전송 시 실제 Pages config 경로에서 즉시 400 반환 및 업스트림 0회, D1 예약 0건 검증.

---

## 5. 남은 제약사항 및 시스템 상태

1. **로컬 예산 정책의 한계**:
   - 본 계량 공식은 앱 내부의 로컬 안전 가드이며, Google의 실제 청구/계량 토큰과 일치함을 보장하지 않습니다.
   - 동일 Google Cloud 프로젝트 내에서 다른 도구나 작업이 API를 호출할 경우 D1은 이를 집계하지 못하므로, Google 프로젝트 전체 사용량의 90% 유지를 보장할 수 없습니다.
   - 압축 오디오(WebM/OGG)는 구조 검증이 불가능하여 바이트 폴백(`decodedBytes + 1024`)으로 동작하므로, 7,976바이트 초과 시 9,000 로컬 유닛/분 상한에 의해 429가 발생할 수 있습니다.
2. **운영 차단 및 보드 관문 보존**:
   - Cloudflare Access AUD 및 프로덕션 D1 바인딩은 여전히 미구성(`BLOCKED_FAIL_CLOSED`)입니다.
   - `BOARD-01` 및 `BOARD-12A`는 미검증 유지. `BOARD-12B` 최신 전용 렌더러 검증은 FOLLOWUP-08 참조.
   - **최종 출시 판정**: **`PUBLIC_RELEASE_STATUS = NOT_APPROVED`**.
3. **후속 검증 절차**:
   - Gemini 구현 단계에서는 명령·네트워크 호출을 수행하지 않았으며, 이후 Codex가 승인 범위에서 직접 실행했습니다.
   - Codex의 최종 전체 검증·실제 합성 결과 및 기기 내 WAV 정규화 추가 사항은 FOLLOWUP-08을 따릅니다.

## Codex 최종 검증 보충

전체53파일496시험·타입/lint/build/보호경로/diff PASS. 단계별 실제 로그와 소규모 공급자 안정성 결과는 FOLLOWUP-08을 따른다. 구현 단계의 0 API 호출 표기는 Gemini 작업 단계이며 Codex의 승인된 합성14호출을 포함하지 않는다. 클라이언트 기기 내 WAV 정규화와 모델별 callerRpm 격리를 포함한다.
