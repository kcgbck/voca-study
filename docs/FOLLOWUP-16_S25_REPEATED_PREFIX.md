# FOLLOWUP-16 S25 반복 접두사 인식 조사

## 증상과 현재 판정
- 사용자가 S25 Chrome에서 합성 문장 `My name is Alex.`를 말했으나 `mine mine is mine is Alex.`로 표시됐다고 보고했다.
- 단어 치환과 결과 조립 중복은 구분해야 한다. 원본 native 이벤트가 없어서 실기기 원인은 아직 미확정이다.
- Codex 모의 시험: 같은 인덱스의 정상 interim `mine` → `mine is` → final `mine is Alex.`는 기존 코드에서도 중복 없이 처리된다.
- 서로 다른 native 세션에서 final `mine`, final `mine is`, final `mine is Alex.`를 보내면 보고된 문자열을 재현한다. 이는 가능한 경로 재현이며, 실제 휴대폰에서 같은 이벤트가 발생했다는 증거가 아니다.
- 실제로 따로 말한 `very` + `very good`도 있을 수 있으므로, 접두사가 겹친다는 이유만으로 결과를 삭제하는 Gemini 제안은 보류했다. Android 백엔드 동작·억양 편향에 대한 출처 없는 설명도 확정 사실로 채택하지 않았다.
- [MDN results 문서](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionEvent/results)는 한 세션의 전체 final과 갱신 가능한 interim 목록이라고 설명한다. 표준 동작만으로 원인을 단정하지 않는다.

## 최소 진단 구현 지시
- Gemini가 BrowserSpeechInputService와 CoachTutorView 두 제품 파일만 수정한다. Codex는 시험과 검증을 담당한다.
- `speech-debug=1`을 명시한 주소에서만 영어 native start/result/end/error/settled 기록을 화면에 표시한다. 마이크 세션 번호·인덱스·final 여부·원문과 앱 조립 결과를 비교한다.
- 진단은 해당 화면 메모리에만 유지하고 서버 저장·자동 전송·콘솔·localStorage·음성 녹음을 추가하지 않는다. 기본 학습에는 진단 설정이나 클릭을 추가하지 않는다.
- 캡처당 최대 40개 기록, 각 결과 최대 16항목/160자, 최종 조립 문자열 최대 500자로 진단 자료를 제한한다. 실제 STT 결과를 잘라 채점하는 변경은 하지 않는다.
- 6초 수집·한국어 진행·확인 후 평가·18세 체크·예산 한도·Access·모델은 변경하지 않는다.

## 검증 상태
- 진단 미구현 상태의 신규 시험: 정상 interim 처리 PASS, 진단 이벤트 기대 시험 FAIL 확인 (`.agy-work/109_trace_red.log`).
- Gemini 제품 구현 완료. Codex 관련 시험 25개 PASS. 전체 `scripts/verify.ps1` exit 0: 68개 파일/602개 시험, typecheck/lint/build/보호 경로/diff 검사 PASS (`.agy-work/112_trace_verify.log`).
- 제공된 키 문자열의 소스·빌드 노출 검사 257개 파일/매칭 0. 새 키·유료 호출·의존성 추가 없음.
- 운영 배포 d0d5841b 완료 (`.agy-work/113_trace_deploy.log`). 주 운영 주소의 진단 링크에서 새 코치와 접이식 진단 UI가 표시되는 것을 Chrome으로 확인했다 (`.agy-work/114_speech_trace_operating.png`).
- 진단 주소: https://voca-study-akf.pages.dev/?voice-check=1&speech-debug=1&build=20261023-3
- 초기 sandbox 실행은 DNS/기존 로그인 접근 제한으로 실패했으며 새 토큰을 만들지 않았다. 같은 기존 Wrangler 인증을 사용하는 승인된 네트워크 실행으로 재시도하여 배포 exit 0을 확인했다.
- branch main / HEAD 8248697cb4702719dfe7191195bccba5851a9cd4, staged 0. commit/push 없음.
- S25의 실제 음향 인식 정확도 개선 또는 문제 해결 완료로 판정하지 않는다.

## 2026-10-23 추가 조사: Android 연속 모드 호환성
- 추가 보고: `mey mey name mey name my name is my name is Alex`.
- 휴대폰의 원본 JSON은 아직 수신하지 않았다. PC의 열린 진단 화면에는 빈 목록만 있어서 휴대폰 기록을 대신 확인했다고 주장하지 않는다.
- 공식 Chromium의 [고정 revision Android bridge](https://chromium.googlesource.com/chromium/src/+/27c7fe6e7a57093e09bcdb675cc6cfedac716110/content/public/android/java/src/org/chromium/content/browser/SpeechRecognitionImpl.java)에서 onPartialResults가 provisional=true로 전달하고, handleResults는 mContinuous가 true이면 provisional을 false로 바꾸는 구현을 확인했다. 앱은 각각의 final을 독립 구간으로 연결한다.
- [현재 main의 구현](https://raw.githubusercontent.com/chromium/chromium/main/content/public/android/java/src/org/chromium/content/browser/SpeechRecognitionImpl.java)은 final_result와 segmented sessions를 다르게 처리한다. 모든 Chrome 버전에 같은 결함이 있다고 단정하지 않는다. 사용자 S25의 설치 Chrome revision은 미확인이다.
- 위 bridge의 승격 동작을 모델링한 새 시험에서 보고 문자열 전체를 정확히 재현했다. 단순 같은 인덱스 interim 갱신 시험과 달리, 연속 모드에서 final로 승격되어 추가되는 경로가 원인 후보로 구체화됐다.
- 수정 전 신규 시험 4개 중 3개 FAIL/1개 PASS (`.agy-work/115_android_bridge_red.log`). 원문 확정 오인식 보존·의도적 반복 보존·6초 공동 데드라인 시험을 포함했다.
- Gemini에 수집 모드의 native continuous만 false로 변경하고 관련 주석을 고치도록 지시했다. interimResults=true와 자동 재시작/6초 수집은 유지한다. 문장 겹침 삭제나 정답 치환은 적용하지 않는다.
- Gemini 제품 수정 완료: BrowserSpeechInputService의 window mode에서 continuous=false, interimResults=true. 관련 주석만 함께 갱신했다.
- Codex 수정 후 관련 시험 26개 PASS (`.agy-work/117_android_compat_green.log`). Chromium bridge 모의 입력의 출력이 전체 중복 문장에서 `my name is Alex`로 바뀌었다. 실제 독립 발화 `very` + `very good`은 `very very good`으로 보존되며 잘못된 final `mine is Alice`도 임의 교정하지 않는다.
- `scripts/verify.ps1` exit 0: 69개 파일/606개 시험, typecheck/lint/build/보호 경로/diff PASS (`.agy-work/118_android_compat_verify.log`). 키 문자열 검사 258개 파일, 노출 0.
- 운영 배포 6395f365 exit 0 (`.agy-work/119_android_compat_deploy.log`). 운영 페이지 초기 탐색은 이전 자산을 표시했지만 다시 새로고침한 후 로컬 빌드와 동일한 `/assets/index-CAyyrdEe.js`가 로드된 것을 DOM으로 확인했다. 이 전파 시차를 STT 수정 실패나 캐시 결함으로 단정하지 않는다.
- 새 S25 확인 주소: https://voca-study-akf.pages.dev/?voice-check=1&speech-debug=1&build=20261023-4
- 운영 화면 증거 `.agy-work/120_android_compat_operating.png`. 이 화면 확인은 실제 마이크 정확도 검증을 대신하지 않는다.
- 휴대폰 raw JSON 및 설치 Chrome revision은 미수신. 알려진 Android bridge 경로의 코드 재현·회피 수정은 검증됐으나 S25 실제 발화 중복 해소는 재시험 대기다.
- 추가 Gemini STT/TTS/대화 API 호출 없음. 무료 한도·Access·예산 DB·AI 모델·학습 흐름 변경 없음. stage/commit/push 없음.

## 실제 진단 로그 수신 및 복사 편의 개선
- 사용자 제공 진단은 session 1의 final 결과 목록이 인덱스 0~7까지 증가했다. 빈 결과 3개 뒤에 `my`, `my name`, `my name`, `my name is`, `my name is Alex`가 각각 final=true로 추가됐다. session 2에는 인식 문장이 없었다.
- 따라서 이 로그의 중복은 재시작 사이의 결합이 아니라 같은 세션 내부 누적 가설을 final로 보낸 경로에서 발생했다. 앱은 각 항목을 독립 문장으로 합쳤고 마지막 단어 인식은 정확했다.
- 앞서 구현한 continuous=false 회피 변경을 유지한다. 수신 로그에는 실제 continuous/interimResults 설정이나 빌드 정보가 없어 해당 로그가 수정 전·후 어느 빌드에서 생성됐는지는 미확정이다.
- 사용자가 반복 시험용 전용 복사 버튼을 요청했다. Gemini에 진단 화면에만 '진단 결과 복사' 버튼, 진단 버전 및 native start의 실제 continuous/interimResults 값을 추가하도록 지시했다. 클립보드 복사는 버튼 클릭 때만 수행하고 실패는 화면에 알린다.
- 신규 복사/설정 진단 회귀 시험 3개 FAIL/기존 12개 PASS를 확인했다 (`.agy-work/121_copy_trace_red.log`). Gemini가 2개 제품 파일 구현을 완료했다. Codex 관련 20개 시험 PASS (`.agy-work/123_copy_trace_green.log`), 전체 69개 파일/610개 시험 및 typecheck/lint/build/보호 경로/diff PASS (`.agy-work/124_copy_trace_verify.log`).
- [MDN writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)에 맞춰 HTTPS 환경의 명시적 클릭 시 복사를 시도하고, 거부/미지원 오류를 화면에 표시한다. 모의 클립보드 성공과 거부를 시험했으며 S25의 실제 클립보드 권한은 별도 사용자 확인 대상이다.
- 진단 전용 버튼과 버전은 speech-debug=1에서만 표시된다. 복사/표시 JSON은 diagnosticVersion=single-utterance-6s-v2와 events를 포함한다. start 이벤트에는 실제 native continuous/interimResults 값을 담는다. 자동 복사/서버 저장/전송은 추가하지 않았다.
- 배포 20e1e7a7 exit 0 (`.agy-work/125_copy_trace_deploy.log`). 운영 DOM의 자산 `/assets/index-CWJYcYQh.js`가 로컬 빌드와 일치했다.
- Chrome viewport 360px에서 문서 가로 넘침 없음, 복사 버튼 높이 44px, 빈 기록일 때 비활성화를 확인했다 (`.agy-work/126_copy_trace_mobile.png`). 운영 마이크 발화나 실제 클립보드 쓰기를 했다고 보고하지 않는다.
- 새 시험 링크: https://voca-study-akf.pages.dev/?voice-check=1&speech-debug=1&build=20261023-5
- 비밀키 문자열 검사 258개 파일/노출 0. 추가 유료 API·Gemini STT/TTS·대화 호출 없음. 인식 모드 false와 학습 흐름·예산 한도 유지. main/HEAD 8248697cb4702719dfe7191195bccba5851a9cd4, staged 0, commit/push 없음.
