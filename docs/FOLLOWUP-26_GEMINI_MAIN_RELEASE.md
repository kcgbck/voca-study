# FOLLOWUP-26 단일 정규 메인 엔트리 통합 및 PWA 신선도 릴리스 보고서

- **작성일시**: 2026-10-24 KST
- **작성자**: Gemini (구현 담당)
- **검증/배포/커밋 담당**: Codex (테스트·검증·커밋·푸시·배포 독점)

---

## 1. 개요 및 목적
- **단일 정규 엔트리 확립**:
  - 임시 테스트용 분기 URL(`?voice-check=1`, `?build=...`, `?speech-check=...`)을 전면 폐지하고, 설치형 PWA와 일반 브라우저 접속 모두 단일 정규 루트 도메인(`https://voca-study-akf.pages.dev/`)으로 일원화.
- **기존 사용자 경험 및 데이터 완벽 보존**:
  - 기존 1~6번 학습 모드(TOEIC 단어, 해사영어, 일본어, 오답노트, 단어장 생성기, 랭킹) 및 7번째 홈 카드인 **"AI 영어 회화"(`CoachTutorView`)**가 표준 홈 화면에서 정상 구동되도록 통합.
  - IndexedDB, localStorage, 내장 단어 DB, 사용자 기기 내 저장소 스키마는 일체 삭제/초기화하지 않음.
- **PWA 서비스 워커 신선도 관리 (v8)**:
  - 브라우저 HTTP 캐시로 인한 구버전 SW 고착을 방지하기 위해 `updateViaCache: 'none'` 및 Cloudflare Pages `_headers`에 `/sw.js` `no-cache` 정책 적용.
  - 앱 복귀(`visibilitychange`) 및 온라인 복귀 시 강제 리로드 없이 조용히 백그라운드에서 최신 SW 갱신(`reg.update()`) 확인.
  - 퀴즈 풀이 중이거나 녹음 중 사용자의 맥락이 날아가지 않도록 무단 자동 리로드는 하지 않음.

---

## 2. 변경된 제품 파일 및 세부 내용

### 1) [`src/main.tsx`](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/src/main.tsx)
- **별도 React Root 분기 제거**:
  - `isVoiceCheck` 분기로 `App`을 건너뛰고 `CoachTutorView`만 단독 렌더링하던 임시 코드를 완전히 제거하고, 항상 `<App />`을 마운트.
- **은퇴한 쿼리 파라미터 무새로고침 URL 정리**:
  - 북마크나 구버전 링크를 통해 들어온 사용자를 위해 `voice-check`, `build`, `speech-check` 파라미터가 URL에 존재할 경우, 화면 새로고침 없이 `window.history.replaceState`로 깔끔하게 정리하여 정규 URL(`/`)로 복원.
  - 개발/진단용 파라미터(예: `speech-debug`)는 보존.

### 2) [`public/sw.js`](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/public/sw.js)
- **캐시 버전 업그레이드**:
  - `voca-study-cache-v7` $\rightarrow$ **`voca-study-cache-v8`**
- **정밀한 구버전 캐시 정리**:
  - `activate` 이벤트 시 `voca-study-cache-` 접두사로 시작하는 이전 구버전 앱 셸 캐시만 선택적으로 삭제하여, 신규 설치 클라이언트가 최신 JS 번들과 에셋을 즉시 사용할 수 있도록 보장.
  - 사용자 데이터나 비연관 캐시는 건드리지 않음.

### 3) [`index.html`](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/index.html)
- **서비스 워커 등록 및 업데이트 전략 고도화**:
  - `navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })` 적용.
  - 페이지 로드(`load`) 직후 `reg.update()`를 호출하여 최신 SW 확인.
  - 탭/앱 복귀(`visibilitychange === 'visible'`) 및 네트워크 복구(`online`) 시 백그라운드 갱신 확인 실행.
  - 학습 중 또는 사용자 입력 중 화면이 강제 리로드되는 부작용 없이, PWA 라이프사이클에 따라 안전하게 새 SW가 대기 및 적용되도록 제어.

### 4) [`public/_headers`](file:///C:/Users/YECHAN/workspace/TOEIC_STUDY/public/_headers) (신규 생성)
- **Cloudflare Pages 전용 HTTP 헤더 추가**:
  - `/sw.js`에 대해 `Cache-Control: no-cache, no-store, must-revalidate`를 명시하여 CDN 에지 및 브라우저에서 서비스 워커 파일이 캐시되지 않고 항상 최신 바이트를 검사하도록 설정.
  - `/manifest.webmanifest`에도 `no-cache` 적용.

### 5) [`.coding-partner/project/COMMON.md`](file:///C:/Users/YECHAN/.coding-partner/project/COMMON.md)
- 사용자의 릴리스 정책 반영: 정규 루트 엔트리(`https://voca-study-akf.pages.dev/`), 검증 완료된 작업의 main 브랜치 커밋 및 푸시, force push/유료 종량제/데이터 삭제 금지 원칙 기록.

---

## 3. 안전성 및 역할 분담 준수 확인

1. **테스트 및 Git 명령 미실행 준수**:
   - 제품 구현 담당(Gemini)은 명령어/쉘 도구, git commit/push, npm test 등을 일절 호출하지 않았습니다.
2. **테스트 및 릴리스 배포 소유권**:
   - 회귀 테스트 갱신(`conversationEntryMigration.test.tsx`의 정규 엔트리 검증 등), 전체 74개 파일 테스트 실행, Git commit 및 push to main, Pages 배포 및 구버전 배포 정리는 Codex가 독점 수행합니다.
3. **사용자 데이터 보존**:
   - 기존의 모든 퀴즈 및 단어 학습 데이터, 오답노트, 설정 정보는 그대로 안전하게 유지됩니다.
