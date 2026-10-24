# FOLLOWUP-33: 기기 내 무료 Whisper ASR 및 Web Speech API 정밀 비교 패널 구현

> **현재 상태: WASM 비교 기능 운영 배포 및 실제 PC 실행 검증 완료.** Gemini 구현·Codex 검증으로 전체84파일/872시험 통과. PC 공개 음성2회 정상 전사(1747/1761ms), 재시작 캐시 준비1084/1114ms, 예산 DB 추가 차감0건. 실제 S25 발음 정확도·속도는 사용자 리포트 대기이며 기본 학습 Web Speech는 유지한다.

**일시:** 2026-10-24 KST  
**구현 담당:** Gemini (Implementer)  
**감독 및 검증:** Codex (Supervisor / Independent Verification)  
**구현 범위:**
- `src/features/conversation/whisper/whisperTypes.ts`
- `src/features/conversation/whisper/whisperWorker.ts`
- `src/features/conversation/whisper/whisperClient.ts`
- `src/features/conversation/whisper/whisperAudioRecorder.ts`
- `src/features/conversation/whisper/whisperBenchmark.ts`
- `src/features/conversation/components/WhisperBenchmarkPanel.tsx` (신규 컴포넌트)
- `src/features/conversation/components/CoachTutorView.tsx` (접점 통합)

---

## 1. 개요 및 구현 목적

Samsung Galaxy S25 (Android Chrome) 등 모바일 단말 환경에서 무료 브라우저 내장 Web Speech API와 기기 내(In-Browser Client-Side) Whisper tiny (q8) 모델의 인식 품질(WER/CER) 및 처리 지연 시간을 객관적으로 대조할 수 있는 **기기 내 음성 비교 패널 (`WhisperBenchmarkPanel`)** 및 Web Worker ASR 파이프라인 수명주기 결함 수정을 완료했습니다.

- **원격 전송 일체 없음 (Whisper 측 한정):** 마이크 오디오 버퍼(Float32Array)는 브라우저 메모리에만 머무르며 파일 저장, 외부 서버/DB 업로드가 전혀 없습니다 (단, 브라우저 기본 내장 Web Speech API는 브라우저 제조사/벤더사 정책에 따라 음성이 원격 전사 서버로 전송될 수 있습니다).
- **비용 0원 원칙:** 비교 실행 과정에서 Gemini LLM API 호출 0회, 외부 유료 STT/TTS API 0회, D1 회화 예산 차감 0회를 유지합니다.
- **온디맨드 다운로드:** 일반 단어장이나 회화 방문 시에는 대용량 모델을 자동 다운로드하지 않으며, 사용자가 접힌 패널에서 'Whisper 준비 (최초 약 65~70MB)'를 명시적으로 클릭했을 때만 다운로드를 시작합니다.
- **단일 운영 URL:** 별도의 테스트 URL 없이 정규 루트(`https://voca-study-akf.pages.dev/`)의 회화 화면 및 완료 화면 하단에 접힌 패널로 통합되었습니다.

---

## 2. 수명주기 결함 수정 내용 (P1 Remediation)

1. **`WhisperClient.ts` 타이머 및 세대 무효화 완비**:
   - `prepare()` 시 WebGPU 지원 확인(`checkWebGpuSupport`) 비동기 대기 전에 `isBusy = true`, `isCanceled = false`, 세대 증가(`++this.generation`), 전체 180초 타이머를 즉시 확립하여 취소나 중복 실행 경합을 원천 차단.
   - 180초 타이머 만료 시 `this.generation++`를 수행하여 이전 probe가 늦게 resolve되더라도 새 Worker를 스폰하지 못하도록 방어.
   - `runSingleInit` 내부의 로컬 단일 타이머(`activeSingleTimer`)를 취소/성공/실패 모든 경로에서 `clearAllTimers()`로 확실히 해제.
   - 모든 세대 불일치(`this.generation !== currentGen`) 분기에서는 공유 상태(`isBusy`, `activePendingReject`)를 일체 건드리지 않고 조용히 탈출하도록 수정.

2. **`WhisperAudioRecorder.ts` 리소스 누수 및 무한 대기 방지**:
   - 권한 요청 타이머를 로컬 변수(`localPermissionTimer`)로 격리하여 이전 세대의 finally 블록이 새 녹음 세션의 타이머를 지우지 못하도록 보호.
   - `decodeAudioData`에 15초 하드 타임아웃(`localDecodeTimer`)을 결합하여, 디코딩이 멈추거나 중단될 때 `AudioContext`를 닫고 명시적 실패로 즉시 탈출.
   - 지연된 `localCtx.close()` Promise의 거부(rejection)도 `.catch(() => {})`로 안전하게 흡수.

3. **`whisperBenchmark.ts` 유효성 검증 및 집계 정밀화**:
   - `calculateWER`, `calculateCER`: 참조 문장이 비어있거나 정규화 후 유효 문자가 없는 경우 1.0이 아닌 명시적 `Error`를 throw하여 invalid reference와 100% 오류를 명확히 구분.
   - 리포트 헤더에서 1건 완료를 1/1 완료로 왜곡하지 않고, 기본 `BENCHMARK_SENTENCES.length` (6개) 대비 고유 문항 ID 집합(`completedSentenceIds.size`)을 기준으로 `X/6개 고유 문항 완료`로 투명하게 표기.

4. **`whisperWorker.ts` 캐시 무결성 검증 수정**:
   - 필수 7개 파일 목록에서 `vocab.json`을 실제 Hugging Face 모델 로드에 필요한 `preprocessor_config.json`으로 교체.
   - `isWarmCache` 판정 시 고정 revision(`ff4177021cc41f7db950912b73ea4fdf7d01d8e7`)이 포함된 URL에 필수 7개 파일이 init 전 스냅샷에 모두 존재했을 때만 true로 인정.

---

## 3. Phase 2 벤치마크 패널 (`WhisperBenchmarkPanel.tsx`) 설계 및 기능

1. **상호 배제 (Mutual Exclusion) 및 안전 가드**:
   - 코칭 진행 중(`coachingActive === true`)에는 비교 패널의 'Whisper 준비' 및 '비교 시작' 버튼이 비활성화됩니다.
   - 비교 패널 실행 중에는 `onBusyChange(true)`를 통해 상위 `CoachTutorView`의 `benchmarkBusy` 상태 및 ref를 동기화하여 코칭 시작, 다음 질문, 텍스트 전환, 텍스트 제출 버튼을 모두 차단합니다.
   - 패널 닫힘, 페이지 숨김(`visibilitychange`), `pagehide`, 컴포넌트 unmount 시 브라우저 STT, 오디오 레코더, Whisper Worker, 브라우저 TTS, 모든 타이머를 즉시 취소(`cancel()`)합니다.

2. **6종 대조 문항 및 순차 Pair 발화**:
   - 한국어 이름(`Minjun Park`), 음료 주문(`coffee` vs `couple`), 컵 요청(`cup` vs `coffee`), 식사 어휘(`jam` vs `gym`), 부정어(`do not like`), 숫자(`thirty`).
   - 사용자가 본인 영문 이름을 직접 입력하여 참조 문장을 수정할 수 있으며, 이 참조 텍스트는 오직 브라우저 로컬 React state에만 유지되고 STT 인식 힌트나 AI 프롬프트로 주입되지 않습니다.
   - **순차 실행 흐름**:
     1. 버튼 클릭 즉시 브라우저 Web Speech API 1차 발화 (10초).
     2. 브라우저 한국어 TTS로 `"이번에는 기기 내 인식입니다. 같은 문장을 다시 말해 주세요"` 안내 발화.
     3. 3초 카운트다운 후 In-Browser Whisper 2차 녹음 (10초).
     4. 단순 에너지 무음 검사 통과 시 Whisper Worker 전사 추론 실행.

3. **공개 예제 독립 실행 검증 (JFK.wav)**:
   - Hugging Face 공식 가이드의 공개 예제 WAV(`jfk.wav`, 약 1.94 MiB, 44.1kHz stereo 11초)를 fetch(15초 상한/최대 3MiB 상한 리더)하여 디코딩 후 순수 Whisper 추론을 즉시 테스트할 수 있는 검증 버튼 제공 (원어민 샘플이므로 6종 초보자 벤치마크 통계에는 섞이지 않고 별도 표시).

4. **수동 리포트 복사 (`whisper-compare-v1`)**:
   - Web Speech와 Whisper의 총 소요 시간(10초 듣기 포함)을 대칭 표시하고, Whisper의 순수 추론 지연 시간(Inference Latency)을 별도로 표기.
   - 단말 메타데이터(UA 기반 또는 사용자 수동 입력), 모델 정보, 캐시 상태, 고유 완료 문항 수(X/6), 평균 WER/CER, 실패 횟수를 포함.
   - 불완전하거나 실패한 결과가 있을 시 Whisper 우세로 자동 판정하지 않으며, 실기기 실측 수치에 따라 전환 여부를 수동 결정함을 명시.
   - 클립보드 거부/미지원 시 `readOnly textarea`를 화면에 노출하여 길게 누르기로 수동 복사 지원.

---

## 4. 모델 용량 및 플랫폼 제약 명시

- **실제 다운로드 용량 (Metadata 기반):**
  - ONNX 양자화 가중치: `encoder_model_quantized.onnx` (10,124,990 bytes) + `decoder_model_merged_quantized.onnx` (30,719,241 bytes) = 약 40.8 MB
  - ONNX 런타임 WASM 바이너리: `ort-wasm-simd-threaded.jsep.wasm` (21,596,019 bytes)
  - 설정 및 토크나이저: 약 2.7 MB
  - **총 다운로드 크기:** 약 65 ~ 70 MB.
- **모바일 칩셋 및 성능 전제:**
  - 특정 칩셋(Snapdragon/Exynos) 모델명을 하드코딩하지 않으며 브라우저의 실제 `navigator.gpu` capability를 동적으로 검사합니다.
  - WebGPU 초기화 실패 시 단일 스레드 WASM으로 폴백하되, WASM이 WebGPU보다 빠를 것으로 가정하지 않으며 실제 S25 단말에서의 유리한 실측 결과가 나오기 전까지는 기존 Web Speech API를 메인 엔진으로 유지합니다.

## 이전 중간 검증 기록 (후속 수정 전, 2026-10-24 KST)
- 핵심4파일시험36개 PASS: 클라이언트15, PCM/녹음9, WER/CER7, Worker5. 별도 비교 패널6시험도 PASS. 취소 후 GPU/WASM 부활, 전체180초 상한, 늦은 권한 스트림, 새 녹음 타이머 오염, 디코더 무응답 등을 재현해 Gemini가 수정했다.
- 전체 npm run test: 84파일864시험 중863PASS/1FAIL. 실패는 CoachTutorView에서 onBusyChange가 state만 갱신해 같은 tick에 코칭을 누르면 두 작업이 함께 시작될 수 있는 동시 마이크 차단 회귀다.
- npm run typecheck: BenchmarkSentence 미사용 import1오류. 실제 런타임36시험 통과를 전체 검증 통과로 보고하지 않는다.
- npx --no-install vite build: 번들 생성 PASS. 최대 단일 자산은21596019바이트 WASM으로 Pages25MiB 자산 한도 이내. 이는 배포/모델 실제 실행 성공을 증명하지 않는다.
- 고정 모델 revision ff4177021cc41f7db950912b73ea4fdf7d01d8e7, q8 가중치40844231바이트 + WASM21596019바이트 + 토크나이저/실행 파일로 최초약65~70MB 예상. 일반 학습에서 자동 모델 다운로드 없음은 단위 시험상 확인했으며 실제 브라우저 모델·캐시는 아직 검증 전이다.
- 현재까지 비교 구현/독립 시험에서 앱 Gemini/STT/TTS 실제 API 호출은 실행하지 않았다. 단어 데이터/사용자 저장소/서버/90% 예산 변경 없음, 기밀 문자열 소스/번들 검사 PASS.
- 남은 제품 수정: 부모 onBusyChange에서 ref를 동기 설정 후 state 갱신하는 안정 콜백과 코칭 버튼 disabled 연결, 불필요 import 제거, 비교 취소 시 모델 상태 동기화. 공개 예제 취소 중 AudioContext 조기 해제·늦은 finally의 새 작업 소유권·취소 중 대기 Promise 정리도 재검토 필요.
- Gemini CLI 실제429가 발생해 제품 수정이 멈췄다. 사용자의 Gemini 구현/Codex 검증 역할을 지키기 위해 Codex가 제품 수정을 대신하지 않았고, Gemini 복구 또는 Codex 최소 수정 허용 결정을 요청한 상태다.
- 이후 전체 검사 통과 → 정규 main의 선택형 비교 패널 전달 → 실제 모델 다운로드/공개 예제 실행/캐시 재사용/예산0 검증 → S25 사용자 6문항 순차 발화 보고서로 정확도·지연·실패 대조 → 더 나은 경우에만 학습 엔진 적용 순서. 실제 원본 이름/음성은 외부 구현 지시로 전달하지 않는다.
- commit/push/deploy 미실행. 운영은 검증된 기존4601ab1 버전 유지. 실제 S25 결과 없이 Whisper 우세·기본 전환 완료로 표시하지 않는다.

## 실제 운영 PC 검증 및 호환 모드(WASM) 전환 (2026-10-24 KST)
- **WebGPU q8 디코더 실측 실패 (P1)**:
  - commit `acdd746` 운영 배포 후 실제 PC Chrome 환경에서 공개 JFK 예제 실행 시, 초기 준비 14,666ms, 추론 11,041ms 소요되었으나 실제 전사 결과가 영어가 아닌 무작위 다국어 반복 문자열(gibberish)로 출력되는 문제 발생. 모델 실행 성공으로 판정하지 않음.
  - 근거: transformers.js 공식 Issue #1317 (v3 Whisper q8 decoder + WebGPU 조합에서 gibberish 출력 및 WASM에서는 정상 동작 보고). PR #1382는 v4 런타임 변경 사항으로 v3.8.1 환경의 해결 증거가 되지 않음.
- **최소 안전 조치 (호환 모드 WASM 고정)**:
  - 불필요한 라이브러리 판올림이나 대용량 가중치 추가 없이, `WhisperBenchmarkPanel.tsx`의 모델 준비 호출을 `prepare('wasm')`으로 명시 고정.
  - UI에 `호환 모드(WASM)` 상태를 안내하고, WebGPU q8의 실측 실패로 인해 현재 WebGPU를 비활성화함을 명시.
  - 기존 다운로드된 q8 가중치 캐시(약 65~70MB)는 WASM 백엔드에서도 그대로 재사용 가능.
  - 실제 PC WASM 전사 결과, 지연 시간, 캐시 재사용 검증은 Codex 독립 검증을 통해 진행.
  - 기본 영어 회화 튜터 엔진은 기존 Web Speech API를 그대로 유지하며, 실제 S25 실측 비교 전까지 교체하지 않음.

- Gemini가 부모의 동기 마이크 배제, 취소 전파, 공개 예제 다운로드·디코딩 수명주기, 오류 표시를 수정했다. Codex가 독립 회귀 시험을 추가했다.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1`: **PASS**, 84파일/872시험 전부 통과. 타입·린트·빌드·보호 경로·공백 검사 포함. 코드 변경 종료 후 실행했다.
- 공개 JFK 예제 실제 헤더: 44.1kHz, 2채널, 485100프레임, 11초. 약1.94MB 파일을 받아 176000샘플로 변환하는 시험 통과. 공개 예제 상한3MiB, 다운로드+디코딩15초; 추론은 별도30초 상한.
- 중지 중 native/TTS/countdown/디코딩이 응답하지 않아도 대기가 끝나며 늦은 결과가 두 번째 마이크를 열지 않는 시험 통과. 전사 오류 후 모델 재준비 가능.
- 제공된 기밀 문자열이 소스·문서·빌드325파일에 없는지 로컬 비교: PASS, 값 출력 없음.
- 최대 정적 파일21,596,019바이트로 Pages25MiB 제한 이내. 모델 가중치는 Pages에 올리지 않고 고정 공개 revision에서 명시 준비 때만 받는다.
- 운영 읽기 기준: 2026-10-24 대화73건/보수적 예산 단위1207464, STT/TTS 예약0건. 실제 모델 실행 후 다시 비교한다.
- 아직 미검증: 실제 PC 브라우저 모델 초기화·공개 예제 추론·캐시 재사용, 실제 S25 6문항 비교. 합성 단위 시험을 실기기 정확도 증거로 취급하지 않는다.
- 비교 두 엔진은 순차 별도 발화이므로 동일 녹음의 엄밀한 대조가 아니다. 발음·소음 조건을 비슷하게 유지해 측정한다. 참조 문장이나 이름을 인식기에 힌트로 주지 않는다.
- 실제 S25에서 유리하다는 증거를 얻기 전 학습 기본 엔진을 교체하지 않는다. 비교 패널은 앱 평가 API를 호출하지 않으며 Whisper 음성은 메모리에서만 처리한다. Web Speech는 브라우저 제공사의 원격 처리 가능성이 있다.
- Codex 후속 검증441: WASM 명시 준비 회귀 시험 포함 전체84파일/872시험, 타입·린트·빌드·보호 경로·diff PASS. 운영 실제 전사 재검증은 후속 기록으로 구분한다.

## 운영 PC 실제 실행 증거 및 남은 실기기 검증
- 운영 제품 커밋 `cc7ea19edc1f1223839fbbaec11e25ff1fd51dd4`, 정규 루트 HTTP200 및 번들 `index-DXe60a9S.js` 확인. 이 기록 커밋은 제품 코드를 변경하지 않는다.
- Chrome 실제 Worker/ONNX/WASM에서 공개11초 JFK 음성을 실행했다. 참조 힌트 없이 두 번 모두 공식 예제와 같은 영어 문장이 나왔다. 순수 추론 **1747ms / 1761ms**. 화면 재시작 후에도 재현했다.
- 모델 준비 화면에서 **캐시 재사용1084ms / 1114ms** 확인. 이것은 캐시가 있는 PC 수치이며 S25 성능이나 WASM 최초 다운로드 시간을 나타내지 않는다. 처음 GPU 검증 때 받은 같은 가중치를 재사용했다.
- 실제 WebGPU q8 경로는 초기화 성공만으로 신뢰할 수 없었다. 영어 음성이 무작위 다국어 반복으로 나왔으므로 **실패**로 기록하고 비교 패널에서는 사용하지 않는다. WASM 명시 경로 회귀 시험으로 고정했다. 라이브러리나 모델 크기를 임의 확대하지 않았다.
- 실제 실행 전후 D1 집계 동일: 2026-10-24 회화73건/보수적 예산 단위1207464 유지. 전체 예약 집계에서 STT/TTS0건 유지. DB 조회 자체는 rows_written0이다. 비교 패널은 서버 AI 클라이언트를 호출하지 않는다.
- 최종 제품 검사 `441_whisper_wasm_verify.log`: 전체84파일/872시험, 타입·린트·빌드·보호 경로·diff PASS. 제공 기밀 문자열 부재 검사327파일PASS. Word DB/사용자 저장소/서버/API90%한도 변경 없음.
- PC 공개 예제 성공은 원어민 파일의 실행 증거다. 한국 이름·초보자 발음·실제 마이크·S25 속도·배터리·메모리 지속 안정성은 아직 미검증이다.
- 사용자에게 정규 앱 안의 비교 패널에서6문항(이름/커피/컵/잼/부정어/숫자)을 두 번씩 발화하고 `whisper-compare-v1` 리포트를 복사하도록 요청했다. 해당 화면에는 새 설정이나 자동 기본 엔진 전환을 추가하지 않았다.
- 실제 S25 결과로 정확도와 지연을 평가한 후 우위가 확인되면 Gemini가 학습 경로 연결을 구현하고 Codex가 재검증한다. 결과가 불리하면 기존 기본 인식기를 유지한다.