import {afterEach,expect,it,vi} from 'vitest';
import {CoachTutorController} from '../src/features/conversation/coach/CoachTutorController';
import {COACH_QUESTIONS,CoachBudgetError} from '../src/features/conversation/coach/coachProtocol';
import type {CoachDiagnosticRecord} from '../src/features/conversation/coach/coachDiagnostics';
const good={meaning:'relevant' as const,sentenceComplete:true,feedbackKo:'뜻이 잘 전달됐어요.',modelAnswerEn:'My name is Alex.',recognizedCandidateIndex:0};
const flush=async()=>{for(let i=0;i<200;i++)await Promise.resolve();};
function harness(){const records:CoachDiagnosticRecord[]=[];const states:any[]=[];const listen=vi.fn(async(_lang:string,o:any)=>{o?.onAlternatives?.(['My name is Alex.','My name is Alice.']);return 'My name is Alex.';});const evaluate=vi.fn(async(_q:string,_a:string,_c?:any)=>({...good}));const onDiagnostic=vi.fn((r:CoachDiagnosticRecord)=>{records.push(structuredClone(r));});const controller=new CoachTutorController({speak:async()=>true,listen,evaluate,cancel:vi.fn(),emit:s=>states.push(structuredClone(s)),onDiagnostic});return{controller,records,states,listen,evaluate,onDiagnostic};}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('pairs initial and reused repeat accurately without adding evaluations or phase duplicates',async()=>{
 const h=harness();await h.controller.start(COACH_QUESTIONS[0]);expect(h.states.at(-1).phase).toBe('complete');expect(h.evaluate).toHaveBeenCalledOnce();expect(h.records).toHaveLength(2);
 expect(h.records.map(r=>[r.stage,r.inputSource,r.evaluationSource,r.evaluationRequests])).toEqual([['initial','voice','ai',1],['repeat','voice','reuse',0]]);expect(new Set(h.records.map(r=>r.id)).size).toBe(2);
 for(const r of h.records){expect(r.rawText).toBe('My name is Alex.');expect(r.candidates).toEqual(['My name is Alex.','My name is Alice.']);expect(r.questionEn).toBe(COACH_QUESTIONS[0].questionEn);expect(r.elapsedMs).toBeGreaterThanOrEqual(0);expect(r.intendedText).toBeUndefined();}
});
it('records non-top recovery as two AI evaluations with raw and selected native text distinct',async()=>{
 const h=harness();h.listen.mockImplementation(async(_l,o)=>{o?.onAlternatives?.(['I would like couple, please.','I would like coffee, please.']);return 'I would like couple, please.';});h.evaluate.mockResolvedValue({...good,modelAnswerEn:'I would like coffee, please.',recognizedCandidateIndex:1});
 await h.controller.start(COACH_QUESTIONS[2]);expect(h.records).toHaveLength(2);expect(h.evaluate).toHaveBeenCalledTimes(2);expect(h.records.every(r=>r.evaluationSource==='ai'&&r.evaluationRequests===1&&r.rawText==='I would like couple, please.'&&r.candidates[1]==='I would like coffee, please.'&&r.evaluation?.recognizedCandidateIndex===1)).toBe(true);
});
it('logging failures cannot break a correct learning sequence',async()=>{
 const h=harness();h.onDiagnostic.mockImplementation(()=>{throw new Error('local storage unavailable');});await h.controller.start(COACH_QUESTIONS[0]);expect(h.states.at(-1).phase).toBe('complete');expect(h.evaluate).toHaveBeenCalledOnce();
});
it('a diagnostic consumer cannot mutate evaluation, candidates or grading state',async()=>{
 const h=harness();h.onDiagnostic.mockImplementation(r=>{if(r.evaluation)r.evaluation.meaning='needs_help';r.candidates[0]='tampered';});await h.controller.start(COACH_QUESTIONS[0]);expect(h.states.at(-1).phase).toBe('complete');expect(h.evaluate).toHaveBeenCalledOnce();expect(h.states.at(-1).recognizedText).toBe('My name is Alex.');
});
it('retains recognized text and native candidates when evaluation fails, with no arbitrary error body in the record',async()=>{
 const h=harness();h.evaluate.mockRejectedValue(new Error('DO_NOT_EXPORT_PRIVATE_URL_OR_KEY'));await h.controller.start(COACH_QUESTIONS[0]);expect(h.records).toHaveLength(1);const r=h.records[0];expect(r.rawText).toBe('My name is Alex.');expect(r.candidates).toHaveLength(2);expect(r.evaluationRequests).toBe(1);expect(r.errorCode).toBeTruthy();expect(JSON.stringify(r)).not.toContain('DO_NOT_EXPORT');expect(h.states.at(-1).phase).toBe('error');
});
it('cancellation suppresses late diagnostic writes after the user pauses',async()=>{
 const h=harness();let resolve!:(v:typeof good)=>void;h.evaluate.mockImplementation(()=>new Promise(r=>{resolve=r;}));const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();h.controller.pause();await pending;resolve({...good});await flush();expect(h.records).toHaveLength(0);
});
it('records speech failure safely with partial transcript and no AI request',async()=>{
 const h=harness();h.listen.mockImplementation(async(_l,o)=>{o?.onPartial?.('my partial name');throw Object.assign(new Error('DO_NOT_EXPORT_PRIVATE_ERROR'),{code:'network'});});await h.controller.start(COACH_QUESTIONS[0]);expect(h.records).toHaveLength(1);expect(h.records[0]).toMatchObject({evaluationSource:'none',evaluationRequests:0,inputSource:'voice',rawText:'my partial name'});expect(h.records[0].errorCode).toMatch(/NETWORK/);expect(JSON.stringify(h.records)).not.toContain('DO_NOT_EXPORT');expect(h.evaluate).not.toHaveBeenCalled();
});
it('text-only answers and repeats are labelled text, with zero microphone starts',async()=>{
 const h=harness();(h.controller as any).deps.isTextMode=()=>true;const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();await h.controller.submitText('My name is Alex.');await flush();await h.controller.submitText('MY NAME IS ALEX!');await pending;
 expect(h.records).toHaveLength(2);expect(h.records.every(r=>r.inputSource==='text'&&r.candidates.length===0)).toBe(true);expect(h.records.map(r=>r.evaluationRequests)).toEqual([1,0]);expect(h.listen).not.toHaveBeenCalled();
});
it('typed fallback during voice does not inherit canceled microphone alternatives',async()=>{
 const h=harness();h.listen.mockImplementation(async(_l,o)=>{o?.onAlternatives?.(['bad native text','other native text']);return new Promise<string>(()=>{});});const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();const typed=h.controller.submitText('My name is Mina.');await flush();h.controller.pause();await typed;await pending;
 expect(h.records).toHaveLength(1);expect(h.records[0]).toMatchObject({inputSource:'text',rawText:'My name is Mina.',candidates:[],evaluationSource:'ai'});
});
it('counts quota retry requests without duplicating an answer entry or claiming upstream consumption',async()=>{
 vi.useFakeTimers();const h=harness();h.evaluate.mockRejectedValueOnce(new CoachBudgetError('잠시 후','COACH_MINUTE_LIMIT',1));const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();await vi.advanceTimersByTimeAsync(1000);await pending;
 expect(h.records).toHaveLength(2);expect(h.records[0].evaluationRequests).toBe(2);expect(h.records[0].elapsedMs).toBeGreaterThanOrEqual(1000);expect(h.records[1].evaluationRequests).toBe(0);expect(h.evaluate).toHaveBeenCalledTimes(2);
});
