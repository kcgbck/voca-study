# FOLLOWUP-22 반복 구간 동일 정답 재사용 및 초급 자연어 이해 강화 보고서

- **작성일시**: 2026-10-23
- **작성자**: Gemini (구현 담당)
- **검증/배포 담당**: Codex (테스트 실행 및 배포 독점)

---

## 1. 개요 및 목적
1. **반복 구간 동일 정답 재사용 (API 호출 절감 & 즉시 피드백)**:
   - 사용자가 초기 발화 또는 직전 연습에서 AI 검증을 통과한 온전한 정답(`meaning: 'relevant'`, `sentenceComplete: true`)을 반복 연습 구간에서 그대로 동일하게 다시 말했을 때, 불필요한 AI 재호출과 네트워크 지연 없이 직전 평가 결과를 안전하게 재사용.
2. **초보자 발화 이해 강화 (자연어 프롬프트 고도화)**:
   - 음성 인식 엔진 자체의 임의 교정(STT rewriting) 없이, 의미(meaning)와 문법적 완성도(sentenceComplete)를 분리하여 경미한 문법 오류나 단답도 문맥상 뜻이 통하면 `relevant`로 인정하되, 온전하지 않은 문장은 `sentenceComplete: false`로 판정하여 1포인트 교정 피드백 제공.

---

## 2. 상세 구현 내용

### A. 인메모리 단일 캐시 항목 기반 안전 재사용 (`CoachTutorController.ts`)
- **구조 및 용량 제약**:
  - 컨트롤러 내 단 1개의 바운디드 슬롯 `lastValidatedEntry: { questionId: string; answer: string; evaluation: CoachEvaluation } | null` 유지 (무제한 Map 불가).
- **저장 조건 (엄격한 성공 검증)**:
  - 실제 `deps.evaluate` 호출 성공 결과 중 `meaning === 'relevant' && sentenceComplete === true`인 경우에만 저장.
  - 교재 예문(`exampleAnswerEn`), 모범 답변(`modelAnswerEn`), 중간 인식 텍스트, 로컬 유사도, 미완성(`sentenceComplete: false`), 오답(`needs_help`), 불확실(`uncertain`), 오류 시 절대 저장 금지.
  - 비동기 처리 중 Abort된 stale 응답은 저장되지 않도록 `!signal.aborted` 확인 결합.
- **재사용 조건 (엄격한 일치)**:
  - `currentMode === 'repeat'` (초기 평가 `initial` 단계는 항상 실제 API 호출).
  - 현재 질문 ID 일치 (`lastValidatedEntry.questionId === currentQuestion.id`).
  - 양 끝 공백 제거 후 대소문자/문장부호까지 정확히 일치 (`lastValidatedEntry.answer === trimmedRepeat`).
  - 퍼지 매칭, 정규화, 교재 정답으로의 대체 등 임의 추측 배제.
- **캐시 초기화 (Clean Lifecycle)**:
  - `start()` 호출 시 (동일 질문 재시작 포함) 즉시 `null`로 초기화.
  - `pause()` 호출 시 즉시 `null`로 초기화.
- **효과**:
  - 캐시 적중 시 API 호출 0회, D1 예산 소비 0회, 쿼터 대기 0초, 네트워크 요청 0건.
  - 음성 10초 캡처 및 최종 결과 확정 완료 후에만 판정하며, 진행 카운트(1/2, 2/2) 및 한국어/영어 음성 피드백은 동일하게 정상 유지.

### B. 초보자 자연어 이해 강화 프롬프트 (`publicCoachHandler.ts`)
- **의미와 문법의 명확한 분리**:
  - `uncertain`: STT 왜곡이 심하거나 인식 불능인 경우 `needs_help`보다 최우선 적용하여 억지 채점을 방지하고 크레딧을 부여하지 않음. 학습자의 이름/나이/음료를 임의로 지어내어 강요하지 않고 다시 말해 달라고만 요청함.
  - `meaning`: 단답이거나 초보자의 경미한 문법/철자 오류가 있어도 질문 문맥에 맞으면 `relevant` 부여. (단, 예시 답변은 문맥 종속적임: 'six'는 나이 질문에만 relevant, 카페 질문에선 오답).
  - `sentenceComplete`: 온전한 주어+동사를 갖춘 올바른 문장이면 `true`, 문법 오류/단답/미완성이면 `false`.
- **피드백과 모범 예문의 시제/문법 교정 일관성 규칙**:
  - `feedbackKo`와 `modelAnswerEn`은 질문 문맥에 알맞은 동일한 시제(과거 질문이면 과거형) 및 문법 교정을 반드시 상호 일치시켜 제시.
- **명시적 간결 예시 추가**:
  - 카페 질문의 `'Coffee, please'` $\rightarrow$ relevant, false
  - 카페 질문의 `'I has coffee'` $\rightarrow$ relevant, false (의미는 통하나 문법 불완전)
  - 나이 질문의 `'six'` $\rightarrow$ relevant, false (나이 질문 문맥 한정)
- **사용자 정보 보존**:
  - 교재 예문이나 특정 이름/음료로 덮어쓰지 않고 학습자가 말한 고유 명사, 음료, 숫자, 부정형을 유지한 채 완전한 문장 제시.
- **제약 준수**:
  - 1500자 이하의 간결한 프롬프트 유지, `maxOutputTokens: 512`, `thinkingConfig: { thinkingLevel: 'minimal' }` 및 90% D1 예산 하드캡(13 RPM, 450 RPD) 온전 유지.

### C. UI 및 알고리즘 보드 동기화
- [`src/features/conversation/components/CoachTutorView.tsx`](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/components/CoachTutorView.tsx):
  - 진단 버전 문자열을 `'paced-coach-10s-v7'`로 갱신 (화면 표시와 복사 페이로드 일치).
- [`scripts/algorithm-board/generateBoard.mjs`](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/scripts/algorithm-board/generateBoard.mjs):
  - "현재 공개 코치 (2026-10-23 운영 현황)" 요약에 "초기 답변 및 변경 답변은 항상 AI 평가, 반복 연습에서 기검증된 동일 정답 발화 시 중복 호출 없이 안전 재사용" 사실 명시.
- **반복 평가 상태 업데이트 동기화 (`CoachTutorController.ts`)**:
  - `runPracticeLoop` 및 `submitText` 반복 분기에서 `repeatEval` 수신 즉시 컨트롤러의 `this.feedbackKo`와 `this.modelAnswerEn`을 최신 평가값으로 갱신하도록 수정.
  - 이를 통해 반복 시 변경된 발화(예: Alex $\rightarrow$ Mina)나 단답에서 완전 문장으로 보완된 발화의 최신 한국어 피드백 및 모범 예문이 화면 스냅샷과 다음 읽어주기 단계에 온전히 반영되도록 결함을 해결함.

---

## 3. 한계점 및 사실 확인

1. **브라우저 음성 인식 엔진(Web Speech API)의 한계**:
   - 브라우저 내장 음성 인식 모델 자체를 본 코드베이스에서 직접 파인튜닝하거나 어쿠스틱 모델을 변경할 수 없습니다. 따라서 원본 STT 인식 정확도가 무조건 향상되었다고 단정하지 않으며, 서버 프롬프트의 의미 해석 유연성과 반복 구간 안전 재사용을 통해 사용자 경험을 개선합니다.
2. **테스트 미실행 준수**:
   - 제품 구현 담당(Gemini)은 규정에 따라 테스트 실행, 빌드 스크립트 실행, 쉘 명령을 일절 수행하지 않았습니다.
   - 모든 기능 검증, 회귀 테스트 통과 확인, 보드 산출물 생성 및 배포는 Codex가 독점 수행합니다.
