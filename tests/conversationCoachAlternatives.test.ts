import {expect,it,vi} from 'vitest';
import {CoachTutorController} from '../src/features/conversation/coach/CoachTutorController';
import {BrowserSpeechInputService} from '../src/features/conversation/services/browserSpeechInput';
import {COACH_QUESTIONS} from '../src/features/conversation/coach/coachProtocol';
const good={meaning:'relevant' as const,sentenceComplete:true,feedbackKo:'뜻이 잘 전달됐어요.',modelAnswerEn:'My name is Alex.'};
const flush=async()=>{for(let i=0;i<160;i++)await Promise.resolve();};
function setup(groups:string[][]){const states:any[]=[];let english=0;const speak=vi.fn().mockResolvedValue(true);const evaluate=vi.fn().mockResolvedValue(good);const cancel=vi.fn();const listen=vi.fn(async(lang:string,options:any)=>{if(lang!=='en-US')throw new Error('Unexpected confirmation microphone');const choices=groups[english++]??['unheard'];options?.onAlternatives?.(choices);return choices[0];});const controller=new CoachTutorController({speak,listen,evaluate,cancel,emit:s=>states.push(structuredClone(s))});return{controller,speak,listen,evaluate,states};}
it('directly evaluates native top one without asking to select another candidate',async()=>{
 const h=setup([['My name is Alexa.','My name is Alex.'],['My name is Alexa.']]);await h.controller.start(COACH_QUESTIONS[0]);expect(h.evaluate.mock.calls.map(c=>c[1])).toEqual(['My name is Alexa.']);expect(h.listen.mock.calls.map(c=>c[0])).toEqual(['en-US','en-US']);expect(h.states.at(-1).phase).toBe('complete');expect(h.speak.mock.calls.some(c=>/맞나요|아니요|인식 후보/.test(c[0]))).toBe(false);
});
it('never chooses the correct lesson candidate when top one is unintelligible',async()=>{
 const h=setup([['might aim axle','My name is Alex.']]);h.evaluate.mockResolvedValue({...good,meaning:'uncertain',sentenceComplete:false});await h.controller.start(COACH_QUESTIONS[0]);expect(h.evaluate).toHaveBeenCalledExactlyOnceWith('name','might aim axle');expect(h.states.at(-1)).toMatchObject({phase:'paused',practiceDone:0});
});
it('single candidate engines complete without an extra capture or fabricated alternative',async()=>{
 const h=setup([['My name is Alex.'],['My name is Alex.']]);await h.controller.start(COACH_QUESTIONS[0]);expect(h.evaluate).toHaveBeenCalledOnce();expect(h.listen).toHaveBeenCalledTimes(2);expect(h.states.at(-1).phase).toBe('complete');
});
it('practice also grades top one rather than a convenient native alternative',async()=>{
 const h=setup([['My name is Alex.'],['different words','My name is Alex.']]);h.evaluate.mockResolvedValueOnce(good).mockResolvedValue({...good,meaning:'uncertain',sentenceComplete:false});await h.controller.start(COACH_QUESTIONS[0]);expect(h.evaluate.mock.calls.map(c=>c[1])).toEqual(['My name is Alex.','different words']);expect(h.states.at(-1)).toMatchObject({phase:'paused',practiceDone:0});
});
it('does not let alternative callbacks trigger grading before the final result settles',async()=>{
 const h=setup([]);h.listen.mockImplementation(async(_lang,options)=>{options?.onAlternatives?.(['My name is Alex.']);return new Promise<string>(()=>{});});const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();expect(h.evaluate).not.toHaveBeenCalled();h.controller.pause();await pending;
});
it('late English results after pause cannot trigger evaluation',async()=>{
 const h=setup([]);let resolveLate!:(s:string)=>void;h.listen.mockImplementation(()=>new Promise<string>(resolve=>{resolveLate=resolve;}));const pending=h.controller.start(COACH_QUESTIONS[0]);await flush();h.controller.pause();resolveLate('My name is Alex.');await pending;expect(h.evaluate).not.toHaveBeenCalled();expect(h.states.at(-1).phase).toBe('paused');
});
it('short coffee answer gets feedback and two practices with one approved-repeat reuse without confirmation',async()=>{
 const h=setup([['Coffee, please.','Copy please.'],["I'd like a coffee, please."],["I'd like a coffee, please."]]);h.evaluate.mockResolvedValueOnce({...good,sentenceComplete:false,feedbackKo:'커피를 원한다는 뜻이 잘 전달됐어요. 완전한 문장으로 연습해 봐요.',modelAnswerEn:"I'd like a coffee, please."});await h.controller.start(COACH_QUESTIONS[2]);expect(h.evaluate.mock.calls[0]).toEqual(['cafe','Coffee, please.']);expect(h.evaluate).toHaveBeenCalledTimes(2);expect(h.listen).toHaveBeenCalledTimes(3);expect(h.states.at(-1)).toMatchObject({phase:'complete',practiceDone:2});
});
it('failed Korean feedback stops before a practice microphone and preserves error',async()=>{
 const h=setup([['My name is Alex.']]);h.speak.mockImplementation(async(text:string)=>text!==good.feedbackKo);await h.controller.start(COACH_QUESTIONS[0]);expect(h.evaluate).toHaveBeenCalledOnce();expect(h.listen).toHaveBeenCalledOnce();expect(h.states.at(-1).phase).toBe('error');
});
it('wires the real capture service directly to evaluation using two English sessions only',async()=>{
 vi.useFakeTimers();const instances:any[]=[];class Native{continuous=false;interimResults=false;maxAlternatives=1;lang='';onstart:any;onresult:any;onend:any;onerror:any;start=vi.fn();stop=vi.fn();abort=vi.fn();constructor(){instances.push(this);}}
 const input=new BrowserSpeechInputService(Native);const states:any[]=[];const evaluate=vi.fn().mockResolvedValue(good);const controller=new CoachTutorController({speak:async()=>true,listen:(lang,options)=>input.start(lang,options),evaluate,cancel:()=>input.cancel(),emit:s=>states.push(structuredClone(s))});
 const deliver=(rec:any,texts:string[])=>rec.onresult({resultIndex:0,results:[Object.assign(texts.map(transcript=>({transcript,confidence:0})),{isFinal:true})]});
 try{const pending=controller.start(COACH_QUESTIONS[0]);await flush();instances[0].onstart();deliver(instances[0],['My name is Alexa.','My name is Alex.']);expect(evaluate).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(10000);instances[0].onend();await flush();expect(evaluate.mock.calls[0]).toEqual(['name','My name is Alexa.']);instances[1].onstart();deliver(instances[1],['My name is Alexa.']);await vi.advanceTimersByTimeAsync(10000);instances[1].onend();await pending;expect(evaluate).toHaveBeenCalledOnce();expect(instances).toHaveLength(2);expect(instances.every(r=>r.lang==='en-US'&&!r.continuous)).toBe(true);expect(states.at(-1)).toMatchObject({phase:'complete',practiceDone:1});expect(vi.getTimerCount()).toBe(0);}finally{controller.pause();vi.useRealTimers();}
});
