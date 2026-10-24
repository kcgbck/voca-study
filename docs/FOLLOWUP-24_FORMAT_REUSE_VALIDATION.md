# FOLLOWUP-24: 표기 차이 정답 재사용 검증

2026-10-24. 사용자 요청에 따라 Gemini가 제품 구현, Codex가 작업 지시·독립 시험·운영 예산 대조·배포를 담당했다. 시작 기준 main / HEAD `8248697cb4702719dfe7191195bccba5851a9cd4` / staged 0 / 기존 변경 99항목 보존.

## 변경한 동작

- 같은 질문의 실제 AI 평가에서 `relevant && sentenceComplete`로 확인한 정답만 반복 단계에서 재사용한다.
- 비교할 때 대소문자, 연속 공백, 문장 끝의 `. ! ?`, 곧은/굽은 아포스트로피 모양 차이를 정리한다. 화면의 원문과 실제 AI 요청 내용은 기존처럼 보존한다.
- 첫 답변, 새 질문/재시작, 단어·이름·숫자·부정 표현이 바뀐 답변은 계속 AI가 평가한다. 일시정지 시 정답 기억을 지우는 기존 경계도 유지한다.
- 내부 쉼표·하이픈·소수점·슬래시·아포스트로피는 보존한다. `can't/cant`, `we're/were`, `we'll/well`, `re-sign/resign`, `2.8/28`, `2,800/2800`, `ice cream/icecream`을 같은 정답으로 합치지 않는다. 축약형 확장, 의미 유사도, 철자 자동 교정, 숫자 단어 치환은 하지 않는다.
- 예문 자체나 단답형은 정답 재사용의 근거가 아니다. 새 녹음이 실패하거나 중간 결과만 있으면 이전 정답으로 통과시키지 않는다. 10초 듣기 및 최종 확정 후에만 처리한다.

제품 변경: `CoachTutorController.ts` 비교 키 및 음성/텍스트 반복 경로, `CoachTutorView.tsx` 진단 버전 `paced-coach-10s-v8`, 보드 생성기의 현재 동작 요약 2곳. 보드 산출물을 재생성했고 역사 노드와 보호된 단어 DB는 보존했다. 서버·모델·90% 한도는 변경하지 않았다.

## 자동시험

- 수정 전: 표기 차이 재사용 관련 10개 시험 실패 재현 (`.agy-work/223_format_red.log`).
- 수정 후: 정답 재사용 파일 46시험. 표기 차이 허용, 의미 변경 보존, 원문 전달, 첫 답변 재평가, 빈 비교 키 차단, 단답 재사용 금지, 실제 음성 수집 서비스와 컨트롤러의 10초 경계 검증.
- 실제 PublicCoachApiClient → 서버 핸들러 → SQLite에서 실행한 D1 예산 SQL → 모의 Google 연결 시험에서 표기 차이 반복은 예약/호출/차감 1건, 변경된 답변은 추가 차감으로 확인.
- 최종 `scripts/verify.ps1`: **74파일 725시험 PASS**, typecheck/lint/build/보호 경로/whitespace PASS. `.agy-work/230_format_verify.log`. 기존 번들 크기 경고 유지.
- 소스 및 빌드 비밀값 검사: 275파일, 일치 0건.

## 실제 무료 API와 운영 D1 대조

로컬 최신 컨트롤러와 실제 운영 API를 연결했다. 입력은 합성 문장이며 마이크와 음성 재생만 대역이다. **S25 실기기 발음 시험이 아니다.**

| 흐름 | 입력 | 실제 AI 호출 | 결과 |
|---|---:|---:|---|
| `My name is Alex.` → `MY NAME IS ALEX!` | 2 | 1 | 1/1 완료, 표기 차이 재사용 |
| `I'd like tea.` → `I’D LIKE TEA!` | 2 | 1 | 1/1 완료, 아포스트로피 모양·대소문자 재사용 |
| `My name is Alex.` → `My name is Mina.` | 2 | 2 | 변경된 이름 새 평가 및 Mina 피드백 |

합계 입력 6회 / 실제 API 4회 / 추가 호출 없는 반복 2회. 실제 요청 4건 모두 HTTP 200, 1.187~1.366초. `.agy-work/231_format_live.json`.

Pacific 2026-10-23 D1 대화 사용량 **58 → 62건(+4)**, 보수적 예산 단위 **954328 → 1020116(+65788)**. 반복 2회 추가 차감 0. STT/TTS 행 0건, 전날 대화 6건은 그대로다. `.agy-work/228_format_budget_before.json`, `.agy-work/232_format_budget_after.json`. 최초 조회는 Cloudflare 7403 오류였으나 기존 OAuth 계정·권한 확인 후 같은 읽기 전용 조회 재시도로 정상 처리됐다. 인증·보안 설정은 바꾸지 않았다.

## 배포 및 남은 범위

- 운영 배포 `d5cd97e6`, JS `/assets/index-DacNYAux.js`, 진단 `paced-coach-10s-v8`.
- [현재 운영 버전](https://voca-study-akf.pages.dev/?voice-check=1&build=20261024-1).
- 현재 보관하는 정답의 비교만 개선했다. Web Speech의 실제 발음 인식 모델을 변경한 것은 아니며, S25 Chrome에서 최신 버전의 실제 마이크 확인은 별도다.
- 무료 프로젝트의 전체 90% 한도(13RPM / 225000 보수적 단위/분 / 450RPD) 유지. stage/commit/push 없음.

## 최종 운영 화면 검증

배포 후 Chrome 텍스트 모드에서 `My name is Alex.` 최초 제출은 AI 분석을 거쳤고, `MY NAME IS ALEX!` 반복은 추가 분석 대기 없이 원문 표시를 보존한 채 1/1 완료 및 다음 질문 버튼으로 진행했다. `.agy-work/234_format_browser_pass.png`에 화면 증거를 저장했다. 실제 제공 JS도 `index-DacNYAux.js`로 확인했다.

브라우저 입력 2회 이후 D1은 **62 → 63건(+1)**, 단위 **1020116 → 1036561(+16445)**로 일치했다. 이번 작업 전체는 **입력 8회 / AI 호출·차감 5건 / 재사용 3회 추가 차감 0**이다. STT/TTS 0건 유지. `.agy-work/235_format_budget_final.json`.

최종 Git: main / 동일 HEAD / staged 0 / 변경 표시 101항목(기존 99항목 + 보고서 2개). 기존 미커밋 작업 보존, commit/push 없음. 새 기능은 Pages 직접 배포로 반영했다.
