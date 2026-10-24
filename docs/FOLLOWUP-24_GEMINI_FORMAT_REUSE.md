# FOLLOWUP-24 정답 반복 재사용 대소문자/문장부호 정규화 보고서

- **작성일시**: 2026-10-24 KST
- **작성자**: Gemini (구현 담당)
- **검증/배포 담당**: Codex (테스트·벤치마크·배포 독점)

---

## 1. 개요 및 요구사항
- **배경**:
  - 기존 FOLLOWUP-22에서는 `trimmedRepeat === lastValidatedEntry.answer`의 완전 일치(case-sensitive, punctuation-strict) 방식으로 재사용함.
  - 음성 인식 엔진(Web Speech API)의 특성상 동일한 발화라도 마이크 세션에 따라 문장 첫 글자의 대소문자(`My` vs `my`), 전체 대문자(`MY NAME IS ALEX!`), 또는 끝 마침표 유무(`Alex.` vs `Alex`)가 다르게 반환되어 불필요하게 AI가 재호출되는 현상이 발생.
- **목적**:
  - 단어와 의미가 변경되지 않은 포맷 차이(대소문자, 문장 말미 종결부호)는 AI 호출 없이 안전하게 재사용.
  - 단어 누락, 변경, 부정, 내부 구두점 차이 등 의미를 바꿀 수 있는 발화는 반드시 실제 AI 평가 수행.

---

## 2. 정규화 및 비교 정책 (`normalizeRepeatAnswerKey`)

- **적용 위치**: `src/features/conversation/coach/CoachTutorController.ts`의 `normalizeRepeatAnswerKey` 함수
- **정규화 규칙**:
  1. **양 끝 공백 제거 및 연속 공백 1칸 축약**: `text.trim().replace(/\s+/g, ' ')`
  2. **굽은 아포스트로피 통일**: `[\u2018\u2019]` $\rightarrow$ `'` (아포스트로피 제거 절대 금지, 축약형 보존)
  3. **소문자화**: `text.toLowerCase()`
  4. **문장 말미 종결부호만 반복 제거**: `text.replace(/[.!?]+$/g, '').trim()`
  5. **구두점 단독 입력 방어**: 문장부호 제거 후 빈 문자열이 되는 경우 빈 키(`''`)를 반환하여 재사용 불가 처리.
- **엄격한 보존 및 배제 규칙 (의미 변형 방지)**:
  - **내부 구두점 절대 보존**: 내부 쉼표(`,`), 하이픈(`-`), 슬래시(`/`), 소수점(`.`), 아포스트로피(`'`)는 절대 제거하거나 치환하지 않음.
    - `cant` vs `can't` $\rightarrow$ 서로 다른 키로 평가 분기.
    - `were` vs `we're` $\rightarrow$ 서로 다른 키로 평가 분기.
    - `well` vs `we'll` $\rightarrow$ 서로 다른 키로 평가 분기.
    - `re-sign` vs `resign` $\rightarrow$ 서로 다른 키로 평가 분기.
    - `2.8` vs `28` $\rightarrow$ 서로 다른 키로 평가 분기.
    - `2,800` vs `2800` $\rightarrow$ 서로 다른 키로 평가 분기.
    - `ice cream` vs `icecream` $\rightarrow$ 공백 보존으로 서로 다른 키.
  - **시맨틱/퍼지 매칭 금지**: 축약어 확장, 숫자 한글/영문 변환, 철자 교정, 단어 치환 등은 일체 수행하지 않음.
  - **원본 데이터 보존**: `recognizedText`, 화면 표시 문구, 실제 `deps.evaluate`에 전달되는 인자(`answer`)는 정규화되지 않은 순수 원본 텍스트를 그대로 유지.

---

## 3. 수정된 제품 파일 목록

1. [`src/features/conversation/coach/CoachTutorController.ts`](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/coach/CoachTutorController.ts)
   - `normalizeRepeatAnswerKey(rawText: string): string` 헬퍼 함수 구현 및 export.
   - `lastValidatedEntry`에 `normalizedKey: string` 필드 추가.
   - `safeEvaluate` 성공 시 `res.value.meaning === 'relevant' && res.value.sentenceComplete === true`를 만족할 때만 `normalizedKey`를 산출하여 보관.
   - `runPracticeLoop`(음성 루프) 및 `submitText`(텍스트 직접 제출)의 반복(`repeat`) 분기에서 `lastValidatedEntry.normalizedKey === repeatKey`로 비교 분기 적용.
   - 상단 헤더 원칙 5번 동기화.
2. [`src/features/conversation/components/CoachTutorView.tsx`](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/components/CoachTutorView.tsx)
   - 진단 버전 문자열을 `'paced-coach-10s-v8'`로 갱신 (화면 표시 및 클립보드 복사 페이로드 일치).
3. [`scripts/algorithm-board/generateBoard.mjs`](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/scripts/algorithm-board/generateBoard.mjs)
   - "현재 공개 코치 (2026-10-23 운영 현황)" 요약에서 재사용 조건을 `대소문자·말미 종결부호 차이를 제외하고 일치 시`로 동기화 갱신. (과거 128차시 아키텍처 및 다이어그램 보존)

---

## 4. 안전성 및 역할 분담 준수 확인

1. **테스트 및 빌드 명령 미실행 준수**:
   - 구현 에이전트(Gemini)는 터미널/쉘/npm/git 명령을 일절 실행하지 않았습니다.
2. **검증 및 테스트 소유권**:
   - `conversationCoachRepeatReuse.test.ts`를 포함한 회귀 테스트 및 새 대소문자/종결부호 정규화 검증 케이스 작성과 실행은 Codex가 독립적으로 수행합니다.
