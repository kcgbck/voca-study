// scripts/conversation/preflight.d.mts
// 로컬 API 사전점검 도구 TypeScript 선언 파일

export interface EnvInspectionResult {
  isValidFormat: boolean;
  hasApiKey: boolean;
  isApiKeyNonEmpty: boolean;
  allowExternalCallsFlag: boolean;
  viteClientLeakRisk: boolean;
  duplicateKeyAnomaly: boolean;
  errorCode: string | null;
}

export interface PreflightOptions {
  envFilePath?: string;
  virtualEnvContent?: string;
}

export interface PreflightResult {
  timestampKST: string;
  networkCalls: number;
  checks: {
    envFileDetected: boolean;
    envInspection: {
      isValidFormat: boolean;
      hasApiKey: boolean;
      isApiKeyNonEmpty: boolean;
      allowExternalCallsFlag: boolean;
      viteClientLeakRisk: boolean;
      duplicateKeyAnomaly: boolean;
      errorCode: string | null;
    };
    staticAssumptions: {
      serverSourceRef: string;
      pagesAuthAdapter: string;
      pagesBudgetAdapter: string;
      freeTierProjectVerification: string;
      adultConsentVerification: string;
    };
    modelQuotaVerification: {
      chatModel: string;
      transcribeModel: string;
      ttsModel: string;
    };
  };
  readiness: {
    isReadyForLiveCalls: boolean;
    blockReasons: string[];
  };
  localReadyStatus: string;
  publicReleaseStatus: string;
}

export function inspectEnvContent(rawText: unknown): EnvInspectionResult;
export function runPreflight(options?: PreflightOptions): PreflightResult;
