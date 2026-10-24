# 운영 대화·예산 차감 검증

사용자 날짜: 2026-10-23 (KST). 사용자가 인증 수정과 기본 브라우저 듣기 변경을 직접 운영 배포한 뒤 Codex가 검증했다. 키·JWT를 읽거나 Gemini에 전달하지 않았다.

## 확인 결과

| 항목 | 관찰 |
|---|---|
| 시험 입력 | 개인정보 없는 합성 영어 문장 3개 |
| 실제 모델 응답 | 연습 2회 + 역할극 1회, 3/3 성공 |
| 모델 | `gemini-3.5-flash-lite` |
| 예산 예약 | 시험 전 0건 → 시험 후 `consumed` 3건 |
| 기록된 입력 예산 | 합계 62,847 보수적 입력 단위 |
| 음성 예산 행 | STT·TTS 모델 행 없음 |
| 기본 듣기 | 새 UI에서 실행 후 재생 오류 표시 없음. 음질·청취 정확도는 확인하지 않음 |

입력은 `My name is Alex.`, `What is your name?`, `Hello, my name is Alex.`였다. 역할극에서는 새 영어 튜터 응답과 한국어 평가가 표시됐고, 규칙 엔진 전환 안내는 없었다. `JWKS_FETCH_ERROR`도 이 3회에서 재발하지 않았다.

DB는 대시보드의 읽기 전용 집계 SELECT로 확인했다. 원문 발화·음성·JWT·개인 학습 기록을 DB에 추가 저장하지 않았다. 예산 단위는 Google의 실제 토큰 사용량이나 금액이 아니다. 이번 결과는 장기 안정성, 실제 한도 도달 시 거부, 다른 앱을 포함한 Google 프로젝트 전체 사용량을 검증한 것이 아니다.

## 기기 내 음성 입력 준비

마이크·언어팩 설치를 실행하지 않는 별도 localhost 페이지에서 현재 Chrome의 네이티브 인식 API, `processLocally`, `available()` 지원을 확인했다. 영어 언어팩 상태는 `downloadable`이며 아직 설치하지 않았다. 실제 발음 인식은 미검증이다.

Gemini가 `localSpeechInput.ts`와 마이크 UI를 구현했다. 기본 마이크는 기기 내 인식만 사용하며, 지원 확인 5초·음성 입력 30초·종료 유예 2초로 한정한다. Google STT는 별도 `클라우드 음성 입력 (한도 사용)` 버튼과 기존 동의 조건을 통과해야 한다. 원격 브라우저 인식으로 자동 전환하지 않으며, 결과는 입력창에만 채우고 사용자가 직접 전송한다.

`영어 음성팩 설치` 버튼을 직접 눌렀을 때만 브라우저의 설치 API를 호출한다. 설치만으로 마이크를 켜거나 발화를 전송하지 않는다. 설치 반환값이 false이면 실패로 표시한다. [MDN 기기 내 처리](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally), [MDN 언어팩 설치](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/install_static)를 대조했다.

최초 9개 중 1개 실패한 대기 중 취소 경계는 수정 후 9개 모두 통과했다. 추가로 준비 중 완료 버튼의 지연 시작과 설치 실패 안내를 재현·수정했다. 정식 신규 시험은 서비스 9개·단계 경계 2개·UI 정책 7개, 합계 18개다. 최종 전체 **57파일 520시험**, 타입 검사·lint·build·보호 경로·diff 검사가 통과했다(`.agy-work/060_final_verify.log`). 제공 키 리터럴 검색은 소스/빌드 230파일 0건이었다.

360px 폭의 실제 컴포넌트 미리보기에서 입력칸이 44px로 줄고 버튼 글자가 겹치는 현상을 확인했다. Gemini가 입력행 줄바꿈과 버튼 폭을 수정한 뒤 입력칸 310px, 버튼 높이 44px 이상, 컨테이너의 가로 넘침 없음으로 재확인했다. 이는 실제 Android/Safari 시험을 대체하지 않는다.

새 음성 입력 코드는 **사용자 재배포 완료, 운영 UI 반영 확인** 상태다. 사용자가 영어 음성팩 설치 완료를 알렸다. 실제 발화 시험 직전 읽기 전용 DB 집계는 대화 `consumed` 3건·62,847단위이며 STT·TTS 행은 없다. 사용자에게 기기 입력으로 합성 문장을 말하고 전송하지 않도록 안내했다. 실제 인식 결과와 시험 후 DB 비교는 아직 대기다(`.agy-work/061_mic_verification.json`). Google STT 22회/일·2회/분 한도 자체를 늘리지 않았고, 기기 내 입력 경로는 이를 소모하지 않도록 구현했다. 대화 모델의 기존 450회/일 및 나머지 90% 정책은 유지한다.

## 증거

2026-10-23 실제 PC 시험 후속: 사용자는 기기 입력의 en-US 팩 미준비 오류와 설치 실패를 보고했다. 운영 화면에서도 설치 실패를 확인했다. 시험 후 DB는 대화 consumed 3건·62,847단위 그대로이며 STT·TTS 행은 없다. 실패 시 클라우드 자동 전환/차감은 관찰되지 않았지만 실제 음성 인식 성공은 미검증이다. 브라우저 설치 실패의 세부 원인은 아직 확인되지 않았다. MDN 호환 데이터에서 Chrome Android의 `available()` 및 Safari의 해당 기능은 미지원이므로 모바일 앱 버튼이 해결책이라고 안내하지 않는다. 대안은 입력창에서 모바일 키보드의 영어 음성 입력을 사용하는 것으로, 앱의 Gemini STT 호출과 별개이며 기기 내 처리 여부는 키보드 설정에 따른다.

- `.agy-work/058_operating_verification.json`
- `.agy-work/058_roleplay_success.png`
- `.agy-work/058_budget_final3.png`
- `.agy-work/058_device_stt_capability.png`
- `.agy-work/058c_stt_baseline.log`
- `.agy-work/059_local_final_tests.log`
- `.agy-work/060_final_verify.log`
- `.agy-work/060_mic_layout_after.png`

기존 PWA 앱 셸이 먼저 캐시에서 반환돼 2회 새로고침 후 최신 JS 및 별도 클라우드 듣기 버튼을 확인했다. 사용자 저장 데이터를 삭제하거나 서비스 워커 캐시를 강제로 초기화하지 않았다.

공개 출시 상태는 `NOT_APPROVED`다. 허용 계정 범위와 90% 한도는 유지했다. 실제 마이크·모바일 기기 검증, 사람 교사 검수, 외부 독립 리뷰는 여전히 별도다. Codex의 배포·stage·commit·push는 없었다.
