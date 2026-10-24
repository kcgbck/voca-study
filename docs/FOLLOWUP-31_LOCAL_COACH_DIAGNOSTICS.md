# FOLLOWUP-31: 로컬 회화 진단 기록 및 수동 복사 지원 (Local Diagnostics)

**Date:** 2026-10-24 KST  
**Author:** Gemini (Implementer)  
**Supervision & Verification:** Codex (Test / Audit / Commit / Deploy)  
**Scope:** Canonical Main Root (`https://voca-study-akf.pages.dev/`)

---

## 1. 개요 및 목적

학습자가 발화한 영어 의도와 브라우저 네이티브 STT 인식 결과, AI 후보군 채택 및 모범답안 사이의 괴리를 진단할 수 있도록, **외부 네트워크 전송이나 원격 텔레메트리 없이 오직 브라우저 로컬에서만 동작하는 진단 기록 저장소 및 복사 UI**를 구현합니다.

- **원격 전송 일체 없음 (진단 기록에 한정):** 진단 기록 자체의 오디오 녹음, 음성 파일 업로드, 배경 네트워크 전송, 외부 진단 API 호출이 전혀 없습니다. (단, 일반 회화 연습 진행을 위한 브라우저 네이티브 음성 인식 및 영문 답변에 대한 AI 직접 평가는 기존처럼 정상적으로 네트워크를 사용할 수 있습니다.)
- **상시 회화 접근성:** 별도의 URL 쿼리 파라미터(`?speech-debug=1`) 없이도 일반 회화 화면 및 5개 질문 완료(`allFinished`) 화면 하단에서 접이식 패널(`<details>`)을 통해 접근할 수 있습니다.
- **클립보드 수동 복사:** 사용자의 명시적 클릭 시에만 `navigator.clipboard.writeText`를 호출하며, 클립보드 권한이 거부되거나 지원되지 않는 환경에서는 읽기 전용 텍스트 영역(`readOnly textarea`)을 화면에 노출하여 길게 누르기(long-press)로 직접 복사할 수 있도록 지원합니다.

---

## 2. 설계 규약 및 저장소 정책 (`coachDiagnostics.ts`)

### 2.1 데이터 모델 (`CoachDiagnosticRecord`)

```typescript
export interface CoachDiagnosticRecord {
  id: string; // 고유 ID (UUID 또는 timestamp_random)
  timestamp: string; // ISO 8601 시각
  questionId: string; // 질문 식별자 (예: cafe, name)
  questionEn: string; // 영어 질문 문장
  stage: 'initial' | 'repeat'; // 초기 질문 또는 반복 연습
  inputSource: 'voice' | 'text'; // 음성 마이크 또는 키보드 직접 입력
  rawText: string; // 네이티브 STT 최상위 인식 문장 또는 제출 답변 (가공 금지)
  candidates: string[]; // N-best 후보군 배열 (최대 3개, 각 500자 이하)
  evaluationSource: 'ai' | 'reuse' | 'none'; // AI 호출, 로컬 승인답안 재사용, 미평가
  evaluation?: CoachEvaluation; // 의미(meaning), 완성도(sentenceComplete), 피드백, 모범예문, 채택 인덱스
  evaluationRequests: number; // 앱 내부 평가 시도 횟수 (외부 Google/D1 소비 계량 아님)
  elapsedMs: number; // 발화/평가 전체 소요 시간 (ms)
  errorCode?: SafeDiagnosticErrorCode; // 허용 목록 기반 에러 코드
  intendedText?: string; // 사용자가 직접 작성한 의도 (선택, 최대 500자)
}
```

### 2.2 엄격한 안전성 및 용량 한도
- **24시간 및 20건 상한:** 최대 20건의 완료된 레코드만 유지하며, 24시간이 경과한 기록 및 1분 이상 미래로 왜곡된 레코드는 읽기/내보내기/저장 시점에 자동 배제됩니다.
- **64 KiB UTF-8 저장소 상한:** 직렬화된 JSON 바이트 크기가 64 KiB를 초과하는 경우 오래된 항목부터 차례로 프루닝하여 다른 앱 저장소에 영향을 주지 않습니다.
- **독립 격리 저장:** 오직 자체 키(`COACH_DIAGNOSTICS_KEY = 'coach_diagnostics_history_v1'`)만 사용하며, `localStorage.clear()`를 호출하지 않고 다른 키(`word-data`, `coach_adult_confirmed_*`)를 일체 건드리지 않습니다.
- **스토리지 차단 내성:** `localStorage` 접근 시 `SecurityError`(blocked)가 발생하는 환경에서도 예외를 발생시키지 않고 인메모리 스토어로 안전하게 동작하며, `persistenceAvailable: false` 경고를 UI에 투명하게 표시합니다.
- **에러 코드 화이트리스트:** 허용 목록(`COACH_MINUTE_LIMIT`, `COACH_DAILY_LIMIT`, `EVALUATION_TIMEOUT`, `EVALUATION_FAILED`, `INVALID_CANDIDATE_INDEX`, `SPEECH_NO_SPEECH`, `SPEECH_NETWORK`, `SPEECH_PERMISSION`, `SPEECH_ERROR` 등)에 없는 임의의 에러 객체/URL/스택 트레이스는 절대 저장 및 리포트에 출력되지 않습니다.

---

## 3. 컨트롤러 연동 (`CoachTutorController.ts`)

- **학습 흐름 무간섭 및 방어적 복사:**
  - `deps.onDiagnostic` 콜백 호출 시 `JSON.parse(JSON.stringify(record))`를 통해 깊은 복사본을 전달하므로, 진단 수신 측에서 `evaluation`이나 `candidates`를 변조하더라도 실제 튜터의 채점 및 캐시 상태에 전혀 영향을 주지 않습니다.
  - 콜백 내부 예외는 완전 격리되어 학습 진행을 중단시키지 않습니다.
- **정확한 입력 소스 및 상태 캡처:**
  - 텍스트 모드에서의 답변은 `'text'`, 음성 인식은 `'voice'`로 정확히 구분 기록됩니다.
  - 음성 인식 실패 시 부분 캡처된 `recognizedText`를 보존하며, 네이티브 음성 에러 코드(`network`, `not-allowed`, `no-speech` 등)를 안전하게 정규화하여 기록합니다.
  - 취소/일시정지(`pause`) 후 늦게 도착한 AI 응답은 `signal.aborted` 검사를 통해 진단 기록 작성을 차단하여 기록 오염을 방지합니다.

---

## 4. UI 구현 (`CoachTutorView.tsx`)

- **접이식 패널 (`<details>`):**
  - 일반 회화 화면 하단 및 5개 질문 완료(`allFinished`) 화면 모두에 `<summary>인식·평가 기록 (N)</summary>` 형태로 접힌 채 배치되어 기본 회화 몰입을 방해하지 않습니다.
  - 레코드 요약 및 패널의 터치 타겟은 최소 44px 이상이며, 모바일 환경(360px 가로폭)에서 긴 단어로 인한 레이아웃 깨짐을 방지하도록 `minWidth: 0`, `overflowWrap: 'anywhere'`, `wordBreak: 'break-word'`가 완비되어 있습니다.
- **명시적 조작 및 상태 표시:**
  - `진단 기록 복사`: 비어있을 때 비활성화되며, 클릭 시 `store.exportText()`를 복사합니다. 실패 시 수동 복사용 `readOnly textarea`를 노출합니다.
  - `진단 기록 지우기`: 회화 진행 중(준비/말하기/듣기/평가 등 활성 상태)에는 비활성화되며, 일시정지(`paused`), 완료(`complete`), 대기(`ready`), 에러(`error`), 전체 완료(`allFinished`) 상태에서만 활성화됩니다.
  - `판정 표기`: UI 및 복사 리포트 모두 친절한 한국어 의미 라벨(`뜻이 통함 (relevant)`, `다시 연습 (needs_help)`, `인식/의미 불확실 (uncertain)`)과 문장 완성 여부(`완전`, `미완성/단답`)를 직관적으로 제공합니다.
  - `내가 말한 내용 (선택)`: 각 기록별로 500자 제한의 텍스트 영역을 제공하여, 사용자가 실제 발화한 의도를 메모해 둘 수 있으며 복사 리포트에 함께 출력됩니다. 메모 입력은 추가 AI 호출이나 음성 재시작을 유발하지 않으며, 메모 수정 시 기존 실패 상태 알림을 초기화합니다.
- **모바일 대응 규격 (스타일 구현):**
  - 모든 버튼 및 상호작용 요소는 최소 44px 터치 높이와 flex-wrap, minWidth 0, overflowWrap anywhere 스타일 규칙을 적용하여 360px 모바일 환경에서 가로 넘침을 방지하도록 작성되었습니다. (실제 모바일 360px 단말 실측 및 브라우저 호환성 검증은 아직 미실시 상태입니다.)

---

## 5. 한계 및 미검증 사항 (Preserved Limitations)

- **백그라운드 타이머 보장 없음:** 24시간 만료 처리는 사용자가 화면을 열어 조회하거나 새 기록이 추가되는 시점에 필터링되는 방식이며, 백그라운드 크론이나 OS 레벨 타이머로 능동 삭제되지 않습니다.
- **발화 의도 자동 판별 불가:** 음성 인식 결과가 실제 학습자의 두뇌 속 발화 의도와 일치하는지는 AI가 자동으로 확정할 수 없으며, 사용자가 직접 '내가 말한 내용'을 기재하기 전까지는 '확인 불가'로 취급됩니다.
- **실물 단말 및 360px 모바일 미검증 상태 유지:** 본 구현은 순수 소스 코드 레벨의 반응형 스타일 정의와 논리적 격리 및 로컬 스토리지 연동이며, 실제 모바일 360px 뷰포트 레이아웃 안정성 및 실물 단말(예: 갤럭시 S25 등)에서의 네이티브 클립보드 동작·장기 보관 안정성은 아직 검증되지 않았으며 Codex 독립 테스트 및 실기기 검증을 통해 확인되어야 합니다.

## 6. Codex 독립 검증 (2026-10-24 KST)

- `scripts/verify.ps1`: **79파일 / 808시험 PASS**, 타입·린트·빌드·보호 경로·공백 검사 통과. 기존 PDF 글꼴/오프라인 모의 시험 경고와 번들 크기 경고는 실패가 아니다.
- 신규 저장소 10시험: 원문/후보/의도 구분, 최근20건/24시간/64KiB 제한, 한글 바이트, 임의 필드·오류 배제, 저장소 차단/쓰기 실패, 방어적 복사, 다른 저장 키 보존.
- 신규 컨트롤러 10시험: 최초 AI평가와 반복 재사용 각각1기록, 비1순위 원문 보존, 콜백 예외·변조 격리, 취소 후 기록 차단, 네트워크 부분 발화, 텍스트 입력 구분, 분당 제한 재시도 계수.
- View 기존21시험에7시험 추가: 일반 화면 접힌 패널, 명시적 복사, 로컬 메모·재조회, 진행 중 지우기 차단/다른 데이터 보존, 클립보드 실패·미지원 수동 복사, 메모 수정 후 이전 수동 보고서 제거, 평가 실패 시 후보 채택 표시 금지. 전체 완료 화면 접근도 확인.
- 독립 시험에서 발견한 저장 실패 시 현재 기록 유실, 임의 오류 코드 출력, 취소 후 기록, 콜백 변조, 입력 출처 오표기와 실패 후보의 허위 채택 표시를 Gemini가 수정한 뒤 모두 재검증했다. 테스트 하네스 참조 비교 문제도 테스트 쪽에서 수정했다.
- 제품 변경은 컨트롤러/로컬 기록 저장소/View만 해당한다. 서버·모델·90% 예산 한도·음성 엔진·단어 데이터·기존 사용자 저장소 변경 없음. 로컬 기록/메모/복사에 추가 네트워크 호출 없음.
- 운영 브라우저의 합성 텍스트 경로 및 D1 집계 대조는 배포 후 별도 기록한다. 실제 S25 발음 인식률·클립보드·360px 실측·장기 보관은 아직 미검증이며, 기존 사람/외부/보드 관문도 미검증 상태를 유지한다.

### 6.1 실제 운영 검증 중 발견한 메모 입력 문제
- 첫 운영 배포에서 선택 메모를 실제 키 입력으로 작성하자 공백이 사라졌다. 원인은 매 입력마다 `annotate()`가 끝 공백을 `trim()`으로 제거하여 제어 입력창에 되돌렸기 때문이다.
- Gemini가 저장값에 원문 공백을 보존하는 한 줄 수정을 수행했다. 공백만 있는 메모 삭제 및500자 제한은 유지한다.
- 독립 증분 입력 시험을 이전 운영 소스로 실행하여 `I actually said coffee, please.`가 `Iactuallysaidcoffee,please.`로 바뀌는 실패를 재현했다. 수정 후 같은 시험 통과. 저장소 시험11개, 전체79파일809시험과 타입·린트·빌드·보호 경로·공백 검사 PASS.
- 실제 운영 텍스트 시험에서 `My name is Alex.` 최초 평가와 `MY NAME IS ALEX!` 반복을 진행하여 각각 진단1건(합계2건)을 확인했다. 최초 AI평가1회/반복 로컬재사용0회 표시와 반복 완료 확인. D1 소비는63→64(+1), 보수적 예산 단위1042597→1059064(+16467), STT/TTS는0건 유지했다. 이는 실제 마이크 인식률 검증이 아니다.
