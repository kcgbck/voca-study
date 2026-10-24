# FOLLOWUP-32: 음성 단일 후보 진단 보존 및 음성 전용 피드백 안전 가드

**일시:** 2026-10-24 KST  
**작성자:** Gemini (Implementer)  
**감독/검증:** Codex (Supervisor / Independent Verification)  
**대상 파일:**
- `src/features/conversation/coach/CoachTutorController.ts`
- `src/features/conversation/server/publicCoachHandler.ts`
- `src/features/conversation/coach/coachDiagnostics.ts`

---

## 1. 개요 및 배경

Android Chrome (예: 갤럭시 S25 등 모바일 환경)에서 무료 브라우저 네이티브 Web Speech API로 음성 회화 연습 시 관찰된 다음 현상들을 해결하기 위한 구현입니다:
1. 브라우저 STT가 단 1개의 전사 결과만 제공했을 때, 컨트롤러 레벨에서 단일 후보를 버려 진단 기록에 '후보 미제공'으로 오인되던 문제.
2. 음성 발화임에도 텍스트 직접 타이핑과 동일하게 취급되어, STT 특성상 발생하는 대소문자(소문자 시작) 및 문장 끝 마침표 누락에 대해 "첫 글자를 대문자로 쓰세요"나 "마침표를 찍으세요" 같은 부적절한 문자 형식 지적이 발생하던 문제.
3. 한국어 고유명사(예: 합성 가명 'Minjun' 발화 시 'London' 전사 등) 전사 왜곡 시, 문맥상 완전한 문장 구조(`My name is London Park.`)를 AI가 실제 발화자의 이름을 확인했다며 과도하게 확정 칭찬하거나 임의의 다른 영어 이름으로 왜곡하던 문제.

---

## 2. 조사 결과 및 플랫폼 제약 (MDN 공식 자료 기반)

### 2.1 Web Speech API 플랫폼 특성 및 한계
- **`maxAlternatives`의 의미 ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/maxAlternatives)):**
  - `maxAlternatives`는 클라이언트가 요청하는 최대 상한(maximum upper bound)일 뿐이며, 브라우저/서버 음성 인식 엔진이 항상 2~3개의 대안을 반환하도록 보장하지 않습니다. Android Chrome 등에서는 상황에 따라 단 1개의 최상위 전사 결과만 반환될 수 있습니다.
- **Android Chrome의 `SpeechRecognitionPhraseList` (`phrases`) 미지원 ([MDN BCD](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/SpeechRecognition.json)):**
  - `SpeechRecognition.phrases`는 Chrome Desktop 142+에서 지원되나 Chrome Android에서는 `version_added: false`로 미지원 상태입니다.
  - 또한 `processLocally` 역시 모바일 환경에서 안정적으로 보장되지 않으므로, 특정 고유명사나 발화 힌트를 주입하여 ASR 인식률을 강제로 향상시키는 웹 표준 방식은 모바일 Chrome에서 현재 사용할 수 없습니다.

### 2.2 한계 및 원칙 명시
- **ASR 음향 인식률 자체의 해결책이 아님:**
  - 이번 개선은 브라우저 STT가 잘못 전사한 텍스트 자체를 오디오 없이 역추적하거나 음향 인식 정확도를 직접 높이는 것이 아닙니다.
  - 전사된 텍스트와 대안 후보군 범위 내에서 안정적인 피드백을 제공하고, 진단 데이터를 누락 없이 관찰할 수 있도록 하는 안전 조치입니다.
- **진단 메모의 자동 학습/치환 금지:**
  - 사용자가 진단 패널에 입력한 '내가 말한 내용 (선택)' 메모는 사용자의 자체 확인 및 수동 복사용 데이터일 뿐이며, AI 채점이나 자동 치환, 원격 학습에 일체 사용되지 않습니다.
- **소요 시간 표기 기준:**
  - 진단 리포트 및 UI에 표시되는 11~12초 소요 시간은 **10초의 바운디드 음성 듣기/입력 대기 시간과 AI 평가 처리 시간을 합산한 전체 시간**이며, 평가 단독 시간이 아닙니다.
- **향후 무료 음성 엔진 대안 및 기술적 전제:**
  - 향후 완전한 클라이언트 사이드 무료 ASR 대안으로 Transformers.js와 Whisper WebGPU를 활용한 브라우저 인-메모리 추론 가능성([Transformers.js WebGPU Guide](https://huggingface.co/docs/transformers.js/guides/webgpu), [Chrome WebGPU 121](https://developer.chrome.com/blog/new-in-webgpu-121))을 검토할 수 있으나, 실제 S25 등 모바일 환경에서의 전사 정확도, 초기 모델 다운로드 용량/지연(Latency), 배터리 발열에 대한 철저한 사전 검증 전까지는 현 브라우저 네이티브 Web Speech API 체제를 전환하지 않습니다.

---

## 3. 세부 변경 사항

### 3.1 `CoachTutorController.ts`
- **단일 후보 보존:**
  - `listenEnglishWithSilenceRetry`에서 `localCandidates.length >= 1` 및 `sanitized.length >= 1`이며 `sanitized[0] === rawTop`인 경우, 단일 후보도 유효한 `candidates: [text]`로 정상 반환합니다. (콜백이 호출되지 않은 경우에는 rawText를 임의로 후보 배열로 날조하지 않습니다.)
- **명시적 `inputSource` 및 유선(Wire) 계약 보존:**
  - 최초 평가(`processEvaluationAndContinue`) 및 반복 연습(`runPracticeLoop`) 시:
    - `candidates.length > 1`인 다중 후보일 때만 `{ inputSource, candidates }`를 API에 전송하고, 단일 후보이거나 후보가 없을 때는 `{ inputSource }`만 전송하여 기존 API 및 서버의 2~3개 후보 유효성 계약을 완벽히 보존합니다.
  - 텍스트 모드 및 `submitText` 호출 시:
    - 항상 명시적으로 `{ inputSource: 'text' }`를 전달하고 서버 요청에는 `candidates`를 생략합니다. 로컬 진단의 후보 배열만 빈 배열(`[]`)로 보관하여 이전 음성 후보가 상속되지 않도록 합니다.

### 3.2 `publicCoachHandler.ts`
- **서버 기본값 명시:**
  - 서버 핸들러는 `rawBody.inputSource === undefined`일 때 기본적으로 `'voice'`로 간주해 왔으므로, `inputSource` 필드의 누락만이 문자 형식 지적의 유일한 원인이 아니었음을 확인하고, 모델 프롬프트 및 결정론적 가드를 함께 보강했습니다.
- **`systemInstruction` 가이드 강화:**
  - `inputSource === 'voice'`일 때: 대소문자, 마침표, 구두점, 띄어쓰기 등 전사 형식에 대한 지적을 금지.
  - 이름 질문(`name`)일 때: 문장 구조만 평가하고, 실제 고유명사 인식 정확성이나 발음 정확성을 확인했다고 칭찬하지 말며, 후보에 없는 다른 이름을 추측하여 치환하지 않도록 지시.
- **결정론적 피드백 안전 가드 (Deterministic Feedback Guard):**
  - 프롬프트 지시만으로는 LLM의 예외적 환각을 100% 방지할 수 없으므로, `validatedInputSource === 'voice'`인 상태에서 AI의 `feedbackKo`에 대소문자/마침표/구두점/문장부호/띄어쓰기/capitalization/punctuation 등의 문자 형식 지적 키워드가 감지되면, AI가 이미 판정한 `meaning`과 `sentenceComplete`에 정확히 일치하는 자연스러운 한국어 말하기 피드백으로만 교체합니다.
  - `name` 질문이면서 `relevant` + `complete`인 경우: 실제 이름의 일치 여부를 단정하지 않고 `"이름을 소개하는 문장 구조를 잘 사용했어요."`로 통일하여 과도한 칭찬을 방지합니다.
  - `meaning`, `sentenceComplete`, `recognizedCandidateIndex`, `modelAnswerEn`, 평가 요청 횟수는 절대 변경하지 않으며, `needs_help`나 `uncertain`을 정답으로 둔갑시키지 않습니다.

### 3.3 `coachDiagnostics.ts`
- **단일 전사 후보 명시:**
  - `exportText()` 리포트에서 후보가 1개인 경우:
    `- 인식 대안 후보군: 단일 전사 1개 (다른 대안 없음)\n  (0) "..."`으로 명확히 구분 표기.
  - 후보가 0개(콜백 미제공 또는 텍스트 입력)인 경우 기존과 같이 `없음 (단일 텍스트/후보 미제공)`으로 유지.

---

## 4. 검증 및 확인 사항

- **독립 테스트 대상:** 단일 후보 보존, voice 소스 전달, 텍스트 소스 격리, 음성 형식 지적 차단 및 판정 보존을 Codex가 검증합니다. 실제 실행 결과는 아래 검증 기록에 따릅니다.
- **실기기 미검증 상태 유지:** 본 구현은 논리적/구조적 안전 가드 구현이며, 실제 단말(S25 등)에서의 네트워크 변동성 및 음성 인식 서버의 동작에 대해서는 실기기 검증을 통해 지속적으로 관찰되어야 합니다.

## 5. Codex 독립 검증 기록 (2026-10-24 KST)
- 신규 회귀11개를 추가했다. 변경 전 소스에서 단일 후보·음성/텍스트 출처3개 실패와 형식 지적·이름 확정칭찬·단일 전사 보고서6개 실패를 재현했다. 기존 텍스트 보존/주제 외 판정2개는 유지됐다.
- 구현 검토에서 텍스트 전용 반복이 voice로 잘못 표시되는 문제와 문장 부호 공백 표기를 놓치는 문제를 잡아 Gemini가 수정했다. 기존 호출 인수 시험은 명시적 입력 방식만 반영하고 원문·횟수·반복 재사용 검증을 유지했다.
- 전체 첫 실행819/820 통과에서 기존 프롬프트1500자 미만 상한 위반1599자를 확인했다. Gemini가 안전 지침/세 후보 예시를 보존하면서1324자로 줄였다. 상한 시험은 완화하지 않았다.
- 최종 scripts/verify.ps1: **79파일820시험 PASS**, 타입·린트·빌드·보호 경로·공백 검사 통과. 단어 데이터·사용자 저장소·90% 한도·API 후보2~3개 계약·모델·10초 듣기 유지.
- 제공된 두 보고서는2건 중복이며 서로 다른5기록 중 평가시도4·무음1이다. 내용 없는 D1 누적 집계도 기존64→68(+4) 및 STT/TTS0을 확인했다. 사용자 원본 발화·이름은 저장소나 Gemini 구현 지시에 기록하지 않았고 합성 가명으로만 재현했다.
- 운영 합성 시험은 배포 후 별도 기록한다. 실제 S25 인식률이 개선됐다는 판정은 하지 않는다. 브라우저에 없는 이름/단어를 복원하는 기능이나 진단 메모 자동 치환은 도입하지 않았다. 기존 사람/외부/보드 관문은 미검증 유지.

### 5.1 운영 합성 대조 및 예산 결과
- 실제 운영 경로에 개인정보 없는 합성5요청을 실행하여 모두 HTTP200/5시나리오 PASS 확인. 마이크는 사용하지 않았다.
- 단일 이름 전사 보존과 문장구조만 칭찬, 단일coffee 말하기 피드백, I would you like coffee please 문법오류의 미완성 판정과 I would like coffee, please. 교정, 이름질문에음료답변 needs_help 유지, 원본 couple/대안 coffee 구제 유지 확인.
- 서버 왕복1869/1592/1206/1580/1207ms. 실제 마이크10초·재생시간 제외이며 표본5건의 관측값이다.
- D1 소비68→73(+5), 보수적 예산 단위1124965→1207464(+82499)로 실요청5개와 일치했다. STT/TTS0건 유지. 제공 리포트에 대응하는 앞선4건과 이번검증5건은 구분한다.
- 실제 S25의 고유명사/초보자 발음 인식률은 여전히 미검증/미해결이다. 형식 지적 차단·진단 개선을 음향 인식 개선으로 표현하지 않는다. 로그에 대안이 없을 때 실제 발화 복원은 보장할 수 없다.
- 로컬 증거: .agy-work/390_live_single_feedback.json 및 .agy-work/394_budget_audit.json. 공개 자산에는 배포하지 않는다. 최종main과동일코드운영배포를일치시키고중간원격배포를정리한다.
