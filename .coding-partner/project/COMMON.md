# Project Instructions

## Release & Canonical Entry Preferences (FOLLOWUP-26)
- **Canonical Root Entry**: 모든 실기기/브라우저 테스트 및 설치형 PWA는 별도의 테스트 엔트리 URL(`?voice-check=1` 등) 없이 단일 정규 루트 URL(`https://voca-study-akf.pages.dev/`)을 표준 진입점으로 사용합니다.
- **Commit & Push to Main**: 검증이 완료된 프로젝트 개발 변경 사항은 main 브랜치에 안전하게 commit 및 push하여 단일 진실 공급원을 유지합니다.
- **Safety Exclusions**:
  - force push 금지, `git reset --hard` 금지, 사용자 미승인 파일 일괄 삭제 금지.
  - `.env`, API 키, 인증정보, 개인 기록 등 기밀 정보는 절대 커밋/푸시하지 않습니다.
  - 유료 종량제 API 사용 금지(Google AI Studio 무료 티어 90% 하드캡 준수).
  - 기존 IndexedDB, localStorage, 내장 단어 DB, 사용자 학습 데이터는 보존합니다.
