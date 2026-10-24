import {afterEach,expect,it,vi} from 'vitest';
import {BrowserSpeechInputService} from '../src/features/conversation/services/browserSpeechInput';
// Models the older Chromium Android Java bridge: in continuous mode,
// handleResults(provisional=true) sets provisional=false. Blink retains each final.
function androidBridge(){const instances:any[]=[];class Native{
 continuous=false;interimResults=false;lang='';onstart:any;onresult:any;onend:any;onerror:any;finals:any[]=[];
 start=vi.fn();stop=vi.fn();abort=vi.fn();constructor(){instances.push(this);}
 deliver(text:string,provisional:boolean){const isFinal=!provisional||this.continuous;const item=Object.assign([{transcript:text,confidence:0.8}],{isFinal});const index=this.finals.length;if(isFinal)this.finals.push(item);const results=isFinal?[...this.finals]:[...this.finals,item];this.onresult?.({resultIndex:index,results});}
 }return{Native,instances};}
afterEach(()=>vi.useRealTimers());
it('avoids Android continuous promotion of provisional hypotheses into duplicate finals',async()=>{
 vi.useFakeTimers();const h=androidBridge();const partial=vi.fn();const input=new BrowserSpeechInputService(h.Native);const pending=input.start('en-US',{windowMs:6000,onPartial:partial});const rec=h.instances[0];rec.onstart();
 for(const text of ['mey','mey name','mey name','my name is'])rec.deliver(text,true);rec.deliver('my name is Alex',false);
 await vi.advanceTimersByTimeAsync(6000);rec.onend();expect(await pending).toBe('my name is Alex');expect(partial).toHaveBeenLastCalledWith('my name is Alex');
});
it('uses single utterance native sessions but preserves the shared six-second window and separate phrases',async()=>{
 vi.useFakeTimers();const h=androidBridge();const ready=vi.fn();const input=new BrowserSpeechInputService(h.Native);const pending=input.start('en-US',{windowMs:6000,onReady:ready});let rec=h.instances[0];expect(rec.continuous).toBe(false);expect(rec.interimResults).toBe(true);rec.onstart();rec.deliver('My name',false);await vi.advanceTimersByTimeAsync(1000);rec.onend();await vi.advanceTimersByTimeAsync(100);rec=h.instances[1];expect(rec.continuous).toBe(false);rec.onstart();rec.deliver('is Alex.',false);await vi.advanceTimersByTimeAsync(4900);rec.onend();expect(await pending).toBe('My name is Alex.');expect(ready).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it('preserves deliberately repeated words across utterances rather than guessing prefix overlaps',async()=>{
 vi.useFakeTimers();const h=androidBridge();const input=new BrowserSpeechInputService(h.Native);const pending=input.start('en-US',{windowMs:6000});let rec=h.instances[0];rec.onstart();rec.deliver('very',false);await vi.advanceTimersByTimeAsync(1000);rec.onend();await vi.advanceTimersByTimeAsync(100);rec=h.instances[1];rec.onstart();rec.deliver('very good',false);await vi.advanceTimersByTimeAsync(4900);rec.onend();expect(await pending).toBe('very very good');
});
it('does not turn an inaccurate final transcript into the lesson answer',async()=>{
 vi.useFakeTimers();const h=androidBridge();const input=new BrowserSpeechInputService(h.Native);const pending=input.start('en-US',{windowMs:6000});const rec=h.instances[0];rec.onstart();rec.deliver('my name',true);rec.deliver('mine is Alice',false);await vi.advanceTimersByTimeAsync(6000);rec.onend();expect(await pending).toBe('mine is Alice');
});

it('handles the supplied S25 empty and cumulative partial sequence without retaining provisional prefixes',async()=>{
 vi.useFakeTimers();const h=androidBridge();const onTrace=vi.fn();const input=new BrowserSpeechInputService(h.Native);const pending=input.start('en-US',{windowMs:6000,onTrace});const rec=h.instances[0];rec.onstart();for(const text of ['','','','my','my name','my name','my name is'])rec.deliver(text,true);rec.deliver('my name is Alex',false);await vi.advanceTimersByTimeAsync(1000);rec.onend();await vi.advanceTimersByTimeAsync(100);h.instances[1].onstart();await vi.advanceTimersByTimeAsync(4900);h.instances[1].onend();expect(await pending).toBe('my name is Alex');expect(onTrace.mock.calls.map(c=>c[0]).filter(e=>e.event==='result').at(-1).results).toEqual([{index:0,text:'my name is Alex',final:true}]);
});
