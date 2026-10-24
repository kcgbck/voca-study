import {afterEach,expect,it,vi} from 'vitest';
import {LocalSpeechInputService} from '../src/features/conversation/services/localSpeechInput';
afterEach(()=>vi.useRealTimers());
it('availability never resolving is bounded to five seconds without starting a microphone',async()=>{
  vi.useFakeTimers();const start=vi.fn();
  class Native {processLocally=false;static available=()=>new Promise(()=>{});start=start;}
  const service=new LocalSpeechInputService(Native);const result=service.start().catch(error=>error);
  await vi.advanceTimersByTimeAsync(5000);expect((await result).message).toContain('시간이 초과');expect(start).not.toHaveBeenCalled();
});
it('stop during availability rejects immediately and never starts later',async()=>{
  let release:any;let settled=false;const start=vi.fn();
  class Native {processLocally=false;static available=()=>new Promise(resolve=>{release=resolve});start=start;}
  const service=new LocalSpeechInputService(Native);const result=service.start().catch(error=>{settled=true;return error});
  service.stop();for(let i=0;i<8;i++)await Promise.resolve();const immediate=settled;
  service.cancel();release('available');await result;
  expect(immediate).toBe(true);expect(start).not.toHaveBeenCalled();
});
