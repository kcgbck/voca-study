# FOLLOWUP-15 즉시 6초 듣기와 음성 수집 검증

## 최신 사용자 요구
- 질문 후 생각 시간을 제거한다.
- 영어 질문이 끝나면 바로 인식을 시작하고 6초간 듣는다.
- S25 Chrome에서 말한 것과 다른 영어 단어·문장으로 표시되는 오인식이 매우 잦다고 보고했다. 단순 무음이나 앞부분 누락으로 단정하지 않는다.

## 원인 구분과 구현 범위
- 기존 컨트롤러는 질문 뒤 10초 대기와 별도의 한국어 안내 음성을 재생한 다음에야 인식을 시작했다. 최신 요구대로 이를 없앤다.
- 수집 코드의 회귀 시험에서 같은 final 결과 인덱스를 반복 전달하면 문장을 중복 추가하는 문제를 재현했다.
- 기존 native onend는 정해진 6초가 되기 전에 수집을 끝낼 수 있다. 마이크 실제 준비 이벤트·중간 결과 표시도 연결되어 있지 않았다.
- 위 수집 결함과 외부 음성 인식 엔진이 다른 단어를 선택하는 현상은 구분한다. 잘못된 단어 선택의 실제 원인을 아직 특정하지 않았다.
- Gemini가 제품 코드를 구현하고 Codex가 재현·회귀 시험·운영 반영 검증을 담당한다.
- 영어 답변은 native 준비 완료부터 한 번의 6초 창으로 수집한다. 조기 종료는 같은 창의 남은 시간에서만 다시 시작한다. 6초 후 입력을 멈추고 확정 결과 정리에 최대 1초를 둔다. 최초 준비 지연은 별도로 최대 5초다.
- 중간 인식 결과는 화면에 표시하지만 확정 답변이나 AI 채점으로 사용하지 않는다. 인식된 단어를 정답 예문으로 강제로 고치지 않는다. 사용자 네/아니요 확인을 유지한다.
- 무료 브라우저 STT만 사용한다. Gemini STT/TTS, 유료 API, 음성 저장·전송 코드, 새 라이브러리·키·음성팩 설정은 추가하지 않는다.

## 공식 문서 확인
- [SpeechRecognition start 이벤트](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/start_event): 인식 서비스가 실제 듣기를 시작한 이벤트이다.
- [continuous](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/continuous): 단일 결과와 연속 결과 수집을 구분한다.
- [interimResults](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/interimResults): 중간 결과는 아직 확정되지 않은 결과다.
- [phrases](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/phrases): 문맥 편향은 실험적 기능이다. S25 지원이 검증되지 않았으므로 이번에 강제 적용하지 않는다.

## 구현 및 검증 결과
- 제품 변경 3개 파일: BrowserSpeechInputService, CoachTutorController, CoachTutorView. Gemini가 구현했고 Codex가 테스트·검증했다.
- 기본 생각 시간 0. 질문 이후 별도의 안내 음성을 제거하여 영어 질문 종료 즉시 인식을 요청한다. 반복 시에도 한국어 안내를 먼저 읽고 영어 예문이 끝나면 즉시 듣는다.
- 6초 수집 모드의 native onstart·조기 종료 복구·최종/중간 결과 분리·동일 인덱스 중복 방지·취소·네트워크 오류·늦은 이전 세션 결과 차단·종료 유예·중간 가설 철회를 시험했다.
- 수집 전에는 ‘마이크 준비 중’, 준비 완료 시 ‘6초 동안 듣는 중’으로 표시하며 중간 인식은 ‘아직 확정 전’으로 표시한다. 콜백이 늦게 와도 완료된 문제를 다시 열지 않는다.
- Gemini 편집이 시간 초과로 일부만 작성되어 중단됐던 실행을 성공으로 간주하지 않았다. 제한된 파일 범위로 재지시하고 테스트 실패를 해결했다. 코드 검증 없이 서비스 품질 개선을 단정하지 않았다.
- `scripts/verify.ps1` exit 0: 67개 파일 / 596개 시험, typecheck/lint/build/보호 경로/diff 검사 통과 (`.agy-work/105_six_second_verify.log`).
- 비밀키 문자열 노출 검사 255개 파일, 매칭 0. 새 키·의존성·유료 API 추가 없음.
- 운영 교정 배포 `408fd4b2` 완료. 기존 공개 Access·독립 예산 DB·90% 한도·앱 AI 모델은 변경하지 않았다 (`.agy-work/106_six_second_deploy.log`).
- 같은 기존 voice-check 주소를 운영에서 새로고침하여 새 6초 안내를 확인했다 (`.agy-work/107_six_second_operating.png`).
- stage/commit/push 없음. branch main, HEAD 8248697cb4702719dfe7191195bccba5851a9cd4 유지.

## 남은 실기기 확인
- S25의 실제 음향 인식 정확도와 마이크 준비·6초 수집 동작은 사용자 재시험이 필요하다.
- 다른 영어 단어로 바뀌는 현상의 실제 원인은 아직 특정하지 못했다. 수집 오류를 수정한 모의 인식기 시험을 실제 음향 인식 성공으로 표시하지 않는다.
- 잘못된 인식 문장을 정답 예문으로 자동 치환하지 않았다. 필요하면 합성 시험 문장의 발화/인식 결과 한 쌍을 근거로 다음 수정을 판단한다.
