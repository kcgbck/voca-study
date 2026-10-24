import {afterEach,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {D1ServerBudgetAdapter,sha256Hex,toPacificDateString,type D1Database} from '../src/features/conversation/server/budgetAdapter';
import {handlePublicCoach} from '../src/features/conversation/server/publicCoachHandler';
import {COACH_POLICY_VERSION} from '../src/features/conversation/coach/coachProtocol';
import {MODEL_HARD_CAPS_90_PERCENT} from '../src/features/conversation/server/budgetPolicy';
const model='gemini-3.5-flash-lite';
const databases:DatabaseSync[]=[];
afterEach(()=>{for(const db of databases.splice(0))db.close();});
function setup(limits:Record<string,number>={}){
 const sqlite=new DatabaseSync(':memory:');databases.push(sqlite);sqlite.exec(readFileSync('scripts/conversation/budget-schema.sql','utf8'));
 const db:D1Database={prepare(sql:string){let values:any[]=[];const stmt={bind(...args:any[]){values=args;return stmt;},async run(){const r=sqlite.prepare(sql).run(...values);return{success:true,meta:{changes:Number(r.changes)}};},async first(){return sqlite.prepare(sql).get(...values) as any??null;}};return stmt;}};
 let now=Date.parse('2026-10-23T12:00:00Z');
 const caps={...MODEL_HARD_CAPS_90_PERCENT[model],...limits};
 const env={PUBLIC_CONVERSATION_ENABLED:'true',ALLOW_EXTERNAL_GEMINI_CALLS:'true',CONVERSATION_FREE_TIER_CONFIRMED:'true',GEMINI_API_KEY:'TEST_ONLY_NOT_REAL',CONVERSATION_BUDGET_DB:db,CONVERSATION_MODEL_LIMITS_JSON:JSON.stringify({...MODEL_HARD_CAPS_90_PERCENT,[model]:caps})};
 const fetchFn=vi.fn(async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({meaning:'relevant',sentenceComplete:true,feedbackKo:'뜻을 잘 전달했어요.',modelAnswerEn:'My name is Alex.'})}]}}]})));
 const adapter=new D1ServerBudgetAdapter({db,model,...caps,clockNow:()=>now});
 const request=(ip='203.0.113.1',id:string=crypto.randomUUID())=>new Request('https://study.example/api/conversation/coach',{method:'POST',headers:{Origin:'https://study.example','Content-Type':'application/json','CF-Connecting-IP':ip},body:JSON.stringify({requestId:id,adultConfirmed:true,policyVersion:COACH_POLICY_VERSION,questionId:'name',answer:'My name is Alex.'})});
 const call=(ip?:string,id?:string)=>handlePublicCoach(request(ip,id),env,{fetchFn,clockNow:()=>now});
 const rows=()=>sqlite.prepare('SELECT * FROM conversation_budget_reservations').all();
 const seed=(count:number,offset=-120000,units=1)=>{const insert=sqlite.prepare("INSERT INTO conversation_budget_reservations(request_hash,caller_hash,model,created_ms,day_key,units,state) VALUES(?,?,?,?,?,?, 'consumed')");for(let i=0;i<count;i++)insert.run(`seed-${i}`,'seed-caller',model,now+offset,toPacificDateString(new Date(now)),units);};
 return{sqlite,db,env,fetchFn,adapter,call,rows,seed,advance:(ms:number)=>{now+=ms;}};
}
it('allows four normal evaluations from one IP and atomically stops the fourteenth globally',async()=>{
 const h=setup();const responses=await Promise.all(Array.from({length:14},()=>h.call()));
 expect(responses.filter(r=>r.status===200)).toHaveLength(13);expect(h.fetchFn).toHaveBeenCalledTimes(13);expect(h.rows()).toHaveLength(13);
 const denied=responses.find(r=>r.status===429)!;expect(denied).toBeDefined();expect(denied.headers.get('Retry-After')).toBe('61');expect(await denied.json()).toMatchObject({errorCode:'COACH_MINUTE_LIMIT',retryAfterSeconds:61});
 h.advance(61000);expect((await h.call()).status).toBe(200);expect(h.fetchFn).toHaveBeenCalledTimes(14);
});
it('different IPs still share the same thirteen request global limit',async()=>{
 const h=setup();const responses=await Promise.all(Array.from({length:20},(_,i)=>h.call(`203.0.113.${i+1}`)));expect(responses.filter(r=>r.status===200)).toHaveLength(13);expect(h.fetchFn).toHaveBeenCalledTimes(13);expect(h.rows()).toHaveLength(13);
});
it('honors a deliberately smaller caller setting',async()=>{
 const h=setup({callerRpm:2});expect((await h.call()).status).toBe(200);expect((await h.call()).status).toBe(200);const denied=await h.call();expect(denied.status).toBe(429);expect(await denied.json()).toMatchObject({errorCode:'COACH_MINUTE_LIMIT'});expect((await h.call('203.0.113.2')).status).toBe(200);expect(h.fetchFn).toHaveBeenCalledTimes(3);
});
it('cannot exceed the 450 day cap even with inflated environment settings',async()=>{
 const h=setup({rpm:999,tpm:9999999,rpd:999,callerRpm:999});h.seed(449);expect((await h.call()).status).toBe(200);const denied=await h.call();expect(denied.status).toBe(429);expect(await denied.json()).toMatchObject({errorCode:'COACH_DAILY_LIMIT'});expect(denied.headers.get('Retry-After')).toBeNull();expect(h.fetchFn).toHaveBeenCalledOnce();expect(h.rows()).toHaveLength(450);
});
it('TPM pressure queues without consuming or calling Google and recovers after the window',async()=>{
 const h=setup();h.seed(1,0,220000);const denied=await h.call();expect(await denied.json()).toMatchObject({errorCode:'COACH_MINUTE_LIMIT'});expect(h.fetchFn).not.toHaveBeenCalled();expect(h.rows()).toHaveLength(1);h.advance(61000);expect((await h.call()).status).toBe(200);expect(h.fetchFn).toHaveBeenCalledOnce();
});
it('duplicate accepted request never replays the provider or advertises an automatic retry',async()=>{
 const h=setup();const id=crypto.randomUUID();expect((await h.call(undefined,id)).status).toBe(200);const duplicate=await h.call(undefined,id);expect(duplicate.status).toBeGreaterThanOrEqual(400);expect((await duplicate.json()).errorCode).not.toBe('COACH_MINUTE_LIMIT');expect(h.fetchFn).toHaveBeenCalledOnce();expect(h.rows()).toHaveLength(1);
});
it('provider 429 is charged once and never confused with a pre-upstream minute denial',async()=>{
 const h=setup();h.fetchFn.mockImplementation(async()=>new Response('quota',{status:429}));const r=await h.call();expect(r.status).toBe(429);expect((await r.json()).errorCode).not.toBe('COACH_MINUTE_LIMIT');expect(h.fetchFn).toHaveBeenCalledOnce();expect(h.rows()[0].state).toBe('consumed');
});
it('missing or failed budget reads cannot authorize a retry or call Google',async()=>{
 const h=setup();(h.env as any).CONVERSATION_BUDGET_DB={prepare(){const stmt={bind(){return stmt;},async run(){return{success:true,meta:{changes:0}};},async first(){throw new Error('db down');}};return stmt;}};const r=await h.call();expect(r.status).toBeGreaterThanOrEqual(400);expect((await r.json()).errorCode).not.toBe('COACH_MINUTE_LIMIT');expect(h.fetchFn).not.toHaveBeenCalled();
});
it('advisory rejects duplicate IDs and oversized requests and stores no transcript or IP',async()=>{
 const h=setup();await h.adapter.reserve('caller:original',10);const advice=(h.adapter as any).getRetryAdvice.bind(h.adapter);expect(await advice('caller:original',10)).toMatchObject({kind:'duplicate'});expect(await advice('caller:new',225001)).toMatchObject({kind:'request-too-large'});expect(JSON.stringify(h.rows())).not.toContain('My name');expect(JSON.stringify(h.rows())).not.toContain('203.0.113');expect(h.rows()[0].request_hash).toBe(await sha256Hex('caller:original'));
});
it('daily exhaustion dominates minute pressure so clients do not loop all day',async()=>{
 const h=setup();h.seed(450,0);expect(await (h.adapter as any).getRetryAdvice('caller:new',100)).toMatchObject({kind:'daily'});
});

it.each([{}, {duplicate_count:0,daily_count:0,minute_count:-1,minute_units:0,caller_count:0}, {duplicate_count:0,daily_count:null,minute_count:13,minute_units:0,caller_count:0}, {duplicate_count:0,daily_count:0,minute_count:'13',minute_units:0,caller_count:0}, {duplicate_count:0,daily_count:0,minute_count:13,minute_units:NaN,caller_count:0}])('malformed advisory counts must fail closed: %j',async(row)=>{
 const db:any={prepare(){const stmt={bind(){return stmt;},async first(){return row;},async run(){return{success:true,meta:{changes:0}};}};return stmt;}};
 const adapter=new D1ServerBudgetAdapter({db,model,rpm:13,tpm:225000,rpd:450,callerRpm:13});expect(await (adapter as any).getRetryAdvice('caller:new',100)).toEqual({kind:'unavailable'});
});
