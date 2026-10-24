import {afterEach,expect,it,vi} from 'vitest';
import {BrowserSpeechInputService} from '../src/features/conversation/services/browserSpeechInput';
function harness(){const instances:any[]=[];class Native{continuous=false;interimResults=false;maxAlternatives=1;onstart:any;onresult:any;onend:any;onerror:any;start=vi.fn();stop=vi.fn();abort=vi.fn();constructor(){instances.push(this);}}return{Native,instances};}
const segment=(texts:string[],final=true)=>Object.assign(texts.map(transcript=>({transcript,confidence:0})),{isFinal:final});
const event=(...segments:any[])=>({resultIndex:0,results:segments});
afterEach(()=>vi.useRealTimers());
function begin(h:ReturnType<typeof harness>,onAlternatives=vi.fn()){const service=new BrowserSpeechInputService(h.Native);const pending=service.start('en-US',{windowMs:6000,onAlternatives} as any);h.instances[0].onstart();return{service,pending,onAlternatives};}
it('requests three native alternatives while preserving single utterance mode and raw top result',async()=>{
 vi.useFakeTimers();const h=harness();const x=begin(h);const rec=h.instances[0];expect(rec.continuous).toBe(false);expect(rec.maxAlternatives).toBe(3);rec.onresult(event(segment(['my name is Alexa','my name is Alex','my name is Alice'])));expect(x.onAlternatives).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(6000);rec.onend();expect(await x.pending).toBe('my name is Alexa');expect(x.onAlternatives).toHaveBeenCalledOnce();expect(x.onAlternatives).toHaveBeenCalledWith(['my name is Alexa','my name is Alex','my name is Alice']);
});
it('keeps single candidate engines working and removes only exact duplicate or empty alternatives',async()=>{
 vi.useFakeTimers();const h=harness();const x=begin(h);h.instances[0].onresult(event(segment(['Alexa','Alexa','Alex','Alice'])));await vi.advanceTimersByTimeAsync(6000);h.instances[0].onend();expect(await x.pending).toBe('Alexa');expect(x.onAlternatives).toHaveBeenCalledWith(['Alexa','Alex']);
});
it('combines independent utterance segments without dropping prefixes and bounds candidate count',async()=>{
 vi.useFakeTimers();const h=harness();const x=begin(h);h.instances[0].onresult(event(segment(['My name','My game'])));await vi.advanceTimersByTimeAsync(1000);h.instances[0].onend();await vi.advanceTimersByTimeAsync(100);h.instances[1].onstart();h.instances[1].onresult(event(segment(['is Alexa','is Alex'])));await vi.advanceTimersByTimeAsync(4900);h.instances[1].onend();expect(await x.pending).toBe('My name is Alexa');const list=x.onAlternatives.mock.calls[0][0];expect(list[0]).toBe('My name is Alexa');expect(list).toContain('My name is Alex');expect(list).toHaveLength(3);expect(list.every((s:string)=>s.startsWith('My '))).toBe(true);
});
it('interim alternatives cannot become candidates, nor survive a fatal error or cancellation',async()=>{
 vi.useFakeTimers();for(const failure of ['cancel','network']){const h=harness();const x=begin(h);const observed=x.pending.catch(e=>e);h.instances[0].onresult(event(segment(['Alexa','Alex'],false)));const stale=h.instances[0].onresult;if(failure==='cancel')x.service.cancel();else h.instances[0].onerror({error:'network'});stale(event(segment(['stale','Alex'])));await vi.advanceTimersByTimeAsync(8000);expect(await observed).toBeInstanceOf(Error);expect(x.onAlternatives).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);}
});
it('only the latest final snapshot at a result index supplies alternatives and callback exceptions are harmless',async()=>{
 vi.useFakeTimers();const h=harness();const seen:string[][]=[];const x=begin(h,vi.fn((list:string[])=>{seen.push(list);throw new Error('UI callback');}));h.instances[0].onresult(event(segment(['Alexa','old'])));h.instances[0].onresult(event(segment(['Alex','Alice'])));await vi.advanceTimersByTimeAsync(6000);expect(()=>h.instances[0].onend()).not.toThrow();expect(await x.pending).toBe('Alex');expect(seen).toEqual([['Alex','Alice']]);
});

it('diagnostics expose requested and actual native alternatives without changing raw transcript selection',async()=>{
 vi.useFakeTimers();const h=harness();const onTrace=vi.fn();const onAlternatives=vi.fn();const input=new BrowserSpeechInputService(h.Native);const pending=input.start('en-US',{windowMs:6000,onTrace,onAlternatives});const rec=h.instances[0];rec.onstart();rec.onresult(event(segment(['Alexa','Alex'])));await vi.advanceTimersByTimeAsync(6000);rec.onend();expect(await pending).toBe('Alexa');const records=onTrace.mock.calls.map(c=>c[0]);expect(records[0]).toMatchObject({event:'start',continuous:false,maxAlternatives:3});expect(records.find(x=>x.event==='result').choices).toEqual([{index:0,alternatives:['Alexa','Alex']}]);expect(records.at(-1)).toMatchObject({event:'settled',text:'Alexa',alternatives:['Alexa','Alex']});
});
