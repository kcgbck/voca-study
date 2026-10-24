import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {CoachTutorController} from '../src/features/conversation/coach/CoachTutorController';
import {CoachBudgetError,COACH_QUESTIONS} from '../src/features/conversation/coach/coachProtocol';
import {PublicCoachApiClient} from '../src/features/conversation/coach/publicCoachApi';
const good={meaning:'relevant' as const,sentenceComplete:true,feedbackKo:'뜻이 잘 전달됐어요.',modelAnswerEn:'My name is Alex.'};
const flush=async()=>{for(let i=0;i<160;i++)await Promise.resolve();};
const minute=(seconds=5)=>new CoachBudgetError('잠시 후 자동으로 이어갈게요.','COACH_MINUTE_LIMIT',seconds);
const response=(data:any,status=429)=>new Response(JSON.stringify(data),{status});
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
function setup(){const states:any[]=[];const speak=vi.fn().mockResolvedValue(true);const listen=vi.fn().mockResolvedValue('My name is Alex.');const evaluate=vi.fn().mockResolvedValue(good);const cancel=vi.fn();const controller=new CoachTutorController({speak,listen,evaluate,cancel,emit:s=>states.push(structuredClone(s))});return{controller,states,speak,listen,evaluate,cancel};}
it('preserves the final answer and automatically evaluates after a visible countdown without another microphone',async()=>{
 const h=setup();h.evaluate.mockRejectedValueOnce(minute());const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();expect(h.states.at(-1).phase).toBe('waiting');expect(h.states.at(-1).recognizedText).toBe('My name is Alex.');expect(h.states.at(-1).practiceDone).toBe(0);
 await vi.advanceTimersByTimeAsync(4000);expect(h.evaluate).toHaveBeenCalledOnce();expect(h.states.at(-1).message).toMatch(/1/);
 await vi.advanceTimersByTimeAsync(1000);await pending;expect(h.evaluate.mock.calls.map(c=>c[1])).toEqual(['My name is Alex.','My name is Alex.']);expect(h.listen.mock.calls.map(c=>c[0])).toEqual(['en-US','en-US']);expect(h.states.at(-1)).toMatchObject({phase:'complete',practiceDone:1});expect(vi.getTimerCount()).toBe(0);
});
it('repetition quota waits keep the same repetition and award credit once',async()=>{
 const h=setup();h.listen.mockResolvedValueOnce('My name is Alex.').mockResolvedValue('My name is Mina.');h.evaluate.mockResolvedValueOnce(good).mockRejectedValueOnce(minute(2));const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();expect(h.states.at(-1)).toMatchObject({phase:'waiting',practiceDone:0});await vi.advanceTimersByTimeAsync(2000);await pending;expect(h.listen).toHaveBeenCalledTimes(2);expect(h.evaluate).toHaveBeenCalledTimes(3);expect(h.states.at(-1)).toMatchObject({phase:'complete',practiceDone:1});
});
it('pause immediately cancels the pending countdown and prevents late evaluation',async()=>{
 const h=setup();h.evaluate.mockRejectedValueOnce(minute(61));const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();expect(h.states.at(-1).phase).toBe('waiting');h.controller.pause();await pending;await vi.advanceTimersByTimeAsync(180000);expect(h.evaluate).toHaveBeenCalledOnce();expect(h.states.at(-1).phase).toBe('paused');expect(vi.getTimerCount()).toBe(0);
});
it('new question cancels the old waiting answer rather than replaying it later',async()=>{
 const h=setup();h.evaluate.mockRejectedValueOnce(minute());const first=h.controller.start(COACH_QUESTIONS[0]);await flush();const second=h.controller.start(COACH_QUESTIONS[2]);await second;await first;await vi.advanceTimersByTimeAsync(10000);expect(h.evaluate.mock.calls.map(c=>c[0])).toEqual(['name','cafe']);expect(vi.getTimerCount()).toBe(0);
});
it('text submission during waiting cannot create a second grading request',async()=>{
 const h=setup();h.evaluate.mockRejectedValueOnce(minute());const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();await h.controller.submitText('Another answer.');expect(h.evaluate).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(5000);await pending;expect(h.evaluate.mock.calls.every(c=>c[1]==='My name is Alex.')).toBe(true);
});
it('repeated minute congestion stops after two waits with no infinite requests or false credit',async()=>{
 const h=setup();h.evaluate.mockRejectedValue(minute(61));const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();await vi.advanceTimersByTimeAsync(200000);await pending;expect(h.evaluate).toHaveBeenCalledTimes(3);expect(h.states.at(-1).phase).not.toBe('complete');expect(h.states.at(-1).practiceDone).toBe(0);expect(vi.getTimerCount()).toBe(0);expect(h.listen).toHaveBeenCalledOnce();
});
it('daily quota explains the daily limit immediately without an automatic retry',async()=>{
 const h=setup();h.evaluate.mockRejectedValue(new CoachBudgetError('하루 무료 평가 한도를 사용했어요.','COACH_DAILY_LIMIT'));await h.controller.start(COACH_QUESTIONS[0]);await vi.advanceTimersByTimeAsync(180000);expect(h.evaluate).toHaveBeenCalledOnce();expect(h.states.at(-1).message).toMatch(/하루/);expect(h.states.some(s=>s.phase==='waiting')).toBe(false);expect(h.states.at(-1).practiceDone).toBe(0);
});
it.each([new Error('Google 호출 한도 초과'),new Error('네트워크 실패'),new Error('503 서비스 장애')])('does not replay an ambiguous provider/network failure: %s',async(error)=>{
 const h=setup();h.evaluate.mockRejectedValue(error);await h.controller.start(COACH_QUESTIONS[0]);await vi.advanceTimersByTimeAsync(180000);expect(h.evaluate).toHaveBeenCalledOnce();expect(h.states.at(-1).message).toBe(error.message);expect(h.states.some(s=>s.phase==='waiting')).toBe(false);
});
it.each([0,-1,62,Infinity,1.5])('rejects invalid minute delay %s without waiting',async(seconds)=>{
 const h=setup();h.evaluate.mockRejectedValue(minute(seconds));await h.controller.start(COACH_QUESTIONS[0]);await vi.advanceTimersByTimeAsync(180000);expect(h.evaluate).toHaveBeenCalledOnce();expect(h.states.some(s=>s.phase==='waiting')).toBe(false);
});
it('client exposes only the marked pre-upstream minute error and makes no automatic fetch itself',async()=>{
 const fetchFn=vi.fn().mockResolvedValue(response({errorCode:'COACH_MINUTE_LIMIT',retryAfterSeconds:61,errorMessage:'잠시 기다려 주세요.'}));const api=new PublicCoachApiClient(fetchFn);
 await expect(api.evaluate('name','Alex.',true)).rejects.toMatchObject({code:'COACH_MINUTE_LIMIT',retryAfterSeconds:61});expect(fetchFn).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it('client preserves the daily code and useful Korean message',async()=>{
 const api=new PublicCoachApiClient(vi.fn().mockResolvedValue(response({errorCode:'COACH_DAILY_LIMIT',errorMessage:'하루 무료 평가 한도를 사용했어요.'})));
 await expect(api.evaluate('name','Alex.',true)).rejects.toMatchObject({code:'COACH_DAILY_LIMIT',message:expect.stringContaining('하루')});
});
it.each([{},{errorCode:'OTHER',retryAfterSeconds:2},{errorCode:'COACH_MINUTE_LIMIT',retryAfterSeconds:'2'},{errorCode:'COACH_MINUTE_LIMIT',retryAfterSeconds:0},{errorCode:'COACH_MINUTE_LIMIT',retryAfterSeconds:62},{errorCode:'COACH_MINUTE_LIMIT',retryAfterSeconds:2.5}])('client never labels unmarked or malformed 429 as retryable: %j',async(data)=>{
 const fetchFn=vi.fn().mockResolvedValue(response(data));const api=new PublicCoachApiClient(fetchFn);let error:any;try{await api.evaluate('name','Alex.',true);}catch(e){error=e;}expect(error).toBeDefined();expect(error).not.toBeInstanceOf(CoachBudgetError);expect(fetchFn).toHaveBeenCalledOnce();
});
it('error response parsing is bounded and cannot expose an enormous body as a retry message',async()=>{
 const api=new PublicCoachApiClient(vi.fn().mockResolvedValue(response({errorCode:'COACH_MINUTE_LIMIT',retryAfterSeconds:1,errorMessage:'x'.repeat(18000)})));
 await expect(api.evaluate('name','Alex.',true)).rejects.not.toBeInstanceOf(CoachBudgetError);expect(vi.getTimerCount()).toBe(0);
});

it('failed spoken waiting notice stops safely instead of hiding the speech error and retrying',async()=>{
 const h=setup();h.evaluate.mockRejectedValueOnce(minute(2));h.speak.mockImplementation(async(text:string)=>!text.includes('잠시'));
 const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();await vi.advanceTimersByTimeAsync(10000);await pending;expect(h.states.at(-1).phase).toBe('error');expect(h.evaluate).toHaveBeenCalledOnce();expect(h.listen).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
