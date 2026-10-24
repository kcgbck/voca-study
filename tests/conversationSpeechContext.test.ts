import {afterEach,expect,it,vi} from 'vitest';
import {CoachTutorController} from '../src/features/conversation/coach/CoachTutorController';
import {COACH_QUESTIONS,COACH_POLICY_VERSION} from '../src/features/conversation/coach/coachProtocol';
import {PublicCoachApiClient} from '../src/features/conversation/coach/publicCoachApi';
import {handlePublicCoach} from '../src/features/conversation/server/publicCoachHandler';
import {MODEL_HARD_CAPS_90_PERCENT} from '../src/features/conversation/server/budgetPolicy';
const good={meaning:'relevant' as const,sentenceComplete:true,feedbackKo:'뜻이 잘 전달됐어요.',modelAnswerEn:'I would like coffee, please.'};
const flush=async()=>{for(let i=0;i<160;i++)await Promise.resolve();};
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
function flow(groups:string[][],evaluation:any={...good,recognizedCandidateIndex:1}){
 const states:any[]=[];const evaluate=vi.fn(async(_q:string,_a:string,_context?:any)=>({...evaluation}));
 const listen=vi.fn(async(_lang:string,options:any)=>{const group=groups.shift()??[];options?.onAlternatives?.(group);return group[0]??'';});
 const controller=new CoachTutorController({speak:async()=>true,listen,evaluate,cancel:vi.fn(),emit:s=>states.push(structuredClone(s))});
 return{controller,evaluate,listen,states};
}
it('passes actual settled alternatives in one evaluation while keeping raw text and never caching recovered raw words',async()=>{
 const candidates=['I would like couple, please.','I would like coffee, please.'];const h=flow([[...candidates],[...candidates]]);
 await h.controller.start(COACH_QUESTIONS[2]);expect(h.evaluate).toHaveBeenCalledTimes(2);
 expect(h.evaluate.mock.calls[0]).toEqual(['cafe',candidates[0],{inputSource:'voice',candidates}]);
 expect(h.states.at(-1)).toMatchObject({phase:'complete',recognizedText:candidates[0],understoodText:candidates[1],practiceDone:1});
});
it('cannot award credit from an invented candidate index',async()=>{
 const h=flow([['unintelligible','I would like coffee.']],{...good,recognizedCandidateIndex:9});await h.controller.start(COACH_QUESTIONS[2]);
 expect(h.states.at(-1).phase).not.toBe('complete');expect(h.states.at(-1).practiceDone).toBe(0);
});
it('uncertain alternative selection pauses without credit, an approval label, or a spoken invented example',async()=>{
 const h=flow([['garbled words','another uncertain fragment']],{...good,meaning:'uncertain',sentenceComplete:false,recognizedCandidateIndex:1});
 const speak=vi.spyOn((h.controller as any).deps,'speak');await h.controller.start(COACH_QUESTIONS[2]);
 expect(h.states.at(-1)).toMatchObject({phase:'paused',practiceDone:0});expect(h.states.every(s=>s.understoodText===undefined)).toBe(true);
 expect(speak.mock.calls.some(c=>c[0]===good.modelAnswerEn)).toBe(false);expect(h.evaluate).toHaveBeenCalledOnce();
});
it('does not grade candidate callbacks until capture has settled and ignores callbacks after pause',async()=>{
 const h=flow([]);let options:any;h.listen.mockImplementation(async(_lang,o)=>{options=o;o?.onAlternatives?.(['bad','I would like coffee.']);return new Promise<string>(()=>{});});
 const pending=h.controller.start(COACH_QUESTIONS[2]);await flush();expect(h.evaluate).not.toHaveBeenCalled();h.controller.pause();options.onAlternatives(['bad','coffee']);await pending;expect(h.evaluate).not.toHaveBeenCalled();
});
it('text submitted during voice capture does not inherit native alternatives',async()=>{
 const h=flow([],{...good});h.listen.mockImplementation(async(_l,o)=>{o?.onAlternatives?.(['bad','I would like coffee.']);return new Promise<string>(()=>{});});
 const pending=h.controller.start(COACH_QUESTIONS[2]);await flush();const submitted=h.controller.submitText('I would like tea.');await flush();h.controller.pause();await submitted;await pending;
 expect(h.evaluate.mock.calls[0].slice(0,2)).toEqual(['cafe','I would like tea.']);expect(h.evaluate.mock.calls[0][2]?.candidates).toBeUndefined();
});
it('ignores a callback list that does not start with the actual settled transcript',async()=>{
 const h=flow([],{...good});let turn=0;h.listen.mockImplementation(async(_l,o)=>{o?.onAlternatives?.(['I want tea.','I want coffee.']);return ++turn===1?'I want water.':'I want water.';});
 await h.controller.start(COACH_QUESTIONS[2]);expect(h.evaluate).toHaveBeenCalledOnce();expect(h.evaluate.mock.calls[0]).toEqual(['cafe','I want water.']);
});
it('does not accept caller mutations of a previously reported native candidate list',async()=>{
 const h=flow([],{...good,recognizedCandidateIndex:1});let resolve!:(text:string)=>void;let n=0;
 h.listen.mockImplementation(async(_l,o)=>{if(++n>1)return '';const candidates=['raw','valid'];o?.onAlternatives?.(candidates);candidates[1]='mutated';return new Promise<string>(r=>{resolve=r;});});
 const pending=h.controller.start(COACH_QUESTIONS[2]);await flush();resolve('raw');await pending;
 expect(h.evaluate.mock.calls[0][2]?.candidates).toEqual(['raw','valid']);expect(h.states.at(-1).practiceDone).toBe(0);
});
function server(ev:any={...good,recognizedCandidateIndex:1}){
 const statements:any[]=[];const db={prepare(sql:string){const stmt={bind(...values:any[]){statements.push({sql,values});return stmt;},run:async()=>({success:true,meta:{changes:1}})};return stmt;}};
 const env={PUBLIC_CONVERSATION_ENABLED:'true',ALLOW_EXTERNAL_GEMINI_CALLS:'true',CONVERSATION_FREE_TIER_CONFIRMED:'true',GEMINI_API_KEY:'TEST_ONLY_NOT_REAL',CONVERSATION_BUDGET_DB:db,CONVERSATION_MODEL_LIMITS_JSON:JSON.stringify(MODEL_HARD_CAPS_90_PERCENT)};
 const fetchFn=vi.fn(async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(ev)}]}}]})));
 const body={requestId:'0a1f7384-9e4e-4a7e-a62e-5f8667e28a1a',adultConfirmed:true,policyVersion:COACH_POLICY_VERSION,questionId:'cafe',answer:'I would like couple, please.',inputSource:'voice',candidates:['I would like couple, please.','I would like coffee, please.']};
 const request=(patch:any={})=>new Request('https://study.example/api/conversation/coach',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://study.example','CF-Connecting-IP':'203.0.113.5'},body:JSON.stringify({...body,...patch})});
 return{env,statements,fetchFn,body,request};
}
it('sends raw and native candidates together to exactly one model call and budgets every payload byte',async()=>{
 const h=server();const r=await handlePublicCoach(h.request(),h.env,{fetchFn:h.fetchFn});expect(r.status).toBe(200);expect(h.fetchFn).toHaveBeenCalledOnce();
 const payload=JSON.parse((h.fetchFn.mock.calls[0] as any)[1].body);const learner=JSON.parse(payload.contents[0].parts[0].text);
 expect(learner).not.toHaveProperty('userAnswerEn');expect(learner.candidates[0]).toBe(h.body.answer);expect(learner.candidates).toEqual(h.body.candidates);
 const reserved=h.statements.find(s=>s.sql.includes('INSERT INTO'));expect(reserved.values[5]).toBeGreaterThanOrEqual(16384+new TextEncoder().encode(JSON.stringify({question:COACH_QUESTIONS[2].questionEn,answer:h.body.answer,candidates:h.body.candidates})).byteLength);
 expect((await r.json()).evaluation.recognizedCandidateIndex).toBe(1);expect(JSON.stringify(h.statements)).not.toContain('coffee');
});
it('constrains model output to select an actual candidate before grading and feedback generation',async()=>{
 const h=server();await handlePublicCoach(h.request(),h.env,{fetchFn:h.fetchFn});const body=JSON.parse((h.fetchFn.mock.calls[0] as any)[1].body);const schema=body.generationConfig.responseSchema;
 expect(schema.propertyOrdering).toEqual(['recognizedCandidateIndex','meaning','sentenceComplete','feedbackKo','modelAnswerEn']);expect(schema.required).toContain('recognizedCandidateIndex');expect(schema.properties.recognizedCandidateIndex).toMatchObject({type:'integer',minimum:0,maximum:1});expect(body.generationConfig.maxOutputTokens).toBe(512);
});
it('structured output offers only index zero without native candidates',async()=>{
 const h=server({...good,recognizedCandidateIndex:0});await handlePublicCoach(h.request({candidates:undefined,inputSource:'text'}),h.env,{fetchFn:h.fetchFn});const body=JSON.parse((h.fetchFn.mock.calls[0] as any)[1].body);
 expect(body.generationConfig.responseSchema.properties.recognizedCandidateIndex.maximum).toBe(0);expect(JSON.parse(body.contents[0].parts[0].text).userAnswerEn).toBe(h.body.answer);
});
it('preserves the complete selected sentence instead of generated noun substitutions and avoids blaming discarded STT words',async()=>{
 const h=server({...good,recognizedCandidateIndex:1,modelAnswerEn:'I would like tea.',feedbackKo:'커플 대신 커피라고 말하세요.'});
 const r=await handlePublicCoach(h.request(),h.env,{fetchFn:h.fetchFn});const ev=(await r.json()).evaluation;
 expect(ev.modelAnswerEn).toBe(h.body.candidates[1]);expect(ev.feedbackKo).not.toMatch(/커플|couple|대신/);expect(ev.meaning).toBe('relevant');expect(ev.sentenceComplete).toBe(true);expect(h.fetchFn).toHaveBeenCalledOnce();
});
it('preserves plausible top candidate wording without inventing the alternative beverage',async()=>{
 const h=server({...good,recognizedCandidateIndex:0});const r=await handlePublicCoach(h.request({answer:'I would like a cup.',candidates:['I would like a cup.','I would like coffee.']}),h.env,{fetchFn:h.fetchFn});
 expect((await r.json()).evaluation.modelAnswerEn).toBe('I would like a cup.');
});
it('incomplete recovery keeps the AI grammar example but never blames an unused native word',async()=>{
 const h=server({...good,recognizedCandidateIndex:1,sentenceComplete:false,feedbackKo:'copy 대신 coffee를 말하세요.'});const r=await handlePublicCoach(h.request({answer:'copy please',candidates:['copy please','coffee please']}),h.env,{fetchFn:h.fetchFn});const ev=(await r.json()).evaluation;
 expect(ev.modelAnswerEn).toBe(good.modelAnswerEn);expect(ev.sentenceComplete).toBe(false);expect(ev.feedbackKo).not.toMatch(/copy|대신/);expect(ev.feedbackKo).toMatch(/[가-힣]/);expect(ev.feedbackKo).not.toMatch(/[a-zA-Z]/);
});
it.each(['커피 주세요','12345','...'])('complete-answer preservation never bypasses English-only output validation: %s',async answer=>{
 const h=server({...good,recognizedCandidateIndex:0});const r=await handlePublicCoach(h.request({answer,candidates:undefined,inputSource:'text'}),h.env,{fetchFn:h.fetchFn});
 expect(r.status).toBe(200);const ev=(await r.json()).evaluation;expect(ev.modelAnswerEn).not.toMatch(/[가-힣]/);expect(ev.modelAnswerEn).toMatch(/[a-zA-Z]/);
});
it('complete long answers retain the bounded AI example without cutting native words',async()=>{
 const h=server({...good,recognizedCandidateIndex:0});const answer='I would like coffee with '.repeat(9)+'milk.';expect(answer.length).toBeGreaterThan(200);
 const r=await handlePublicCoach(h.request({answer,candidates:undefined,inputSource:'text'}),h.env,{fetchFn:h.fetchFn});expect(r.status).toBe(200);expect((await r.json()).evaluation.modelAnswerEn).toBe(good.modelAnswerEn);
});
it.each([{inputSource:'text'},{inputSource:'invalid'},{candidates:['different raw','coffee']},{candidates:['x','x']},{candidates:['x']},{candidates:['x','y','z','q']},{candidates:['I would like couple, please.',42]},{candidates:['I would like couple, please.',' ']},{candidates:['I would like couple, please.','x'.repeat(501)]}])('rejects invalid candidate context before budget/upstream: %j',async patch=>{
 const h=server();const r=await handlePublicCoach(h.request(patch),h.env,{fetchFn:h.fetchFn});expect(r.status).toBe(400);expect(h.fetchFn).not.toHaveBeenCalled();expect(h.statements).toHaveLength(0);
});
it.each([-1,3,0.5,'1',undefined])('rejects an invalid or missing model candidate index: %s',async index=>{
 const h=server({...good,recognizedCandidateIndex:index});const r=await handlePublicCoach(h.request(),h.env,{fetchFn:h.fetchFn});expect(r.status).toBe(502);expect(h.fetchFn).toHaveBeenCalledOnce();
});
it('client preserves voice context and rejects a fabricated response candidate index',async()=>{
 const fetchFn=vi.fn(async()=>new Response(JSON.stringify({success:true,evaluation:{...good,recognizedCandidateIndex:8}})));
 const api=new PublicCoachApiClient(fetchFn);const context={inputSource:'voice' as const,candidates:['I want couple.','I want coffee.']};
 await expect((api.evaluate as any)('cafe',context.candidates[0],true,context)).rejects.toThrow();
 const sent=JSON.parse((fetchFn.mock.calls[0] as any)[1].body);expect(sent.candidates).toEqual(context.candidates);expect(sent.answer).toBe(context.candidates[0]);
});
it.each([{inputSource:'text',candidates:['raw','other']},{inputSource:'voice',candidates:['different raw','other']},{inputSource:'voice',candidates:['raw','raw']}])('client rejects malformed context before HTTP: %j',async context=>{
 vi.useFakeTimers();const fetchFn=vi.fn();const api=new PublicCoachApiClient(fetchFn);await expect((api.evaluate as any)('name','raw',true,context)).rejects.toThrow();expect(fetchFn).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it('caller mutation after submission cannot expand the candidate index validation boundary',async()=>{
 let finish!:(value:Response)=>void;const fetchFn=vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;}));const api=new PublicCoachApiClient(fetchFn);
 const context={inputSource:'voice' as const,candidates:['raw','valid']};const pending=(api.evaluate as any)('name','raw',true,context);context.candidates.push('invented');
 finish(new Response(JSON.stringify({success:true,evaluation:{...good,recognizedCandidateIndex:2}})));await expect(pending).rejects.toThrow();
});
it('rejects an oversized multi-byte candidate body before reserving any budget',async()=>{
 const h=server();const candidates=['가'.repeat(500),'나'.repeat(500),'다'.repeat(500)];const r=await handlePublicCoach(h.request({answer:candidates[0],candidates}),h.env,{fetchFn:h.fetchFn});
 expect(r.status).toBe(413);expect(h.fetchFn).not.toHaveBeenCalled();expect(h.statements).toHaveLength(0);
});
