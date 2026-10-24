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
- **시스템 프롬프트 컴팩트화 및 운영 결함 보완:**
  - 중복 근거 문구를 압축하여 프롬프트 길이를 1,130자(Codex 실제 소스 계수, 1,500자 미만)로 컴팩트하게 정돈하면서, 실운영 합성 결과(`.agy-work/286_speech_live.json`)에서 발견된 실결함 교정 지침 반영.
  - 채택된 후보(selected candidate) 기준으로만 문법/완성도 및 피드백을 평가하도록 명시 (원문 index 0의 STT 대안 어휘를 학습자의 어휘 실수로 지적하거나 'couple 대신 coffee' 등으로 탓하지 않음).
  - 온전한 문장이 채택된 경우 `sentenceComplete=true` 부여 및 한국어 피드백에서 대안 어휘를 탓하지 않는 올바른 칭찬/교정을 지시.
  - 어휘 의도 엄격 보존: 발화에 없는 구체적 음료명(coffee 등)이나 인명을 모범답안(`modelAnswerEn`)에 임의 날조/추가 금지 ('I would like a cup.'은 그대로 보존, 모호할 경우 한국어로 음료 되묻기).
  - `uncertain` 시 미발화된 예시 인명/문장('My name is John' 등) 날조 금지, 채택/원문 텍스트 유지 및 한국어로 재발화만 요청.
- Gemini 반환 JSON 파싱 시 `recognizedCandidateIndex`의 유효 범위 검증(502 방어).

---

## 3. 한계 및 미검증 사항 (Preserved Limitations)

- **운영 1차 실측 발견 결함 및 재검증 대기 (Live Discovery Unresolved):**
  - 운영 배포 후 수집된 실측 합성 결과(`.agy-work/286_speech_live.json`)에서 1) 후보 채택 후 원문 STT 어휘 탓 및 `sentenceComplete=false` 오판, 2) 'a cup' 발화에 'a cup of coffee' 모범답안 날조, 3) 불확실 발화에 'My name is John' 모범답안 날조 현상이 발견되었습니다.
  - 본 프롬프트 보강을 통해 지침을 명확화하였으나, Codex 재시험 및 실제 모델 재평가 검증이 완료될 때까지 해당 결함은 **해결 대기(not yet resolved until Codex retest)** 상태로 문서화하여 관리합니다.
- **후보군 부재 시의 한계:**
  - 브라우저 네이티브 STT가 제공한 1~3순위 후보군 어디에도 올바른 단어나 이름이 들어있지 않은 경우(예: 완전히 엉뚱한 영어 단어들만 생성된 경우), 인위적으로 교재 예문을 주입하거나 단어를 추측하지 않으므로 여전히 `uncertain`으로 처리됩니다.
- **실물 단말 미검증 상태 유지:**
  - 본 구현은 순수 소스 레벨의 논리적 격리 및 단일 호출 파이프라인 연동이며, 실제 모바일 S25 단말에서의 네이티브 음성 인식률 수치나 브라우저별 N-best 생성 품질은 측정/보장되지 않았습니다.
  - 실물 S25, PWA/iOS, 강사 검토, 외부 검토, `BOARD-01`, `BOARD-12A` 항목은 계속 미검증 상태로 유지됩니다.

## 4. Codex 독립 검증 (배포 전)
- `scripts/verify.ps1`: 77개 파일 / 760개 시험 PASS. 타입·린트·빌드·보호 경로·공백 검사 PASS.
- 신규 28개 후보 연동 시험과 화면 원문/문맥 표시 시험 포함. 잘못된 후보 인덱스·텍스트 혼입·타이머 누수·변경 가능한 배열·과소 예산 예약·왜곡 원문 캐시를 검증.
- 민감값 검사 289파일 일치 0. 단어 DB와 저장소 변경 없음.
- 운영 모델의 합성 문장 응답과 D1 차감은 배포 후 별도 확인한다. 실제 S25 발음 인식률 PASS로 해석하지 않는다.
- 근거: [Web Speech API 명세](https://webaudio.github.io/web-speech-api/#dom-speechrecognition-maxalternatives). maxAlternatives는 반환 후보의 상한이며 후보 3개를 보장하지 않는다.
