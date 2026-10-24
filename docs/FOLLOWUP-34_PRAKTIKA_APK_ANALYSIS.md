# FOLLOWUP-34: Praktika 4.41.1 APK 정적 분석 보고

분석일: 2026-10-24 KST. 대상은 사용자가 제공한 `docs/Praktika.4.41.1.apk` 한 파일이다.

## 핵심 결론

1. Flutter 화면과 LiveKit/WebRTC 실시간 음성 통신, Unity/별도 아바타 플러그인, 기기 내 TFLite 아바타 모델이 함께 들어 있다.
2. 포함된 대형 음성 관련 모델은 음성을 512차원 특징으로 바꾸거나 입 모양 이미지를 생성하는 구성이다. 이를 음성→텍스트 엔진이나 무료 Whisper 구현으로 해석할 근거는 없다.
3. 가장 참고할 부분은 **말끝 판단 지연 제어, 마이크·재생 상태 관리, PCM 오디오 처리, 기기별 실제 성능 측정, 초보자용 교정 방식**이다.
4. 실제 STT·대화 LLM·TTS 제공사, 모델명, 서버 프롬프트와 발음 정확도는 이 APK만으로 확정하지 못했다. 추론과 확인 사실을 아래에서 구분한다.

## 분석 범위와 재현 정보

- APK 설치·실행·계정 접속·서비스 API 호출 없이 로컬 정적 분석만 수행했다. APK나 추출 내용을 Gemini 등 외부 AI 서비스에 업로드하지 않았다. 기존 무료 회화 API 사용량을 소모하지 않았다.
- 크기: **130,654,562바이트**(약130.65MB), ZIP 항목 **2,300개**, 압축 해제 기준 합계 **152,788,356바이트**.
- SHA-256: `d0c3d3c45d63700dfd5ff69986f6439b643ce01821507bf71e91b753109482c8`.
- Manifest: 패키지 `ai.praktika.android`, 버전 `4.41.1`, versionCode `2810`, minSdk `32`, targetSdk `36`.
- DEX 2개: `classes.dex` 10,652,672바이트 / `classes2.dex` 8,201,204바이트. 문자열 테이블 합계102,697개 항목을 읽었다.
- ZIP 전체 CRC 오류 없음. DEX 2개 모두 선언 파일 크기·헤더 SHA-1·Adler32 일치. 이 검사는 파일 내부 일관성 검사이며 공식 배포 서명의 진위 확인은 아니다.
- Android binary XML, DEX 문자열·타입·메서드/필드, Unity IL2CPP 메타데이터, TFLite FlatBuffer 입출력, Flutter 번역 키·에셋 목록을 조사했다. 전체 역컴파일이나 실행 추적은 수행하지 않았다.

## 구조별 발견 사항

| 영역 | 이 파일에서 확인한 근거 | 해석과 한계 |
|---|---|---|
| 앱 화면 | `flutterEmbedding=2`, `assets/flutter_assets/`, Flutter 플러그인 등록 코드의 문자열 | Flutter 포함 확인. 전체 Dart 업무 로직은 현재 파일에서 확보하지 못함 |
| 실시간 음성 | `livekit_client`, `flutter_webrtc`, `audio_session`, `record_android`, `flutter_pcm_sound`, `just_audio` 플러그인 등록 문자열 | LiveKit/WebRTC 및 오디오 녹음·재생 구성 포함. 각 경로의 현재 활성 여부·서버 설정은 미확인 |
| 아바타 | `flutter_unity_widget`, `gen_avatars`, Unity 데이터, `SALSA-LipSync.dll` 메타데이터 | Unity와 별도 아바타 모듈의 공존 확인. 모든 화면이 Unity로만 구현됐다는 뜻은 아님 |
| 기기 내 ML | TFLite 형식 파일11개, Interpreter/GPU Delegate 관련 타입 | 기기 내 모델 실행 구성 포함. TFLite 존재만으로 STT를 기기 내에서 한다고 판단할 수 없음 |
| 학습 화면 | 핸즈프리/누르고 말하기, 속도, 교정 강도, 발음 점수 번역 키 | 기능 설명 자료가 포함됨. UI 문자열만으로 실제 알고리즘·정확도·유료 여부를 확정할 수 없음 |
| 인증·운영 | Firebase Auth/Analytics/Crashlytics/Messaging, Google Sign-In, RevenueCat, Amplitude, Adjust, Datadog, Intercom 등의 등록 문자열 | 로그인·구독·분석·진단·고객지원 SDK 포함. SDK 포함은 실제 개인정보 전송 관측과 다름 |
| 권한 | 인터넷, 녹음, 오디오 설정, 카메라, 알림, 결제, 저장소 등 선언 | 선언된 권한 확인. 매 수업에서 해당 권한을 모두 사용한다는 의미는 아님 |

플러그인 등록 관련 문자열은58개다. `Error registering plugin …`은 APK에 포함된 **오류 처리용 문자열**이며 실제 오류가 발생했다는 로그가 아니다.

## TFLite 모델을 직접 확인한 결과

총11개 모델의 압축 해제 크기는 **87,649,352바이트(약87.65MB)**다.

| 모델 | 개수/크기 | 실제 입출력 | 판단 |
|---|---|---|---|
| `audio_encoder_fp32.tflite` | 1개 / 13,964,768바이트 | FLOAT32 `[1,4800]` → FLOAT32 `[1,512]` | 오디오 특징 인코더. 그 자체로 텍스트 전사가 완성되는 구조가 아님 |
| `audio_encoder_dynamic_wi8_afp32.tflite` | 1개 / 3,563,024바이트 | 동일 입출력 | 경량화된 특징 인코더 변형으로 보임. 양자화 세부 성능은 실행 미검증 |
| `lipsync_model_*.tflite` | 8개 / 합계69,806,040바이트 | 이미지 `[1,3,128,128]` 또는 `[1,3,224,224]` 및 특징 `[1,16,512]` → 같은 해상도의 이미지 | Noah/Raven/Skye/Tama별 입 모양 영상 처리 구성. 이름·입출력 모두 아바타 용도를 지지함 |
| `tflite_langid.tflite.jpg` | 1개 / 315,520바이트 | STRING `[1]` →111개 점수와 문자열 라벨 | 확장자는 `.jpg`이지만 내부 식별자는 `TFL3`. 텍스트 언어 분류 모델로 해석됨. 마이크 STT 모델로 볼 근거 없음 |

특징 인코더 출력의512차원과 립싱크 모델 입력의512차원이 맞물린다. **음성 특징을 아바타에 연결하는 구성이라는 해석이 강하게 지지**되지만 실제 런타임 연결 순서를 추적한 것은 아니다.

제공된 파일 범위에서 Whisper/Vosk/Sherpa 모델 파일, STT용 토크나이저·디코더 조합은 확인되지 않았다. 서버 실행·추가 다운로드·누락된 split에 있을 가능성은 배제할 수 없다.

## 음성 상호작용에서 참고할 부분

### 1. 말끝 판단을 별도 제어하는 흔적

Flutter 번역 키에 아래 이름이 들어 있다.

- `lessonSettings.liveKitDebugMinEndpointingDelay`
- `lessonSettings.liveKitDebugMaxEndpointingDelay`
- `lessonSettings.liveKitDebugDebounceDelay`
- `lessonSettings.liveKitDebugUninterruptibleHandsFreeMic`
- `lessonSettings.liveKitDebugLiveTextEnabled`

이는 말끝 판단의 최소·최대 지연, 연속 이벤트 안정화, 핸즈프리·실시간 텍스트를 구분해 다루는 설정 흔적이다. **실제 적용값은 확인하지 못했고, 해당 디버그 UI가 일반 사용자에게 노출되는지도 미확인**이다.

우리 앱에는 생각할 시간과 발화 완료 판단을 분리하는 아이디어가 유용하다. 예를 들어 첫 발화 전 대기는 유지하고, 말하기 시작 후 충분한 무음이 이어지면 조기 종료하는 방식은 검토할 만하다. 현재 사용자가 요청한10초 정책을 이 분석만으로 변경하지 않았다. 초보자가 문장 중간에 쉬는 것을 발화 종료로 오판하지 않는 실제 시험이 필요하다. LiveKit 공식 문서 역시 턴 감지·중단·음성 활동 감지를 별도 영역으로 다룬다: [턴 처리 문서](https://docs.livekit.io/agents/logic/turns/).

### 2. 오디오 재생과 아바타 동기화

DEX에서 다음 클래스·메서드·필드를 확인했다.

- `RenderAudioSyncController`: `setDelayMs`, `setOutputMuted`, `beginAdaptiveGate`, `releaseAdaptiveGate`, 캡처 시작/종료.
- `AdaptiveRenderGateProcessor`: `hasSpeech`, 큐/링 버퍼, 시작·해제 세대, 음성 임계값 필드.
- `RenderDelayProcessor`, `RenderOutputMuteProcessor`, `SingleFlightBatchQueue`, `AndroidRenderAudioCapture`.
- Flutter 설정 키의 render delay/adaptive gate, DEX의 `LipSyncRenderGate`.

**이 gate는 이름·주변 구조상 재생/render와 립싱크 동기화 경로다. 이를 학습자 마이크의 VAD라고 단정하지 않는다.** 참고할 원리는 오래된 오디오/콜백 배제, 재생·캡처 수명주기, 중복 작업 차단이다. 우리 앱에는 이미 세대 식별과 취소·동시 마이크 차단이 있으므로 그대로 재작성할 이유는 없다.

### 3. 녹음 전처리와 PCM 경로

`echoCancellation`, `noiseSuppression`, `autoGainControl`, Android 하드웨어 음성 처리 관련 키와 PCM 녹음·재생 플러그인이 있다. 설정 존재는 확인했지만 실제 기본값과 각 세션의 활성 여부는 미확인이다.

우리 Whisper 레코더는 이미 세 옵션을 `true`로 요청한다(`whisperAudioRecorder.ts`). 따라서 같은 옵션을 추가하는 것만으로 새 정확도 개선을 얻었다고 주장할 수 없다. 다음 검증 후보는 기기에서 실제 반영된 트랙 설정, 마이크 시작 지연, WebM 디코딩 시간, 입력 음량·클리핑이다. 브라우저 constraints는 요청과 실제 지원/설정을 구분해야 한다: [MediaTrackConstraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints).

PCM을 직접 받는 `AudioWorklet` 경로는 별도 검토 후보이며, 인코딩·디코딩 비용 감소 여부를 측정해야 한다. 이것만으로 한국 이름이나 커피/컵의 의미 구분 정확도가 좋아진다고 보장할 수 없다.

### 4. 실제 기기 성능으로 실행 경로 선택

`audio_encoder_accelerator`, `audio_encoder_p80_ms`, `lipSync128P80Ms`, `lipSync224P80Ms`, 모델 probe/benchmark 관련 문자열이 있다. 아바타 처리의 가속기와 지연을 측정하는 구조의 흔적이다. 실행 빈도·실제 측정값·정확한 선택 알고리즘은 미확인이다.

우리 앱에도 GPU 지원 여부만으로 경로를 선택하지 않고 **정상 전사 여부 + 초기 준비 시간 + 반복 지연 + 실패율**을 측정하는 원칙을 적용할 수 있다. 이번 Whisper q8 WebGPU의 잘못된 전사를 실제 시험으로 잡고 WASM으로 바꾼 검증과 같은 방향이다. 아직 S25 실측 비교 리포트는 받지 못했다.

### 5. 초보자용 교정과 진행

번역 자료에는 핸즈프리와 누르고 말하기가 구분돼 있다. 초보자·천천히 생각하며 답하기를 위한 설명도 포함된다. 교정 강도는 부드럽게/균형 있게/엄격하게, 음성 속도는0.7~1.2배 자료가 있다. 발음·유창성·완성도 점수 UI도 있다.

우리 사용자 요구에는 설정을 늘리기보다 **자동 마이크 + 초보자에게 충분한 발화 여유 + 한국어 원포인트 피드백 + 느린 영어 예문**을 기본값으로 제공하는 쪽이 맞다. APK의 UI/문구/모델을 복제할 필요는 없다. STT가 만든 문자열만으로 실제 발음 점수까지 정확하게 계산한다고 주장해서도 안 된다.

## 이 파일만으로 확정할 수 없는 것

- 현재 수업의 STT가 Whisper/OpenAI/Google/Deepgram/자체 모델 중 무엇인지.
- LLM 모델명, 서버 프롬프트, TTS 제공사와 과금 구조.
- 한국 이름과 초보자 발음의 실제 인식률, 처리 속도, 오프라인 가능 범위.
- LiveKit 포함 사실만으로 무료 STT/LLM/TTS를 제공한다고 볼 수 있는지. **그렇게 판단할 근거는 없다.** LiveKit은 음성·영상·에이전트 연결 구성과 모델 연동을 제공한다: [공식 개요](https://docs.livekit.io/intro/overview/).

중요한 제약: Manifest에 `requiredSplitTypes=base__abi,base__density`, `com.android.vending.splits.required=true`가 있고, 이 파일에는 `.so`, `libapp.so`, `libflutter.so`, `libil2cpp.so`가 없다. **이 파일은 ABI·밀도 split을 요구하는 base APK로 판단된다.** Dart AOT와 네이티브 실행 본체가 빠진 상태라 서버 연결 로직을 끝까지 확인할 수 없다. Flutter의 ABI별 배포 구조는 [공식 Android 배포 문서](https://docs.flutter.dev/deployment/android)에 설명돼 있다. 전체 split이 있어도 서버 내부 구현까지 APK에서 확인되는 것은 아니다.

## 권장 우선순위와 현재 상태

1. S25에서 현재 Whisper 비교 리포트를 먼저 확보해 한국 이름/커피/컵/잼/부정어/숫자 정확도와 지연을 판단한다.
2. 개선이 필요하면 첫 발화 대기와 말끝 감지를 구분하고, 녹음·디코딩·추론 시간을 분리 계량한다. 브라우저 전처리의 실제 적용 여부도 확인한다.
3. 한국어 원포인트 피드백과 느린 영어 예문을 유지하고, 아바타·회원가입·구독·분석 SDK는 현재 영어 학습 목적에 필요하지 않으므로 도입 후보로 삼지 않는다.

이번 요청은 분석·보고로 처리했다. 앱 코드와 운영 설정은 변경하지 않았으며 배포·API 호출도 없다. APK 원본과 추출 모델을 프로젝트 자산이나 Git 커밋에 포함하지 않았다.

## 근거 파일과 해석 기준

작업용 증거는 Git에서 제외된 `.agy-work/apk-analysis/` 아래에 있다.

- `manifest-safe.json`: 민감한 메타데이터 값을 가린 Manifest 구조.
- `asset-inventory.json`: 압축 해제 없이 읽은 파일명·크기.
- `models-shapes.json`: TFLite 식별자·스키마·입출력 텐서.
- `audio-details-safe.json`: 오디오 클래스/메서드/필드와 필터링한 문자열.
- `findings-summary.json`: 플러그인·설정 키·규모 집계.
- `integrity.json`: ZIP CRC 및 DEX 내부 일관성 검사.

TFLite 텐서 타입과 테이블은 [TensorFlow 공식 FlatBuffer 스키마](https://raw.githubusercontent.com/tensorflow/tensorflow/master/tensorflow/compiler/mlir/lite/schema/schema.fbs)를 기준으로 해석했다. 모델 추론을 실행하거나 앱 실행 성능을 측정한 결과가 아니다.

## 추가 확인: 교육 자료와 STT/Whisper 포함 여부

- `translations/en.json`의 문자열 말단 항목1472개 중 수업·코스·문법·역할극·어휘 관련 키/문구201개를 확인했다. 이는 UI 키워드 검색 집계이며201개 수업이나 예문이 있다는 뜻이 아니다.
- 문법 학습 자료 화면, 역할극 상황 지정, 토론 주제 지정, 사전 저장, 코스 추가 생성 등의 UI 구성 흔적이 있다. 완성된 수업별 대본·질문·정답·교정 기준 데이터 묶음은 확인하지 못했다.
- 번역 파일을 제외한 JSON은 Unity/폰트/네이티브 자산 설정 및 온보딩·상품·결제 노출용 mockup이 대부분이었다. 독립적인 수업용 CSV/SQLite/문제은행/PDF 파일은 경로·확장자 조사에서 발견되지 않았다. Unity 바이너리의 모든 내부 자산을 역직렬화한 것은 아니므로 완전한 부재 증명은 아니다.
- 독립 MP3는5개이며 파일명은 `lesson_finished`, `success`, `incorrect_answer`, `send_message`, `success_short`이다. 수업 완료·성공·오답·메시지 전송 효과음으로 보인다. 영어 회화 대본 녹음 묶음은 확인되지 않았다. MP3 재생 확인은 수행하지 않았다.
- 추가 모델 경로 조사에서도 Whisper/ONNX/GGML/GGUF 모델·STT용 토크나이저와 디코더는 확인되지 않았다. LiveKit/WebRTC 통신 구성은 STT 제공사·모델 식별 증거와 구분해야 한다.
- 결론: **교육 기능을 설계하는 단서는 있지만, 바로 가져다 쓸 전체 교재나 무료 STT/Whisper 엔진은 제공된 APK 범위에서 확인되지 않았다.** 서버·다운로드 콘텐츠·누락된 ABI split의 가능성은 남는다. 원본 모델·교재를 앱에 복사하거나 서비스에 접속하지 않았다.
- 추가 조사 작업 기록: `.agy-work/457_apk_education_check.log`.

## 공식 공개 자료로 보완한 서버 교육 구조

추가 확인일: 2026-10-24. 앞의 'STT 제공사 미확인'은 **제공 APK만 정적으로 조사했을 때의 한계**다. 다음은 별도로 확인한 공개 서비스 설명이며 APK 4.41.1의 실행 추적 결과와 구분한다.

- OpenAI의2026-01-22 Praktika 고객 사례는 **Transcription API를 통한 음성 인식**, GPT 기반 대화형 튜터, 학습 성과 추적·학습 계획·지속 메모리를 설명한다. 따라서 서비스 차원에서 외부 AI API를 사용한다는 공개 근거가 있다. [공식 사례](https://openai.com/index/praktika/)
- 이는 음성 인식 모델의 가중치를 휴대폰에 다운로드한다는 뜻이 아니라, 서버의 AI API로 음성을 처리하고 인식 결과를 받아 사용하는 방식의 근거다. 정확한 앱→Praktika 서버→공급사 통신 경로는 이번에 관찰하지 않았다.
- 공개 사례는 수업 목표·학습자 정보·최근 대화와 이전 실수를 활용해 수업을 조정하는 구조를 설명한다. 모든 교육 대본이나 교재가 APK 내부 정적 파일로 들어 있을 필요는 없다.
- Transcription API의 정확한 STT 모델명은 해당 사례에서 식별되지 않는다. 이를 Whisper라고 단정하지 않는다. TTS 공급사도 이번 자료로 확정하지 않았다. 공개 시점의 GPT 모델 설명을 이 APK의 모든 세션에 그대로 적용해 확정하지 않는다.
- Praktika 공식 도움말도 수준에 맞춘 수업·개인화 계획, 실시간 문법/어휘 지원·교정, 모국어 학습 지원을 설명한다. [Learning Process](https://intercom.help/praktika-ai/en/articles/10707916-learning-process)

교육 기능이 없다는 결론이 아니다. **APK는 학습 화면·마이크·출력 등을 담당하고, 서버 쪽 AI와 학습 상태를 연결해 교육하는 서비스 구성**으로 이해할 근거가 보완됐다. 내장 대형 TFLite 모델의 입출력 분석 결과와도 모순되지 않는다.
