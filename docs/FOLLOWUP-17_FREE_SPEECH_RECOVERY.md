# FOLLOWUP-17 무료 영어 인식 후보 복구

## 목표와 실제 확인 범위
- 사용자는 초보자 발음도 잘 알아듣도록 무료 범위에서 조사·구현하고 Gemini 구현/Codex 지시·검증을 요청했다.
- S25 최신 실제 로그에서 중복 수집은 해결됐고, `Alex` 발화를 최종 `Alexa`로 인식한 사례가 남았다. 녹음 원본은 없으므로 실제 음향·발음 원인이나 개선율을 단정하지 않는다.
- 웹 앱이 Google 브라우저 음성 엔진 자체를 재학습할 수는 없다. 이번 변경은 엔진이 이미 만든 다른 후보를 버리지 않고, 사용자 확인으로 잘못된 1순위를 복구하는 것이다.

## 조사 결과와 채택
| 방법 | 검토 결과 | 결정 |
| --- | --- | --- |
| maxAlternatives=3 | 기본 1개 후보보다 다른 native 후보를 받을 기회를 늘린다. 최대치 요청이며 3개 반환 보장은 없다. | 채택 |
| 사용자 음성으로 대체 후보 확인 | 거부된 1순위 대신 실제 native 다음 후보를 보여주고 한국어 네/아니요로 확인한다. 확인 전 AI 호출 없음. | 채택 |
| 문맥 phrases/음성팩 강제 | experimental. 조사한 Chromium Android 인식기의 UpdateRecognitionContext는 미지원 오류 경로가 있다. S25 로컬 영어팩도 이미 실패했다. | 적용하지 않음 |
| 다른 영어 지역 태그 | 한국인 초보 발음에 대한 개선 근거 없음. en-KR의 문법적 유효성과 엔진 지원은 별개다. | en-US 유지 |
| 브라우저 Whisper | 공식 Transformers.js에 WebGPU ASR 예시가 있다. 새 모델/라이브러리 다운로드와 S25 메모리·속도·정확도 실측이 필요하다. 현재 결과 없이 품질 향상을 보장할 수 없다. | 이번 변경에 설치하지 않음 |
| 마이크 게인·필터 | 현재 native WebSpeech 입력 경로에 바로 적용할 설정이 없다. 실험적 audioTrack API를 모든 기기에 적용할 수 있다고 가정하지 않는다. | 새 녹음 파이프라인 추가 안 함 |

## 공식 출처
- [maxAlternatives](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/maxAlternatives)
- [phrases](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/phrases)
- [Chromium Android native adapter](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/speech/speech_recognizer_impl_android.cc)
- [Transformers.js WebGPU 음성 인식 예시](https://huggingface.co/docs/transformers.js/en/guides/webgpu)

## 구현 계약
- Gemini는 BrowserSpeechInputService와 CoachTutorController 두 제품 파일을 구현한다. Codex가 시험과 문서를 작성·검증한다.
- continuous=false, interimResults=true, native 준비부터 6초, 한국어 진행, 명시적 음성 확인, 18세 체크를 유지한다.
- window mode에만 maxAlternatives=3을 요청한다. final 결과마다 실제 후보 최대 3개를 보존하고, 분절 발화/재시작에서도 앞 문장을 보존한 전체 문장 후보 최대 3개를 만든다.
- raw 1순위 반환을 유지하고, 정확히 같은 빈 문자열·중복만 제외한다. 교재 정답·유사도·신뢰도 임계치로 후보를 조작하지 않는다.
- 첫 후보 거부 시 한국어로 다음 후보를 안내하고 해당 영어 후보를 영어 음성으로 읽은 뒤 한국어로 확인한다. 사용자가 네라고 한 후보만 평가한다. 모두 거부하거나 후보가 하나면 기존 제한된 재발화로 돌아간다.
- 무응답/애매한 확인은 자동 수락하지 않는다. 취소/늦은 콜백은 결과를 바꾸지 못한다. 반복 학습에도 같은 원칙을 적용한다.
- Gemini STT/TTS·추가 AI API·새 키·의존성·음성 저장·서버 전송을 추가하지 않는다.

## 검증 진행
- Gemini 조사 응답을 검토하여 출처 없는 발음 원인·모델 다운로드 크기·언어 태그 단정은 채택하지 않았다.
- 구현 전 새 시험 11개 중 6개 FAIL/5개 PASS를 확인했다 (`.agy-work/128_accuracy_red.log`).
- Gemini 1차 구현 후 서비스 23개 시험 PASS (`.agy-work/130_accuracy_service_check.log`). 실제 수집 서비스를 컨트롤러에 연결한 모의 native 통합 시험에서 1순위 Alexa 거부→2순위 Alex 확인→초기/반복 평가만 총 2회 호출하는 흐름을 확인했다.
- 1차 확인 시험 35개 중 34개 PASS/1개 FAIL: 대체 후보 TTS 실패 오류가 paused로 덮이는 결함을 발견했다 (`.agy-work/131_accuracy_controller_check.log`). Gemini에 fatal_error 분기와 호출부 즉시 종료를 지시했고 후속 확인 시험 30개 PASS (`.agy-work/133_accuracy_confirm_green.log`).
- Gemini는 후속으로 실제 maxAlternatives 요청값, 각 native 결과의 choices(최대 16구간×3후보×160자), 최종 전체 문장 alternatives(최대 3후보×500자) 진단을 추가했다. 진단 제한은 실제 평가 후보 원문을 자르는 처리가 아니다. 진단/복사 버전 speech-alternatives-6s-v3, 기존 복사 버튼 유지.
- 일반 화면에는 다른 후보가 있을 때 음성으로 먼저 확인한다는 한 문장 안내만 추가했다. 필수 버튼·설정·추가 동의는 없다. 한국어 진행과 대체 후보의 영어 읽기 언어를 구분했다.
- 진단/수집 회귀 29개 PASS (`.agy-work/134_accuracy_diagnostics_check.log`). 전체 검증 exit 0: 71개 파일/625개 시험, typecheck/lint/build/보호 경로/diff PASS (`.agy-work/135_accuracy_verify.log`). 제공된 키 문자열 검사 261개 파일/노출 0.
- 운영 배포 463644c1 완료 (`.agy-work/136_accuracy_deploy.log`). 운영 DOM의 `/assets/index-B6vjdX_c.js`가 로컬 빌드와 일치했다. 360px 너비에서 문서 가로 넘침 없음, 체크박스 1개, 복사 버튼 44px·시작 전 비활성화, 안내·진단 v3 표시를 확인했다 (`.agy-work/137_accuracy_operating_mobile.png`). 이는 실제 마이크 정확도 확인을 대체하지 않는다.
- S25 시험 링크: https://voca-study-akf.pages.dev/?voice-check=1&speech-debug=1&build=20261023-6
- S25 실제 후보 반환 개수 및 초보 발화 복구율은 새 진단 로그/사용자 시험 대기다. maxAlternatives는 최대치 요청이며 엔진이 실제로 복수 후보를 반환한다고 보장하지 않는다. 음향 모델 정확도나 학습자 억양 인식률의 측정된 향상으로 보고하지 않는다.
- Gemini STT/TTS·추가 대화 API 실제 호출 0. 로컬 모의 ASR·모의 평가 시험과 실제 사용자 발화 검증을 구분한다. 무료 90% 한도·Access·예산 DB·대화 모델 변경 없음.
- 제품 변경 범위: BrowserSpeechInputService, CoachTutorController, CoachTutorView. Codex 시험 2개 파일 추가 및 기존 진단/뷰 시험 갱신. Gemini 연구 보고의 부정확한 일반화는 채택하지 않았다.
- main / HEAD 8248697cb4702719dfe7191195bccba5851a9cd4 유지, staged 0, commit/push 없음. 기존 사용자 변경을 되돌리거나 전체 세션 결과를 이번 수정으로 간주하지 않았다.

## 후속: native network 오류 조사 (사용자 재시험 복구 확인)
- 사용자가 '네트워크 연결 오류로 음성 인식에 실패했습니다'를 보고했다. 해당 문구는 BrowserSpeechInputService window capture에서 native event.error=network일 때 생성된다. 앱 Gemini API 응답 문구와 구분한다.
- [MDN error 정의](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionErrorEvent/error)는 인식에 필요한 네트워크 통신 실패다. [Chromium Android Java 오류 매핑](https://raw.githubusercontent.com/chromium/chromium/main/content/public/android/java/src/org/chromium/content/browser/SpeechRecognitionImpl.java)은 ERROR_NETWORK_TIMEOUT/ERROR_NETWORK/ERROR_SERVER를 NETWORK로 묶는다. 기기의 인터넷 단절이나 후보 개수 3 설정이 원인이라고 단정하지 않는다.
- 공개 앱 HTTP 200, 자산 index-B6vjdX_c.js 유지 확인. 이는 동일 휴대폰의 음성 서비스 연결 성공을 뜻하지 않는다.
- 관련 기존 시험 28개 PASS (`.agy-work/139_network_existing_checks.log`). network 오류가 나면 이전 결과/후보를 성공으로 반환하지 않고 타이머·마이크를 정리하는 경로를 확인했다.
- Gemini에 최근 변경·native 오류 경로 읽기 전용 분석을 지시했다. 첫 연결인지 자동 재시작 중인지 확인할 실제 진단 로그와 한 번 재시도 결과를 사용자에게 요청했다.
- PC의 기존 자동화 탭은 사라졌고, 새로 확인한 시험 탭 연결도 브라우저 도구의 focus 연결 시간 초과로 두 번 실패했다. 실제 탭의 로그를 읽었다고 주장하지 않는다.
- Gemini 읽기 전용 분석 완료 (`.agy-work/138_network_analysis_response.json`). native network 경로와 앱 API를 구분했고, 후보 3개 요청이 오류의 원인이라는 증거는 없었다. 자동 1회 재시도는 검토 후보로만 남겼으며 구현하지 않았다.
- 사용자가 이후 “잠시 네트워크가 안좋았다 my name is alex 제대로 인식했다”고 확인했다. 제품 수정/재배포 없이 재시험에서 정상 인식됐으므로 이 신고는 일시 연결 불안정 후 복구된 사례로 정리한다. 실패 당시 원시 트레이스나 네트워크 세부 원인은 확보하지 않았다.
- S25에서 해당 합성 문장 1회 정확 인식을 사용자 보고로 확인했다. 복수 후보 반환 개수·대체 후보 선택 성공·다른 초보 발음의 개선율까지 검증된 것으로 확대하지 않는다.
- 이 조사에서는 제품 수정·재배포·무료 Gemini API 실제 호출 없음. 관련 기록만 갱신했다. commit/push 없음.
