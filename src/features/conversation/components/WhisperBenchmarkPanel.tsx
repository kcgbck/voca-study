// src/features/conversation/components/WhisperBenchmarkPanel.tsx
// 기기 내 음성 비교 (Web Speech API vs In-Browser Whisper) 벤치마크 패널

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  BENCHMARK_SENTENCES,
  BenchmarkPairRecord,
  calculateWER,
  calculateCER,
  generateBenchmarkReport,
  normalizeForMetrics,
} from '../whisper/whisperBenchmark';
import {
  WhisperClient,
  WhisperClientDeps,
} from '../whisper/whisperClient';
import {
  WhisperAudioRecorder,
  WhisperAudioRecorderDeps,
  resampleTo16kHzMono,
} from '../whisper/whisperAudioRecorder';
import {
  WhisperStatus,
  WhisperProgressPayload,
  WHISPER_MODEL_ID,
  WHISPER_MODEL_REVISION,
  WHISPER_DTYPE,
} from '../whisper/whisperTypes';
import { BrowserSpeechInputService } from '../services/browserSpeechInput';
import { VoiceOutputService } from '../services/voiceOutput';

export interface WhisperBenchmarkPanelProps {
  adultConfirmed: boolean;
  coachingActive: boolean;
  onBusyChange: (busy: boolean) => void;
  // DI 단위 테스트용 선택 의존성
  whisperClientDeps?: WhisperClientDeps;
  audioRecorderDeps?: WhisperAudioRecorderDeps;
  browserSpeechInputService?: BrowserSpeechInputService;
  voiceOutputService?: VoiceOutputService;
}

export const WhisperBenchmarkPanel: React.FC<WhisperBenchmarkPanelProps> = ({
  adultConfirmed,
  coachingActive,
  onBusyChange,
  whisperClientDeps,
  audioRecorderDeps,
  browserSpeechInputService,
  voiceOutputService,
}) => {
  // 클라이언트 인스턴스 (컴포넌트 수명주기 동안 단일 유지)
  const clientRef = useRef<WhisperClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new WhisperClient(whisperClientDeps);
  }

  const recorderRef = useRef<WhisperAudioRecorder | null>(null);
  if (!recorderRef.current) {
    recorderRef.current = new WhisperAudioRecorder(audioRecorderDeps);
  }

  const browserSpeechRef = useRef<BrowserSpeechInputService | null>(null);
  if (!browserSpeechRef.current) {
    browserSpeechRef.current = browserSpeechInputService || new BrowserSpeechInputService();
  }

  const voiceOutputRef = useRef<VoiceOutputService | null>(null);
  if (!voiceOutputRef.current) {
    voiceOutputRef.current = voiceOutputService || new VoiceOutputService();
  }

  // 모델 준비 상태
  const [modelStatus, setModelStatus] = useState<WhisperStatus>(() => clientRef.current!.getStatus());
  const [downloadProgress, setDownloadProgress] = useState<WhisperProgressPayload | null>(null);

  // 벤치마크 문항 및 선택 상태
  const sentences = BENCHMARK_SENTENCES;
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [customRefText, setCustomRefText] = useState(BENCHMARK_SENTENCES[0].referenceText);

  // 실행 및 진행 상태 (동기 ref 확립)
  const [isBusy, setIsBusy] = useState(false);
  const busyRef = useRef(false);
  const [busyPhaseLabel, setBusyPhaseLabel] = useState<string>('');
  const [currentPrompt, setCurrentPrompt] = useState<string>('');

  // 벤치마크 결과 레코드 (화면 인메모리, 최대 20건 제한)
  const [records, setRecords] = useState<BenchmarkPairRecord[]>([]);
  const [latestPair, setLatestPair] = useState<BenchmarkPairRecord | null>(null);

  // 복사 상태 및 수동 복사 텍스트
  const [copyStatus, setCopyStatus] = useState<string>('');
  const [manualReportText, setManualReportText] = useState<string>('');

  // 기기 메타데이터 (사용자 수동 입력/UA 정보)
  const [deviceInput, setDeviceInput] = useState<string>(() => {
    if (typeof navigator !== 'undefined' && navigator.userAgent) {
      if (navigator.userAgent.includes('Android')) return 'Android Mobile (Chrome)';
      return 'Desktop (Chrome)';
    }
    return '';
  });

  // 공개 예제(JFK.wav) 테스트 결과
  const [sampleResult, setSampleResult] = useState<{ text: string; inferenceMs: number; error?: string } | null>(null);

  // 생명주기 및 취소 세대 관리
  const isMountedRef = useRef(true);
  const operationGenRef = useRef(0);
  const compareAbortRef = useRef<AbortController | null>(null);
  const sampleAbortRef = useRef<AbortController | null>(null);
  const activeTimersRef = useRef<Set<any>>(new Set());

  const addTimer = (timer: any) => {
    activeTimersRef.current.add(timer);
    return timer;
  };
  const clearTimer = (timer: any) => {
    clearTimeout(timer);
    activeTimersRef.current.delete(timer);
  };
  const clearAllLocalTimers = () => {
    activeTimersRef.current.forEach((t) => clearTimeout(t));
    activeTimersRef.current.clear();
  };

  const updateBusyState = useCallback(
    (busy: boolean, phaseLabel = '') => {
      busyRef.current = busy;
      if (isMountedRef.current) {
        setIsBusy(busy);
        setBusyPhaseLabel(phaseLabel);
      }
      onBusyChange(busy);
    },
    [onBusyChange]
  );

  // 모든 비동기 작업 및 마이크/워커 완전 취소
  const cancelAllOperations = useCallback(() => {
    operationGenRef.current++; // 세대 증가로 pending 비동기 분기 무력화
    clearAllLocalTimers();

    if (compareAbortRef.current) {
      try {
        compareAbortRef.current.abort();
      } catch {
        // ignore
      }
      compareAbortRef.current = null;
    }

    if (sampleAbortRef.current) {
      try {
        sampleAbortRef.current.abort();
      } catch {
        // ignore
      }
      sampleAbortRef.current = null;
    }

    try {
      browserSpeechRef.current?.cancel();
    } catch {
      // ignore
    }
    try {
      recorderRef.current?.cancel();
    } catch {
      // ignore
    }
    try {
      voiceOutputRef.current?.cancel();
    } catch {
      // ignore
    }
    try {
      clientRef.current?.cancel();
    } catch {
      // ignore
    }

    if (isMountedRef.current && clientRef.current) {
      setModelStatus(clientRef.current.getStatus());
    }

    updateBusyState(false, '');
    if (isMountedRef.current) {
      setCurrentPrompt('');
    }
  }, [updateBusyState]);

  // 문항 선택 변경
  const handleSelectSentence = (idx: number) => {
    if (busyRef.current) return;
    setSelectedIdx(idx);
    setCustomRefText(sentences[idx].referenceText);
    setLatestPair(null);
    setCopyStatus('');
    setManualReportText('');
  };

  // 다음 문항으로 이동
  const handleNextSentence = () => {
    if (busyRef.current) return;
    if (selectedIdx < sentences.length - 1) {
      handleSelectSentence(selectedIdx + 1);
    }
  };

  // 마운트/언마운트 생명주기 및 가시성 리스너
  useEffect(() => {
    isMountedRef.current = true;

    const handleVisibility = () => {
      if (document.hidden) {
        cancelAllOperations();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', cancelAllOperations);

    return () => {
      isMountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', cancelAllOperations);
      cancelAllOperations();
      try {
        clientRef.current?.dispose();
      } catch {
        // ignore
      }
    };
  }, [cancelAllOperations]);

  // 1. 모델 준비 클릭 (명시적 Opt-In)
  const handlePrepareModel = async () => {
    if (busyRef.current || coachingActive || !adultConfirmed) return;

    updateBusyState(true, '모델 준비 중');
    setDownloadProgress(null);
    const thisGen = ++operationGenRef.current;

    try {
      const status = await clientRef.current!.prepare('auto', (p) => {
        if (isMountedRef.current && operationGenRef.current === thisGen) {
          setDownloadProgress(p);
        }
      });
      if (isMountedRef.current && operationGenRef.current === thisGen) {
        setModelStatus(status);
      }
    } catch (err: any) {
      if (isMountedRef.current && operationGenRef.current === thisGen) {
        setModelStatus(clientRef.current!.getStatus());
      }
    } finally {
      if (operationGenRef.current === thisGen) {
        updateBusyState(false, '');
      }
    }
  };

  // 2. 단일 Pair 벤치마크 실행 (Web Speech 1차 발화 -> 한국어 TTS 안내 -> Whisper 2차 발화)
  const handleStartComparison = async () => {
    if (busyRef.current || coachingActive || !adultConfirmed || modelStatus.state !== 'ready') return;

    const activeSentence = sentences[selectedIdx];
    const refText = customRefText.trim();
    if (!refText || normalizeForMetrics(refText).length === 0) {
      alert('유효한 영문/한글 문자가 포함된 참조 문장을 입력해 주세요 (공백이나 구두점만 입력 불가).');
      return;
    }

    const thisGen = ++operationGenRef.current;
    const abortController = new AbortController();
    compareAbortRef.current = abortController;
    const { signal } = abortController;

    updateBusyState(true, '1차 Web Speech 진행 중');
    setCopyStatus('');
    setManualReportText('');
    setCurrentPrompt(`[1/2차] Web Speech API 발화: "${refText}" 문장을 소리 내어 말해 주세요 (10초).`);

    let wsText = '';
    let wsStatus: 'ok' | 'silent' | 'timeout' | 'error' = 'ok';
    let wsErrorMsg: string | undefined;
    const wsStartTime = Date.now();

    // 1차 발화: Web Speech API (버튼 제스처 내에서 동기 start, 16.5초 상한 race 및 abort 즉시 settle)
    try {
      const speechPromise = browserSpeechRef.current!.start('en-US', {
        windowMs: 10000,
      });

      let timeoutHandle: any;
      let abortHandler: (() => void) | null = null;
      const raceDeadline = new Promise<never>((_, rej) => {
        timeoutHandle = addTimer(
          setTimeout(() => {
            try {
              browserSpeechRef.current?.cancel();
            } catch {
              // ignore
            }
            rej(new Error('Web Speech 응답 제한 시간이 초과되었습니다 (16.5초).'));
          }, 16500)
        );

        if (signal.aborted) {
          rej(new Error('Web Speech 인식이 취소되었습니다.'));
        } else {
          abortHandler = () => {
            try {
              browserSpeechRef.current?.cancel();
            } catch {
              // ignore
            }
            rej(new Error('Web Speech 인식이 취소되었습니다.'));
          };
          signal.addEventListener('abort', abortHandler, { once: true });
        }
      });

      try {
        wsText = await Promise.race([speechPromise, raceDeadline]);
      } finally {
        clearTimer(timeoutHandle);
        if (abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
      }

      if (!wsText || wsText.trim().length === 0) {
        wsStatus = 'silent';
      }
    } catch (err: any) {
      try {
        browserSpeechRef.current?.cancel();
      } catch {
        // ignore
      }
      const code = err?.code;
      if (code === 'no-speech' || code === 'empty-result') {
        wsStatus = 'silent';
      } else if (code === 'startup-timeout') {
        wsStatus = 'timeout';
      } else {
        wsStatus = 'error';
        wsErrorMsg = err?.message || '음성 인식 오류';
      }
    }
    const wsElapsedMs = Math.max(0, Date.now() - wsStartTime);

    // 취소되었거나 세대가 바뀌었으면 2차 녹음 진입 절대 금지
    if (!isMountedRef.current || operationGenRef.current !== thisGen || signal.aborted) {
      if (compareAbortRef.current === abortController) {
        compareAbortRef.current = null;
      }
      return;
    }

    // 2차 발화 전 한국어 TTS 안내 (실패/취소 시 안전 탈출, 6초 유한 상한 race)
    updateBusyState(true, '2차 전환 안내 중');
    setCurrentPrompt('이번에는 기기 내 인식입니다. 같은 문장을 다시 말해 주세요.');
    try {
      const ttsPromise = voiceOutputRef.current!.speak('이번에는 기기 내 인식입니다. 같은 문장을 다시 말해 주세요', {
        lang: 'ko-KR',
      });
      let ttsTimerHandle: any;
      let ttsAbortHandler: (() => void) | null = null;
      const ttsDeadline = new Promise<void>((resolve, reject) => {
        ttsTimerHandle = addTimer(
          setTimeout(() => {
            try {
              voiceOutputRef.current?.cancel();
            } catch {
              // ignore
            }
            resolve();
          }, 6000)
        );
        if (signal.aborted) {
          reject(new Error('TTS 취소'));
        } else {
          ttsAbortHandler = () => {
            try {
              voiceOutputRef.current?.cancel();
            } catch {
              // ignore
            }
            reject(new Error('TTS 취소'));
          };
          signal.addEventListener('abort', ttsAbortHandler, { once: true });
        }
      });

      try {
        await Promise.race([ttsPromise, ttsDeadline]);
      } finally {
        clearTimer(ttsTimerHandle);
        if (ttsAbortHandler) {
          signal.removeEventListener('abort', ttsAbortHandler);
        }
      }
    } catch {
      // ignore
    }

    if (!isMountedRef.current || operationGenRef.current !== thisGen || signal.aborted) {
      if (compareAbortRef.current === abortController) {
        compareAbortRef.current = null;
      }
      return;
    }

    // 3초 카운트다운 (취소 시 즉시 settle 및 탈출)
    for (let c = 3; c > 0; c--) {
      setCurrentPrompt(`[2/2차] 기기 내 Whisper 준비 중... ${c}초 후 마이크가 켜집니다.`);
      let countTimerHandle: any;
      let countAbortHandler: (() => void) | null = null;
      const countPromise = new Promise<void>((resolve, reject) => {
        countTimerHandle = addTimer(
          setTimeout(() => {
            resolve();
          }, 1000)
        );
        if (signal.aborted) {
          reject(new Error('카운트다운 취소'));
        } else {
          countAbortHandler = () => {
            reject(new Error('카운트다운 취소'));
          };
          signal.addEventListener('abort', countAbortHandler, { once: true });
        }
      });

      try {
        await countPromise;
      } catch {
        // aborted
      } finally {
        clearTimer(countTimerHandle);
        if (countAbortHandler) {
          signal.removeEventListener('abort', countAbortHandler);
        }
      }

      if (!isMountedRef.current || operationGenRef.current !== thisGen || signal.aborted) {
        if (compareAbortRef.current === abortController) {
          compareAbortRef.current = null;
        }
        return;
      }
    }

    // 2차 발화: In-Browser Whisper 녹음 (권한 대기 중 "준비 중", onReady 시 "마이크 켜짐")
    updateBusyState(true, '2차 Whisper 녹음 대기 중');
    setCurrentPrompt(`[2/2차] 기기 내 Whisper 마이크 준비 중... 잠시만 기다려 주세요.`);

    let whText = '';
    let whStatus: 'ok' | 'silent' | 'timeout' | 'error' = 'ok';
    let whErrorMsg: string | undefined;
    let whInferenceMs = 0;
    let whAudioSec = 0;
    const whTotalStartTime = Date.now();

    try {
      const recordPromise = recorderRef.current!.record({
        maxDurationMs: 10000,
        onReady: () => {
          if (isMountedRef.current && operationGenRef.current === thisGen && !signal.aborted) {
            setCurrentPrompt(`[2/2차] 기기 내 Whisper 마이크 켜짐: "${refText}" 문장을 다시 말해 주세요 (10초).`);
          }
        },
      });

      let recAbortHandler: (() => void) | null = null;
      const recAbortRace = new Promise<never>((_, reject) => {
        if (signal.aborted) {
          reject(new Error('녹음 취소'));
        } else {
          recAbortHandler = () => {
            try {
              recorderRef.current?.cancel();
            } catch {
              // ignore
            }
            reject(new Error('녹음 취소'));
          };
          signal.addEventListener('abort', recAbortHandler, { once: true });
        }
      });

      let recordResult: any;
      try {
        recordResult = await Promise.race([recordPromise, recAbortRace]);
      } finally {
        if (recAbortHandler) {
          signal.removeEventListener('abort', recAbortHandler);
        }
      }

      if (!isMountedRef.current || operationGenRef.current !== thisGen || signal.aborted) {
        if (compareAbortRef.current === abortController) {
          compareAbortRef.current = null;
        }
        return;
      }
      whAudioSec = recordResult.durationSec;

      if (recordResult.isSilent) {
        whStatus = 'silent';
      } else {
        updateBusyState(true, 'Whisper 전사 추론 중');
        setCurrentPrompt('기기 내 Whisper가 음성을 전사하고 있습니다...');
        const txResult = await clientRef.current!.transcribe(recordResult.audio);
        if (!isMountedRef.current || operationGenRef.current !== thisGen || signal.aborted) {
          if (compareAbortRef.current === abortController) {
            compareAbortRef.current = null;
          }
          return;
        }

        whText = txResult.text;
        whInferenceMs = txResult.durationMs;
        if (!whText || whText.trim().length === 0) {
          whStatus = 'silent';
        }
      }
    } catch (err: any) {
      if (!isMountedRef.current || operationGenRef.current !== thisGen || signal.aborted) {
        if (compareAbortRef.current === abortController) {
          compareAbortRef.current = null;
        }
        return;
      }
      whStatus = 'error';
      whErrorMsg = err?.message || 'Whisper 녹음/전사 오류';
      if (isMountedRef.current && clientRef.current) {
        setModelStatus(clientRef.current.getStatus());
      }
    } finally {
      if (compareAbortRef.current === abortController) {
        compareAbortRef.current = null;
      }
    }
    const whTotalElapsedMs = Math.max(0, Date.now() - whTotalStartTime);

    if (!isMountedRef.current || operationGenRef.current !== thisGen || signal.aborted) return;

    // 지표 계산
    let wsWer = 1.0;
    let wsCer = 1.0;
    let whWer = 1.0;
    let whCer = 1.0;

    try {
      wsWer = calculateWER(refText, wsText);
      wsCer = calculateCER(refText, wsText);
    } catch {
      wsWer = 1.0;
      wsCer = 1.0;
    }

    try {
      whWer = calculateWER(refText, whText);
      whCer = calculateCER(refText, whText);
    } catch {
      whWer = 1.0;
      whCer = 1.0;
    }

    const newRecord: BenchmarkPairRecord = {
      id: `pair_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sentenceId: activeSentence.id,
      category: activeSentence.category,
      titleKo: activeSentence.titleKo,
      referenceText: refText,
      timestamp: new Date().toISOString(),
      webSpeech: {
        rawText: wsText,
        status: wsStatus,
        errorMessage: wsErrorMsg,
        totalElapsedMs: wsElapsedMs,
      },
      whisper: {
        rawText: whText,
        status: whStatus,
        errorMessage: whErrorMsg,
        totalElapsedMs: whTotalElapsedMs,
        pureInferenceMs: whInferenceMs,
        audioDurationSec: whAudioSec,
        backend: modelStatus.backend,
        isWarmCache: modelStatus.isWarmCache,
      },
      webSpeechWer: wsWer,
      webSpeechCer: wsCer,
      whisperWer: whWer,
      whisperCer: whCer,
    };

    setLatestPair(newRecord);
    setRecords((prev) => [newRecord, ...prev].slice(0, 20));
    setCurrentPrompt('비교 측정이 완료되었습니다. 결과를 확인하세요.');
    updateBusyState(false, '');
  };

  // 공개 예제(JFK.wav) 독립 실행 검증 (3MiB 상한 스트림 바운디드 리더)
  const handleRunSampleWav = async () => {
    if (busyRef.current || coachingActive || !adultConfirmed || modelStatus.state !== 'ready') return;

    const thisGen = ++operationGenRef.current;
    updateBusyState(true, '공개 예제 테스트 중');
    setSampleResult(null);

    const abortController = new AbortController();
    sampleAbortRef.current = abortController;
    const { signal } = abortController;

    let timedOut = false;
    const timer = addTimer(
      setTimeout(() => {
        timedOut = true;
        abortController.abort();
      }, 15000)
    );

    let audioCtx: AudioContext | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const fetchPromise = fetch('https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav', {
        signal,
      });

      let fetchAbortHandler: (() => void) | null = null;
      const fetchAbortRace = new Promise<Response>((_, reject) => {
        if (signal.aborted) {
          reject(new Error('공개 예제 다운로드가 취소되었습니다.'));
        } else {
          fetchAbortHandler = () => reject(new Error('공개 예제 다운로드가 취소되었습니다.'));
          signal.addEventListener('abort', fetchAbortHandler, { once: true });
        }
      });

      let res: Response;
      try {
        res = await Promise.race([fetchPromise, fetchAbortRace]);
      } finally {
        if (fetchAbortHandler) {
          signal.removeEventListener('abort', fetchAbortHandler);
        }
      }

      if (!res.ok) throw new Error(`공개 예제 다운로드 실패 (${res.status})`);

      const maxBytes = 3 * 1024 * 1024; // 3 MiB 상한 (실제 JFK 파일 약 1.94 MiB 허용)
      const contentLengthHeader = res.headers.get('content-length');
      if (contentLengthHeader) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          throw new Error('공개 예제 파일 크기가 3 MiB 제한을 초과했습니다.');
        }
      }

      reader = res.body?.getReader();
      if (!reader) throw new Error('스트림 리더를 사용할 수 없습니다.');

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (true) {
        if (signal.aborted || operationGenRef.current !== thisGen) {
          if (reader) {
            try {
              reader.cancel().catch(() => {});
            } catch {
              // ignore
            }
          }
          throw new Error('공개 예제 실행이 취소되었습니다.');
        }

        let readAbortHandler: (() => void) | null = null;
        const abortRace = new Promise<never>((_, reject) => {
          if (signal.aborted) {
            reject(new Error('공개 예제 실행이 취소되었습니다.'));
          } else {
            readAbortHandler = () => {
              if (reader) {
                try {
                  reader.cancel().catch(() => {});
                } catch {
                  // ignore
                }
              }
              reject(new Error('공개 예제 실행이 취소되었습니다.'));
            };
            signal.addEventListener('abort', readAbortHandler, { once: true });
          }
        });

        let chunkResult: { done: boolean; value?: Uint8Array };
        try {
          chunkResult = await Promise.race([reader.read(), abortRace]);
        } finally {
          if (readAbortHandler) {
            signal.removeEventListener('abort', readAbortHandler);
          }
        }

        const { done, value } = chunkResult;
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            if (reader) {
              try {
                reader.cancel().catch(() => {});
              } catch {
                // ignore
              }
            }
            throw new Error('공개 예제 파일 크기가 3 MiB 제한을 초과했습니다.');
          }
          chunks.push(value);
        }
      }

      if (signal.aborted || operationGenRef.current !== thisGen) {
        throw new Error('공개 예제 실행이 취소되었습니다.');
      }

      const combinedBuffer = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combinedBuffer.set(chunk, offset);
        offset += chunk.byteLength;
      }

      const CtxConstructor = window.AudioContext || (window as any).webkitAudioContext;
      audioCtx = new CtxConstructor();
      if (audioCtx.state === 'suspended') {
        let resumeAbortHandler: (() => void) | null = null;
        const resumeRace = new Promise<never>((_, reject) => {
          if (signal.aborted) {
            reject(new Error('AudioContext 시작 취소'));
          } else {
            resumeAbortHandler = () => reject(new Error('AudioContext 시작 취소'));
            signal.addEventListener('abort', resumeAbortHandler, { once: true });
          }
        });
        try {
          await Promise.race([audioCtx.resume(), resumeRace]);
        } finally {
          if (resumeAbortHandler) {
            signal.removeEventListener('abort', resumeAbortHandler);
          }
        }
      }

      if (signal.aborted || operationGenRef.current !== thisGen) {
        throw new Error('공개 예제 실행이 취소되었습니다.');
      }

      const decodedPromise = audioCtx.decodeAudioData(combinedBuffer.buffer);
      let decodeTimerHandle: any;
      let decodeAbortHandler: (() => void) | null = null;
      const abortOrTimeoutDeadline = new Promise<never>((_, rej) => {
        decodeTimerHandle = addTimer(
          setTimeout(() => {
            rej(new Error('오디오 디코딩 제한 시간 초과 (10초).'));
          }, 10000)
        );
        if (signal.aborted) {
          rej(new Error('오디오 디코딩이 취소되었습니다.'));
        } else {
          decodeAbortHandler = () => {
            clearTimer(decodeTimerHandle);
            if (audioCtx) {
              try {
                audioCtx.close().catch(() => {});
              } catch {
                // ignore
              }
            }
            rej(new Error('오디오 디코딩이 취소되었습니다.'));
          };
          signal.addEventListener('abort', decodeAbortHandler, { once: true });
        }
      });

      let decoded: AudioBuffer;
      try {
        decoded = await Promise.race([decodedPromise, abortOrTimeoutDeadline]);
      } finally {
        clearTimer(decodeTimerHandle);
        if (decodeAbortHandler) {
          signal.removeEventListener('abort', decodeAbortHandler);
        }
      }

      // decode 완료 직후 fetch+decode 15초 상한 타이머 해제 (이후 transcribe는 자체 30초 데드라인으로 진행)
      clearTimer(timer);

      if (signal.aborted || operationGenRef.current !== thisGen) {
        throw new Error('공개 예제 실행이 취소되었습니다.');
      }

      const pcm16k = resampleTo16kHzMono(decoded);
      const tx = await clientRef.current!.transcribe(pcm16k);
      if (isMountedRef.current && operationGenRef.current === thisGen && !signal.aborted) {
        setSampleResult({
          text: tx.text,
          inferenceMs: tx.durationMs,
        });
      }
    } catch (err: any) {
      if (isMountedRef.current && operationGenRef.current === thisGen && (!signal.aborted || timedOut)) {
        setSampleResult({
          text: '',
          inferenceMs: 0,
          error: timedOut ? '공개 예제 다운로드/디코딩 시간 초과 (15초)' : err?.message || '공개 예제 실행 실패',
        });
        if (clientRef.current) {
          setModelStatus(clientRef.current.getStatus());
        }
      }
    } finally {
      clearTimer(timer);
      if (sampleAbortRef.current === abortController) {
        sampleAbortRef.current = null;
      }
      if (reader) {
        try {
          reader.cancel().catch(() => {});
        } catch {
          // ignore
        }
      }
      if (audioCtx) {
        try {
          audioCtx.close().catch(() => {});
        } catch {
          // ignore
        }
      }
      if (operationGenRef.current === thisGen) {
        updateBusyState(false, '');
      }
    }
  };

  // 4. 리포트 복사
  const handleCopyReport = async () => {
    const reportText = generateBenchmarkReport(records, {
      deviceMetadata: deviceInput.trim() || '미지정 단말',
      modelRevision: `${WHISPER_MODEL_ID}@${WHISPER_DTYPE} (${WHISPER_MODEL_REVISION.slice(0, 8)})`,
      isWarmCache: modelStatus.isWarmCache,
      loadDurationMs: modelStatus.loadDurationMs,
    });

    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(reportText);
        setCopyStatus('비교 결과 리포트가 클립보드에 복사되었습니다.');
        setManualReportText('');
        return;
      } catch {
        // fallback
      }
    }

    setManualReportText(reportText);
    setCopyStatus('클립보드 접근이 거부되어 아래 텍스트 상자에 리포트를 표시했습니다. 길게 눌러 복사하세요.');
  };

  const isModelReady = modelStatus.state === 'ready';

  return (
    <details
      onToggle={(e) => {
        const isOpen = (e.currentTarget as HTMLDetailsElement).open;
        if (!isOpen) {
          cancelAllOperations();
          // 접혔을 때 모델 상태를 client 최신 상태로 동기화
          if (clientRef.current) {
            setModelStatus(clientRef.current.getStatus());
          }
        }
      }}
      style={{
        marginTop: '20px',
        background: '#0f172a',
        border: '1px solid #334155',
        borderRadius: '12px',
        padding: '12px 14px',
        minWidth: 0,
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 600,
          color: '#38bdf8',
          minHeight: '44px',
          display: 'flex',
          alignItems: 'center',
          minWidth: 0,
        }}
      >
        기기 내 음성 비교 (Web Speech API vs In-Browser Whisper)
      </summary>

      <div style={{ marginTop: '10px', fontSize: '12px', color: '#94a3b8', lineHeight: 1.5 }}>
        💡 브라우저 내장 Web Speech API와 기기 내(In-Browser) 무료 Whisper 모델의 인식 정확도(WER/CER) 및 처리 속도를 동일한 참조 문장으로 1:1 대조합니다.
        <br />
        - <strong>비용 및 개인정보:</strong> 비교 과정에서 Gemini 평가 및 종량제 API는 일체 호출되지 않습니다(비용 0원). Whisper 측은 기기 로컬 메모리에서만 음성이 처리되며 외부 전송이 전혀 없습니다 (단, 기존 Web Speech API는 브라우저 제공사 정책에 따라 원격 전사될 수 있습니다).
        <br />
        - <strong>순차 발화 방식:</strong> 단일 마이크 충돌을 방지하기 위해 같은 문장을 1차(Web Speech)와 2차(Whisper)로 순서대로 따로 발화하는 방식입니다.
      </div>

      {!adultConfirmed && (
        <div style={{ marginTop: '8px', padding: '6px 10px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', fontSize: '12px', color: '#f87171' }}>
          ⚠️ 만 18세 이상 성인 확인 체크 후에만 음성 비교 기능을 이용할 수 있습니다.
        </div>
      )}

      {/* 1. 모델 준비 섹션 */}
      <div style={{ marginTop: '14px', padding: '12px', background: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <strong style={{ color: '#f8fafc', fontSize: '13px' }}>Whisper 모델 상태: </strong>
            <span style={{ color: isModelReady ? '#34d399' : modelStatus.state === 'error' ? '#f87171' : '#fbbf24' }}>
              {isModelReady
                ? `준비 완료 (${modelStatus.backend.toUpperCase()}, ${modelStatus.isWarmCache ? '캐시 재사용' : '새로 다운로드'}, ${modelStatus.loadDurationMs}ms)`
                : modelStatus.state === 'loading'
                ? '모델 준비 중...'
                : modelStatus.state === 'error'
                ? '초기화 실패'
                : '미준비 (다운로드 필요)'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={handlePrepareModel}
              disabled={isBusy || coachingActive || !adultConfirmed || isModelReady}
              style={{
                background: isModelReady ? '#334155' : '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                minHeight: '44px',
                padding: '0 16px',
                cursor: isBusy || coachingActive || !adultConfirmed || isModelReady ? 'not-allowed' : 'pointer',
                opacity: isBusy || coachingActive || !adultConfirmed || isModelReady ? 0.6 : 1,
                fontWeight: 600,
              }}
            >
              {isModelReady ? '준비 완료' : 'Whisper 준비 (최초 약 65~70MB)'}
            </button>

            {isBusy && (
              <button
                type="button"
                onClick={cancelAllOperations}
                style={{
                  background: '#ef4444',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  minHeight: '44px',
                  padding: '0 16px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                중지
              </button>
            )}
          </div>
        </div>

        {downloadProgress && (
          <div style={{ marginTop: '8px', fontSize: '11px', color: '#64748b' }}>
            개별 파일 다운로드 진행률: {downloadProgress.file || downloadProgress.name || '가중치'} (
            {typeof downloadProgress.progress === 'number' ? `${Math.round(downloadProgress.progress)}%` : '진행 중'})
          </div>
        )}

        {modelStatus.errorMessage && (
          <div style={{ marginTop: '8px', color: '#f87171', fontSize: '12px' }}>
            오류: {modelStatus.errorMessage}
          </div>
        )}
      </div>

      {/* 2. 기기 메타데이터 입력 */}
      <div style={{ marginTop: '12px' }}>
        <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
          측정 기기 메타데이터 (리포트 기록용, 예: Samsung Galaxy S25 / PC Chrome):
        </label>
        <input
          type="text"
          value={deviceInput}
          maxLength={100}
          disabled={isBusy}
          onChange={(e) => setDeviceInput(e.target.value)}
          placeholder="기기 모델명을 입력하세요 (개인 식별정보 입력 금지)"
          style={{
            width: '100%',
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '6px',
            color: '#f8fafc',
            padding: '8px 10px',
            minHeight: '44px',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* 3. 문항 선택 및 대조군 실행 */}
      <div style={{ marginTop: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#f8fafc' }}>
            대조 문항 선택 ({selectedIdx + 1} / {sentences.length}):
          </label>
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>
            완료: {new Set(records.filter((r) => r.webSpeech.status === 'ok' && r.whisper.status === 'ok').map((r) => r.sentenceId)).size} / {sentences.length}개
          </span>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {sentences.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              disabled={isBusy}
              onClick={() => handleSelectSentence(idx)}
              style={{
                background: idx === selectedIdx ? '#38bdf8' : '#1e293b',
                color: idx === selectedIdx ? '#0f172a' : '#cbd5e1',
                border: '1px solid #334155',
                borderRadius: '6px',
                padding: '6px 10px',
                minHeight: '44px',
                cursor: isBusy ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                fontSize: '11px',
              }}
            >
              {s.titleKo}
            </button>
          ))}
        </div>

        <div style={{ marginTop: '10px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
            참조 영문 문장 (실제 읽을 정답 문장, 필요 시 본인 영문 이름으로 수정 가능):
          </label>
          <input
            type="text"
            value={customRefText}
            maxLength={200}
            disabled={isBusy}
            onChange={(e) => {
              setCustomRefText(e.target.value);
              setCopyStatus('');
              setManualReportText('');
            }}
            style={{
              width: '100%',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '6px',
              color: '#f8fafc',
              padding: '8px 10px',
              minHeight: '44px',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleStartComparison}
            disabled={!isModelReady || isBusy || coachingActive || !adultConfirmed}
            style={{
              background: '#10b981',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '0 20px',
              minHeight: '44px',
              fontWeight: 600,
              cursor: !isModelReady || isBusy || coachingActive || !adultConfirmed ? 'not-allowed' : 'pointer',
              opacity: !isModelReady || isBusy || coachingActive || !adultConfirmed ? 0.6 : 1,
            }}
          >
            이 문장 비교 시작 (2회 순차 발화)
          </button>

          {latestPair && selectedIdx < sentences.length - 1 && (
            <button
              type="button"
              onClick={handleNextSentence}
              disabled={isBusy}
              style={{
                background: '#334155',
                color: '#f8fafc',
                border: '1px solid #475569',
                borderRadius: '6px',
                padding: '0 16px',
                minHeight: '44px',
                fontWeight: 600,
                cursor: isBusy ? 'not-allowed' : 'pointer',
              }}
            >
              다음 문장으로 →
            </button>
          )}

          <button
            type="button"
            onClick={handleRunSampleWav}
            disabled={!isModelReady || isBusy || coachingActive || !adultConfirmed}
            style={{
              background: '#475569',
              color: '#cbd5e1',
              border: '1px solid #64748b',
              borderRadius: '6px',
              padding: '0 14px',
              minHeight: '44px',
              fontSize: '12px',
              cursor: !isModelReady || isBusy || coachingActive || !adultConfirmed ? 'not-allowed' : 'pointer',
              opacity: !isModelReady || isBusy || coachingActive || !adultConfirmed ? 0.6 : 1,
            }}
          >
            공개 예제로 실행 확인 (JFK.wav)
          </button>
        </div>

        {busyPhaseLabel && (
          <div style={{ marginTop: '8px', fontSize: '11px', color: '#38bdf8' }}>
            현재 진행 단계: <strong>{busyPhaseLabel}</strong>
          </div>
        )}

        {currentPrompt && (
          <div style={{ marginTop: '10px', padding: '8px 12px', background: '#0284c7', borderRadius: '6px', color: '#ffffff', fontSize: '12px', fontWeight: 600 }}>
            {currentPrompt}
          </div>
        )}

        {sampleResult && (
          <div style={{ marginTop: '10px', padding: '10px', background: '#1e293b', borderRadius: '6px', border: '1px solid #334155', fontSize: '12px' }}>
            <span style={{ color: '#38bdf8' }}>공개 예제 테스트 결과 (원어민 샘플로 6문항 통계 미포함): </span>
            {sampleResult.error ? (
              <span style={{ color: '#f87171' }}>오류: {sampleResult.error}</span>
            ) : (
              <span style={{ color: '#f8fafc' }}>
                &ldquo;{sampleResult.text}&rdquo; (순수 추론: {sampleResult.inferenceMs}ms)
              </span>
            )}
          </div>
        )}
      </div>

      {/* 4. 최신 비교 결과 표시 */}
      {latestPair && (
        <div style={{ marginTop: '16px', padding: '12px', background: '#1e293b', borderRadius: '8px', border: '1px solid #334155', fontSize: '12px' }}>
          <strong style={{ color: '#f8fafc', fontSize: '13px' }}>최신 비교 결과: [{latestPair.titleKo}]</strong>
          <div style={{ marginTop: '6px', color: '#cbd5e1' }}>
            <span style={{ color: '#64748b' }}>참조 문장: </span> &ldquo;{latestPair.referenceText}&rdquo;
          </div>

          <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
            {/* Web Speech 결과 */}
            <div style={{ background: '#0f172a', padding: '10px', borderRadius: '6px', border: '1px solid #334155' }}>
              <div style={{ color: '#38bdf8', fontWeight: 600 }}>Web Speech API (1차)</div>
              <div style={{ marginTop: '4px', color: '#f8fafc' }}>&ldquo;{latestPair.webSpeech.rawText || '(인식 실패)'}&rdquo;</div>
              <div style={{ marginTop: '6px', color: '#94a3b8', fontSize: '11px' }}>
                - 단어 오류율 (WER): <strong>{latestPair.webSpeechWer}</strong>
                <br />
                - 글자 오류율 (CER): <strong>{latestPair.webSpeechCer}</strong>
                <br />
                - 총 소요: {latestPair.webSpeech.totalElapsedMs}ms (10초 청취 포함)
                <br />
                - 상태: {latestPair.webSpeech.status}
                {latestPair.webSpeech.errorMessage && (
                  <>
                    <br />
                    - 오류 원인: <span style={{ color: '#f87171' }}>{latestPair.webSpeech.errorMessage}</span>
                  </>
                )}
              </div>
            </div>

            {/* Whisper 결과 */}
            <div style={{ background: '#0f172a', padding: '10px', borderRadius: '6px', border: '1px solid #334155' }}>
              <div style={{ color: '#34d399', fontWeight: 600 }}>In-Browser Whisper (2차)</div>
              <div style={{ marginTop: '4px', color: '#f8fafc' }}>&ldquo;{latestPair.whisper.rawText || '(전사 실패)'}&rdquo;</div>
              <div style={{ marginTop: '6px', color: '#94a3b8', fontSize: '11px' }}>
                - 단어 오류율 (WER): <strong>{latestPair.whisperWer}</strong>
                <br />
                - 글자 오류율 (CER): <strong>{latestPair.whisperCer}</strong>
                <br />
                - 순수 추론: <strong>{latestPair.whisper.pureInferenceMs ?? 0}ms</strong> (녹음: {latestPair.whisper.audioDurationSec}초)
                <br />
                - 백엔드: {latestPair.whisper.backend} | 상태: {latestPair.whisper.status}
                {latestPair.whisper.errorMessage && (
                  <>
                    <br />
                    - 오류 원인: <span style={{ color: '#f87171' }}>{latestPair.whisper.errorMessage}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. 리포트 복사 섹션 */}
      <div style={{ marginTop: '16px' }}>
        <button
          type="button"
          onClick={handleCopyReport}
          disabled={records.length === 0}
          style={{
            background: records.length > 0 ? '#334155' : '#1e293b',
            color: '#cbd5e1',
            border: '1px solid #475569',
            borderRadius: '6px',
            padding: '0 16px',
            minHeight: '44px',
            fontWeight: 600,
            cursor: records.length > 0 ? 'pointer' : 'not-allowed',
            opacity: records.length > 0 ? 1 : 0.5,
          }}
        >
          비교 결과 리포트 복사 ({records.length}건)
        </button>

        {copyStatus && (
          <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: copyStatus.includes('거부') ? '#f87171' : '#34d399' }}>
            {copyStatus}
          </p>
        )}

        {manualReportText && (
          <textarea
            readOnly
            value={manualReportText}
            style={{
              width: '100%',
              height: '140px',
              marginTop: '8px',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '6px',
              color: '#f8fafc',
              fontSize: '11px',
              fontFamily: 'monospace',
              lineHeight: 1.4,
              boxSizing: 'border-box',
            }}
          />
        )}
      </div>
    </details>
  );
};
