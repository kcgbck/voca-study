# 자동 음성 연결 1차 구현·검증

2026-10-23 KST. 사용자 최신 요구: Gemini가 구현, Codex가 지시·검증. 무료 Web Speech API TTS+STT로 시작 후 질문→자동 듣기→응답 처리를 연결하고, S25 Edge 실제 동작을 확인한 뒤 학습 화면을 개편한다. 공개 방식은 사용자가 **18세 이상 간단 체크, 로그인 없이 공개**로 결정했다.

## 이번 변경

- `browserSpeechInput.ts`: 언어팩 설치/`processLocally` 강제가 없는 기본 SpeechRecognition 경로. en-US, final 결과, 최대 30초+종료 유예 2초, 취소·이전 콜백 차단. 앱의 Gemini STT 호출 없음. 브라우저 제공자의 원격 처리는 가능하다.
- `handsFreeVoiceLoop.ts`: 질문 TTS 완료 후에만 자동 STT 시작. TTS 15초 상한, 취소·일시정지, 오류 시 자동 재시도 없음.
- `HandsFreeSpeechCheck.tsx`: 18세 체크와 짧은 처리 안내, 세 질문의 재생→자동 듣기→인식 문장 읽기. 답변은 메모리에서만 사용하고 AI 평가로 표시하지 않는다. 화면 숨김·이탈·언마운트 시 취소.
- `index.tsx`: 회화 홈에 음성 연결 확인 진입만 추가. 기존 저장 세션과 수업을 삭제하지 않았다.

## Codex 검증

새 정식 시험 12개. 권한 오류 뒤 종료 이벤트 누락, 재시작 시 타이머 간섭, 결과 읽기 실패의 성공 오표시, pagehide 취소 누락을 실패로 재현하고 Gemini 수정 후 통과했다. 서비스·제어기·UI 정책 모의 시험이며 실제 사람의 음성이나 S25 성공을 뜻하지 않는다.

`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1`: **60파일·532시험 PASS**, typecheck/lint/build/보호 경로/diff PASS. `.agy-work/067_handsfree_verify.log` 참조. 제공된 키 문자열 검사 237개 소스·빌드 파일에서 일치 0건. 360px 실제 로컬 Chrome 화면의 main clientWidth/scrollWidth 모두 340px로 가로 넘침 없음. `.agy-work/067_voice_check_360.png` 참조.

## 현재 경계와 다음 단계

- 사용자 배포 승인 후 기존 Wrangler로 운영 배포 완료. 배포 ID `462e0e84`, 주소 `https://462e0e84.voca-study-akf.pages.dev`. 운영 메인 주소에서 회화 홈의 새 버튼과 검사 화면을 확인했다. `.agy-work/068_deployed_voice_check.png` 참조. 운영 Access·예산·API 키 설정을 바꾸지 않았다.
- S25 Edge에서 세 질문의 소리, TTS 후 자동 마이크, 실제 인식 문장, 결과 읽기, 다음 전환은 **미검증**. 휴대폰이 이 PC의 브라우저 제어에 연결되어 있지 않아 실제 발화는 사용자가 진행해야 한다.
- 확인 방법: 회화 홈→음성 연결 확인→18세 체크→확인 시작. 질문이 끝나고 듣는 중이면 합성 이름/나이/음료로 답한다. 별도 마이크·전송 버튼 없이 문장이 표시되고 읽히는지 확인한다. 다음 질문 버튼으로 총 3개를 확인한다. 언어팩 설치는 하지 않는다.
- 확인 후 정답 1회/교정 필요 2회 연습과 자연어 원포인트 지도를 연결한다. 단답의 의미와 완전 문장 학습 목표는 구분한다. 일반적인 올바른 대답을 고정 키워드와 다르다는 이유로 오답 처리하지 않는다.
- 로그인·다중 시험 동의 제거는 **아직 미적용**. 익명 공개 API의 호출 제한과 18세 assertion/짧은 처리 안내를 검증한 뒤 전환한다. 독립 D1의 프로젝트 전역 90% 예산과 관리자 경로 보호는 유지한다. 원래 Access JWT 경로를 단순히 무조건 통과시키지 않는다.

Git: main / HEAD `8248697cb4702719dfe7191195bccba5851a9cd4`, staged 0. 기존 변경을 보존했다. Codex/Gemini의 stage·commit·push 없음. 새로운 종량제 API·키·의존성 추가 없음. 전체 요청 완료 또는 공개 출시 승인으로 보고하지 않는다.
