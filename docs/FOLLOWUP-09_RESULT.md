# FOLLOWUP-09 운영 설정 안내·로컬 네이티브 D1 검증 — 2026-10-22

Codex가 작업지시·검증을, Gemini 구독 CLI가 격리 시험 코드 구현을 맡았다. 사용자용 단계별 안내는 [CONVERSATION_OPERATING_SETUP.md](CONVERSATION_OPERATING_SETUP.md)이다. 계정 설정·운영 Access·원격 DB 생성/스키마/바인딩·Secret·배포는 변경하지 않았다. Google API 호출0, 패키지 설치0.

## 검증 진행 및 결과

첫 Gemini 요청은 JWT/Pages/D1을 포함한 큰 하네스였으나 약9분 동안 결과 파일이 없어 중단했다. 성공으로 집계하지 않았다. 이후 범위를 실제 로컬 D1 어댑터 검증 2파일로 축소했다. Gemini conversation `a8c95f65-bda2-4f7c-8bda-e66e81b1c193`이 `.agy-work/037_native_worker.ts` 및 `037_native_probe.mjs`를 작성했고 Codex가 검토·번들 컴파일·직접 실행했다. 인증/Pages의 기존 검증을 반복 구현하지 않았다.

기존 Wrangler3.114.17/Miniflare workerd의 **실제 로컬 D1 binding**에 기존 `scripts/conversation/budget-schema.sql`을 적용했다. 임의의 가상 UUID와 `.agy-work/037_native_state`만 사용했다. 기존 운영 DB ID 및 사용자 데이터는 사용하지 않았다. 빈 보조 로컬 DB에는 스키마를 적용하지 않았다. 이는 이전 Node SQLite 래퍼 시험과 다른 런타임 호환 증거이며 원격 D1/Access의 검증은 아니다.

| 항목 | 결과 |
|---|---|
| 첫 예약 허용 | PASS |
| 같은 요청 ID 중복 거절 | PASS |
| 첫 예약 뒤 동시6요청 중 추가1건만 허용 (RPM2) | PASS |
| 모델 전역 한도 소진 후 다른 호출자도 차단 | PASS |
| consume 두 번 호출 멱등성 | PASS |
| consumed 후 release로 환불되지 않음 | PASS |
| 실제 로컬 DB의 정확한 행·상태·유닛 확인 | PASS |
| 스키마 없는 DB에서 DATABASE_RESERVATION_FAILED로 차단 | PASS |

**네이티브 런타임 8/8 PASS.** 실제 DB 읽기 결과는 STT 모델, 1088유닛, consumed1행/reserved1행이다. Codex가 서버를 종료한 뒤 Wrangler 로컬 SELECT로 다시 읽어 일치함을 확인했다. 해시·키·발화·음성은 결과에 출력하지 않았다. 동시성은 단일 로컬 런타임 내부 6요청 시험이며 다지역 전역 부하 시험으로 확대 해석하지 않는다.

- 실행: `wrangler d1 execute ... --local --config .agy-work/037_native_wrangler.toml --persist-to .agy-work/037_native_state --file scripts/conversation/budget-schema.sql`; `wrangler dev --local ... --port8790`; `node .agy-work/037_native_probe.mjs`.
- 증거: `.agy-work/037_native_result.json`, `037_native_rows.json`, `037_schema_apply.log`.
- 검증 Worker는 운영 경로에 연결되지 않은 Git 제외 파일이다. 로컬 서버는 종료했다. DB 초기화/삭제/리셋 코드는 없다. 하네스는 새 격리 상태에서 1회 실행하는 시험이며 같은 상태에 재실행하면 이전 소진 행 때문에 실패할 수 있다.
- 전체 회귀 `scripts/verify.ps1`: **53파일496시험 PASS**, 타입/lint/build·보호경로·diff 공백 PASS (`.agy-work/039_full_verify.log`). 네이티브8개는 이496개에 포함되지 않는 별도 통합 검증이다.
- 이번 턴 소스168파일 비교: 변경0/신규0/누락0 (`.agy-work/039_source_scope.json`). 제품 코드·기존 시험·생성 보드 불변. 문서와 Git 제외 검증 자료만 추가/갱신했다.
- 현재 정적 preflight는 예상대로 exit2/BLOCKED_FAIL_CLOSED. 운영 어댑터 실연결을 확인하는 도구가 아니므로 설정 완료 후에도 이 출력으로 운영 연결 성공을 판정하지 않는다.

## 남은 관문

운영 Access 팀/AUD·호스트 보호·계정 허용 정책·실제 JWT 전달, 원격 독립 예산 D1 바인딩/스키마·최신 코드 배포 및 실제 운영 경로는 미검증이다. 사용자는 안내서 순서로 준비하고 프로젝트 이름/URL·팀 도메인·AUD·예산 DB 이름/ID·스키마/변수 적용 여부만 알려주면 된다. 키·JWT·로그인 PIN은 전달하지 않는다.

공식 Google 한국 지원 목록과 현재 약관 원문을 확인해 안내서에 출처와 적용 구분을 기록했다. 이를 사용자 앱의 법적 적격성이나 약관 동의 완료로 판정하지 않았다. 실제 기기 Android/Safari/PWA, 교재 교사 검수, 외부 독립 리뷰, BOARD-01 원본 첨부 대조 및 BOARD-12A 직접 file 열람도 기존 미검증 상태 유지한다. BOARD-12B는 이전 전용 렌더러 검증 범위에서 PASS 유지한다.

**PUBLIC_RELEASE_STATUS=NOT_APPROVED**, 운영 호출 기본 차단 유지. `main`, HEAD `8248697cb4702719dfe7191195bccba5851a9cd4`, staged0. stage/commit/push/배포 없음.
