---
type: session-summary
status: active
created: 2026-10-26
updated: 2026-10-26
source_project: "TOEIC_STUDY"
summary: "# FOLLOWUP-37 Moonshine v2 연결과 검증 - 날짜:2026-10-26 KST. Parent HEAD:58c8d5435277a4b8bc7cea3772ff7bf59756e6f8. main. - 사용자 요청: 무료 Moonshine Voice v2 조건 확인 후 실제 학습에 연결하고, 기존 요청에 따라 검증 후 main 커밋·푸시·운영 배포. - 공식 영어 모델과 라이브러리 MIT 조건을 확인했다. 정규 진입점 한 곳을 유지하며 별도 운영 시험 페이지를 만들지 않았다. - Gemini 구현: Worker와 음성서비스, 런타임 빌드자산, 필요한 보안 헤더, 코칭 준비 게이트, 취소·오류·텍스트 모드, 엔진 진단. Codex는 의존성 설치와 시험·원본 고지 일치·실제 음성예제 실행·예산 조회를 담"
tags: [save]
tools: [coding-partner]
related_paths: [project_status.md, docs/partner/CURRENT.md]
related_knowledge_cards: []
verification: [source-hash-verified]
sensitivity: public-safe
source_commit: 58c8d5435277a4b8bc7cea3772ff7bf59756e6f8
session_scope: baseline-compared
---
# FOLLOWUP-37 Moonshine v2 연결과 검증
- 날짜:2026-10-26 KST. Parent HEAD:58c8d5435277a4b8bc7cea3772ff7bf59756e6f8. main.
- 사용자 요청: 무료 Moonshine Voice v2 조건 확인 후 실제 학습에 연결하고, 기존 요청에 따라 검증 후 main 커밋·푸시·운영 배포.
- 공식 영어 모델과 라이브러리 MIT 조건을 확인했다. 정규 진입점 한 곳을 유지하며 별도 운영 시험 페이지를 만들지 않았다.
- Gemini 구현: Worker와 음성서비스, 런타임 빌드자산, 필요한 보안 헤더, 코칭 준비 게이트, 취소·오류·텍스트 모드, 엔진 진단. Codex는 의존성 설치와 시험·원본 고지 일치·실제 음성예제 실행·예산 조회를 담당했다.
- 실패와 해결: 취소콜백을 먼저 지워 대기하던 오류, 잘못된 PCM 수용, 제거된 진단변수 잔존, 준비중 연속클릭, 시험의 비동기 대기·기록순서 가정을 수정했다. 최종 전체 검증은88파일936시험 통과.
- 실제 실행: 공개JFK와 합성영어 대조. 빌드Worker 전사923ms. 합성coffee 실제운영시험 전사326/229ms, 평가HTTP200/1916ms, 동일정답반복 재사용1회. 실제마이크와 TTS는 해당시험에서 대체했다.
- DB근거: 로컬전사 전후 집계동일. 실제운영평가 후 대화+1/로컬예산+17028, STT/TTS0. 예산 단위와 제공사실제사용량은 구별한다.
- 사용자자료·단어DB·기존학습저장소·서버예산정책은 보존했다. S25 실제발음과 지속안정성은 사용자 실기기확인이 남았다. 인간검토완료로 표시하지 않았다.
- 상세검증과 원본기록위치는 docs/FOLLOWUP-37_MOONSHINE_V2.md를 따른다.

Operation: followup37-moonshine-v2-20261026
Parent HEAD: 58c8d5435277a4b8bc7cea3772ff7bf59756e6f8
