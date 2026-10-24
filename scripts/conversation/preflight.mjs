// scripts/conversation/preflight.mjs
// 로컬 API 사전점검 도구 (네트워크 0회, Fail-Closed 기반, 비밀값 비노출 안전 진단기)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 엄격한 1행 단위 dotenv 하위집합 파서
 * [보안 및 교육 규칙 원칙]:
 * 1. 키의 값, 해시, 마스킹된 문자열을 일체 반환하거나 외부에 노출하지 않는다.
 * 2. 빈 값, 따옴표 빈 값("", ''), 주석, 인라인 주석, 잘못된 행, 중복 키, 변수 확장은 Fail-Closed 처리한다.
 * 3. dotenv 확장($VAR)이나 process.env 덮어쓰기/파일 쓰기 실행이 없다.
 * 4. VITE_ 접두어 키 사용 시 클라이언트 번들 누출 위험을 진단한다.
 */
export function inspectEnvContent(rawText) {
  if (typeof rawText !== 'string') {
    return {
      isValidFormat: false,
      hasApiKey: false,
      isApiKeyNonEmpty: false,
      allowExternalCallsFlag: false,
      viteClientLeakRisk: false,
      duplicateKeyAnomaly: false,
      errorCode: 'INVALID_INPUT_TYPE',
    };
  }

  const lines = rawText.split(/\r?\n/);
  const seenKeys = new Set();
  let duplicateKeyAnomaly = false;
  let hasApiKey = false;
  let isApiKeyNonEmpty = false;
  let allowExternalCallsFlag = false;
  let viteClientLeakRisk = false;
  let isValidFormat = true;
  let detectedErrorCode = null;

  let apiKeyCandidate = null;
  let allowCandidate = null;

  for (const line of lines) {
    const trimmed = line.trim();
    // 전체 빈 행이거나 독립 주석 행은 건너뜀
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) {
      // '='가 없는 잘못된 형식의 행 -> Fail-Closed
      isValidFormat = false;
      detectedErrorCode = 'MALFORMED_LINE_NO_EQUALS';
      break;
    }

    const key = trimmed.slice(0, equalIndex).trim();
    const rawVal = trimmed.slice(equalIndex + 1).trim();

    // 키 식별자 유효성 검사 (영문자/언더스코어로 시작, 영문숫자/언더스코어)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      isValidFormat = false;
      detectedErrorCode = 'INVALID_KEY_NAME';
      break;
    }

    // 중복 키 감지 시 무결성 이상으로 Fail-Closed
    if (seenKeys.has(key)) {
      duplicateKeyAnomaly = true;
      isValidFormat = false;
      detectedErrorCode = 'DUPLICATE_KEY_DETECTED';
      break;
    }
    seenKeys.add(key);

    // VITE_ 접두어 클라이언트 번들 노출 위험 감지
    if (key.startsWith('VITE_GEMINI') || key.startsWith('VITE_API_KEY')) {
      viteClientLeakRisk = true;
    }

    // 변수 확장($VAR, ${VAR})은 실행/지원하지 않으므로 감지 시 Fail-Closed
    if (rawVal.includes('$')) {
      isValidFormat = false;
      detectedErrorCode = 'VARIABLE_EXPANSION_NOT_SUPPORTED';
      break;
    }

    let parsedVal = '';

    if (rawVal.startsWith('"')) {
      if (!rawVal.endsWith('"') || rawVal.length < 2) {
        // 따옴표 불일치 -> Fail-Closed
        isValidFormat = false;
        detectedErrorCode = 'MISMATCHED_DOUBLE_QUOTES';
        break;
      }
      parsedVal = rawVal.slice(1, -1).trim();
    } else if (rawVal.startsWith("'")) {
      if (!rawVal.endsWith("'") || rawVal.length < 2) {
        // 따옴표 불일치 -> Fail-Closed
        isValidFormat = false;
        detectedErrorCode = 'MISMATCHED_SINGLE_QUOTES';
        break;
      }
      parsedVal = rawVal.slice(1, -1).trim();
    } else {
      // 따옴표 없는 값
      if (rawVal.endsWith('"') || rawVal.endsWith("'")) {
        isValidFormat = false;
        detectedErrorCode = 'MISMATCHED_QUOTES';
        break;
      }
      // 인라인 주석(#)이 포함된 경우 (예: GEMINI_API_KEY= # comment)
      if (rawVal.includes('#')) {
        isValidFormat = false;
        detectedErrorCode = 'UNQUOTED_INLINE_COMMENT_FAIL_CLOSED';
        break;
      }
      parsedVal = rawVal;
    }

    if (key === 'GEMINI_API_KEY') {
      hasApiKey = true;
      apiKeyCandidate = parsedVal;
    }

    if (key === 'ALLOW_EXTERNAL_GEMINI_CALLS') {
      allowCandidate = parsedVal;
    }
  }

  // 형식 오류나 중복키 이상이 있으면 모든 플래그를 false로 강등 (Fail-Closed)
  if (!isValidFormat || duplicateKeyAnomaly) {
    isApiKeyNonEmpty = false;
    allowExternalCallsFlag = false;
  } else {
    if (hasApiKey && apiKeyCandidate !== null && apiKeyCandidate.length > 0) {
      isApiKeyNonEmpty = true;
    }
    if (allowCandidate === 'true') {
      allowExternalCallsFlag = true;
    }
  }

  return {
    isValidFormat,
    hasApiKey,
    isApiKeyNonEmpty,
    allowExternalCallsFlag,
    viteClientLeakRisk,
    duplicateKeyAnomaly,
    errorCode: detectedErrorCode,
  };
}

/**
 * 사전점검 종합 진단 실행 함수 (네트워크 0회)
 * @param {object} options
 * @param {string} [options.envFilePath] 점검할 env 파일 경로
 * @param {string} [options.virtualEnvContent] 가상 테스트용 파일 내용 fixture
 */
export function runPreflight(options = {}) {
  const envFilePath = options.envFilePath || 'docs/.env';
  const virtualContent = options.virtualEnvContent;

  const now = new Date();
  const kstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const timestampKST = kstTime.toISOString().replace('Z', '+09:00');

  let envInspection;
  let envFileDetected = false;

  if (typeof virtualContent === 'string') {
    envFileDetected = true;
    envInspection = inspectEnvContent(virtualContent);
  } else {
    try {
      if (fs.existsSync(envFilePath)) {
        envFileDetected = true;
        const content = fs.readFileSync(envFilePath, 'utf8');
        envInspection = inspectEnvContent(content);
      } else {
        envInspection = {
          isValidFormat: false,
          hasApiKey: false,
          isApiKeyNonEmpty: false,
          allowExternalCallsFlag: false,
          viteClientLeakRisk: false,
          duplicateKeyAnomaly: false,
          errorCode: 'ENV_FILE_NOT_FOUND',
        };
      }
    } catch {
      // [보안]: 경로, 시스템 에러 원문, 스택 노출 절대 금지
      envInspection = {
        isValidFormat: false,
        hasApiKey: false,
        isApiKeyNonEmpty: false,
        allowExternalCallsFlag: false,
        viteClientLeakRisk: false,
        duplicateKeyAnomaly: false,
        errorCode: 'ENV_READ_FAILED',
      };
    }
  }

  const blockReasons = [];

  if (!envFileDetected) {
    blockReasons.push('환경 설정 파일이 지정된 경로에 존재하지 않음');
  }
  if (!envInspection.isValidFormat) {
    blockReasons.push('환경 설정 파일 형식이 유효하지 않음 (Fail-Closed)');
  }
  if (!envInspection.isApiKeyNonEmpty) {
    blockReasons.push('GEMINI_API_KEY가 구성되지 않았거나 비어 있음 (또는 이상 행/중복키 감지)');
  }
  if (!envInspection.allowExternalCallsFlag) {
    blockReasons.push('ALLOW_EXTERNAL_GEMINI_CALLS 플래그가 true로 활성화되지 않음');
  }
  if (envInspection.viteClientLeakRisk) {
    blockReasons.push('VITE_ 접두어가 포함된 키가 감지됨 (클라이언트 번들 노출 위험으로 차단)');
  }

  // 조건부 factory 주입에 따른 런타임 설정 및 검증 필요성 (오프라인 정적 진단이며 실호출 허가 판정이 아님)
  blockReasons.push('운영 authAdapter 구성 필요 (CONFIGURATION_REQUIRED: Access 서명 설정 및 런타임 검증 필요)');
  blockReasons.push('운영 budgetAdapter 구성 필요 (CONFIGURATION_REQUIRED: 독립 예산 DB/모델 한도 설정 및 런타임 검증 필요)');
  blockReasons.push('본 진단은 정적 오프라인 진단이며 실제 외부 API 호출 허가 판정이 아님');

  const result = {
    timestampKST,
    networkCalls: 0,
    checks: {
      envFileDetected,
      envInspection: {
        isValidFormat: envInspection.isValidFormat,
        hasApiKey: envInspection.hasApiKey,
        isApiKeyNonEmpty: envInspection.isApiKeyNonEmpty,
        allowExternalCallsFlag: envInspection.allowExternalCallsFlag,
        viteClientLeakRisk: envInspection.viteClientLeakRisk,
        duplicateKeyAnomaly: envInspection.duplicateKeyAnomaly,
        errorCode: envInspection.errorCode,
      },
      staticAssumptions: {
        serverSourceRef: 'functions/api/conversation/[[action]].ts',
        pagesAuthAdapter: 'CONFIGURATION_REQUIRED (Cloudflare Access 서명 검증 및 팀 도메인/Audience 런타임 주입 필요)',
        pagesBudgetAdapter: 'CONFIGURATION_REQUIRED (독립 CONVERSATION_BUDGET_DB 및 모델 한도 JSON 런타임 주입 필요)',
        freeTierProjectVerification: 'NOT_VERIFIED (런타임 미확인; 유료 종량제 방지 확인 필요)',
        adultConsentVerification: 'NOT_VERIFIED (런타임 미확인; 성인 및 4대 동의 필요)',
      },
      modelQuotaVerification: {
        chatModel: 'NOT_VERIFIED (gemini-3.5-flash-lite; 계정별 실제 한도/운영 설정 검증 필요, 목록 존재와 실제 생성/무료한도는 별개)',
        transcribeModel: 'NOT_VERIFIED (gemini-3.5-transcribe; 목록 존재와 실제 생성/무료한도는 별개)',
        ttsModel: 'NOT_VERIFIED (gemini-3.8-flash-lite-tts; 목록 존재와 실제 생성/무료한도는 별개)',
      },
    },
    readiness: {
      isReadyForLiveCalls: false, // 모든 정적 가드 및 런타임 어댑터가 완비되기 전까지 항상 false
      blockReasons,
    },
    localReadyStatus: 'BLOCKED_FAIL_CLOSED',
    publicReleaseStatus: 'NOT_APPROVED',
  };

  return result;
}

// CLI 직접 실행 시 처리 (import 시 부작용 없음)
const currentFilePath = fileURLToPath(import.meta.url);
const invokedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (invokedFilePath === currentFilePath) {
  let envFilePath = 'docs/.env';
  let hasValidArgs = true;

  const rawArgs = process.argv.slice(2);
  let i = 0;
  while (i < rawArgs.length) {
    if (rawArgs[i] === '--config-file') {
      if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('--')) {
        envFilePath = rawArgs[i + 1];
        i += 2;
      } else {
        hasValidArgs = false;
        break;
      }
    } else {
      hasValidArgs = false;
      break;
    }
  }

  if (!hasValidArgs) {
    process.stderr.write(JSON.stringify({ error: 'UNKNOWN_OR_MALFORMED_CLI_OPTION' }) + '\n');
    process.exit(1);
  }

  try {
    const result = runPreflight({ envFilePath });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');

    // 기록용 진단 종료 코드:
    // 1: 파일 읽기 치명적 오류 (ENV_READ_FAILED)
    // 2: 진단 완료되었으나 실호출 준비 미충족 또는 파일 부재 (ENV_FILE_NOT_FOUND, BLOCKED_FAIL_CLOSED)
    // 0: 모든 가드 및 어댑터 통과 (현재 상태에서는 도달 불가)
    if (result.checks.envInspection.errorCode === 'ENV_READ_FAILED') {
      process.exit(1);
    } else if (!result.readiness.isReadyForLiveCalls) {
      process.exit(2);
    } else {
      process.exit(0);
    }
  } catch {
    // 진단 도구 자체 치명적 실패 시 exit 1
    process.stderr.write(JSON.stringify({ error: 'PREFLIGHT_DIAGNOSTIC_FAILURE' }) + '\n');
    process.exit(1);
  }
}
