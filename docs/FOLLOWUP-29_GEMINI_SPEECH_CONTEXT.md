# FOLLOWUP-29: 브라우저 N-best 대안군 단일 AI 호출 연동 및 안전성 감사

**Date:** 2026-10-24 KST  
**Author:** Gemini (Implementer)  
**Supervision & Verification:** Codex (Test / Audit / Commit / Deploy)  
**Scope:** Canonical Main Root (`https://voca-study-akf.pages.dev/`)

---

## 1. 개요 및 이전 조사 표현 정정

1. **조사 표현 정정 (Correction):**
   - 이전 조사 보고에서 `webkitSpeechGrammarList`를 언급했으나, 모바일 Chromium에서 `SpeechRecognition.phrases` 속성은 온디바이스(on-device) 모델팩이 없으면 무시되거나 실험적 상태입니다.
   - 또한 N-best 후보군 활용은 "유일한 무료 해결책"이 아니라 "현재 아키텍처 및 무료 제약 조건에서 가장 부작용이 적고 단일 호출로 통합 가능한 경량 방식"으로 정확히 정의합니다.
2. **목표:**
   - 추가 과금 API, 별도 STT 호출, 음성 파일 업로드 없이 브라우저 Web Speech API가 내부적으로 수집하는 N-best 대안군(`alternatives`)을 **동일한 단일 Gemini 호출**에 안전하게 전달하여, 초급자 발음(예: coffee vs couple) 및 한국어 고유명사가 2~3순위 후보군에 존재할 때 구제할 수 있도록 지원.

---

## 2. 변경된 파일 및 구현 상세

### 2.1 `src/features/conversation/coach/coachProtocol.ts`
- `CoachInputContext` 인터페이스 정의 및 export:
  ```typescript
  export interface CoachInputContext {
    inputSource: 'voice' | 'text';
    candidates?: string[];
  }
  ```
- `CoachEvaluation`에 `recognizedCandidateIndex?: number` 선택적 필드 추가.
- `CoachRequest`에 `inputSource?: 'voice' | 'text'`, `candidates?: string[]` 선택적 필드 추가.

### 2.2 `src/features/conversation/coach/publicCoachApi.ts`
- `evaluate` 메서드 4번째 인자로 `context?: CoachInputContext` 허용 (기존 3개 인자 호출과 100% 하위 호환).
- **타이머 누수 방지 및 사전 유효성 검사 (Review Fix):**
  - `context` 검증과 방어적 복사(`clonedCandidates`)를 `crypto.randomUUID()`, `this.cancel()`, `deadlinePromise` 타이머 생성 **이전에 즉시 수행**.
  - 잘못된 `context` 전달 시 기존 진행 중인 요청을 취소하지 않으며 25초 타이머가 유실되는 문제를 완전 차단.
  - `inputSource === 'text'`인 경우 `candidates` 금지, 배열 길이 2~3, 중복 없음, 각 문자열 1~500자, `candidates[0] === trimmedAnswer`.
- 응답 수신 시 `recognizedCandidateIndex`가 전송된 `candidates` 범위 내(0 ~ candidates.length - 1)인지 엄격 검증. 후보군이 없을 때 0 이외의 인덱스는 에러 처리.

### 2.3 `src/features/conversation/coach/CoachTutorController.ts`
- `deps.evaluate`의 3번째 인자로 `context?: CoachInputContext`를 전달할 수 있도록 인터페이스 확장하되, `context`가 없을 때는 2개 인자로만 호출하여 기존 테스트 및 목업과의 호환성 유지.
- `listenEnglishWithSilenceRetry`:
  - `onAlternatives` 수신 시 `alts.slice(0, 3)`으로 즉시 스냅샷 복사(호출자 측 배열 앨리어스 차단).
  - 캡처 완료 후 `text === localCandidates[0]` 일치 여부, 유효성 검증(최대 3개, 각 500자 이하 고유 문자열)을 통과한 경우에만 반환 객체에 `candidates` 첨부. 단어 잘림(truncation) 없이 원본 보존.
- 초기 답변 및 반복 발화 평가 시:
  - 후보군이 2개 이상일 때만 `context: { inputSource: 'voice', candidates }`를 구성하여 평가 요청.
  - 텍스트 직접 제출(`submitText`) 시에는 `candidates`를 절대 전달하지 않음.
- **캐시 및 표시 격리 (Review Fix):**
  - `recognizedCandidateIndex > 0`인 non-top 구제 판정인 경우, **왜곡되었던 원본 발화(`raw answer`)로 캐시를 시딩하지 않음**.
  - `uncertain`인 경우 캐시 저장 절대 금지.
  - **오직 `meaning === 'relevant'` 판정일 때만 `understoodText`를 설정**하여 오답/불확실 상태에서 승인을 암시하지 않도록 보장.
  - 새 캡처/시작/일시정지/텍스트 제출 시 `understoodText`를 즉시 `undefined`로 초기화.

### 2.4 `src/features/conversation/components/CoachTutorView.tsx`
- `api.evaluate` 호출 시 전달받은 `context`가 존재할 때만 4번째 인자로 전달.
- 화면 렌더링 시 `understoodText`가 존재하고 `recognizedText`와 다를 때, 원본 인식 문장 아래에 작은 보조 라벨(`문맥으로 이해한 답변: "[understoodText]"`)로 안전하게 표시.
- 진단 패널 버전 문자열을 `paced-coach-10s-v9`로 상향.

### 2.5 `src/features/conversation/server/publicCoachHandler.ts`
- 4 KiB 본문 읽기 상한 내에서 `inputSource` 및 `candidates`를 사전 검증:
  - text 모드에 candidates 전달 시 400 거부.
  - 배열 형태, 길이(2~3), 빈 문자열/500자 초과/중복 여부, `candidates[0] !== trimmedAnswer` 검증.
- 예산 예약(`estimatedUnits`) 시 `candidates`의 실제 UTF-8 바이트 수를 합산 계산하여 과소 계량 방지.
- **시스템 프롬프트 컴팩트화 및 후보 선택 Few-Shot 도입:**
  - 중복 문구를 압축하여 목표 상한(<=1400자) 내로 컴팩트하게 정돈. (정확한 글자 수는 Codex 측정에 위임)
  - candidates 중 채택할 후보를 먼저 결정(FIRST)하고, candidates 경계 밖의 발음 유사 어휘로 임의 재작성하지 않도록 명시.
  - 네이티브 후보군 경계 내 Few-Shot 예시 추가:
    - `['I would like couple, please.', 'I would like coffee, please.']` -> index 1, relevant/true
    - `['I had toast with gym.', 'I had toast with jam.']` -> index 1, relevant/true
    - `['I would like a cup.', 'I would like coffee.']` -> index 0, relevant/true
    - (주의: 상기 예시는 원칙 전달용이며 실제 정답 어휘는 반드시 전달된 candidates 내에 있어야 함)
  - 기존 필수 요구사항 보존: `six`, `Coffee, please`, `I has coffee`, 낯선 한국어 이름 표기 보존, 숫자/부정어 엄격성, `maxOutputTokens: 512`, JSON 스키마.
- **구조적 후보 우선 생성 가설 및 `responseSchema` 적용 (Structural Selection-Order Hypothesis):**
  - AI 반환 JSON 프롬프트 및 `generationConfig.responseSchema`의 속성 순서(`propertyOrdering`)에서 `recognizedCandidateIndex`를 최우선(맨 앞)으로 재배치:
    - 프롬프트 JSON 일러스트레이션: `{"recognizedCandidateIndex":0|1|2,"meaning":"relevant"|"needs_help"|"uncertain", ...}`
    - `generationConfig.responseSchema`: `recognizedCandidateIndex`(integer, minimum 0, maximum 후보수-1)를 첫 번째 프로퍼티로 지정하고 `propertyOrdering`을 강제하여 디코더가 의미/피드백 생성 이전에 후보군 선택을 먼저 결정하도록 유도.
  - 본 조치는 디코더의 생성 순서 앵커링을 검증하기 위한 최소한의 구조적 가설 적용이며, 정확도 완전 보장이 입증된 것은 아니므로 **Codex 실측 재검증 대기(pending retest)** 상태로 유지.
- **결정론적 서버 안전 가드 (Deterministic Server Guard):**
  - AI 반환 JSON 파싱 및 인덱스 유효성 검증 직후 서버 레벨에서 결정론적 교정 적용:
  - 1) `meaning === 'relevant'`이고 `sentenceComplete === true`일 때: 채택된 문장이 200자 이하이며 영문 알파벳 포함(`/[a-zA-Z]/`) 및 한글 부재(`!/[가-힣ㄱ-ㅎㅏ-ㅣ]/`) 조건을 모두 만족하는 경우에만 `modelAnswerEn`을 해당 채택 문장 원본으로 확정 (한글 직접 입력 등 미충족 시 검증된 기존 AI 모범답안 유지).
  - 2) 1순위 왜곡 구제(non-top recovery: `recognizedCandidateIndex > 0`)이고 `relevant`인 경우: 탈락한 STT 어휘(couple, gym 등)를 학습자 실수로 비난하지 않고 한국어 피드백(`feedbackKo`) 적용. TTS 영문 모범답안은 컨트롤러에서 별도로 낭독하므로 한국어 피드백 내 영문 모범답안을 삽입하지 않고 한국어 전용 문구(`sentenceComplete` 시 온전문장 칭찬, 아닐 시 '뜻은 잘 전달됐어요. 이어지는 예문처럼 완전한 문장으로 말해 보세요.')로 제공.
  - 모델의 meaning/sentenceComplete/index 판정 결정 자체는 왜곡하지 않으며, 텍스트 직접 입력 및 기존 에러/예산 처리는 100% 동일하게 유지.

---

## 3. 한계 및 미검증 사항 (Preserved Limitations)

- **운영 실측 1·2차 결함 및 재검증 대기 (Live Discovery 2nd Failure Pending Retest):**
  - 운영 배포 후 수집된 실측 합성 결과(`.agy-work/286_speech_live.json`, `.agy-work/289_speech_live.json`)에서 지침만으로는 모델이 candidates[1]의 `coffee` 대신 0순위 `couple`을 채택하고 발음 유사 어휘 `cup`을 날조하거나, 1순위 채택 시에도 피드백에서 여전히 STT 오류(`gym->jam`)를 학습자 탓으로 돌리는 현상이 확인되었습니다.
  - 본 Few-Shot 프롬프트 보강 및 서버 결정론적 가드(`finalModelAnswerEn`, `finalFeedbackKo`)를 도입하였으나, Codex 재시험 및 실제 배포 재평가 검증이 완료될 때까지 해당 결함은 **해결 대기(pending retest)** 상태로 유지합니다.
- **후보군 부재 시의 한계:**
  - 브라우저의 실제 후보 어디에도 의도한 단어나 이름이 없으면 자동 복원을 보장할 수 없습니다. 의미가 불명확하면 재발화를 요청하지만, 문맥에 맞는 다른 단어로 오인식되면 이를 탐지하지 못할 수도 있습니다. 교재 정답이나 특정 이름을 인식 원문에 주입하지 않습니다.
- **실물 단말 미검증 상태 유지:**
  - 본 구현은 순수 소스 레벨의 논리적 격리 및 단일 호출 파이프라인 연동이며, 실제 모바일 S25 단말에서의 네이티브 음성 인식률 수치나 브라우저별 N-best 생성 품질은 측정/보장되지 않았습니다.
  - 실물 S25, PWA/iOS, 강사 검토, 외부 검토, `BOARD-01`, `BOARD-12A` 항목은 계속 미검증 상태로 유지됩니다.

## 4. Codex 독립 검증 (배포 전)
- `scripts/verify.ps1`: 77개 파일 / 767개 시험 PASS. 타입·린트·빌드·보호 경로·공백 검사 PASS.
- 신규 35개 후보 연동 시험과 화면 원문/문맥 표시 시험 포함. 잘못된 후보 인덱스·텍스트 혼입·타이머 누수·변경 가능한 배열·과소 예산 예약·왜곡 원문 캐시를 검증.
- 민감값 검사 289파일 일치 0. 단어 DB와 저장소 변경 없음.
- 운영 모델의 합성 문장 응답과 D1 차감은 배포 후 별도 확인한다. 실제 S25 발음 인식률 PASS로 해석하지 않는다.
- 근거: [Web Speech API 명세](https://webaudio.github.io/web-speech-api/#dom-speechrecognition-maxalternatives). maxAlternatives는 반환 후보의 상한이며 후보 3개를 보장하지 않는다.

## 5. Codex 실제 운영 대조 및 남은 한계
- 구현은 Gemini 구독 CLI, 독립 시험·검토·운영 검증은 Codex가 담당했다. 실제 사용자 음성·이름은 시험에 사용하지 않았다.
- 운영 합성 시험 세 묶음 총 **28회**. D1 소비 **28건 / 보수적 예산 단위 463,427**으로 요청별 실제 UTF-8 후보 입력 계산과 정확히 일치했다. Gemini STT/TTS 예약은 **0건**. 기존 무료 90% 상한은 유지했다.
- 최신 묶음: jam, 프롬프트 예시에 없는 tennis·bread 후보 구제, cup 의도·한국식 합성 가명·숫자·부정 보존을 확인했다. 대안 채택 후 원문을 탓하는 피드백과 온전한 문장에 새 명사를 추가하는 응답은 서버 보존 장치로 막았다.
- **coffee 구제 안정성 미달**: 같은 후보 묶음에서도 coffee를 선택하거나 uncertain으로 재발화를 요청하는 차이가 남았다. 최신 시험에서는 uncertain으로 정지하고 진도 0을 유지했다. 완전 해결 또는 높은 실기기 인식률로 보고하지 않는다.
- 최신 묶음의 불명확 발화 1회는 **20초 504 시간 초과**였다. 자동 재호출 없이 예산 1건이 소비되었다. 해당 응답을 성공으로 세지 않았다.
- 후보 번호가 출력 JSON 맨 마지막인 구조를 먼저 생성하는 방식으로 바꾸기 위해, `recognizedCandidateIndex`를 첫 번째로 배치하고 `responseSchema`의 `propertyOrdering`을 적용한 구조적 가설 구현을 완료했다. 이는 Codex 실측 재검증 대상이며 정확도 완전 보장으로 보지 않는다.
- S25 실제 발음, 후보가 하나만 반환되거나 전부 틀린 경우, 장기 안정성은 미검증이다. 기존 사람·외부·보드 수동 관문도 유지한다.
