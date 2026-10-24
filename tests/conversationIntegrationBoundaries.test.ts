import 'fake-indexeddb/auto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ToeicStudyDatabase} from '../src/storage/db';
import {ConversationStorageService} from '../src/features/conversation/services/storageService';
import {CONVERSATION_POLICY_VERSION} from '../src/features/conversation/types';
import {getLessonById, ALL_32_LESSONS} from '../src/features/conversation/content/lessons';
import {evaluateUserUtterance} from '../src/features/conversation/engine/pedagogyEvaluator';
import {LessonStateMachine} from '../src/features/conversation/engine/lessonStateMachine';
import {handleConversationAction} from '../src/features/conversation/server/router';
import {ConversationApiClient} from '../src/features/conversation/services/conversationApi';
import type {ServerConfig} from '../src/features/conversation/server/types';
import {callGeminiChatApi} from '../src/features/conversation/server/geminiInteractionsClient';

const databases:ToeicStudyDatabase[]=[];
afterEach(async()=>{for(const db of databases.splice(0))await db.delete();vi.restoreAllMocks();});
const lesson=getLessonById('intro-u01-l01')!;

describe('통합에서 발견한 성취·동의·단계 보존 경계',()=>{
  it('같은 실제 상황의 연습과 역할극 반복으로 두 상황 숙련을 만들지 않는다',()=>{
    const machine=new LessonStateMachine(LessonStateMachine.createSession(lesson),lesson);
    const result=evaluateUserUtterance('Hello, I am Alex.',lesson);
    machine.recordTurn('Hello, I am Alex.',result,lesson.id+':scenario',false,'practice');
    machine.recordTurn('Hello, I am Alex.',result,lesson.id+':scenario',false,'roleplay');
    expect(machine.getSession().observedObjectives['obj-intro-01'].isMasteredByRule).toBe(false);
  });
  it('새 전이 상황에서는 두 목표 각각 증거를 얻어 실제 수업을 완료할 수 있다',()=>{
    const machine=new LessonStateMachine(LessonStateMachine.createSession(lesson),lesson);
    for(const [main,transfer,id] of [['Hello, I am Alex.','Hello, I am Sarah.','obj-intro-01'],['Nice to meet you.','Hi Sarah, nice to meet you.','obj-intro-02']]){
      const initial=evaluateUserUtterance(main,lesson,'controlled_practice',0,[],id);
      const changed=evaluateUserUtterance(transfer,lesson,'transfer_assessment');
      expect(initial.matchedObjectiveId).toBe(id);expect(changed.matchedObjectiveId).toBe(id);
      expect(changed.factualConsistency?.consistent).toBe(true);
      machine.recordTurn(main,initial,lesson.id+':scenario',false,'practice');
      machine.recordTurn(transfer,changed,lesson.id+':transfer:'+lesson.transferTask.taskId,false,'transfer_assessment');
    }
    for(let i=0;i<5;i++)machine.advancePhase();
    expect(machine.getSession().rulePassed).toBe(true);
  });
  it('자동 제공된 힌트 뒤의 답을 호출자의 false 플래그로 노힌트로 바꾸지 않는다',()=>{
    const machine=new LessonStateMachine(LessonStateMachine.createSession(lesson),lesson);
    machine.recordTurn("I don't know",evaluateUserUtterance("I don't know",lesson),'main',false);
    machine.recordTurn('Hello, I am Alex.',evaluateUserUtterance('Hello, I am Alex.',lesson),'main',false);
    expect(machine.getSession().hintLevel).toBe(1);
    expect(machine.getSession().observedObjectives['obj-intro-01'].evidences[0].usedHint).toBe(true);
  });
  it('32차시 모든 목표에 대해 실제 답 예시가 있고 다른 목표로 강제 귀속하지 않는다',()=>{
    let count=0;
    for(const l of ALL_32_LESSONS)for(const objective of l.learningObjectives){
      const intent=l.acceptableIntents.find(i=>i.targetObjectiveId===objective.id)!;
      expect(intent).toBeDefined();
      const result=evaluateUserUtterance(intent.exactMatches[0],l,'controlled_practice',0,[],objective.id);
      expect(['ACCEPT','OPTIONAL_EXPANSION']).toContain(result.evaluation);
      expect(result.matchedObjectiveId,l.id).toBe(objective.id);count++;
    }
    expect(count).toBe(64);
  });
  it('32차시 64목표가 변경된 전이 사실에서도 실제 성취 증거를 만들 수 있다',()=>{
    for(const l of ALL_32_LESSONS)for(const objective of l.learningObjectives){
      const intent=l.acceptableIntents.find(i=>i.targetObjectiveId===objective.id)!;
      const source=intent.exactMatches[0];
      const oldFact=l.scenario.facts[l.transferTask.contextFactKey];
      const next=oldFact ? source.replace(new RegExp(String(oldFact).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),()=>String(l.transferTask.expectedFactValue)) : source;
      const result=evaluateUserUtterance(next,l,'transfer_assessment');
      expect(result.matchedObjectiveId,`${l.id}/${objective.id}: ${next}`).toBe(objective.id);
      expect(result.factualConsistency?.consistent,`${l.id}: ${next}`).toBe(true);
    }
  });
  it('저장 후 역할극 단계 메타데이터와 KST 복습 날짜를 보존한다',async()=>{
    const db=new ToeicStudyDatabase('boundary-'+crypto.randomUUID());databases.push(db);await db.open();
    const service=new ConversationStorageService(db);
    const machine=new LessonStateMachine(LessonStateMachine.createSession(lesson),lesson);
    machine.recordTurn('Hello, I am Alex.',evaluateUserUtterance('Hello, I am Alex.',lesson),'main',false,'roleplay');
    await service.saveSession(machine.getSession());
    expect((await service.getSessionById(machine.getSession().sessionId))?.turns.every(t=>t.phase==='roleplay')).toBe(true);
    const now=new Date('2026-10-21T15:05:00Z');vi.spyOn(Date,'now').mockReturnValue(now.getTime());
    const completed=await service.completeSession(machine.getSession(),lesson);
    expect(completed.createdReviews.length).toBeGreaterThan(0);
    expect(completed.createdReviews.every(r=>r.nextReviewDate==='2026-10-23')).toBe(true);
  });
  it('구버전/미기록 동의는 재활성화하지 않고 현재 명시 동의만 로드한다',async()=>{
    const db=new ToeicStudyDatabase('consent-'+crypto.randomUUID());databases.push(db);await db.open();
    const service=new ConversationStorageService(db);
    const consent={isAdult:true,sendCurrentTurnOnlyAgreed:true,googleReviewDisclosureAgreed:true,noSensitiveInfoAgreed:true,policyVersion:'old-policy'};
    await service.saveSettings({allowExternalFreeGeminiCalls:true,cloudConsent:consent});
    expect((await service.getSettings()).allowExternalFreeGeminiCalls).toBe(false);
    await service.saveSettings({allowExternalFreeGeminiCalls:true,cloudConsent:{...consent,policyVersion:CONVERSATION_POLICY_VERSION}});
    expect((await service.getSettings()).allowExternalFreeGeminiCalls).toBe(true);
  });
});

describe('모델 오교정의 전체 텍스트 교체와 투명한 대체 학습',()=>{
  const createConfig=(text:string):ServerConfig=>({allowExternalFreeGeminiCalls:true,isAdultConfirmed:true,isFreeTierProjectConfirmed:true,geminiApiKey:'mock-key-only',authAdapter:{verifyCaller:async()=>({authorized:true,callerId:'synthetic'})},budgetAdapter:{reserve:async()=>({allowed:true}),consume:async()=>{},release:async()=>{}},fetchFn:vi.fn(async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({evaluation:'ERROR_CORRECTION',userSpokenText:text,isShortAnswer:false,tutorResponseEn:'Your grammar is wrong. Say a full sentence.',selfCorrectionPromptKo:'문법 오류입니다.',factualConsistency:{consistent:true}})}]},finishReason:'STOP'}]}),{status:200}))});
  it.each([['Good, thanks.','intro-u01-l03','ACCEPT'],['???','intro-u01-l01','TRANSCRIPT_UNCERTAIN'],["I don't know",'intro-u01-l01','NEEDS_HINT']])('%s: 잘못된 문법 교정 문구를 남기지 않는다',async(text,lessonId,expected)=>{
    const req=new Request('https://local.invalid/api/conversation/chat',{method:'POST',body:JSON.stringify({requestId:crypto.randomUUID(),userConsentToCloud:true,lessonId,contentRevision:1,userSpokenText:text,currentPhase:'roleplay'})});
    const res=await handleConversationAction(req,'chat',createConfig(text));
    const body=await res.json();expect(res.status,JSON.stringify(body)).toBe(200);
    expect(body.fallbackToRuleEngine).toBe(true);
    expect(['ACCEPT','OPTIONAL_EXPANSION'].includes(expected)?['ACCEPT','OPTIONAL_EXPANSION']: [expected]).toContain(body.evaluation.evaluation);
    expect(body.evaluation.tutorResponseEn).not.toContain('grammar is wrong');
  });
  it('클라이언트가 서버 규칙 대체를 실제 Gemini 대화로 위장하지 않는다',async()=>{
    const client=new ConversationApiClient(vi.fn(async()=>new Response(JSON.stringify({success:true,fallbackToRuleEngine:true,evaluation:{}}),{status:200})));
    await expect(client.sendTurn({lessonId:lesson.id,contentRevision:1,currentPhase:'practice',userSpokenText:'Hello.'},{isAdult:true,sendCurrentTurnOnlyAgreed:true,googleReviewDisclosureAgreed:true,noSensitiveInfoAgreed:true})).rejects.toThrow('고정 교재');
  });
});

describe('대화 API 데드라인 분리(서버 20초/클라이언트 25초) 및 리스너 정리 경계 검증', () => {
  it('서버 20초 타임아웃은 클라이언트 25초 마감보다 먼저 발동하여 정규 HTTP 504를 반환해야 한다', async () => {
    vi.useFakeTimers();
    try {
      // 서버에서 20초 타임아웃을 모의하기 위해 AbortSignal을 기다리는 모의 fetch
      const delayedFetch = vi.fn().mockImplementation((_url, opts) => {
        return new Promise((_, reject) => {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('TIMEOUT');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const config: ServerConfig = {
        allowExternalFreeGeminiCalls: true,
        isAdultConfirmed: true,
        isFreeTierProjectConfirmed: true,
        geminiApiKey: 'mock-key',
        authAdapter: { verifyCaller: async () => ({ authorized: true, callerId: 'user-t' }) },
        budgetAdapter: { reserve: async () => ({ allowed: true }), consume: async () => {}, release: async () => {} },
        fetchFn: delayedFetch,
      };

      const req = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req-timeout-test',
          userConsentToCloud: true,
          lessonId: 'intro-u01-l01',
          contentRevision: 1,
          userSpokenText: 'Hello',
          currentPhase: 'practice',
        }),
      });

      const promise = handleConversationAction(req, 'chat', config);
      // 서버 타임아웃 20,000ms 전진 (클라이언트 25,000ms 이전)
      await vi.advanceTimersByTimeAsync(20000);

      const res = await promise;
      expect(res.status).toBe(504);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.errorMessage).toContain('시간 초과');
    } finally {
      vi.useRealTimers();
    }
  });

  it('헤더 도착 후 본문(body) 수신이 지연되더라도(200 및 500 상태) 클라이언트 25초 데드라인에 의해 안전하게 타임아웃되어야 한다', async () => {
    vi.useFakeTimers();
    try {
      // 1. 정상(200) 헤더 도착 후 본문(body) 30초 지연(stall)
      const slowBody200 = {
        ok: true,
        status: 200,
        json: vi.fn().mockImplementation(() => {
          return new Promise((_, reject) => {
            setTimeout(() => {
              const err = new Error('Body stalled');
              err.name = 'AbortError';
              reject(err);
            }, 30000);
          });
        }),
      } as unknown as Response;

      const client200 = new ConversationApiClient(vi.fn().mockResolvedValue(slowBody200));
      const promise200 = client200.sendTurn(
        { lessonId: 'intro-u01-l01', contentRevision: 1, userSpokenText: 'Hi', currentPhase: 'practice' },
        { isAdult: true, sendCurrentTurnOnlyAgreed: true, googleReviewDisclosureAgreed: true, noSensitiveInfoAgreed: true }
      );
      // unhandled rejection 방지를 위해 advance 전에 핸들러 설치
      const assertion200 = expect(promise200).rejects.toThrow('시간 초과');
      await vi.advanceTimersByTimeAsync(25000);
      await assertion200;

      // 2. 500 에러 헤더 도착 후 에러 본문 JSON 30초 지연(stall)
      const slowBody500 = {
        ok: false,
        status: 500,
        json: vi.fn().mockImplementation(() => {
          return new Promise((_, reject) => {
            setTimeout(() => {
              const err = new Error('Error body stalled');
              err.name = 'AbortError';
              reject(err);
            }, 30000);
          });
        }),
      } as unknown as Response;

      const client500 = new ConversationApiClient(vi.fn().mockResolvedValue(slowBody500));
      const promise500 = client500.sendTurn(
        { lessonId: 'intro-u01-l01', contentRevision: 1, userSpokenText: 'Hi', currentPhase: 'practice' },
        { isAdult: true, sendCurrentTurnOnlyAgreed: true, googleReviewDisclosureAgreed: true, noSensitiveInfoAgreed: true }
      );
      const assertion500 = expect(promise500).rejects.toThrow('시간 초과');
      await vi.advanceTimersByTimeAsync(25000);
      await assertion500;
    } finally {
      vi.useRealTimers();
    }
  });

  it('요청 완료 후 externalSignal과 activeController의 abort 리스너가 누수 없이 모두 정리되어야 한다', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, evaluation: { evaluation: 'ACCEPT', userSpokenText: 'Hi', isShortAnswer: false, tutorResponseEn: 'Hello', factualConsistency: { consistent: true } } }), { status: 200 })
    );
    const client = new ConversationApiClient(mockFetch);

    const extController = new AbortController();
    const addListenerSpy = vi.spyOn(extController.signal, 'addEventListener');
    const removeListenerSpy = vi.spyOn(extController.signal, 'removeEventListener');

    await client.sendTurn(
      { lessonId: 'intro-u01-l01', contentRevision: 1, userSpokenText: 'Hi', currentPhase: 'practice' },
      { isAdult: true, sendCurrentTurnOnlyAgreed: true, googleReviewDisclosureAgreed: true, noSensitiveInfoAgreed: true },
      extController.signal
    );

    expect(addListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('callGeminiChatApi는 이미 취소된 externalSignal에 대해 네트워크 요청을 0회 수행하고 즉시 504 거부해야 한다', async () => {
    const mockFetch = vi.fn();
    const preAborted = new AbortController();
    preAborted.abort(new Error('USER_PRE_ABORT'));

    await expect(
      callGeminiChatApi({ contents: [] }, 'fake-key', mockFetch, 20000, preAborted.signal)
    ).rejects.toThrow('시간 초과 또는 취소');

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
