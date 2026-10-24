# AI 회화 운영 Access·독립 예산 DB 연결 순서

2026-10-22 Codex 코드·공식 문서 대조. 실제 계정 설정·DB 생성·스키마 적용·배포는 이 문서를 작성하면서 실행하지 않았다. 사용자가 확인한 Pages 프로젝트 이름은 `voca-study`, 운영 주소는 `https://voca-study-akf.pages.dev`이다. Cloudflare 대시보드의 계정 식별자는 문서에 기록하지 않는다. 현재 외부 호출 기본 차단을 유지한다.

## 1. 접속 주소와 무료 요금제 확인

Cloudflare 대시보드에서 **Workers & Pages → voca-study**를 연다. 운영 호스트는 **voca-study-akf.pages.dev**, 미리보기 호스트 패턴은 **\*.voca-study-akf.pages.dev**이다. 프로젝트 이름과 호스트 이름이 다르므로 Access에는 프로젝트명 대신 실제 호스트를 지정한다. Workers/D1은 Free를 유지한다. D1 Free는 일일 읽기·쓰기 한도 초과 시 쿼리가 실패하므로 유료 업그레이드 없이 차단되는 방향을 유지한다. [D1 무료 한도 동작](https://developers.cloudflare.com/d1/reference/faq/)

## 2. Zero Trust 팀 생성

Cloudflare **Zero Trust**를 처음 열면 팀 이름을 만들고 **Free** 플랜을 선택한다. 팀 주소를 `https://팀이름.cloudflareaccess.com` 형태로 기록한다. 코드가 이 정확한 형태를 요구하므로 끝의 `/`나 경로를 붙이지 않는다. 공식 온보딩은 Free에서도 결제 수단 입력 단계가 있을 수 있다고 안내한다. 해당 입력 및 약관 동의는 사용자가 직접 진행한다. [공식 시작 안내](https://developers.cloudflare.com/cloudflare-one/setup/)

로그인 방식은 기본 Cloudflare 계정 또는 Email one-time PIN 등 실제 시험자가 사용할 방식을 정한다. One-time PIN을 쓸 때는 Identity providers/Login methods에서 추가하고 해당 앱에서 사용 가능하게 한다. 이는 Cloudflare API token이나 Google API 키를 새로 만드는 작업이 아니다.

## 3. 실제 접속 호스트를 Access로 보호

현재 `voca-study-akf.pages.dev`를 사용한다면 Pages 프로젝트 **Settings → Enable access policy → Manage**에서 생성된 Access 앱을 연다. 자동 생성된 `*.voca-study-akf.pages.dev`는 보통 미리보기용이므로 **운영 `voca-study-akf.pages.dev`도 실제 보호 대상인지 확인**한다. 공식 Pages 안내는 생성 앱의 wildcard를 제거해 운영 호스트를 보호하고, 이후 미리보기 정책을 다시 켜 두 정책을 구성하는 절차를 제시한다. [Pages 도메인의 Access 설정](https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain)

초기 내부 시험은 **운영 호스트 전체**를 보호하는 방식이 로그인 확인이 쉽다. API만 보호하면 첫 fetch가 로그인 HTML/리디렉션을 받아 앱 오류가 될 수 있어 별도의 로그인 진입 흐름이 필요하다. 기존 일반 학습 화면도 로그인 뒤 접근하게 되는 범위를 이해하고 사용자가 설정한다.

Access 앱의 정책은 **Allow → Include → Emails → 본인 및 명시적으로 허용한 성인 시험자 이메일만** 지정한다. Everyone/Bypass 정책을 사용하지 않는다. Allow에 포함하지 않은 사용자는 접근 불가 상태를 유지한다. 이메일 허용은 연령 확인 자체가 아니므로 내부 성인 시험자 조건은 별도 확인한다.

사용자 도메인을 쓰면 **Zero Trust → Access controls → Applications → Create application → Self-hosted**에서 실제 사용자 도메인도 보호해야 한다. 미리보기/사용자 도메인별 앱 AUD가 다를 수 있다. 현재 서버 설정은 AUD 1개만 받으므로 **실제 운영 호스트를 보호하는 앱의 AUD**를 선택한다. Preview에는 외부 호출 허용을 복사하지 않는다.

## 4. 팀 도메인과 Application AUD 기록

**Zero Trust → Settings**에서 팀 이름/도메인을 확인한다. **Access controls → Applications → 해당 앱 Configure → Additional settings → Application Audience (AUD) Tag**를 복사한다. App ID, Account ID, Service token과 혼동하지 않는다. Access가 원본 서버로 전달하는 `Cf-Access-Jwt-Assertion`은 서버에서 서명·발급자·AUD·기한을 다시 검증한다. 브라우저에서 JWT를 복사해 채팅으로 보낼 필요가 없다. [AUD 확인 및 JWT 검증](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

## 5. 독립 예산 D1 생성 및 스키마 적용

Cloudflare **Storage & databases → D1 SQL Database → Create database**에서 예를 들어 `voca-conversation-budget`를 새로 만든다. 기존 앱의 `voca-study-db`와 **DB ID가 달라야 한다**. 이름과 UUID(Database ID)를 기록한다. [D1 생성](https://developers.cloudflare.com/d1/get-started/#2-create-a-database)

새 DB의 **Console**에서 저장소의 `scripts/conversation/budget-schema.sql`을 열어 CREATE TABLE 1문장 및 CREATE INDEX 3문장을 적용한다. Console이 여러 문장을 받지 않으면 한 문장씩 실행한다. **이 파일에 DROP/DELETE는 없다. 기존 앱 DB에 적용하지 않는다.** 적용 후 아래 읽기 전용 쿼리로 테이블·인덱스를 확인한다.

```sql
SELECT type, name
FROM sqlite_master
WHERE name = 'conversation_budget_reservations'
   OR name IN ('idx_budget_model_window', 'idx_budget_model_day', 'idx_budget_caller_window');
```

예상: 테이블1+인덱스3. 이 DB에는 request/caller 해시·모델·시간·예산 숫자·소진 상태만 저장한다. 사용자 발화·음성·사진·PDF·교재·점수·JWT·API 키는 저장하지 않는다.

## 6. Pages의 D1 바인딩 연결

정확한 **바인딩 변수명은 `CONVERSATION_BUDGET_DB`**다. 문자열 환경변수로 DB 이름을 넣는 것이 아니라 D1 리소스 바인딩으로 연결한다. 대시보드 방식은 **Workers & Pages → 프로젝트 → Settings → Bindings → Add → D1 database**에서 위 변수명과 새 DB를 선택한다. 바인딩은 새 배포에 반영된다. [Pages D1 바인딩](https://developers.cloudflare.com/pages/functions/bindings/#d1-databases)

**이 저장소에는 `pages_build_output_dir`가 있는 `wrangler.toml`이 있다. 실제 배포가 이를 설정 원본으로 쓰면 대시보드에서 같은 항목을 수정할 수 없거나 다음 배포에서 덮어써질 수 있다.** 이 경우 DB 이름/ID를 Codex에 전달하면 기존 `DB`를 유지하며 production에만 추가할 정확한 변경을 준비한다. Preview 기본 바인딩과 플래그는 그대로 비활성으로 둔다. 단순히 `[env.production]` 끝에 기존DB를 덮어쓰거나, 기존 `DB` binding 이름을 바꾸지 않는다. [설정 원본 규칙](https://developers.cloudflare.com/pages/functions/wrangler-configuration/#source-of-truth)

운영 블록에 **추가할 예시**(실제 ID를 받은 뒤 검토용이며 이 문서만으로 연결되지 않음):

```toml
[[env.production.d1_databases]]
binding = "CONVERSATION_BUDGET_DB"
database_name = "voca-conversation-budget"
database_id = "<새 예산 DB의 UUID>"
```

## 7. Production 변수와 Secret 등록

Pages 프로젝트 **Settings → Variables and Secrets**의 **Production**에 아래를 준비한다. Wrangler 관리 항목이면 소스 설정과 일치시킨다. API 키는 **Encrypt/Secret**로 넣고 `VITE_` 접두어를 절대 붙이지 않는다. 로컬 `docs/.env`는 Cloudflare에 자동 업로드되지 않는다. [Pages 변수·Secret](https://developers.cloudflare.com/pages/functions/bindings/#secrets)

| 이름 | 넣을 값 / 형식 |
|---|---|
| `GEMINI_API_KEY` | 기존 청구 미연결 무료 프로젝트의 키, Secret |
| `CONVERSATION_ACCESS_TEAM_DOMAIN` | `https://팀이름.cloudflareaccess.com` |
| `CONVERSATION_ACCESS_AUDIENCE` | 운영 호스트를 보호하는 앱의 AUD |
| `CONVERSATION_MODEL_LIMITS_JSON` | `docs/CONVERSATION_MODEL_LIMITS_90_PERCENT.json`의 JSON 내용 전체 |
| `CONVERSATION_FREE_TIER_CONFIRMED` | 무료·청구 미연결 상태 확인 후 문자열 `true` |
| `CONVERSATION_ADULT_TESTERS_CONFIRMED` | 허용 대상이 실제 성인 내부 시험자임을 확인한 뒤 문자열 `true` |
| `ALLOW_EXTERNAL_GEMINI_CALLS` | 준비·로그인 점검 동안 `false`; 운영 시험 시작 시에만 `true` |

대시보드 값에 바깥 따옴표를 문자로 포함하지 않는다. JSON은 경로나 파일 이름이 아니라 JSON 본문이다. 아래는 줄바꿈을 제거한 동일한 값이다.

```json
{"gemini-3.5-flash-lite":{"rpm":13,"tpm":225000,"rpd":450,"callerRpm":13},"gemini-3.5-transcribe":{"rpm":2,"tpm":9000,"rpd":22,"callerRpm":2},"gemini-3.8-flash-lite-tts":{"rpm":2,"tpm":9000,"rpd":9,"callerRpm":2}}
```

## 8. 반영 및 운영 경로 검증 순서

먼저 허용 플래그 `false`로, 검토한 코드와 환경설정이 들어간 **새 배포**를 반영한다. 바인딩/Secret 저장만으로 기존 배포 코드가 새 설정을 사용한다고 간주하지 않는다. 저장소가 dirty이고 신규 기능 파일이 아직 미커밋이므로 대시보드의 이전 빌드 재실행만으로 최신 코드가 포함된다고 가정하지 않는다. Git 연결/직접 업로드 방식을 확인한 뒤 최신 변경 범위로 배포 계획을 준비한다. 이 안내는 Codex의 commit/push/배포 실행을 의미하지 않는다.

1. 시크릿 창에서 운영 주소 접속 → Access 로그인 화면 표시.
2. 허용한 계정 로그인 성공, 미허용 계정은 차단 확인. API의 로그인 리디렉션/HTML을 JSON 성공으로 오인하지 않는다.
3. 플래그 false 상태 API403 및 Google0회 확인.
4. 스키마·바인딩·팀/AUD·무료 및 성인 조건 확인 후, 내부 운영 시험을 시작할 때 Production `ALLOW_EXTERNAL_GEMINI_CALLS=true`를 반영한다.
5. 명시 동의 후 비개인 합성 문장 1건으로 응답 및 예산 행 consumed 확인. 앱의 동일Origin 요청을 사용하고 JWT를 채팅/로그로 내보내지 않는다.
6. 중복 요청429, 미인증 차단, 설정 누락403, 모델별 90% 상한 및 실패 차감 확인. 의도적으로 일일 음성9회를 모두 소진하는 시험은 하지 않는다.
7. 오류나 검증 중단 시 허용 플래그 false로 되돌려 반영한다. 자동 재시도/유료 승급/모델 전환은 하지 않는다.

현재 `preflight.mjs`는 네트워크 없는 정적 진단으로 운영 Access/D1 검증을 실제 수행하지 않고 CONFIGURATION_REQUIRED를 남긴다. 운영 설정을 마쳐도 이 도구의 출력을 실계정 연결 성공/실패 증명으로 사용하지 않는다.

## 9. 설정 후 Codex에 전달할 항목

Pages 프로젝트 이름, 운영 URL, 팀 도메인, 해당 앱 AUD, 예산 DB 이름/ID, 스키마 적용 여부, 바인딩과 Production 변수 등록 여부를 알려준다. 키·JWT·로그인 PIN은 보내지 않는다. 실제 이메일 허용 목록도 채팅에 붙일 필요 없이 본인/승인 성인 시험자만 허용했는지 확인한다.

## 10. 이 설정으로 완료되지 않는 관문

실제 기기의 마이크·Safari·PWA 오프라인, 교재 교사 검수, 외부 독립 리뷰, 원본 첨부 비교 및 직접 file 열람은 별도다. Access/D1 연결 성공은 공개 출시 승인이나 사람 검수를 대신하지 않는다. Google의 한국 지원 목록과 약관 원문 검토도 법적 적격성을 자동 확정하지 않는다. 최신 미검증 표는 `CONVERSATION_REMAINING.md`를 따른다.

## Google 지역·약관 원문 대조 보충 (운영 승인과 구분)

2026-10-22 조회한 공식 [지역 목록](https://ai.google.dev/gemini-api/docs/available-regions)에 South Korea가 있다. 다만 한국에서 기술적으로 접근 가능하다는 사실만으로 앱 용도 전체가 적격하다고 판단하지 않는다. [Gemini 추가 약관](https://ai.google.dev/gemini-api/terms)(표시 효력일 2026-03-23)은 API 사용 및 API Client 접근 연령, 개발자의 professional/business 용도, 지원 지역, 특정 유럽 지역에 서비스를 제공할 때의 유료 서비스 조건을 명시한다. 무료 서비스의 입력·출력은 제품 개선과 사람 검토에 쓰일 수 있고 민감·기밀·개인정보 제출을 금한다. 이 앱의 실제 사용 목적·대상·지역 및 안내/동의가 조건에 맞는지는 운영자가 확인해야 한다. 이 원문 대조를 법적 적격성 승인이나 GATE-TERMS-01 완료로 표시하지 않는다.

## 실제 대시보드 화면 확인 (2026-10-22, 사용자와 단계별 진행 중)

Codex가 사용자 요청으로 기존 로그인된 Chrome에서 프로젝트 `voca-study`의 설정을 직접 열었다. 실제 운영 도메인 `voca-study-akf.pages.dev` 및 Git 미연결 표시를 확인했다. Variables and Secrets에 해당 회화 변수가 표시되지 않았고, 기존 D1 `DB`만 표시됐다. 바인딩 추가/편집 버튼은 비활성 상태였다. 이는 아직 운영 연결이 끝났다는 뜻이 아니다. 비활성화 원인은 화면만으로 확정하지 않으며 Wrangler 설정 원본과 맞춰 준비한다.

현재 UI의 Pages **일반 → 프리뷰 액세스 → 프리뷰 제한**은 미리보기 URL만 보호하고 운영 pages.dev/사용자 도메인은 별도 관리한다고 명시한다. 위의 과거 `Enable access policy` 메뉴명은 계정별 UI에 따라 다를 수 있다. 현재 계정에는 이미 Zero Trust 조직과 기존 앱 목록이 있어 새 조직/플랜 생성 단계는 건너뛰었다. 다른 앱 설정은 열거나 수정하지 않았다.

실제 경로는 **왼쪽 Zero Trust → Access 제어 → 애플리케이션 → 새 애플리케이션 만들기 → 자체 호스팅 및 프라이빗(공개 DNS) → 계속**이다. 새 앱 화면의 **사용자 지정 입력으로 전환**을 누르면 공개 호스트 이름 단일 입력란이 나온다. 여기에 `voca-study-akf.pages.dev`만 입력하며 `https://`, `/`, wildcard를 붙이지 않는다. 아래 **새 정책 만들기**로 이동하여 사용자 본인이 Allow 및 허용 이메일을 지정한다. 앱 이름은 세부 정보에서 `voca-study-conversation` 등으로 정한다. 이 계정에서는 앱 세부 정보 하단에 이름/세션시간 및 생성 버튼이 있으며, AUD는 생성 후 확인한다.

Codex는 탐색과 입력 방식 표시만 수행했다. 호스트·이메일 입력, 정책 저장, 앱 생성, D1 생성·스키마·Secret·배포는 실행하지 않았다. 사용자에게 공개 호스트 입력과 새 정책 만들기 클릭을 안내하고 다음 화면에서 이어간다.

Gemini 설정 검토는 조건부 통과이며 P0 없음, 기존 DB 보존·production 배열·정확한 플래그·도메인/AUD·Secret·Functions 포함 배포의 확인 항목을 제시했다. Codex는 `npx vitest run src/features/conversation` 제안을 실제 시험 위치와 맞지 않아 채택하지 않았고, 실제 `tests/conversationAuthBudget.test.ts`, `tests/conversationBudgetPolicy.test.ts`, `tests/conversationPagesIntegration.test.ts` 경로로 직접 실행했다. 이것은 외부 독립 리뷰나 운영 검증 완료가 아니다.

## 현장 진행 보충 — Access 앱·새 D1 생성 후

사용자가 `voca-study-conversation` Access 앱을 생성했고 운영 호스트와 단일 이메일 Allow 정책이 연결된 것을 Codex가 읽기 확인했다. 팀 도메인/AUD는 확인했으나 실제 앱 로그인·JWT 전달·운영 API 성공은 아직 미검증이다. 이어 사용자가 독립 D1 `voca-conversation-budget`를 생성했다. 기존 앱 DB와 다른 UUID이며 처음 확인 시 테이블0이었다.

Gemini가 `wrangler.toml` production에만 `CONVERSATION_BUDGET_DB`를 추가했다. Codex의 TOML 구조 비교에서 기존 설정 전체 보존·기존 바이트 prefix 보존·기본/preview 불변을 확인했고 Pages Functions 로컬 컴파일이 통과했다. 아직 배포되지 않아 실제 운영 바인딩 완료로 판정하지 않는다.

Codex는 새 DB의 콘솔에 기존 budget-schema.sql과 공백 제외 완전히 일치하는 CREATE TABLE1/CREATE INDEX3 SQL을 입력만 했다. 사용자에게 실행 버튼을 안내하며, 원격 실행·테이블 생성 결과는 다음 화면에서 확인한다. DROP/DELETE/ALTER/INSERT/UPDATE는 포함하지 않는다.

## 현장 진행 보충 — 원격 스키마 확인 및 Secret 구분

사용자가 콘솔의 CREATE SQL을 실행했고, Codex가 같은 새 예산 DB에서 읽기 전용 sqlite_master SELECT를 실행하여 테이블1개 및 지정 인덱스3개가 실제로 존재함을 확인했다. 이는 원격 스키마 존재 검증이며 앱의 실제 원격 바인딩/예산 차감 연동 성공과는 구분한다.

현재 계정의 Variables and Secrets 추가 창은 일반 변수가 Wrangler에서 관리되므로 **대시보드에서는 암호화된 Secret만 관리 가능**하다고 명시한다. 이에 따라 일반 플래그3개와 90% 한도 JSON은 Gemini가 production vars에 준비했고, API키·Access 팀 도메인·AUD는 사용자가 Cloudflare Secret으로 직접 등록한다. 문자열을 Secret에 저장해도 서버 env에서 동일하게 읽힌다.

자동 승인 검토가 실제 팀 도메인/AUD를 Gemini에 전송하는 요청을 기존 승인 범위 밖으로 거절했다. 해당 명령은 실행되지 않았다. 이후 Gemini 작업 범위를 비식별 일반 설정4개로 줄여 실행했고, 운영 식별자는 전달하지 않았다. Codex가 기존 TOML 전체 및 바이트 prefix 보존·production 한정·한도 JSON 일치·키/Access 식별자 부재를 검증했다. ALLOW_EXTERNAL_GEMINI_CALLS=false 및 성인 확인=false로 호출은 계속 차단한다. 성인 내부 시험자 여부는 사용자 확인 대기다.

바인딩 추가 후 전체53파일496시험이 통과했고, 일반 vars 추가 후 TOML 구조 비교와 Pages Functions 로컬 컴파일도 통과했다. 실제 배포/Secret 저장/API 실호출은 아직 미검증이다. 현재 사용자가 직접 키 값을 넣을 GEMINI_API_KEY Secret 등록 창을 열어두었다. 키 입력 전 빈 화면만 기록했으며 키 값은 관찰·기록·외부 전달하지 않는다.

### 2026-10-22 사용자 직접 배포 후 확인

사용자가 Wrangler 로그인 및 운영 배포를 직접 완료했다. Codex가 Production 설정에서 기존 `DB` 보존, 별도 `CONVERSATION_BUDGET_DB` → `voca-conversation-budget` 반영, 모델별90% JSON, `ALLOW_EXTERNAL_GEMINI_CALLS="false"`, 무료/성인 확인 `true`, 세 Secret의 암호화 저장 상태를 확인했다. 키 값은 읽지 않았다. 프리뷰 Access는 wildcard 호스트에 활성화됐고 실제 포함 규칙은 본인 이메일1개다. 운영 기본 주소 접속은 회화 전용 Cloudflare Access 로그인 화면으로 리디렉션됐다. 로그인 성공·비허용 사용자 거부·서버 JWT 검증·운영 DB 예산 예약·실제 모델 호출은 아직 미검증이며, 현재 외부 호출 차단을 유지한다.

배포 전 최신 검증: `.agy-work/051_predeploy_verify.log` 전체53파일496시험, 타입 검사·빌드·보호 경로·diff 통과. Pages Functions 로컬 컴파일 통과. 제공 키 리터럴의 소스/빌드224파일 검색0건. Gemini의 잘못된 범용 API 경로 기반 부재 의견은 실제 전용 `functions/api/conversation/[[action]].ts`와 `src/features/conversation/server/configFactory.ts` 재검토로 철회됐다(`.agy-work/051b_review_correction_response.json`). 공개 출시/사람 검토 완료를 뜻하지 않는다. 사용자에 의한 배포이며 Codex commit/push 없음.

### 2026-10-22 운영 동의·차단 시험 및 활성화 준비

사용자가 운영 Access 로그인과 현재 정책4대 동의 및 클라우드 시험 스위치를 직접 저장했다. Codex는 UI 체크 상태를 확인했다. 운영 UI에서 합성 문장 `My name is Alex.` 1개를 전송하자 외부 호출 전제 조건 미충족 안내와 규칙 엔진 자동 전환·정상 평가·저장됨이 표시됐다. 이 결과는 실제 Google 응답이나 JWT/DB 예약 통과를 뜻하지 않는다.

다음 통제된 무료 합성 시험을 위해 Gemini가 로컬 `wrangler.toml`의 production `ALLOW_EXTERNAL_GEMINI_CALLS` 문자열만 false→true로 변경했다. Codex가 다른 바이트 불변을 비교하고 인증·예산·Pages71시험 통과를 확인했다. 재배포 전 운영값은 여전히false다. Access 정책·모델별90%총량·독립DB·공개출시NOT_APPROVED는 유지하며, 운영 JWT 검증과 실제 예산 예약은 다음 재배포 이후 검증한다. 이 단계에서 실제 Google 호출·원격DB쓰기·Codex배포·Git커밋/푸시 없음.

### 2026-10-22 실제 운영 1요청 인증 실패 조사

사용자가 외부 호출 허용 설정을 직접 재배포한 뒤 Codex가 합성 문장 `My name is Alex.` 1개를 운영UI로 시험했다. 결과는 `JWKS_FETCH_ERROR` 후 규칙 엔진 전환이며 실제 모델 응답 성공으로 판정하지 않는다. 코드상 모델 호출/예산 예약 전 인증 실패 단계다. 별도 브라우저에서 공개 JWKS는 정상JSON·RSA키2개·5116문자로 읽혔다(실제 도메인·AUD·토큰은 Gemini에 전달하지 않음).

원인 입증: 프로젝트 Wrangler3.114.17 동봉 Miniflare의 네이티브 Request는 `redirect:error`를 즉시 거부하고 `manual`은 허용한다. `.agy-work/056_native_redirect_probe.mjs`의 마지막 실행으로 재현했다. Gemini가 인증 어댑터의 공개키 fetch를 `manual`로만 수정했고 3xx는 기존 response.ok 검사로 거부해 추종하지 않는다. 고정호스트/3초/64KiB/RS256/발급자·대상 검사는 보존됐다. 새 회귀 시험은 격리된 기존 소스에서 예상대로 실패했고 수정본 전체53파일497시험은 통과했다. 실제 운영 재검증은 이 수정의 사용자 재배포 이후 필요하다.

무료 사용량 문제는 미해결이다. 기존90%전역총량 Chat450/STT22/TTS9는 유지한다. 매턴STT/TTS 각1회라면 TTS로 하루최대9턴 수준이며 혼자 사용해도 같다. 기존 브라우저 합성은 서버TTS 실패 후의 대체 경로다. 브라우저 합성 기본 전환과 로컬STT 검토는 아직 구현되지 않았다. 기기합성은 제공업체 원격 음성을 사용할 수 있으므로 완전오프라인을 보장하지 않는다. 공개출시·공유적합성 승인 없음. 이번조사에서 키/JWT/발화 원문을 Gemini에 전달하지 않았다(합성 예문만 전달). Codex배포/commit/push 없음.

### 2026-10-22 무료 음성 사용량 개선 준비 (사용자 재배포 필요)

- 운영 합성1요청은 JWKS_FETCH_ERROR로 실패했고, 독립 예산 DB의 읽기 SELECT 결과 예약행0개였다. 실제 모델 성공을 주장하지 않는다.
- Gemini의 인증 수정은 redirect:error→manual만 반영했고, 고정 URL·3초·64KiB·RS256과 3xx거부를 유지했다. 네이티브 런타임의 기존옵션실패와 새옵션허용, 기존소스의 회귀시험실패, 수정본 통과를 Codex가 확인했다.
- 기본 `음성 듣기`는 브라우저 합성으로 전환해 Google TTS 자동 호출0회이며, 기존 클라우드 캐시 재생도 기본 경로에서 제외한다. 별도 `클라우드 음성 듣기 (한도 사용)` 버튼에만 기존동의·정책·취소·캐시를 적용한다. 브라우저 제공업체 원격 음성 가능성을 UI에 고지했다. STT22/일 및 클라우드TTS9/일 한도 자체는 그대로다.
- 정식 tests/conversationAudioPlayerPolicy.test.tsx의5개행동검증(기본호출0·배속, 명시적호출, 동의없음0, 브라우저실패시클라우드0, 중지후지연응답재생없음)을 Gemini가 보존했다. Codex 최종 정식54파일502시험 PASS(.agy-work/057_product_tests.log), 타입/lint/build/보호경로/diff PASS(.agy-work/057_full_verify.log). 후자의55/507집계는 당시 격리검증복사본5개가 중복발견된 수이며 복사본을 fixture로 바꿔 정식집계를 재확인했다. 최신키검색225파일0건. Functions컴파일은 인증수정후통과했다.
- 변경은 로컬준비상태다. 운영재배포 후 인증/JWT/예산예약/모델응답 및 브라우저음성 실기기 검증이 필요하다. 로컬STT 미구현, Android/Safari/PWA 실기기·사람교사검수·독립외부리뷰·BOARD01원본·BOARD12A직접파일은 여전히 미검증이다. 공개출시NOT_APPROVED, 사용자만Access허용, 종량제금지 및90%총량 유지. Codex배포/DB쓰기/commit/push 없음.

### 2026-10-23 운영 검증 및 기기 음성 입력 준비

사용자 재배포 후 운영 합성 대화3/3(연습2+역할극1)이 성공했다. 독립예산DB 읽기집계는0→consumed3건, 보수적입력예산62,847단위였다. 기본브라우저듣기도 실행했고 STT/TTS예산행은 없었다. 실제Google토큰/금액 또는 장기안정성을 뜻하지 않는다. JWT공개키오류는 이3회에서 재발하지 않았다. 상세 docs/FOLLOWUP-10_OPERATING_VALIDATION.md 및 .agy-work/058_operating_verification.json 참조.

Gemini가 기기내 전용 음성입력서비스/기본마이크/명시적클라우드입력/수동영어팩설치를 구현했다. 원격인식 자동전환 없음, 기기입력은GoogleSTT0회, 편집후사용자전송유지. 취소대기/준비중완료/설치실패 오안내를 Codex가 실패시험으로 재현해 수정시켰다. 좁은입력창44px축소와글자겹침도수정하고360px컨테이너에서입력310px·가로넘침0을확인했다. 최종정식57파일520시험·타입/lint/build/보호경로/diff PASS(.agy-work/060_final_verify.log), 제공키검색230파일0건. 새음성입력은로컬빌드완료이며재배포대기다. 실제Chrome은processLocally지원·영어팩downloadable관찰, 설치/실제마이크/Android/Safari는미검증. 원래GoogleSTT22/일,클라우드TTS9/일,Chat450/일과90%정책/본인Access범위는유지했다. 공개출시NOT_APPROVED; Codex배포/원격DB쓰기/stage/commit/push 없음.
