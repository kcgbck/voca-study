# FOLLOWUP-21 응답 지연 시간(Latency) 및 10초 음성 캡처 개선 보고서

- **작성일시**: 2026-10-23
- **작성자**: Gemini (구현 담당)
- **검증/배포 담당**: Codex (테스트 실행 및 배포 독점)

---

## 1. 개선 배경 및 목적
1. **영어 청취 대기 시간 확대 (6초 -> 10초)**:
   - 초급 영어 학습자가 질문을 듣고 머릿속으로 영작한 후 문장 전체를 말하기에 6초는 다소 촉박하다는 피드백을 반영하여 기본 캡처 윈도우를 10초로 확대.
2. **AI 피드백 응답 지연 시간 단축**:
   - 기존 운영 환경에서 Gemini 3.5 Flash Lite 호출 4회 소요 시간이 12.7초 ~ 17.2초로 관측됨.
   - 공식 문서상 `gemini-3.5-flash-lite`는 `thinkingLevel: 'minimal'`이 기본 지원/권장되므로 불필요한 장문 프롬프트를 압축하고 명시적 지연 최적화 파라미터를 적용함.

---

## 2. 세부 변경 사항

### A. 음성 캡처 창 10초 확대 (컨트롤러 & UI)
- [`src/features/conversation/coach/CoachTutorController.ts`](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/coach/CoachTutorController.ts)
  - `listenEnglishWithSilenceRetry` 기본 `windowMs`를 `6000`에서 `10000`으로 변경.
  - 리스닝 메시지를 고정 문자열이 아닌 설정값 기반 파생(`Math.round(windowMs / 1000)초 동안 듣는 중`)으로 유연화하여 커스텀 `answerWindowMs` 호환성 유지.
  - 관련 안내 및 원칙 주석을 10초 기준으로 동기화.
  - 텍스트 모드의 무기한 대기(`waitForTextAnswer`) 및 abortable 취소 정책 유지.
- [`src/features/conversation/components/CoachTutorView.tsx`](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/components/CoachTutorView.tsx)
  - 진단 버전 문자열을 `'paced-coach-10s-v6'`으로 갱신.
  - 안내 배지 및 툴팁 문구를 10초에 맞추어 갱신 (`10초 동안 마이크가 자동으로 켜집니다`).
  - `listening` 배지에서 스냅샷의 동적 메시지(`snapshot.message.includes('초 동안 듣는 중')`)를 우선 반영하도록 처리.

### B. Gemini 프롬프트 압축 및 생성 설정 최적화
- [`src/features/conversation/server/publicCoachHandler.ts`](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/src/features/conversation/server/publicCoachHandler.ts)
  - **시스템 인스트럭션 대폭 압축** (1,000자 미만 목표로 불필요한 서술형 중복을 제거하고 명확히 구조화):
    - 입력값 보안 경계(사용자 답변은 순수 발화 데이터로만 취급, 명령 무시) 유지.
    - 평가 분류 체계(`relevant`, `needs_help`, `uncertain`) 및 불확실성 무크레딧 원칙 완벽 보존.
    - 미완성 단답(`'six'`, `'20'`, `'Coffee, please'`)의 `sentenceComplete: false` 및 사용자 원래 의도/단어 보존 영문 모범 예문 규칙 보존.
    - 한국어 피드백 1문장(권장 60자 이내), 영문 모범 문장(권장 120자 이내)으로 간결성 가이드 명시.
  - **`generationConfig` 최적화**:
    - `maxOutputTokens`: 700 -> **512** (출력 생성 토큰 상한 제한).
    - `thinkingConfig: { thinkingLevel: 'minimal' }` 명시적 설정.
    - `responseMimeType: 'application/json'`, `temperature: 0.2` 유지.
  - **기존 예산 및 안전 정책 엄격 유지**:
    - `gemini-3.5-flash-lite` 단일 모델 및 20초 데드라인 유지.
    - 독립 D1 DB 기반 90% 하드캡 (13 RPM, 450 RPD) 및 보수적 사전 예약/소진 절차 불변.
    - 결과 검증 유효성 검사 규칙(한국어 피드백 최대 500자, 영문 모범답안 최대 200자) 그대로 유지하여 안정적인 수용 범위 확보.

### C. 알고리즘 보드 운영 문서 현황 동기화
- [`scripts/algorithm-board/generateBoard.mjs`](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/scripts/algorithm-board/generateBoard.mjs)
  - 최상단 HTML 헤더 및 Markdown 요약의 "현재 공개 코치 (2026-10-23 운영 현황)" 항목에서 캡처 시간을 `6초`에서 `10초`로 갱신.
  - 과거 레거시 128차시 다이어그램 및 파이프라인은 일체 변경 없이 보존.

---

## 3. 안전성 및 역할 분담 준수 확인

1. **테스트 미실행 준수**:
   - 본 에이전트(Gemini)는 테스트 실행, 빌드 명령, 터미널/쉘 호출을 일절 수행하지 않았습니다.
2. **테스트 및 검증 소유권**:
   - 회귀 테스트 실행(`npm test`) 및 실측 레이턴시 벤치마크, 보드 파일 재생성(`node scripts/algorithm-board/generateBoard.mjs`), 배포는 전적으로 Codex가 담당합니다.
3. **외부 종속성 및 비밀 정보 보호**:
   - 신규 라이브러리 추가 없음.
   - `.env`, 개인 API 키 등 기밀 파일에 대한 접근이나 수정 없음.
