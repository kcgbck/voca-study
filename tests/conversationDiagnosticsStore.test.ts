import {afterEach,expect,it,vi} from 'vitest';
import {CoachDiagnosticStore,COACH_DIAGNOSTICS_KEY,type CoachDiagnosticRecord} from '../src/features/conversation/coach/coachDiagnostics';
const baseTime=Date.parse('2026-10-24T07:00:00.000Z');
const sample=(id='one',time=baseTime):CoachDiagnosticRecord=>({id,timestamp:new Date(time).toISOString(),questionId:'cafe',questionEn:'What would you like to drink?',stage:'initial',inputSource:'voice',rawText:'I would like couple, please.',candidates:['I would like couple, please.','I would like coffee, please.'],evaluationSource:'ai',evaluation:{meaning:'relevant',sentenceComplete:true,feedbackKo:'뜻이 잘 전달됐어요.',modelAnswerEn:'I would like coffee, please.',recognizedCandidateIndex:1},evaluationRequests:1,elapsedMs:1500});
function storage(){const data=new Map<string,string>();return{data,getItem:vi.fn((k:string)=>data.get(k)??null),setItem:vi.fn((k:string,v:string)=>{data.set(k,v);}),removeItem:vi.fn((k:string)=>{data.delete(k);})};}
afterEach(()=>vi.unstubAllGlobals());
it('keeps raw, native alternatives, selected meaning and optional intent distinct across reloads',()=>{
 const disk=storage();const store=new CoachDiagnosticStore(disk,()=>baseTime);store.append(sample());store.annotate('one','I would like coffee, please.');
 const record=new CoachDiagnosticStore(disk,()=>baseTime).list()[0];expect(record.rawText).toBe('I would like couple, please.');expect(record.candidates[1]).toBe('I would like coffee, please.');expect(record.intendedText).toBe(record.candidates[1]);expect(record.evaluation?.recognizedCandidateIndex).toBe(1);
 const report=store.exportText();for(const term of ['coach-report-v1','What would you like to drink?','I would like couple, please.','I would like coffee, please.','1500','relevant'])expect(report).toContain(term);
 expect(report).toMatch(/의도|말한/);expect(report).toMatch(/후보/);expect(report).toMatch(/피드백/);
});
it('marks intent unknown until the user adds it and never treats a model answer as the actual utterance',()=>{
 const store=new CoachDiagnosticStore(storage(),()=>baseTime);store.append(sample());expect(store.list()[0].intendedText).toBeUndefined();expect(store.exportText()).toMatch(/확인 불가|미입력|미작성|알 수 없/);
 store.annotate('one','different words');store.annotate('one','');expect(store.list()[0].intendedText).toBeUndefined();
});
it('retains only the latest twenty completed records',()=>{
 const disk=storage();const store=new CoachDiagnosticStore(disk,()=>baseTime);for(let i=0;i<25;i++)store.append(sample(String(i),baseTime-25000+i*1000));
 expect(store.list()).toHaveLength(20);expect(store.list().map(r=>r.id)).not.toContain('0');expect(store.list().map(r=>r.id)).toContain('24');
});
it('drops expired and corrupted future records from live lists, exports and reloaded storage',()=>{
 let now=baseTime;const disk=storage();const store=new CoachDiagnosticStore(disk,()=>now);store.append(sample());store.append(sample('future',baseTime+86400000));store.append(sample('expired',baseTime-86400001));
 expect(store.list().map(r=>r.id)).toEqual(['one']);now+=86400001;expect(store.list()).toEqual([]);expect(store.exportText()).not.toContain('I would like couple');expect(new CoachDiagnosticStore(disk,()=>now).list()).toEqual([]);
});
it('bounds multi-byte persistence and user annotation without touching other app storage',()=>{
 const disk=storage();disk.data.set('word-data','keep-words');disk.data.set('coach_adult_confirmed_coach-2026-10-23','true');const store=new CoachDiagnosticStore(disk,()=>baseTime);
 for(let i=0;i<25;i++){const r=sample(String(i));r.rawText='가'.repeat(500);r.candidates=['나'.repeat(500),'다'.repeat(500),'라'.repeat(500)];r.evaluation!.feedbackKo='마'.repeat(500);store.append(r);store.annotate(r.id,'바'.repeat(800));}
 expect(new TextEncoder().encode(disk.data.get(COACH_DIAGNOSTICS_KEY)??'').byteLength).toBeLessThanOrEqual(65536);expect(store.list().length).toBeGreaterThan(0);expect(store.list().length).toBeLessThanOrEqual(20);expect(store.list().every(r=>(r.intendedText?.length??0)<=500)).toBe(true);expect(new TextEncoder().encode(store.exportText()).byteLength).toBeLessThanOrEqual(131072);
 store.clear();expect(store.list()).toEqual([]);expect(disk.data.get('word-data')).toBe('keep-words');expect(disk.data.get('coach_adult_confirmed_coach-2026-10-23')).toBe('true');expect(disk.removeItem).toHaveBeenCalledWith(COACH_DIAGNOSTICS_KEY);
});
it('snapshots incoming records and returned records defensively',()=>{
 const store=new CoachDiagnosticStore(storage(),()=>baseTime);const original=sample();store.append(original);original.candidates[1]='mutated';original.evaluation!.feedbackKo='mutated';const returned=store.list();returned[0].candidates[0]='also-mutated';returned[0].evaluation!.modelAnswerEn='also-mutated';
 expect(store.list()[0]).toEqual(sample());
});
it('ignores malformed storage and exports only allowed record fields and safe error codes',()=>{
 const disk=storage();disk.data.set(COACH_DIAGNOSTICS_KEY,'broken');const store=new CoachDiagnosticStore(disk,()=>baseTime);expect(store.list()).toEqual([]);
 const evil={...sample(),apiKey:'DO_NOT_EXPORT_KEY',headers:{Authorization:'DO_NOT_EXPORT_AUTH'},errorCode:'DO_NOT_EXPORT_ERROR_KEY',evaluation:{...sample().evaluation,secret:'DO_NOT_EXPORT_NESTED'}};
 store.append(evil as any);expect(store.exportText()).not.toContain('DO_NOT_EXPORT');expect(JSON.stringify(store.list())).not.toContain('DO_NOT_EXPORT');
});
it('keeps current-screen memory and annotations when storage writes fail',()=>{
 const disk=storage();disk.setItem.mockImplementation(()=>{throw new Error('quota');});const store=new CoachDiagnosticStore(disk,()=>baseTime);store.append(sample());expect(store.list()).toHaveLength(1);store.annotate('one','coffee please');expect(store.list()[0].intendedText).toBe('coffee please');store.clear();expect(store.list()).toEqual([]);
});
it('tolerates blocked localStorage property access and retains bounded memory',()=>{
 vi.stubGlobal('window',{get localStorage(){throw new Error('blocked');}});const store=new CoachDiagnosticStore(undefined,()=>baseTime);expect(()=>store.append(sample())).not.toThrow();expect(store.list()).toHaveLength(1);expect(()=>store.clear()).not.toThrow();expect(store.list()).toEqual([]);
});
it('never serializes non-finite counters or out-of-range selected indexes as valid data',()=>{
 const store=new CoachDiagnosticStore(storage(),()=>baseTime);const r=sample();r.elapsedMs=Infinity;r.evaluationRequests=NaN;r.evaluation!.recognizedCandidateIndex=999;store.append(r);
 for(const record of store.list()){expect(Number.isFinite(record.elapsedMs)).toBe(true);expect(Number.isFinite(record.evaluationRequests)).toBe(true);expect(record.evaluation?.recognizedCandidateIndex===undefined||record.evaluation.recognizedCandidateIndex<record.candidates.length).toBe(true);}
});
it('preserves spaces during controlled incremental annotation typing',()=>{
 const store=new CoachDiagnosticStore(storage(),()=>baseTime);store.append(sample());
 let value='';for(const char of 'I actually said coffee, please.'){store.annotate('one',value+char);value=store.list()[0].intendedText??'';}
 expect(value).toBe('I actually said coffee, please.');expect(store.exportText()).toContain('I actually said coffee, please.');
 store.annotate('one','   ');expect(store.list()[0].intendedText).toBeUndefined();
});
it('distinguishes a returned single native transcript from unavailable alternatives in the report',()=>{
 const store=new CoachDiagnosticStore(storage(),()=>baseTime);const r=sample();r.candidates=[r.rawText];r.evaluation!.recognizedCandidateIndex=0;store.append(r);const report=store.exportText();expect(report).toMatch(/단일.*1개|1개.*단일/);expect(report).toContain(r.rawText);expect(report).not.toContain('후보 미제공');
});
