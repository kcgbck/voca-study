# FOLLOWUP-18 — 확인 질문 없는 초급 회화

## 사용자 변경 요청 (2026-10-23)
- S25 Chrome에서 세 번째 질문까지 진행 후 대체로 만족. 인식 확인 음성/화면/네·아니요 절차는 길고 지루하므로 모두 제거.
- 영어 질문 → 영어 답변 → 바로 한국어 평가·원포인트 피드백과 영어 예문 → 기존 반복 연습(완전한 정답 1회, 단답/도움 필요 2회) → 다음 버튼.
- 성인 확인은 기존 저장값을 유지하고 한 번 체크하면 화면에서 숨김.
- 무료 음성 인식 품질 유지/개선 가능성 검토 및 실제 API 소모 설명.

## 작업 및 검증 범위
- Gemini: Controller/View/coachProtocol/publicCoachApi/publicCoachHandler 5개 제품 파일의 최소 수정.
- Codex: 요구 변경에 따른 기존 확인 전용 시험의 직접 평가 회귀 시험 전환, 성인 저장·다시 접속 시험, 원본 top-1 보존·중간 결과 미채점·취소·오류·모델 호출 수 검증.
- 이전 문서에서 요구한 전사 확인은 이번 사용자 명시 요청으로 폐기한다. 사용자가 확인하지 않은 답변에 transcriptConfirmed=true를 보내지 않도록 프로토콜과 서버 요구도 제거한다. 성인/무료 여부/Origin/독립 DB/한도 검증은 유지한다.
- 브라우저 STT의 continuous=false, 영어 en-US, 실제 시작부터 6초, 최종 결과만 반환하는 기존 중복 방지 유지. 인식 후보를 임의로 정답으로 바꾸지 않는다.
- 추가 유료 음성 API, 키, 의존성, 모델 다운로드 없음. 코드 작성용 agy 구독 CLI와 앱 Gemini API는 별도 경로다.

## API 소모 (코드 확인)
| 동작 | 앱 Gemini 호출 |
|---|---:|
| 화면 열기, 성인 체크, 고정 영어 질문·상황 표시 | 0 |
| 브라우저 영어 음성 인식, 중간/최종 텍스트 생성 | 0 |
| 브라우저로 한국어·영어 읽기 | 0 |
| 답변 의미 판단 + 한국어 피드백 + 영어 예문 생성 | 1 (한 응답에 모두 포함) |
| 따라 말한 답변 평가 | 답변마다 1 |
| 인식 네트워크 오류/무음으로 AI 평가까지 못 간 경우 | 0 |
| 앱 예산 거절로 Google 요청 전 차단 | 0 |
| Google 요청 시도 이후 실패/시간초과 | 앱 예산은 보수적으로 차감 유지 |

- 현재 모델 gemini-3.5-flash-lite. 질문당 정상 완주 2회(최초 평가+반복1), 단답에서 완주 3회(최초 평가+반복2). 연습 오답 재평가 시 추가 호출. 최초 무음은 고정 예문 도움말로 이동하고 무음 자체는 채점하지 않는다.
- 전체 모델 정책 상한은 13 RPM / 225000 로컬 안전 유닛 TPM / 450 RPD. 환경값이 더 작으면 그 값을 적용한다.
- 공개 코치의 별도 caller 제한은 min(설정,3) / rolling60초. 로그인 사용자 ID가 아니라 Cloudflare 접속 IP 해시 기준이므로 같은 네트워크에서는 공유될 수 있다.
- D1 units는 실제 Google 청구 토큰이 아니다. 코치 경로는 16384 + 질문/답변 JSON UTF-8 바이트를 보수적으로 예약/소진하고 usageMetadata로 축소하지 않는다.
- Google 한도는 프로젝트 단위이고 일일 초기화는 미국 태평양 자정이다. 한국 시간으로 서머타임 중 16시, 아닐 때 17시. 다른 앱이 같은 Google 프로젝트를 쓰면 Google 한도는 공유하지만 이 D1은 해당 앱의 예약만 기록한다.
- 450회가 학습 질문 450개라는 의미는 아니다. 다른 사용/실패/재시도 없이 요청 수만 계산하면 2회씩 225문항 또는 3회씩 150문항. 분당 제한과 공유 사용량에 따라 실제 가능량은 감소한다.
- 현재 무료 프로젝트 승인 상태를 전제로 사용하며 이 작업은 billing/청구 상태를 변경하지 않는다. 브라우저 음성도 서버 인식을 사용할 수 있고 네트워크 연결이 필요할 수 있으므로 무제한/완전 오프라인을 보장하지 않는다.

## 실제 운영 예산 조회
- 2026-10-23 KST 작업 중 D1 읽기 전용 집계: 날짜 키(Pacific) 2026-10-23 chat consumed 6회 / 98673 units, 2026-10-22 chat consumed 6회 / 112198 units.
- 조회 시점 전체 기록: 대화 12회, Gemini STT 0건, Gemini TTS 0건. 당일 앱 상한 450 대비 6회 사용(1.33%), 앱 기록 기준 잔여 최대 444회. 다른 서비스 사용량은 포함하지 않음.
- 증거 `.agy-work/142_budget_snapshot.json`: rows_written=0, changed_db=false.
- CLI는 budget binding이 production 환경에 있기 때문에 `--env production`이 필요했다. Pages 배포 명령에는 해당 옵션을 사용하지 않는다.

## 공식 참고
- https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition — Chrome 서버 기반 음성 인식, interim/final, 언어·후보 동작.
- https://ai.google.dev/gemini-api/docs/rate-limits — RPM/TPM/RPD, 프로젝트 단위 한도, Pacific 자정 리셋.

## 검증 상태
- 요구 변경 RED: 5파일 59시험 중 27실패/32통과 (`.agy-work/141_direct_red.log`). 기존 제품이 확인 질문을 요구하고 성인 체크를 계속 표시함을 재현.
- 구현/최종 회귀/운영 배포 결과: 완료. 아래 최종 결과 참고.
- 새 흐름의 실제 S25 마이크 재시험은 배포 후 사용자 확인 필요. 네이티브 서비스 모의 시험과 실제 기기 인식 정확도는 구분한다.

## 최종 결과 (2026-10-23 22:08 KST)
- Gemini 구현 및 감독 cleanup 완료: `.agy-work/140_direct_coach_response.json`, `.agy-work/147_direct_cleanup_response.json` SUCCESS. 제품 변경 5파일 이외 기능 확장 없음.
- 미사용 confirming 상태/배지/네·아니요 안내/메서드와 transcriptConfirmed 필드 제거. 성인 저장 정책 버전 유지.
- Codex 변경: 기존 Controller21 / Alternatives9 / View13 / PublicCoachAPI4 / PublicCoach12 시험을 현재 사용자 요구로 검증. 확인 전용 시험은 삭제/skip 대신 원본 직접 평가·대안 임의선택 방지·지연 결과 취소·API 횟수 시험으로 전환.
- 최종 scripts/verify.ps1 PASS: TypeScript 타입 검사, lint, 71파일/628시험, Vite build, 보호 경로, diff whitespace. 로그 `.agy-work/149_direct_final_verify.log`.
- 제공 비밀키 literal 검사: 소스/빌드262파일, 일치0. 키값 출력/전달 없음.
- 로컬 브라우저 실제 UI: 첫 방문 체크1개 → 체크 직후0개 → 새로고침0개. 저장된 상태로 시작 버튼 활성화. 360px/scrollWidth360.
- 운영 배포 완료: `36f053dd`, main asset `/assets/index-DRjF-qWI.js`. 기존 운영 주소에서 동일 자산 로드 확인.
- 최종 학습 링크: https://voca-study-akf.pages.dev/?voice-check=1&build=20261023-7 (speech-debug 없이 진단 메뉴 미표시).
- 운영 화면 증거 `.agy-work/153_direct_final_mobile.png`: 실제 360px/scrollWidth360, 성인 체크0개, 확인 질문 없음. `.agy-work/151_direct_operating_mobile.png`는 이름과 달리 2560px 데스크톱 캡처이므로 모바일 증거로 사용하지 않는다.

## 실제 무료 운영 API 시험과 차감
`.agy-work/146_direct_operating_probe.json`: 전사 확인 플래그 없이 합성 영어 3건. 모두 HTTP200, 자동 재시도0, 외부 API 총3회.
1. `Coffee, please.` → relevant/문장미완성, 한국어로 주문 의도 인정 후 완전한 문장 권장, `I'd like a coffee, please.`. 3076ms.
2. `I'd like a coffee, please.` → relevant/완전한문장, 한국어 긍정 피드백, 동일 주문 대상 유지. 4233ms.
3. `zorp flib glax` → uncertain/문장미완성, 한국어 재발화 도움말, 무조건 정답 처리하지 않음. 12279ms.

시험 후 읽기 전용 D1 집계 `.agy-work/152_budget_after.json`:
- Pacific 2026-10-23: chat consumed **9회**, units148048 (직전6회/98673에서 **3회 증가**).
- Pacific 2026-10-22: chat consumed6회, units112198.
- 전체 누적 chat15회, STT0건, TTS0건. 읽기 자체 rows_written0, changed_db=false.
- 오늘 앱 상한450 중9회=2%, 이 DB 기준 잔여 최대441회. 이번 감독의 합성 검증3회도 포함한다.
- 이 3건은 의미 평가/서버 연동 시험이다. 실제 S25 마이크의 새로운 발음 정확도 측정이 아니며, 이번 변경으로 STT 엔진 자체 정확도가 향상됐다고 주장하지 않는다. 초보 단답의 의미 해석·피드백은 보강했다.

## Git 및 남은 확인
- branch main / HEAD 8248697cb4702719dfe7191195bccba5851a9cd4, staged0 유지. 커밋·푸시 없음. 기존 다수 변경은 보존했고 전체를 이번 변경으로 귀속하지 않는다.
- 이 작업에서 제품5파일, 해당 시험5파일, 이 문서1파일을 수정/추가했다. .agy-work는 지시/응답/검증/스크린샷 기록이다.
- S25에서 새 운영 빌드의 질문→답변→직접 피드백→반복 전체 음성 동작은 사용자 기기 재시험 필요. 기존 빌드에서 세 번째 질문까지 사용 및 정확도 만족 보고는 있었으나 새 빌드 물리 기기 검증과 구분한다.
- 무료 브라우저 STT/TTS 방식과 6초 듣기, 모델/90% 예산/IP별3RPM/인증 공개 상태 유지. 추가 요금제/키/패키지/모델 다운로드 없음.
