---
type: session-summary
status: active
created: 2026-10-24
updated: 2026-10-24
source_project: "TOEIC_STUDY"
summary: "비교 기능 acdd746 배포 후 Codex 실제 PC WebGPU q8 실행에서 공개 영어 음성이 다국어 반복으로 깨짐을 확인했다. 준비14666ms/추론11041ms이나 정확도 실패. 공식 라이브러리 이슈1317과 일치하며 성공으로 취급하지 않는다. Gemini가 비교 패널만 WASM 명시 준비로 수정, 같은 가중치/다운로드범위 유지. Codex WASM 준비 경로 회귀 시험 및 전체84파일872시험/타입/린트/빌드/보호경로/diff PASS. WASM 실제 추론/캐시와 S25 비교는 재배포 후 대기. 기본 학습 Web Speech 유지, 단어장/서버/90%예산 보존. 사용자 승인대로 main 커밋·푸시·운영 배포 진행. parentHEAD acdd746. 상세 FOLLOWUP-33."
tags: [save]
tools: [coding-partner]
related_paths: [project_status.md, docs/partner/CURRENT.md]
related_knowledge_cards: []
verification: [source-hash-verified]
sensitivity: public-safe
source_commit: acdd74661935a61b16d3c5e10ff9e653cff6d098
session_scope: session-attribution-unavailable
---
비교 기능 acdd746 배포 후 Codex 실제 PC WebGPU q8 실행에서 공개 영어 음성이 다국어 반복으로 깨짐을 확인했다. 준비14666ms/추론11041ms이나 정확도 실패. 공식 라이브러리 이슈1317과 일치하며 성공으로 취급하지 않는다. Gemini가 비교 패널만 WASM 명시 준비로 수정, 같은 가중치/다운로드범위 유지. Codex WASM 준비 경로 회귀 시험 및 전체84파일872시험/타입/린트/빌드/보호경로/diff PASS. WASM 실제 추론/캐시와 S25 비교는 재배포 후 대기. 기본 학습 Web Speech 유지, 단어장/서버/90%예산 보존. 사용자 승인대로 main 커밋·푸시·운영 배포 진행. parentHEAD acdd746. 상세 FOLLOWUP-33.

Operation: followup33-whisper-wasm-fix-20261024
Parent HEAD: acdd74661935a61b16d3c5e10ff9e653cff6d098
