// tests/conversationPreflight.test.ts
// 로컬 API 사전점검 도구 단위 검증 (가상 임시 Fixture 기반, 실제 파일 미참조, 네트워크 0회 검증)

import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPreflight, inspectEnvContent } from '../scripts/conversation/preflight.mjs';

describe('사전점검 실제 Node CLI 경계', () => {
  const script = fileURLToPath(new URL('../scripts/conversation/preflight.mjs', import.meta.url));
  const invoke = (args: string[]) => spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8', timeout: 5000,
  });

  it('가상 키 파일은 값 노출 없이 exit2, 읽을 수 없는 디렉터리는 exit1', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'conversation-preflight-'));
    const env = path.join(dir, 'fixture.env');
    const fakeSecret = 'synthetic-cli-secret-never-real';
    try {
      writeFileSync(env, `GEMINI_API_KEY=${fakeSecret}\n`);
      const blocked = invoke(['--config-file', env]);
      expect(blocked.status).toBe(2);
      expect(JSON.parse(blocked.stdout).checks.envInspection.isApiKeyNonEmpty).toBe(true);
      expect(blocked.stdout + blocked.stderr).not.toContain(fakeSecret);
      expect(blocked.stdout + blocked.stderr).not.toContain(dir);
      const unreadable = invoke(['--config-file', dir]);
      expect(unreadable.status).toBe(1);
      expect(JSON.parse(unreadable.stdout).checks.envInspection.errorCode).toBe('ENV_READ_FAILED');
      expect(unreadable.stdout + unreadable.stderr).not.toContain(dir);
    } finally {
      unlinkSync(env);
      rmdirSync(dir);
    }
  });

  it('옵션 인자 누락과 알 수 없는 옵션은 원문 비노출 exit1', () => {
    for (const args of [['--config-file'], ['--unknown-private-input'], ['--config-file', '--unknown-private-input']]) {
      const result = invoke(args);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain('unknown-private-input');
    }
  });

  it('새 프로세스에서 모듈을 import해도 출력과 CLI 실행이 없다', () => {
    const moduleUrl = new URL('../scripts/conversation/preflight.mjs', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(moduleUrl)})`], {
      encoding: 'utf8', timeout: 5000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
});

describe('로컬 API 사전점검 도구(preflight) 안전 진단 검증', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. 네트워크 0회 및 비밀값 비노출 격리 원칙 검증', () => {
    it('사전점검 실행 시 전역 네트워크 호출이 발생하지 않아야 한다 (networkCalls: 0)', () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      try {
        const result = runPreflight({ virtualEnvContent: 'GEMINI_API_KEY=test-mock-key\nALLOW_EXTERNAL_GEMINI_CALLS=true' });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(result.networkCalls).toBe(0);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('가상 비밀키가 fixture에 포함되어 있어도 반환 객체 및 직렬화 문자열 어디에도 키 원문이나 마스킹 값이 노출되지 않아야 한다', () => {
      const secretRaw = 'AIzaSyFakeSecret1234567890abcdefABCDEF';
      const virtualContent = `GEMINI_API_KEY=${secretRaw}\nALLOW_EXTERNAL_GEMINI_CALLS=true`;

      const result = runPreflight({ virtualEnvContent: virtualContent });
      const serialized = JSON.stringify(result);

      // 비밀키 문자열 원문 또는 그 부분 문자열이 직렬화된 결과 어디에도 존재하지 않아야 함
      expect(serialized).not.toContain(secretRaw);
      expect(serialized).not.toContain('AIzaSy');
      expect(serialized).not.toContain('abcdef');

      // 오직 불리언 플래그만 존재해야 함
      expect(result.checks.envInspection.hasApiKey).toBe(true);
      expect(result.checks.envInspection.isApiKeyNonEmpty).toBe(true);
    });
  });

  describe('2. Fail-Closed 구문 파싱 및 회귀 검증', () => {
    it('GEMINI_API_KEY= # comment 와 같은 인라인 주석은 유효한 비어있지 않은 값으로 인정하지 않고 failclosed 처리한다', () => {
      const inlineComment = inspectEnvContent('GEMINI_API_KEY= # comment\nALLOW_EXTERNAL_GEMINI_CALLS=true');
      expect(inlineComment.isValidFormat).toBe(false);
      expect(inlineComment.isApiKeyNonEmpty).toBe(false);
      expect(inlineComment.allowExternalCallsFlag).toBe(false);
    });

    it('따옴표 불일치(""val, \'val", val")는 유효 형식을 거부하고 failclosed 처리한다', () => {
      const mismatched1 = inspectEnvContent('GEMINI_API_KEY="unclosed_val\nALLOW_EXTERNAL_GEMINI_CALLS=true');
      expect(mismatched1.isValidFormat).toBe(false);
      expect(mismatched1.isApiKeyNonEmpty).toBe(false);

      const mismatched2 = inspectEnvContent("GEMINI_API_KEY='single_double_mismatch\"\nALLOW_EXTERNAL_GEMINI_CALLS=true");
      expect(mismatched2.isValidFormat).toBe(false);
      expect(mismatched2.isApiKeyNonEmpty).toBe(false);

      const mismatched3 = inspectEnvContent('GEMINI_API_KEY=trailing_quote"\nALLOW_EXTERNAL_GEMINI_CALLS=true');
      expect(mismatched3.isValidFormat).toBe(false);
      expect(mismatched3.isApiKeyNonEmpty).toBe(false);
    });

    it('변수 확장($VAR, ${VAR})은 지원/실행하지 않으므로 감지 시 유효 형식을 거부하고 failclosed 처리한다', () => {
      const expansion1 = inspectEnvContent('GEMINI_API_KEY=$EXISTING_SECRET\nALLOW_EXTERNAL_GEMINI_CALLS=true');
      expect(expansion1.isValidFormat).toBe(false);
      expect(expansion1.isApiKeyNonEmpty).toBe(false);

      const expansion2 = inspectEnvContent('GEMINI_API_KEY=${ENV_SECRET}\nALLOW_EXTERNAL_GEMINI_CALLS=true');
      expect(expansion2.isValidFormat).toBe(false);
      expect(expansion2.isApiKeyNonEmpty).toBe(false);
    });

    it('빈 값 및 따옴표 빈 값("", \'\')은 isApiKeyNonEmpty: false로 Fail-Closed 처리되어야 한다', () => {
      const empty1 = inspectEnvContent('GEMINI_API_KEY=');
      expect(empty1.hasApiKey).toBe(true);
      expect(empty1.isApiKeyNonEmpty).toBe(false);

      const empty2 = inspectEnvContent('GEMINI_API_KEY=""');
      expect(empty2.hasApiKey).toBe(true);
      expect(empty2.isApiKeyNonEmpty).toBe(false);

      const empty3 = inspectEnvContent("GEMINI_API_KEY=''");
      expect(empty3.hasApiKey).toBe(true);
      expect(empty3.isApiKeyNonEmpty).toBe(false);

      const empty4 = inspectEnvContent('GEMINI_API_KEY="   "');
      expect(empty4.hasApiKey).toBe(true);
      expect(empty4.isApiKeyNonEmpty).toBe(false);
    });

    it('등호(=)가 없는 잘못된 행 또는 잘못된 키 이름은 isValidFormat: false 및 failclosed 처리되어야 한다', () => {
      const badLine = inspectEnvContent('INVALID_LINE_WITHOUT_EQUALS\nGEMINI_API_KEY=valid-key');
      expect(badLine.isValidFormat).toBe(false);
      expect(badLine.isApiKeyNonEmpty).toBe(false);

      const badKey = inspectEnvContent('123BAD_KEY=valid-val');
      expect(badKey.isValidFormat).toBe(false);
      expect(badKey.isApiKeyNonEmpty).toBe(false);
    });

    it('중복 키 정의 탐지 시 duplicateKeyAnomaly가 true가 되고 isValidFormat: false 및 failclosed 처리되어야 한다', () => {
      const duplicateContent = 'GEMINI_API_KEY=key-one\nGEMINI_API_KEY=key-two\nALLOW_EXTERNAL_GEMINI_CALLS=true';
      const parsed = inspectEnvContent(duplicateContent);

      expect(parsed.duplicateKeyAnomaly).toBe(true);
      expect(parsed.isValidFormat).toBe(false);
      expect(parsed.isApiKeyNonEmpty).toBe(false);
      expect(parsed.allowExternalCallsFlag).toBe(false);
    });

    it('VITE_ 접두어가 붙은 키가 존재할 경우 클라이언트 번들 누출 위험을 경고해야 한다', () => {
      const viteLeakContent = 'VITE_GEMINI_API_KEY=leak-key\nGEMINI_API_KEY=valid-key';
      const parsed = inspectEnvContent(viteLeakContent);

      expect(parsed.viteClientLeakRisk).toBe(true);
    });

    it('주석, CRLF가 포함된 정상적인 1행 단위 포맷은 안전하게 파싱되어야 한다', () => {
      const validContent = '# Comment line\r\nGEMINI_API_KEY=valid-mock-val\r\nALLOW_EXTERNAL_GEMINI_CALLS=true\r\n';
      const parsed = inspectEnvContent(validContent);

      expect(parsed.isValidFormat).toBe(true);
      expect(parsed.hasApiKey).toBe(true);
      expect(parsed.isApiKeyNonEmpty).toBe(true);
      expect(parsed.allowExternalCallsFlag).toBe(true);
    });
  });

  describe('3. 정적 가드 및 준비 미충족(BLOCKED) 상태 불변성 검증', () => {
    it('키와 플래그가 가상으로 주어지더라도 조건부 factory 주입에 따른 런타임 설정 검증 필요로 인해 isReadyForLiveCalls는 false여야 한다', () => {
      const fullVirtualContent = 'GEMINI_API_KEY=valid-mock-secret\nALLOW_EXTERNAL_GEMINI_CALLS=true';
      const result = runPreflight({ virtualEnvContent: fullVirtualContent });

      expect(result.readiness.isReadyForLiveCalls).toBe(false);
      expect(result.localReadyStatus).toBe('BLOCKED_FAIL_CLOSED');
      expect(result.publicReleaseStatus).toBe('NOT_APPROVED');

      // 행 번호 대신 필드명 기준 정적 가정 확인
      expect(result.checks.staticAssumptions.serverSourceRef).toBe('functions/api/conversation/[[action]].ts');
      expect(result.checks.staticAssumptions.pagesAuthAdapter).toContain('CONFIGURATION_REQUIRED');
      expect(result.checks.staticAssumptions.pagesAuthAdapter).toContain('Access');
      expect(result.checks.staticAssumptions.pagesBudgetAdapter).toContain('CONFIGURATION_REQUIRED');
      expect(result.checks.staticAssumptions.pagesBudgetAdapter).toContain('CONVERSATION_BUDGET_DB');

      // 사용자 청구 확인은 런타임 진단 결과가 아니므로 NOT_VERIFIED로 명시
      expect(result.checks.staticAssumptions.freeTierProjectVerification).toContain('NOT_VERIFIED');
      expect(result.checks.staticAssumptions.adultConsentVerification).toContain('NOT_VERIFIED');

      // 신규 대화 모델(gemini-3.5-flash-lite) 반영 및 실제 한도 검증 필요성 명시 확인
      expect(result.checks.modelQuotaVerification.chatModel).toContain('gemini-3.5-flash-lite');
      expect(result.checks.modelQuotaVerification.chatModel).toContain('NOT_VERIFIED');
      expect(result.checks.modelQuotaVerification.transcribeModel).toContain('gemini-3.5-transcribe');
      expect(result.checks.modelQuotaVerification.ttsModel).toContain('gemini-3.8-flash-lite-tts');

      // 차단 사유에 auth/budget 어댑터 런타임 설정 검증 필요 및 오프라인 진단 한계가 반드시 포함되어야 함
      expect(result.readiness.blockReasons.some((r: string) => r.includes('authAdapter') && r.includes('CONFIGURATION_REQUIRED'))).toBe(true);
      expect(result.readiness.blockReasons.some((r: string) => r.includes('budgetAdapter') && r.includes('CONFIGURATION_REQUIRED'))).toBe(true);
      expect(result.readiness.blockReasons.some((r: string) => r.includes('실제 외부 API 호출 허가 판정이 아님'))).toBe(true);
    });

    it('존재하지 않는 파일 경로 지정 시 고정 에러 코드(ENV_FILE_NOT_FOUND)만 반환하고 파일 경로를 노출하지 않아야 한다', () => {
      const result = runPreflight({ envFilePath: 'non/existent/path/.env.fake' });

      expect(result.checks.envInspection.errorCode).toBe('ENV_FILE_NOT_FOUND');
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('non/existent/path/.env.fake');
    });
  });

  describe('4. 모듈 임포트 무부작용 검증', () => {
    it('도구 모듈 함수 호출 시 콘솔 출력이 발생하지 않아야 한다', () => {
      const consoleLogSpy = vi.spyOn(console, 'log');
      const consoleErrorSpy = vi.spyOn(console, 'error');
      try {
        inspectEnvContent('GEMINI_API_KEY=val');
        runPreflight({ virtualEnvContent: 'GEMINI_API_KEY=val' });

        expect(consoleLogSpy).not.toHaveBeenCalled();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
      } finally {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    });
  });
});
