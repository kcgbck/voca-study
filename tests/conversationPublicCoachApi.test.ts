import {afterEach,expect,it,vi} from 'vitest';
import {PublicCoachApiClient} from '../src/features/conversation/coach/publicCoachApi';
const ev={meaning:'relevant',sentenceComplete:true,feedbackKo:'뜻을 잘 전달했어요.',modelAnswerEn:'My name is Alex.'};
const response=()=>new Response(JSON.stringify({success:true,evaluation:ev}));
afterEach(()=>vi.useRealTimers());
it('only sends adult learner final text to the same-origin coach route',async()=>{
 const fetchFn=vi.fn().mockResolvedValue(response()); const api=new PublicCoachApiClient(fetchFn);
 await expect(api.evaluate('name','Alex.',false)).rejects.toThrow(/18/); expect(fetchFn).not.toHaveBeenCalled();
 await expect(api.evaluate('name',' My name is Alex. ',true)).resolves.toEqual(ev);
 const [url,init]=fetchFn.mock.calls[0]; expect(url).toBe('/api/conversation/coach');
 expect(init).toMatchObject({credentials:'same-origin',redirect:'error',cache:'no-store'});
 expect(JSON.parse(init.body)).toMatchObject({adultConfirmed:true,answer:'My name is Alex.'});
 expect(JSON.parse(init.body)).not.toHaveProperty('transcriptConfirmed');
});
it('rejects invalid English-only feedback and never retries provider failures',async()=>{
 const fetchFn=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({success:true,evaluation:{...ev,feedbackKo:'Good.'}}))).mockResolvedValueOnce(new Response('',{status:429}));
 const api=new PublicCoachApiClient(fetchFn); await expect(api.evaluate('name','Alex.',true)).rejects.toThrow();
 await expect(api.evaluate('name','Alex.',true)).rejects.toThrow(/한도/); expect(fetchFn).toHaveBeenCalledTimes(2);
});
it('actually bounds a streaming response before EOF',async()=>{
 let canceled=false; const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(16385));},cancel(){canceled=true;}});
 const api=new PublicCoachApiClient(vi.fn().mockResolvedValue(new Response(body)));
 let rejected=false; void api.evaluate('name','Alex.',true).catch(()=>{rejected=true;});
 for(let i=0;i<100;i++) await Promise.resolve();
 expect(rejected).toBe(true);expect(canceled).toBe(true);api.cancel();
});
it('settles on the deadline even if fetch ignores its AbortSignal',async()=>{
 vi.useFakeTimers();const api=new PublicCoachApiClient(vi.fn().mockImplementation(()=>new Promise(()=>{})));
 let error=''; void api.evaluate('name','Alex.',true).catch(e=>{error=e.message;});
 await vi.advanceTimersByTimeAsync(25001); expect(error).toMatch(/초과/);api.cancel();
});
