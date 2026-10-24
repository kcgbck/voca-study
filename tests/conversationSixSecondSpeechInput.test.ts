import {afterEach,expect,it,vi} from 'vitest';
import {BrowserSpeechInputService} from '../src/features/conversation/services/browserSpeechInput';
function harness(){const instances:any[]=[];class Native {lang='';continuous=false;interimResults=false;onstart:any;onresult:any;onend:any;onerror:any;start=vi.fn();stop=vi.fn();abort=vi.fn();constructor(){instances.push(this);}}return {Native,instances};}
const result=(text:string,isFinal=true)=>({resultIndex:0,results:[Object.assign([{transcript:text,confidence:0.8}],{isFinal})]});
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function begin(h:ReturnType<typeof harness>,options:any={}){const service=new BrowserSpeechInputService(h.Native);const ready=vi.fn();const partial=vi.fn();const pending=service.start('en-US',{windowMs:6000,onReady:ready,onPartial:partial,...options});return {service,ready,partial,pending};}
afterEach(()=>vi.useRealTimers());
it('allows a beginner answer after eight seconds in the ten-second window without grading interim words',async()=>{
 vi.useFakeTimers();const h=harness();const x=begin(h,{windowMs:10000});let settled=false;void x.pending.then(()=>{settled=true;});
 h.instances[0].onstart?.();await vi.advanceTimersByTimeAsync(8000);expect(settled).toBe(false);expect(h.instances[0].stop).not.toHaveBeenCalled();
 h.instances[0].onresult(result('My name',false));await vi.advanceTimersByTimeAsync(1500);expect(settled).toBe(false);
 h.instances[0].onresult(result('My name is Alex.'));await vi.advanceTimersByTimeAsync(499);expect(h.instances[0].stop).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);expect(h.instances[0].stop).toHaveBeenCalledOnce();h.instances[0].onend();expect(await x.pending).toBe('My name is Alex.');expect(vi.getTimerCount()).toBe(0);
});
it('keeps the English capture window open for six seconds from native readiness, not from button or TTS end',async()=>{
 vi.useFakeTimers();const h=harness();const x=begin(h);let settled=false;void x.pending.catch(()=>{}).then(()=>{settled=true;});
 await vi.advanceTimersByTimeAsync(2000);expect(x.ready).not.toHaveBeenCalled();h.instances[0].onstart?.();expect(x.ready).toHaveBeenCalledOnce();
 h.instances[0].onresult(result('My name is Alex.'));await vi.advanceTimersByTimeAsync(5999);expect(h.instances[0].stop).not.toHaveBeenCalled();expect(settled).toBe(false);
 await vi.advanceTimersByTimeAsync(1);expect(h.instances[0].stop).toHaveBeenCalledOnce();h.instances[0].onend();expect(await x.pending).toBe('My name is Alex.');
});
it('repeated final result indexes are replaced, never appended twice',async()=>{
 vi.useFakeTimers();const h=harness();const x=begin(h);h.instances[0].onstart?.();h.instances[0].onresult(result('My name is Alex.'));h.instances[0].onresult(result('My name is Alex.'));
 await vi.advanceTimersByTimeAsync(6000);h.instances[0].onend();expect(await x.pending).toBe('My name is Alex.');
});
it('interim words are visible but cannot become a confirmed learning answer',async()=>{
 vi.useFakeTimers();const h=harness();const x=begin(h);const observed=x.pending.catch((e:any)=>e);h.instances[0].onstart?.();h.instances[0].onresult(result('might name',false));expect(x.partial).toHaveBeenCalledWith('might name');
 await vi.advanceTimersByTimeAsync(6000);h.instances[0].onend();expect(await observed).toBeInstanceOf(Error);
});
it('an early native end retains recognized words and collects the rest within the same six-second window',async()=>{
 vi.useFakeTimers();const h=harness();const x=begin(h);let settled=false;void x.pending.then(()=>{settled=true;});h.instances[0].onstart?.();
 await vi.advanceTimersByTimeAsync(1000);h.instances[0].onresult(result('My name'));h.instances[0].onend();await flush();expect(settled).toBe(false);
 await vi.advanceTimersByTimeAsync(250);expect(h.instances.length).toBeGreaterThan(1);h.instances[1].onstart?.();h.instances[1].onresult(result('is Alex.'));
 await vi.advanceTimersByTimeAsync(4750);h.instances[1].onend();expect(await x.pending).toBe('My name is Alex.');
});
it('cancel clears restart/deadline timers and cannot emit late results',async()=>{
 vi.useFakeTimers();const h=harness();const x=begin(h);const observed=x.pending.catch((e:any)=>e);h.instances[0].onstart?.();const stale=h.instances[0].onresult;x.service.cancel();stale(result('late wrong words'));await vi.advanceTimersByTimeAsync(15000);
 expect(await observed).toBeInstanceOf(Error);expect(x.partial).not.toHaveBeenCalled();expect(h.instances).toHaveLength(1);expect(vi.getTimerCount()).toBe(0);
});

it('recognizer substitutions are kept verbatim, never replaced by the expected lesson answer',async()=>{
 vi.useFakeTimers();const h=harness();const x=begin(h);h.instances[0].onstart?.();h.instances[0].onresult(result('Might aim is Alice.'));
 await vi.advanceTimersByTimeAsync(6000);h.instances[0].onend();expect(await x.pending).toBe('Might aim is Alice.');
});
it('permission failures discard partial answers and do not restart the microphone',async()=>{
 vi.useFakeTimers();const h=harness();const x=begin(h);const observed=x.pending.catch((e:any)=>e);h.instances[0].onstart?.();h.instances[0].onresult(result('stale words'));h.instances[0].onerror({error:'not-allowed'});
 expect(await observed).toBeInstanceOf(Error);await vi.advanceTimersByTimeAsync(15000);expect(h.instances).toHaveLength(1);expect(vi.getTimerCount()).toBe(0);
});
it('a recognizer that never becomes ready has a bounded startup failure',async()=>{
 vi.useFakeTimers();const h=harness();const x=begin(h);const observed=x.pending.catch((e:any)=>e);await vi.advanceTimersByTimeAsync(5001);
 expect(await observed).toBeInstanceOf(Error);expect(x.ready).not.toHaveBeenCalled();expect(h.instances[0].abort).toHaveBeenCalled();
});
it('after stopping at six seconds, uncooperative native end is bounded to one second finalization grace',async()=>{
 vi.useFakeTimers();const h=harness();const x=begin(h);h.instances[0].onstart?.();h.instances[0].onresult(result('My name is Alex.'));await vi.advanceTimersByTimeAsync(7001);
 expect(await x.pending).toBe('My name is Alex.');expect(h.instances[0].abort).toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});

it('network errors cannot return an earlier final answer or keep recording',async()=>{
 vi.useFakeTimers();const h=harness();const x=begin(h);const observed=x.pending.catch((e:any)=>e);h.instances[0].onstart?.();h.instances[0].onresult(result('earlier words'));h.instances[0].onerror({error:'network'});
 await flush();let settled=false;void observed.then(()=>{settled=true;});await flush();expect(settled).toBe(true);expect(await observed).toBeInstanceOf(Error);expect(h.instances[0].abort).toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it('late callbacks from an ended native session cannot contaminate the restart',async()=>{
 vi.useFakeTimers();const h=harness();const x=begin(h);h.instances[0].onstart?.();const stale=h.instances[0].onresult;h.instances[0].onresult(result('My name'));await vi.advanceTimersByTimeAsync(1000);h.instances[0].onend();await vi.advanceTimersByTimeAsync(100);
 h.instances[1].onstart?.();stale(result('wrong stale words'));h.instances[1].onresult(result('is Alex.'));await vi.advanceTimersByTimeAsync(4900);h.instances[1].onend();expect(await x.pending).toBe('My name is Alex.');
});
it('synchronous native end during stop cannot leave a grace timer running',async()=>{
 vi.useFakeTimers();const h=harness();const x=begin(h);h.instances[0].onstart?.();h.instances[0].onresult(result('My name is Alex.'));h.instances[0].stop.mockImplementation(()=>h.instances[0].onend());
 await vi.advanceTimersByTimeAsync(6000);expect(await x.pending).toBe('My name is Alex.');expect(vi.getTimerCount()).toBe(0);
});

it('a retracted interim hypothesis clears the live preview instead of leaving wrong words visible',async()=>{
 vi.useFakeTimers();const h=harness();const x=begin(h);const observed=x.pending.catch((e:any)=>e);h.instances[0].onstart?.();h.instances[0].onresult(result('wrong interim',false));h.instances[0].onresult({resultIndex:0,results:[]});
 expect(x.partial).toHaveBeenLastCalledWith('');await vi.advanceTimersByTimeAsync(6000);h.instances[0].onend();expect(await observed).toBeInstanceOf(Error);
});
