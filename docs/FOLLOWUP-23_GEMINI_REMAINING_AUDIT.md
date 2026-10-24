# FOLLOWUP-23 잔여 검증 및 S25 실기기 점검 감사 보고서 (Gemini Remaining Audit)

작성일시: 2026-10-24 KST
작성자: Gemini (구현 담당) / 검증 담당: Codex (감독·테스트·배포 독점)

---

## 1. 현재 공개 5문항 코치 (2026-10-24) 기검증 완료 내역

1. **무로그인 5개 핵심 일상 질문 코치 운영**:
   - `name`, `age`, `cafe`, `breakfast`, `hobby` 5종 일상 질문.
   - 만 18세 이상 성인 확인 1회(로컬 스토리지 보존 시 체크박스 숨김 처리).
2. **10초 바운디드 Web Speech 단일 발화 캡처 (FOLLOWUP-21)**:
   - 한국어 안내/영어 질문 종료 후 브라우저 내장 10초(`windowMs = 10000`) 음성 인식 창 자동 활성화.
   - 브라우저 내장 음성인식/합성 사용으로 현재 코치는 Gemini STT/TTS API를 호출하지 않음. FOLLOWUP-22 당시 D1 실측 STT/TTS 0건이며 이번 단계의 새 운영 조회는 아님.
3. **직접 평가 및 단답 2회 연습 규칙 (FOLLOWUP-18)**:
   - 전사 확인 절차("맞나요? 네/아니요") 전면 폐지, raw top-1 인식 텍스트 직접 AI 1회 평가.
   - 온전한 문장(`relevant` + `sentenceComplete: true`)은 1회 통과, 단답형/미완성(`Coffee, please` 등)은 의미 인정 후 2회 연습.
4. **독립 D1 90% 글로벌 하드캡 및 로컬 페이싱 (FOLLOWUP-19)**:
   - Google AI Studio 무료 티어 대비 90% 하드캡: **13 RPM** / 225,000 안전 단위/분 / **450 RPD**.
   - 분당 롤링 한도 초과 시 직전 발화 보존 및 61초 카운트다운 후 최대 2회 자동 재시도.
5. **텍스트 전용 학습 모드 (FOLLOWUP-20)**:
   - 음성 미지원 환경 또는 텍스트 모드 전환 시 마이크를 요구하지 않고 abortable 프로미스로 대기(`waitForTextAnswer`).
   - 시작 전 텍스트 제출 차단 및 초안 보존.
6. **반복 구간 기승인 동일 정답 안전 재사용 (FOLLOWUP-22)**:
   - 반복 연습(repeat) 단계에서 직전 AI 승인된 완전한 정답(`relevant && sentenceComplete: true`)과 양 끝 공백만 제외하고 정확히 일치하는 발화는 추가 AI 호출/예산 소진 없이 로컬 재사용. 내부 공백·대소문자·문장부호 차이는 새 평가 대상.
   - 첫 답변 및 변경된 답변(이름·나이·단어 변경)은 항상 실제 AI 호출 수행.
   - FOLLOWUP-22의 74개 파일 697개 테스트에 Codex 통합시험 2개 추가. 최신 전체 74파일 699시험, 관련 6파일 91시험 PASS.

---

## 2. 코드베이스 정밀 감사: STT / 캐시 / 라이프사이클 경계 검토

### A. 최종 인식(Final) vs 중간(Interim) 인식 분리 및 조기 재사용 방지
- **검토 위치**: `src/features/conversation/services/browserSpeechInput.ts` (`onresult`, `onend`) 및 `src/features/conversation/coach/CoachTutorController.ts` (`runPracticeLoop`)
- **동작 분석**:
  - `BrowserSpeechInputService`는 `isFinal === true`인 결과만 `currentNativeFinals` 맵에 인덱스별로 누적하고, 중간 발화는 `currentNativeInterims`로만 보관하여 화면 미리보기(`onPartial`)에만 사용합니다.
  - 10초 윈도우 타이머가 만료되어 `windowEnded`가 설정된 뒤 종료 이벤트 또는 최종 확정 유예 타이머를 통해 수집을 끝냅니다. 마이크 창 종료와 최종 결과 반환은 같은 순간으로 보장하지 않습니다.
  - 따라서 중간 인식 텍스트가 일치하더라도 10초 청취가 완전히 종료되기 전에는 컨트롤러의 반복 루프가 평가/재사용 분기로 진입하지 않으므로, 조기 크레딧 부여는 발생하지 않습니다. (Codex 테스트: `real recognition service waits for the finalized ten-second repetition before using the approved result` 통과).

### B. 네트워크 에러 발생 시 캐시 오염 및 가짜 크레딧 방지
- **검토 위치**: `browserSpeechInput.ts` (`recognition.onerror`) 및 `CoachTutorController.ts` (`listenEnglishWithSilenceRetry`)
- **동작 분석**:
  - Web Speech 중 `onerror`에 `network`가 수신되면 `BrowserSpeechInputService`는 즉시 타이머를 해제하고 `err.code = 'network'`와 함께 reject합니다.
  - `CoachTutorController`는 `res.status === 'error'`에서 `fatal_error`를 반환하고, `runPracticeLoop`는 즉시 루프를 중단(`if (listenRes.status === 'fatal_error') return;`)합니다.
  - 이전에 올바른 캐시(`lastValidatedEntry`)가 존재하더라도, 청취 프로미스가 실패했으므로 캐시 매칭 분기(`trimmedRepeat === this.lastValidatedEntry.answer`)에 도달하지 못해 가짜 정답 처리가 원천 차단됩니다. (Codex 테스트: `network failure during a new recording cannot reuse a cached answer even after a matching native final event` 통과).

### C. 일시정지(`pause`), 페이지 숨김(`pagehide`), 새 질문 시작 시 상태 정리
- **검토 위치**: `CoachTutorController.ts` (`start`, `pause`), `CoachTutorView.tsx` (`handleVisibility`, `handlePageHide`)
- **동작 분석**:
  - `start()` 호출 시 `this.lastValidatedEntry = null;`로 즉시 초기화되어 다른 질문이나 이전 세션의 답변이 오염되지 않습니다.
  - `pause()` 호출 시 즉시 `lastValidatedEntry = null;`로 초기화되며 진행 중인 비동기 Abort 및 `cancel()`이 수행됩니다.
  - 화면을 벗어나거나 탭을 닫는 `pagehide`/`visibilitychange` 발생 시 뷰에서 `controller.pause()`를 동기적으로 호출하므로 백그라운드 재사용이나 대기 중이던 프로미스의 부당 승인이 방지됩니다.

### D. 실질적 결함 여부 및 권고
- 이번 소스 검토와 자동시험 범위에서 네이티브 음성 수집 및 캐시 재사용과 관련한 P0/P1 결함을 추가로 재현하지 못했습니다. 실기기 정확도나 모든 결함의 부재를 보증하는 결과는 아닙니다.
- 오프라인 상태에서 Gemini AI 평가가 불가능한 것은 클라우드 기반 LLM API 아키텍처의 정상적인 제약이며, 결함으로 분류하지 않습니다.

---

## 3. 잔여 수동 검증 및 비대상 관문 (Pending / Manual Verification)

다음 항목들은 본 자동화/로컬 개발 환경에서 임의로 PASS 처리할 수 없으며, 미검증 상태를 유지합니다:

1. **갤럭시 S25 실기기 Chrome 전주기 사용자 체감 검증**:
   - 실기기 하드웨어 마이크 감도, 주변 소음, 실제 한국인 발음 억양에서의 Web Speech 전사 정확도 및 10초 발화 완료 후 AI 대기 없는 동일 반복 체감은 사용자의 실기기 테스트 피드백이 필수적입니다.
2. **이전 128차시 교육과정 전문 교사 검수 (`HUMAN_CURRICULUM_REVIEW_PENDING`)**:
   - 128개 전체 차시 및 32개 초안 차시의 교육학적 적합성 검수는 교사/전문가 인력에 의한 별도 관문입니다.
3. **외부 제3자 독립 보안/코드 리뷰 (`EXTERNAL_REVIEW_PENDING`)**:
   - 이전 128차시 설계에 대한 외부 독립 리뷰 및 출시 승인은 보류(`PUBLIC_RELEASE_STATUS = NOT_APPROVED`) 상태를 유지합니다.
4. **알고리즘 보드 관문 (`BOARD-01`, `BOARD-12A`)**:
   - `BOARD-01`: 외부 첨부 원본 파일 부재로 원문 대조 미수행(`NOT_VERIFIED`).
   - `BOARD-12A`: 샌드박스 브라우저 정책 및 도구 제약으로 로컬 `file://` 브라우징 미수행(`NOT_VERIFIED`).
5. **PWA / iOS Safari 완결성**:
   - 현재 배포는 표준 모바일 Chrome 웹 환경에 최적화되어 있으며, PWA 오프라인 캐싱 및 iOS Safari 음성 합성은 실기기 수동 확인 대상입니다.

---

## 4. 사용자용 갤럭시 S25 Chrome 단계별 점검 순서 (S25 Checklist)

갤럭시 S25 단말기에서 인앱 브라우저(카카오톡, 네이버 등)가 아닌 **순수 Chrome 앱**으로 다음 주소에 접속하여 점검해 주세요.

- **접속 주소**: [https://voca-study-akf.pages.dev/?voice-check=1&build=20261023-12](https://voca-study-akf.pages.dev/?voice-check=1&build=20261023-12)

---

### [필수 점검] 정상 학습 흐름 (기본 3단계)

#### 1단계. 첫 번째 질문 (이름): 완전한 문장 말하기 $\rightarrow$ 동일 문장 반복
1. "코칭 시작" 버튼을 누릅니다. (성인 확인 체크박스가 보이면 1회 체크)
2. AI의 한국어 상황 설명과 영어 질문(`"What is your name?"`) 음성을 끝까지 듣습니다.
3. 질문이 끝나고 화면에 **"10초 동안 듣는 중"**이 표시되면 다음처럼 말합니다:
   - 🗣️ **발화**: `"My name is Alex."`
4. 10초가 지나면 AI 분석을 거쳐 한국어 칭찬 피드백이 나오고 모범 문장을 읽어줍니다.
5. 화면에 **"따라 말해 볼까요?"** 안내가 나온 뒤 마이크가 켜지면, **화면에 표시된 문장과 똑같이** 다시 말합니다:
   - 🗣️ **발화**: `"My name is Alex."`
6. **확인할 점**:
   - 두 번째 말하기는 10초 듣기와 최종 인식 확정 후 **추가 AI 분석 대기 없이** 한국어 피드백을 거쳐 완료되고 "다음 질문으로" 버튼이 나타나는지 확인합니다. 최종 인식 확정 및 음성 재생 시간은 남습니다.

#### 2단계. 두 번째 질문 (나이): 완전한 문장 말하기 $\rightarrow$ 동일 문장 반복
1. "다음 질문으로" 버튼을 누릅니다.
2. 질문(`"How old are you?"`)을 듣고 마이크가 켜지면 말합니다:
   - 🗣️ **발화**: `"I am 28 years old."` (또는 `"I am twenty-eight years old."`)
3. AI 피드백을 듣고, 따라 말하기 마이크가 켜지면 **화면에 인식된 문장 그대로** 똑같이 말합니다.
4. **확인할 점**:
   - 첫 번째는 AI 분석을 거치고, 두 번째 동일 최종 텍스트는 최종 인식 확정 후 추가 AI 분석 대기 없이 피드백과 완료로 진행되는지 확인합니다.

#### 3단계. 세 번째 질문 (카페): 짧은 단답 말하기 $\rightarrow$ 2회 연습
1. "다음 질문으로" 버튼을 누릅니다.
2. 질문(`"What would you like to drink?"`)을 듣고 마이크가 켜지면 단답으로 말합니다:
   - 🗣️ **발화**: `"Coffee, please."`
3. **확인할 점**:
   - AI가 뜻을 인정해주면서 완전한 문장(`"I'd like a coffee, please."`)을 권장하는지 확인합니다.
   - 단답형이므로 연습 목표가 **2회**로 설정됩니다.
4. 첫 번째 따라 말하기에서 AI 모범 문장(`"I'd like a coffee, please."`)을 말합니다. $\rightarrow$ 이 때는 문장이 달라졌으므로 정상적으로 AI 분석을 거칩니다.
5. 두 번째 따라 말하기에서 방금 인식된 문장을 똑같이 말합니다. $\rightarrow$ 최종 인식 확정 후 **추가 AI 분석 대기 없이** 피드백을 거쳐 2/2 연습이 완료되어야 합니다. 예문은 예시와 다를 수 있으므로 실제 화면의 문장을 따릅니다.

---

### [선택 점검] 오답 및 일시정지 확인 (부담 없을 때만 선택 수행)

- **오답 확인**: 질문과 전혀 다른 엉뚱한 말(예: 나이 질문에 `"I like bananas."`)을 했을 때, 정답 처리되지 않고 도움말 안내가 나오는지 확인합니다.
- **일시정지 확인**: 학습 도중 화면 하단의 "일시정지" 버튼을 누르면 즉시 마이크가 꺼지고 안전하게 멈추는지 확인합니다.
- **인식 문장 표기 유의사항**: 반복 재사용은 음성 엔진이 최종 확정한 텍스트가 대소문자/문장부호까지 일치해야 작동합니다. 중간에 지나가는 인식 중 글자가 아닌 최종 확정된 박스 안의 글자를 기준으로 판단합니다.
