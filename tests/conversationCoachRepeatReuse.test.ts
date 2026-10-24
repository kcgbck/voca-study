import {afterEach,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {CoachTutorController} from '../src/features/conversation/coach/CoachTutorController';
import {PublicCoachApiClient} from '../src/features/conversation/coach/publicCoachApi';
import {COACH_QUESTIONS,type CoachEvaluation} from '../src/features/conversation/coach/coachProtocol';
import {handlePublicCoach} from '../src/features/conversation/server/publicCoachHandler';
import {MODEL_HARD_CAPS_90_PERCENT} from '../src/features/conversation/server/budgetPolicy';
import type {D1Database} from '../src/features/conversation/server/budgetAdapter';
import {BrowserSpeechInputService} from '../src/features/conversation/services/browserSpeechInput';
const good:CoachEvaluation={meaning:'relevant',sentenceComplete:true,feedbackKo:'뜻을 잘 전달했어요.',modelAnswerEn:'My name is Alex.'};
const uncertain:CoachEvaluation={...good,meaning:'uncertain',sentenceComplete:false,feedbackKo:'뜻을 확실하게 알 수 없어요.'};
const flush=async()=>{for(let i=0;i<200;i++)await Promise.resolve();};
const databases:DatabaseSync[]=[];
afterEach(()=>{for(const db of databases.splice(0))db.close();vi.useRealTimers();});
function setup(answers=['My name is Alex.','My name is Alex.'],evaluations:CoachEvaluation[]=[good]){
 const states:any[]=[];let last=evaluations[0]??good;
 const evaluate=vi.fn(async()=>{last=evaluations.shift()??last;return {...last};});
 const listen=vi.fn(async()=>answers.shift()??'');
 const controller=new CoachTutorController({speak:async()=>true,listen,evaluate,cancel:vi.fn(),emit:s=>states.push(structuredClone(s))});
 return{controller,evaluate,listen,states};
}
it('reuses only the already AI-approved exact answer after a new completed utterance',async()=>{
 const h=setup();await h.controller.start(COACH_QUESTIONS[0]);
 expect(h.evaluate).toHaveBeenCalledOnce();expect(h.listen).toHaveBeenCalledTimes(2);
 expect(h.states.at(-1)).toMatchObject({phase:'complete',practiceDone:1});
});
it('never seeds reuse from a model example: short answer and first complete repetition both call AI',async()=>{
 const full="I'd like a coffee, please.";const h=setup(['Coffee, please.',full,full],[{...good,sentenceComplete:false,modelAnswerEn:full},{...good,modelAnswerEn:full}]);
 await h.controller.start(COACH_QUESTIONS[2]);expect(h.evaluate.mock.calls).toHaveLength(2);
 expect(h.states.at(-1)).toMatchObject({phase:'complete',practiceDone:2});
});
it.each(['My name is Alexa.','My name is not Alex.','I am 20 years old.'])('sends a changed answer to AI rather than matching approximately: %s',async changed=>{
 const h=setup(['My name is Alex.',changed],[good,uncertain]);await h.controller.start(COACH_QUESTIONS[0]);
 expect(h.evaluate).toHaveBeenCalledTimes(2);expect(h.evaluate.mock.calls[1]).toEqual(['name',changed]);
 expect(h.states.at(-1)).toMatchObject({phase:'paused',practiceDone:0});
});
it('allows outer whitespace trimming, consistent with API validation',async()=>{
 const h=setup(['My name is Alex.','  My name is Alex.  ']);await h.controller.start(COACH_QUESTIONS[0]);expect(h.evaluate).toHaveBeenCalledOnce();
});
it.each(['my name is alex.','MY NAME IS ALEX!','My name is Alex','  My   name\tis Alex.  ','My name is Alex?!','My name is Alex...'])('reuses formatting-only variation while preserving the actual recognized text: %s',async repeated=>{
 const h=setup(['My name is Alex.',repeated]);await h.controller.start(COACH_QUESTIONS[0]);
 expect(h.evaluate).toHaveBeenCalledOnce();expect(h.evaluate.mock.calls[0]).toEqual(['name','My name is Alex.']);
 expect(h.states.at(-1)).toMatchObject({phase:'complete',practiceDone:1,recognizedText:repeated.trim()});
});
it.each([
 ["I can't swim.",'I cant swim.'],["We're happy.",'Were happy.'],["We'll have tea.",'Well have tea.'],
 ['I will re-sign.','I will resign.'],['I paid 2.8 dollars.','I paid 28 dollars.'],
 ['I paid 2,800 dollars.','I paid 2800 dollars.'],['I like ice cream.','I like icecream.'],
 ['I want tea.','I want coffee.'],['My name is Alex.','My name is Alexa.'],
 ['I am 28 years old.','I am 29 years old.'],['I want coffee.','I do not want coffee.'],
 ["Let's eat, Alex.","Let's eat Alex."],['I want tea/coffee.','I want tea coffee.'],
 ["I'm twenty-eight.",'I am twenty eight.'],['I paid +2 dollars.','I paid -2 dollars.'],
])('preserves potentially meaningful differences and sends raw changed input to AI: %s -> %s',async(first,changed)=>{
 const h=setup([first,changed],[good,uncertain]);await h.controller.start(COACH_QUESTIONS[0]);
 expect(h.evaluate.mock.calls).toEqual([['name',first],['name',changed]]);
 expect(h.states.at(-1)).toMatchObject({phase:'paused',practiceDone:0});
});
it('never reuses an empty key even if an upstream evaluation incorrectly approves punctuation',async()=>{
 const h=setup(['...','?!'],[good,uncertain]);await h.controller.start(COACH_QUESTIONS[0]);
 expect(h.evaluate).toHaveBeenCalledTimes(2);expect(h.states.at(-1)).toMatchObject({phase:'paused',practiceDone:0});
});
it('format variation in a new question or restarted initial answer still requires AI',async()=>{
 const h=setup(['My name is Alex.','MY NAME IS ALEX!','my name is alex','MY NAME IS ALEX.']);
 await h.controller.start(COACH_QUESTIONS[0]);await h.controller.start(COACH_QUESTIONS[0]);
 expect(h.evaluate.mock.calls).toEqual([['name','My name is Alex.'],['name','my name is alex']]);
});
it('format-only direct text repetition reuses approval without changing displayed text',async()=>{
 const h=setup();h.listen.mockResolvedValueOnce('My name is Alex.').mockImplementation(()=>new Promise<string>(()=>{}));
 const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();await h.controller.submitText('MY NAME IS ALEX!');await pending;
 expect(h.evaluate).toHaveBeenCalledOnce();expect(h.states.at(-1)).toMatchObject({phase:'complete',practiceDone:1,recognizedText:'MY NAME IS ALEX!'});
});
it('format normalization does not turn a short answer into an approved complete sentence',async()=>{
 const h=setup(['Alex.','ALEX!'],[{...good,sentenceComplete:false},uncertain]);await h.controller.start(COACH_QUESTIONS[0]);
 expect(h.evaluate.mock.calls).toEqual([['name','Alex.'],['name','ALEX!']]);expect(h.states.at(-1)).toMatchObject({phase:'paused',practiceDone:0});
});
it('reuses typographic apostrophe variation without expanding or removing the contraction',async()=>{
 const h=setup(["I'd like tea.",'I’D LIKE TEA!']);await h.controller.start(COACH_QUESTIONS[2]);
 expect(h.evaluate).toHaveBeenCalledOnce();expect(h.states.at(-1)).toMatchObject({phase:'complete',recognizedText:'I’D LIKE TEA!',practiceDone:1});
});
it('shows the latest evaluated intent and feedback when the repetition changes the name',async()=>{
 const latest={...good,feedbackKo:'미나라는 이름을 잘 표현했어요.',modelAnswerEn:'My name is Mina.'};
 const h=setup(['My name is Alex.','My name is Mina.'],[good,latest]);await h.controller.start(COACH_QUESTIONS[0]);
 expect(h.evaluate).toHaveBeenCalledTimes(2);expect(h.states.at(-1)).toMatchObject({phase:'complete',recognizedText:'My name is Mina.',feedbackKo:latest.feedbackKo,modelAnswerEn:latest.modelAnswerEn});
});
it('direct text repetition also replaces stale feedback and model sentence',async()=>{
 const latest={...good,feedbackKo:'미나라는 이름을 잘 표현했어요.',modelAnswerEn:'My name is Mina.'};const h=setup(undefined,[good,latest]);
 h.listen.mockResolvedValueOnce('My name is Alex.').mockImplementation(()=>new Promise<string>(()=>{}));const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();
 await h.controller.submitText('My name is Mina.');await pending;
 expect(h.states.at(-1)).toMatchObject({phase:'complete',feedbackKo:latest.feedbackKo,modelAnswerEn:latest.modelAnswerEn});expect(h.evaluate).toHaveBeenCalledTimes(2);
});
it('never reuses incomplete or off-topic replies as correct',async()=>{
 for(const meaning of ['relevant','needs_help'] as const){
  const h=setup(['Alex.','Alex.','Alex.','Alex.'],[{...good,meaning,sentenceComplete:false}]);await h.controller.start(COACH_QUESTIONS[0]);
  expect(h.evaluate).toHaveBeenCalledTimes(4);expect(h.states.at(-1)).toMatchObject({phase:'paused',practiceDone:0});
 }
});
it('restarting the same question and changing question both require fresh initial AI evaluation',async()=>{
 const h=setup(Array(6).fill('My name is Alex.'));await h.controller.start(COACH_QUESTIONS[0]);await h.controller.start(COACH_QUESTIONS[0]);await h.controller.start(COACH_QUESTIONS[1]);
 expect(h.evaluate.mock.calls).toEqual([['name','My name is Alex.'],['name','My name is Alex.'],['age','My name is Alex.']]);
});
it('pause clears reuse, including the direct text submission path',async()=>{
 const h=setup();h.listen.mockResolvedValueOnce('My name is Alex.').mockImplementation(()=>new Promise<string>(()=>{}));
 const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();expect(h.evaluate).toHaveBeenCalledOnce();h.controller.pause();await pending;
 await h.controller.submitText('My name is Alex.');expect(h.evaluate).toHaveBeenCalledTimes(2);expect(h.states.at(-1).practiceDone).toBe(1);
});
it('an aborted old evaluation cannot overwrite the new run reusable answer',async()=>{
 const h=setup(Array(5).fill('My name is Alex.'));let oldResolve!:(e:CoachEvaluation)=>void;let repeatResolve!:(s:string)=>void;
 h.listen.mockResolvedValueOnce('My name is Alex.').mockResolvedValueOnce('My name is Mina.').mockImplementation(()=>new Promise<string>(r=>{repeatResolve=r;}));
 h.evaluate.mockImplementationOnce(()=>new Promise<CoachEvaluation>(r=>{oldResolve=r;}));
 const old=h.controller.start(COACH_QUESTIONS[0]);await flush();
 const current=h.controller.start(COACH_QUESTIONS[1]);await flush();oldResolve(good);await old;await flush();repeatResolve('My name is Mina.');await current;
 expect(h.evaluate).toHaveBeenCalledTimes(2);expect(h.states.at(-1)).toMatchObject({phase:'complete',question:{id:'age'},practiceDone:1});
});
it.each(['My name is Alex.','MY NAME IS ALEX!','my name is alex'])('the actual client, handler and budget SQL consume one request for a verified repeat: %s',async repeated=>{
 const sqlite=new DatabaseSync(':memory:');databases.push(sqlite);sqlite.exec(readFileSync('scripts/conversation/budget-schema.sql','utf8'));
 const db:D1Database={prepare(sql){let values:any[]=[];const stmt={bind(...args:any[]){values=args;return stmt;},async run(){const r=sqlite.prepare(sql).run(...values);return{success:true,meta:{changes:Number(r.changes)}};},async first(){return sqlite.prepare(sql).get(...values) as any??null;}};return stmt;}};
 const env={PUBLIC_CONVERSATION_ENABLED:'true',ALLOW_EXTERNAL_GEMINI_CALLS:'true',CONVERSATION_FREE_TIER_CONFIRMED:'true',GEMINI_API_KEY:'TEST_ONLY_NOT_REAL',CONVERSATION_BUDGET_DB:db,CONVERSATION_MODEL_LIMITS_JSON:JSON.stringify(MODEL_HARD_CAPS_90_PERCENT)};
 const google=vi.fn(async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(good)}]}}]})));
 const http=vi.fn(async(_input:any,init:any)=>handlePublicCoach(new Request('https://study.example/api/conversation/coach',{...init,headers:{...init.headers,Origin:'https://study.example','CF-Connecting-IP':'203.0.113.1'}}),env,{fetchFn:google}));
 const api=new PublicCoachApiClient(http);const states:any[]=[];
 const answers=['My name is Alex.',repeated,'My name is Alex.','My name is Mina.'];
 const controller=new CoachTutorController({speak:async()=>true,listen:async()=> answers.shift()??'',evaluate:(q,a)=>api.evaluate(q,a,true),cancel:()=>api.cancel(),emit:s=>states.push(s)});
 await controller.start(COACH_QUESTIONS[0]);expect(states.at(-1)).toMatchObject({phase:'complete',practiceDone:1});
 expect(http).toHaveBeenCalledOnce();expect(google).toHaveBeenCalledOnce();
 const rows=sqlite.prepare('SELECT model,state,units FROM conversation_budget_reservations').all();expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({model:'gemini-3.5-flash-lite',state:'consumed'});expect(Number(rows[0].units)).toBeGreaterThan(16384);
 await controller.start(COACH_QUESTIONS[0]);expect(http).toHaveBeenCalledTimes(3);expect(google).toHaveBeenCalledTimes(3);
 expect(sqlite.prepare('SELECT COUNT(*) AS n FROM conversation_budget_reservations').get()?.n).toBe(3);
});
it('a cached repeat completes immediately without a second request even if further API calls would hit quota',async()=>{
 const h=setup();h.evaluate.mockResolvedValueOnce(good).mockRejectedValue(new Error('quota exhausted'));
 await h.controller.start(COACH_QUESTIONS[0]);expect(h.evaluate).toHaveBeenCalledOnce();expect(h.states.some(s=>s.phase==='waiting')).toBe(false);expect(h.states.at(-1)).toMatchObject({phase:'complete',practiceDone:1});
});
it('a complete but off-topic answer never enters the correct-answer reuse slot',async()=>{
 const h=setup(Array(4).fill('I like blue cars.'),[{...good,meaning:'needs_help',sentenceComplete:true}]);await h.controller.start(COACH_QUESTIONS[1]);
 expect(h.evaluate).toHaveBeenCalledTimes(4);expect(h.states.at(-1)).toMatchObject({phase:'paused',practiceDone:0});
});
function nativeFlow(){
 const instances:any[]=[];class Native{lang='';continuous=false;interimResults=false;onstart:any;onresult:any;onend:any;onerror:any;start=vi.fn();stop=vi.fn();abort=vi.fn();constructor(){instances.push(this);}}
 const input=new BrowserSpeechInputService(Native);const states:any[]=[];const evaluate=vi.fn().mockResolvedValue(good);
 const controller=new CoachTutorController({speak:async()=>true,listen:(lang,options)=>input.start(lang,options),evaluate,cancel:()=>input.cancel(),emit:s=>states.push(structuredClone(s))});
 const result=(rec:any,text:string,final=true)=>rec.onresult({resultIndex:0,results:[Object.assign([{transcript:text,confidence:0.8}],{isFinal:final})]});
 return{instances,states,evaluate,controller,result};
}
it.each(['My name is Alex.','MY NAME IS ALEX!'])('real recognition service waits for the finalized ten-second repetition before using approval: %s',async repeated=>{
 vi.useFakeTimers();const h=nativeFlow();const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();
 h.instances[0].onstart();h.result(h.instances[0],'My name is Alex.');await vi.advanceTimersByTimeAsync(9999);expect(h.evaluate).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);h.instances[0].onend();await flush();expect(h.evaluate).toHaveBeenCalledOnce();
 h.instances[1].onstart();h.result(h.instances[1],'might aim',false);h.result(h.instances[1],repeated);h.result(h.instances[1],repeated);
 await vi.advanceTimersByTimeAsync(9999);expect(h.states.at(-1).practiceDone).toBe(0);expect(h.evaluate).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(1);h.instances[1].onend();await pending;
 expect(h.states.at(-1)).toMatchObject({phase:'complete',recognizedText:repeated,practiceDone:1});expect(h.evaluate).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it('network failure during a new recording cannot reuse a cached answer even after a matching native final event',async()=>{
 vi.useFakeTimers();const h=nativeFlow();const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();
 h.instances[0].onstart();h.result(h.instances[0],'My name is Alex.');await vi.advanceTimersByTimeAsync(10000);h.instances[0].onend();await flush();
 h.instances[1].onstart();h.result(h.instances[1],'My name is Alex.');h.instances[1].onerror({error:'network'});await pending;await vi.advanceTimersByTimeAsync(30000);
 expect(h.states.at(-1)).toMatchObject({phase:'error',practiceDone:0});expect(h.evaluate).toHaveBeenCalledOnce();expect(h.instances).toHaveLength(2);expect(vi.getTimerCount()).toBe(0);
});
it('a format-equivalent interim preview cannot hide a different finalized name from AI',async()=>{
 vi.useFakeTimers();const h=nativeFlow();const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();
 h.instances[0].onstart();h.result(h.instances[0],'My name is Alex.');await vi.advanceTimersByTimeAsync(10000);h.instances[0].onend();await flush();
 h.instances[1].onstart();h.result(h.instances[1],'MY NAME IS ALEX!',false);await flush();
 expect(h.evaluate).toHaveBeenCalledOnce();expect(h.states.at(-1).practiceDone).toBe(0);
 h.result(h.instances[1],'My name is Mina.');await vi.advanceTimersByTimeAsync(10000);h.instances[1].onend();await pending;
 expect(h.evaluate.mock.calls).toEqual([['name','My name is Alex.'],['name','My name is Mina.']]);
 expect(h.states.at(-1)).toMatchObject({phase:'complete',recognizedText:'My name is Mina.',practiceDone:1});expect(vi.getTimerCount()).toBe(0);
});
