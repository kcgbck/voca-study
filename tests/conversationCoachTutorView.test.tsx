import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import React from 'react';
const h=vi.hoisted(()=>({
  states:[] as any[],
  refs:[] as any[],
  s:0,
  r:0,
  effect:false,
  cleanup:undefined as any,
  listeners:{} as Record<string,()=>void>,
  speak:vi.fn(),
  listen:vi.fn(),
  eval:vi.fn(),
  cancelInput:vi.fn(),
  cancelOutput:vi.fn(),
  cancelApi:vi.fn(),
  supported:true,
  moonshineReady:false,
  moonshinePrepare:vi.fn(),
  moonshineDispose:vi.fn(),
}));
vi.mock('react',async original=>({...await original<any>(),
 useState:(initial:any)=>{const i=h.s++;if(!(i in h.states)) h.states[i]=typeof initial==='function'?initial():initial;return [h.states[i],(v:any)=>{h.states[i]=typeof v==='function'?v(h.states[i]):v;}];},
 useRef:(initial:any)=>{const i=h.r++;return h.refs[i]??(h.refs[i]={current:initial});},useCallback:(fn:any)=>fn,
 useEffect:(fn:any)=>{if(!h.effect){h.effect=true;h.cleanup=fn();}},
}));
vi.mock('../src/features/conversation/services/browserSpeechInput',()=>({
  BrowserSpeechInputService:class{
    start=h.listen;
    cancel=h.cancelInput;
    isSupported(){return h.supported;}
  }
}));
vi.mock('../src/features/conversation/moonshine/moonshineSpeechInput',()=>({
  MoonshineSpeechInputService:class{
    static readonly ENGINE_NAME = 'Moonshine' as const;
    static readonly MODEL_ARCH = 'SmallStreaming' as const;
    static readonly SDK_VERSION = '0.1.5' as const;
    static readonly CATALOG_REVISION = 'quantized_26_07_30' as const;
    static readonly ESTIMATED_DOWNLOAD_BYTES = 165489086 as const;
    engineName = 'Moonshine';
    modelArch = 'SmallStreaming';
    sdkVersion = '0.1.5';
    catalogRevision = 'quantized_26_07_30';
    start=h.listen;
    cancel=h.cancelInput;
    dispose=h.moonshineDispose;
    prepare=h.moonshinePrepare;
    isReady(){return h.moonshineReady;}
    isSupported(){return h.supported;}
  }
}));
vi.mock('../src/features/conversation/services/voiceOutput',()=>({VoiceOutputService:class{speak=h.speak;cancel=h.cancelOutput;}}));
vi.mock('../src/features/conversation/coach/publicCoachApi',()=>({PublicCoachApiClient:class{evaluate=h.eval;cancel=h.cancelApi;}}));
import {CoachBudgetError,CAFE_QUESTIONS} from '../src/features/conversation/coach/coachProtocol';
import {CoachTutorView} from '../src/features/conversation/components/CoachTutorView';
import {COACH_DIAGNOSTICS_KEY} from '../src/features/conversation/coach/coachDiagnostics';
const render=()=>{h.s=h.r=0;return CoachTutorView({onBack:vi.fn()});};
function nodes(t:any):any[]{return t&&typeof t==='object'?[t,...React.Children.toArray(t.props?.children).flatMap(nodes)]:[];}
function text(t:any):string{return typeof t==='string'||typeof t==='number'?String(t):Array.isArray(t)?t.map(text).join(''):t?.props?text(t.props.children):'';}
const button=(t:any,label:string)=>nodes(t).find(n=>n.type==='button'&&text(n).includes(label));
const checkbox=()=>nodes(render()).find(n=>n.type==='input'&&n.props.type==='checkbox');
const agree=()=>checkbox().props.onChange({target:{checked:true}});
const flush=async()=>{for(let i=0;i<150;i++) await Promise.resolve();};
beforeEach(()=>{vi.useFakeTimers();vi.resetAllMocks();h.states=[];h.refs=[];h.effect=false;h.listeners={};h.cleanup=undefined;h.supported=true;h.moonshineReady=false;
 const target={location:{search:''},hidden:false,addEventListener:(name:string,fn:any)=>{h.listeners[name]=fn;},removeEventListener:vi.fn()};vi.stubGlobal('window',target);vi.stubGlobal('document',target);vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn()});
 h.speak.mockResolvedValue({success:true});let answers=['I would like coffee, please.','I would like coffee, please.'];h.listen.mockImplementation(async()=>answers.shift()??'');
 h.eval.mockResolvedValue({meaning:'relevant',sentenceComplete:true,feedbackKo:'뜻을 정확히 전달했어요.',modelAnswerEn:'I would like coffee, please.',nextQuestionId:'cafe_temp'});
 h.moonshinePrepare.mockImplementation(async()=>{h.moonshineReady=true;});
});
afterEach(()=>{h.cleanup?.();vi.useRealTimers();vi.unstubAllGlobals();});
it('has only one adult checkbox and no login or legacy settings',()=>{
 const t=render();expect(nodes(t).filter(n=>n.type==='input'&&n.props.type==='checkbox')).toHaveLength(1);
 expect(button(t,'확인 후 시작').props.disabled).toBe(true);expect(text(t)).not.toMatch(/로그인|128목차|영어 음성팩|시험 참여/);
});
it('connects Korean guidance, English listening, direct evaluation and repeat, then waits for Next',async()=>{
 render();agree();button(render(),'코칭 시작').props.onClick();await flush();
 expect(h.listen.mock.calls.map(c=>c[0])).toEqual(['en-US','en-US']);expect(h.eval).toHaveBeenCalledOnce();
 expect(h.speak.mock.calls.some(c=>c[1].lang==='ko-KR')).toBe(true);expect(text(render())).toContain('뜻을 정확히 전달했어요.');
 expect(button(render(),'다음 질문으로')).toBeDefined();expect(text(render())).toContain('1 / 1 회 완료');
 const count=h.speak.mock.calls.length;await vi.advanceTimersByTimeAsync(60000);expect(h.speak).toHaveBeenCalledTimes(count);
});
it('does not listen when the real voice service reports failure',async()=>{
 render();h.speak.mockResolvedValue({success:false});agree();button(render(),'코칭 시작').props.onClick();await flush();
 expect(h.listen).not.toHaveBeenCalled();expect(h.eval).not.toHaveBeenCalled();expect(text(render())).toContain('실패');
});
it('shows the native transcript beside a recovered candidate without a confirmation step or raw reuse',async()=>{
 h.listen.mockImplementation(async(_lang:string,options:any)=>{options?.onAlternatives?.(['couple please','I would like coffee, please.']);return 'couple please';});
 h.eval.mockResolvedValue({meaning:'relevant',sentenceComplete:true,feedbackKo:'원하는 음료를 잘 말씀하셨어요.',modelAnswerEn:'I would like coffee, please.',recognizedCandidateIndex:1,nextQuestionId:'cafe_temp'});
 render();agree();button(render(),'코칭 시작').props.onClick();await flush();
 const display=text(render());expect(display).toContain('couple please');expect(display).toContain('문맥으로 이해한 답변');expect(display).toContain('I would like coffee, please.');expect(display).not.toMatch(/맞나요|아니요/);
 expect(h.eval).toHaveBeenCalledTimes(2);expect(h.eval.mock.calls.every(c=>c[3]?.candidates?.[0]==='couple please')).toBe(true);expect(display).toContain('1 / 1 회 완료');
});
it('pagehide cancels pending microphone and API',async()=>{
 render();h.listen.mockImplementation(()=>new Promise(()=>{}));agree();button(render(),'코칭 시작').props.onClick();await vi.advanceTimersByTimeAsync(10000);await flush();
 const count=h.cancelInput.mock.calls.length;h.listeners.pagehide();await flush();expect(h.cancelInput.mock.calls.length).toBeGreaterThan(count);expect(text(render())).toContain('일시정지');expect(h.eval).not.toHaveBeenCalled();
});
it('unsupported voice still explains Chrome and leaves text learning available',()=>{
 h.supported=false;render();const t=render();expect(text(t)).toContain('Chrome');expect(text(t)).toContain('텍스트');
});

it('shows microphone readiness and live unconfirmed words without requesting AI evaluation',async()=>{
 render();h.listen.mockImplementation((_lang:string,options:any)=>{options?.onReady?.();options?.onPartial?.('I would like a tea.');return new Promise(()=>{});});
 agree();button(render(),'코칭 시작').props.onClick();await flush();
 expect(text(render())).toContain('I would like a tea.');expect(text(render())).toMatch(/확정|인식 중/);expect(h.eval).not.toHaveBeenCalled();
 h.listeners.pagehide();await flush();
});

it('normal learning has no speech diagnostic collection or additional settings',async()=>{
 render();agree();h.listen.mockImplementation(()=>new Promise(()=>{}));button(render(),'코칭 시작').props.onClick();await flush();expect(h.listen.mock.calls[0][1]?.onTrace).toBeUndefined();expect(text(render())).not.toContain('음성 진단 결과');h.listeners.pagehide();await flush();
});
it('explicit speech-debug link no longer mounts legacy native trace UI in canonical Moonshine mode',async()=>{
 (window as any).location={search:'?speech-debug=1'};render();expect(text(render())).not.toContain('음성 진단 결과');expect(text(render())).not.toContain('paced-coach-10s-v9');
});

it('hides adult confirmation immediately after saving and restores it on a fresh mount',()=>{
 const saved=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>saved.get(k)??null,setItem:(k:string,v:string)=>{saved.set(k,v);}});
 render();expect(checkbox()).toBeDefined();agree();expect(checkbox()).toBeUndefined();expect(text(render())).not.toContain('성인 사용자 본인 확인');
 h.cleanup?.();h.states=[];h.refs=[];h.effect=false;render();expect(checkbox()).toBeUndefined();expect(button(render(),'코칭 시작').props.disabled).toBe(false);
 expect(saved.size).toBe(1);expect([...saved.keys()][0]).toMatch(/^coach_adult_confirmed_/);
});
it('storage read failure never bypasses the adult gate',()=>{
 vi.stubGlobal('localStorage',{getItem:()=>{throw new Error('unavailable');},setItem:vi.fn()});const t=render();expect(checkbox()).toBeDefined();expect(button(t,'확인 후 시작').props.disabled).toBe(true);
});
it('does not display or speak transcript confirmation instructions anywhere in normal coaching',async()=>{
 render();agree();button(render(),'코칭 시작').props.onClick();await flush();expect(text(render())).not.toMatch(/맞나요|아니요|다른 인식 후보|말씀해 주세요.*네/);
 expect(h.speak.mock.calls.some(c=>/맞나요|아니요|인식 후보/.test(c[0]))).toBe(false);expect(h.listen.mock.calls.every(c=>c[0]==='en-US')).toBe(true);
});

it('waiting displays a countdown, disables typing/submission and pagehide cancels pending retry',async()=>{
 render();agree();button(render(),'키보드 직접 입력').props.onClick();h.eval.mockRejectedValueOnce(new CoachBudgetError('잠시 후 이어갑니다.','COACH_MINUTE_LIMIT',5));button(render(),'코칭 시작').props.onClick();await flush();
 expect(text(render())).toContain('5초');expect(button(render(),'일시정지')).toBeDefined();expect(nodes(render()).find(n=>n.type==='input'&&n.props.type==='text').props.disabled).toBe(true);expect(button(render(),'제출').props.disabled).toBe(true);
 await vi.advanceTimersByTimeAsync(1000);await flush();expect(text(render())).toContain('4초');h.listeners.pagehide();await flush();await vi.advanceTimersByTimeAsync(10000);expect(h.eval).toHaveBeenCalledOnce();expect(text(render())).toContain('일시정지');
});
it('component unmount while waiting prevents background model retries',async()=>{
 render();agree();h.eval.mockRejectedValueOnce(new CoachBudgetError('잠시 후 이어갑니다.','COACH_MINUTE_LIMIT',5));button(render(),'코칭 시작').props.onClick();await flush();h.cleanup();h.cleanup=undefined;await vi.advanceTimersByTimeAsync(10000);expect(h.eval).toHaveBeenCalledOnce();
});

const typeAnswer=(answer:string)=>nodes(render()).find(n=>n.type==='input'&&n.props.type==='text').props.onChange({target:{value:answer}});
const submitAnswer=async(answer:string)=>{typeAnswer(answer);nodes(render()).find(n=>n.type==='form').props.onSubmit({preventDefault:vi.fn()});await flush();};
it('switching to text before Start preserves the draft and cannot silently submit it',async()=>{
 render();agree();button(render(),'텍스트 모드로 전환').props.onClick();typeAnswer('I would like coffee, please.');
 expect(button(render(),'제출').props.disabled).toBe(true);nodes(render()).find(n=>n.type==='form').props.onSubmit({preventDefault:vi.fn()});await flush();
 expect(nodes(render()).find(n=>n.type==='input'&&n.props.type==='text').props.value).toBe('I would like coffee, please.');expect(h.eval).not.toHaveBeenCalled();expect(h.listen).not.toHaveBeenCalled();expect(h.speak).not.toHaveBeenCalled();
});
it('text learning waits for typing without microphone deadlines or false silence after a minute',async()=>{
 render();agree();button(render(),'텍스트 모드로 전환').props.onClick();const start=button(render(),'코칭 시작')??button(render(),'다시 시작');start.props.onClick();await flush();
 await vi.advanceTimersByTimeAsync(60000);await flush();expect(h.eval).not.toHaveBeenCalled();expect(h.listen).not.toHaveBeenCalled();expect(h.speak).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 expect(text(render())).not.toMatch(/마이크 준비 중|10초 동안|감지하지 못|듣지 못|예문으로 연습을 시작/);expect(text(render())).toContain('텍스트');
 await submitAnswer('I would like coffee, please.');expect(h.eval).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(60000);await flush();expect(h.eval).toHaveBeenCalledOnce();expect(text(render())).toContain('0 / 1 회 완료');expect(text(render())).not.toMatch(/감지하지 못|듣지 못/);expect(vi.getTimerCount()).toBe(0);
 await submitAnswer('I would like coffee, please.');expect(h.eval).toHaveBeenCalledOnce();expect(text(render())).toContain('1 / 1 회 완료');expect(button(render(),'다음 질문으로')).toBeDefined();expect(h.listen).not.toHaveBeenCalled();expect(h.speak).not.toHaveBeenCalled();
});
it('typed incomplete answers require two complete repetitions with the second exact answer reused',async()=>{
 render();agree();button(render(),'텍스트 모드로 전환').props.onClick();(button(render(),'코칭 시작')??button(render(),'다시 시작')).props.onClick();await flush();
 h.eval.mockResolvedValueOnce({meaning:'relevant',sentenceComplete:false,feedbackKo:'완전한 문장으로 말해보세요.',modelAnswerEn:'I would like coffee, please.',nextQuestionId:'cafe_temp'});
 await submitAnswer('Coffee.');expect(text(render())).toContain('0 / 2 회 완료');await submitAnswer('I would like coffee, please.');expect(text(render())).toContain('1 / 2 회 완료');expect(button(render(),'다음 질문으로')).toBeUndefined();
 await submitAnswer('I would like coffee, please.');expect(text(render())).toContain('2 / 2 회 완료');expect(h.eval).toHaveBeenCalledTimes(2);expect(button(render(),'다음 질문으로')).toBeDefined();
});
it('five typed questions advance only on Next and end without background microphone or evaluation',async()=>{
 render();agree();button(render(),'텍스트 모드로 전환').props.onClick();(button(render(),'코칭 시작')??button(render(),'다시 시작')).props.onClick();await flush();
 for(const [i,q] of CAFE_QUESTIONS.entries()){
  expect(text(render())).toContain(q.questionEn);
  const nextId = q.allowedNextQuestionIds[0];
  h.eval.mockResolvedValue({meaning:'relevant',sentenceComplete:true,feedbackKo:'좋습니다.',modelAnswerEn:q.exampleAnswerEn,nextQuestionId:nextId});
  await submitAnswer(q.exampleAnswerEn);await submitAnswer(q.exampleAnswerEn);expect(h.eval).toHaveBeenCalledTimes(i+1);
  await vi.advanceTimersByTimeAsync(60000);expect(h.eval).toHaveBeenCalledTimes(i+1);
  const nextBtn = button(render(),'다음 질문으로') ?? button(render(),'주문 마치기');
  expect(nextBtn).toBeDefined();nextBtn.props.onClick();await flush();
 }
 expect(text(render())).toContain('오늘 주문 연습을 마쳤어요');expect(button(render(),'진단 기록 복사').props.disabled).toBe(false);expect(h.eval.mock.calls.map(c=>c[0])).toEqual(CAFE_QUESTIONS.map(q=>q.id));expect(h.listen).not.toHaveBeenCalled();expect(h.speak).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it('hiding the page during text waiting cancels cleanly without a later timeout or evaluation',async()=>{
 render();agree();button(render(),'텍스트 모드로 전환').props.onClick();(button(render(),'코칭 시작')??button(render(),'다시 시작')).props.onClick();await flush();h.listeners.pagehide();await flush();await vi.advanceTimersByTimeAsync(180000);
 expect(text(render())).toContain('일시정지');expect(text(render())).not.toMatch(/감지하지 못|듣지 못/);expect(h.eval).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});

function diagnosticDisk(){const data=new Map<string,string>([['word-data','keep']]);const disk={getItem:vi.fn((k:string)=>data.get(k)??null),setItem:vi.fn((k:string,v:string)=>{data.set(k,v);}),removeItem:vi.fn((k:string)=>{data.delete(k);})};vi.stubGlobal('localStorage',disk);(window as any).localStorage=disk;return{data,disk};}
it('normal canonical coaching exposes a collapsed local report and copies only on an explicit click',async()=>{
 diagnosticDisk();const writeText=vi.fn().mockResolvedValue(undefined);vi.stubGlobal('navigator',{clipboard:{writeText}});render();expect(button(render(),'진단 기록 복사').props.disabled).toBe(true);agree();button(render(),'코칭 시작').props.onClick();await flush();
 const tree=render();const summary=nodes(tree).find(n=>n.type==='summary'&&text(n).includes('인식'));expect(summary).toBeDefined();const panel=nodes(tree).find(n=>n.type==='details'&&text(n).includes('인식·평가 기록'));expect(panel.props.open).not.toBe(true);
 expect(writeText).not.toHaveBeenCalled();expect(h.eval).toHaveBeenCalledOnce();expect(h.listen).toHaveBeenCalledTimes(2);await button(tree,'진단 기록 복사').props.onClick();await flush();expect(writeText).toHaveBeenCalledOnce();const report=writeText.mock.calls[0][0];for(const term of ['coach-report-v1',CAFE_QUESTIONS[0].questionEn,'I would like coffee, please.'])expect(report).toContain(term);expect(report).toMatch(/재사용/);expect(report).toMatch(/초기|첫/);expect(report).toMatch(/반복/);
 h.cleanup?.();h.states=[];h.refs=[];h.effect=false;render();await button(render(),'진단 기록 복사').props.onClick();expect(writeText.mock.calls[1][0]).toContain('I would like coffee, please.');expect(h.eval).toHaveBeenCalledOnce();
});
it('intended-utterance notes stay local, preserve the raw transcript and never trigger another evaluation',async()=>{
 diagnosticDisk();const writeText=vi.fn().mockResolvedValue(undefined);vi.stubGlobal('navigator',{clipboard:{writeText}});render();agree();button(render(),'코칭 시작').props.onClick();await flush();const tree=render();const editor=nodes(tree).find(n=>n.type==='textarea'&&!n.props.readOnly);expect(editor).toBeDefined();expect(editor.props.maxLength).toBe(500);editor.props.onChange({target:{value:'I actually said tea.'}});await flush();await button(render(),'진단 기록 복사').props.onClick();const report=writeText.mock.calls[0][0];expect(report).toContain('I actually said tea.');expect(report).toContain('I would like coffee, please.');expect(h.eval).toHaveBeenCalledOnce();expect(h.listen).toHaveBeenCalledTimes(2);
});
it('clears only diagnostics after pausing and disables clear during active learning',async()=>{
 const {data}=diagnosticDisk();render();agree();button(render(),'코칭 시작').props.onClick();await flush();expect(data.has(COACH_DIAGNOSTICS_KEY)).toBe(true);h.listen.mockImplementation(()=>new Promise(()=>{}));button(render(),'다음 질문으로').props.onClick();await flush();expect(button(render(),'진단 기록 지우기').props.disabled).toBe(true);h.listeners.pagehide();await flush();expect(button(render(),'진단 기록 지우기').props.disabled).toBe(false);await button(render(),'진단 기록 지우기').props.onClick();await flush();expect(button(render(),'진단 기록 복사').props.disabled).toBe(true);expect(data.get('word-data')).toBe('keep');expect([...data.keys()].some(k=>k.startsWith('coach_adult_confirmed_'))).toBe(true);expect(h.eval).toHaveBeenCalledOnce();
});
it.each(['denied','unsupported'])('offers a readable manual report when clipboard is %s, without false success',async mode=>{
 diagnosticDisk();vi.stubGlobal('navigator',mode==='denied'?{clipboard:{writeText:vi.fn().mockRejectedValue(new Error('denied'))}}:{});render();agree();button(render(),'코칭 시작').props.onClick();await flush();await button(render(),'진단 기록 복사').props.onClick();await flush();const t=render();const manual=nodes(t).find(n=>n.type==='textarea'&&n.props.readOnly);expect(manual).toBeDefined();expect(manual.props.value).toContain('coach-report-v1');expect(manual.props.value).toContain('I would like coffee, please.');expect(text(t)).not.toContain('클립보드에 복사했습니다.');expect(h.eval).toHaveBeenCalledOnce();
});
it('invalidates a stale manual report after the user annotates an utterance',async()=>{
 diagnosticDisk();vi.stubGlobal('navigator',{});render();agree();button(render(),'코칭 시작').props.onClick();await flush();await button(render(),'진단 기록 복사').props.onClick();await flush();expect(nodes(render()).some(n=>n.type==='textarea'&&n.props.readOnly)).toBe(true);
 const editor=nodes(render()).find(n=>n.type==='textarea'&&!n.props.readOnly);editor.props.onChange({target:{value:'I actually said tea.'}});expect(nodes(render()).some(n=>n.type==='textarea'&&n.props.readOnly)).toBe(false);await button(render(),'진단 기록 복사').props.onClick();await flush();expect(nodes(render()).find(n=>n.type==='textarea'&&n.props.readOnly).props.value).toContain('I actually said tea.');expect(h.eval).toHaveBeenCalledOnce();
});
it('never labels a candidate as AI-selected when evaluation returned an error',async()=>{
 diagnosticDisk();h.listen.mockImplementation(async(_l,o)=>{o?.onAlternatives?.(['couple please','I would like coffee, please.']);return 'couple please';});h.eval.mockRejectedValue(new Error('service unavailable'));render();agree();button(render(),'코칭 시작').props.onClick();await flush();expect(text(render())).toContain('couple please');expect(text(render())).not.toMatch(/← 채택/);expect(h.eval).toHaveBeenCalledOnce();
});
it('blocks coaching synchronously when the Whisper comparison claims the microphone',async()=>{
 render();agree();
 const n=render();
 const startBtn=button(n,'코칭 시작');
 const panel=nodes(n).find(x=>typeof x.props?.onBusyChange==='function'&&'coachingActive' in x.props);
 expect(panel).toBeTruthy();
 panel.props.onBusyChange(true);
 startBtn.props.onClick();
 await flush();
 expect(h.speak).not.toHaveBeenCalled();
 expect(h.listen).not.toHaveBeenCalled();
 expect(h.eval).not.toHaveBeenCalled();
 expect(button(render(),'코칭 시작')).toBeUndefined();
});
it('marks active coaching so the comparison cannot start a competing microphone',async()=>{h.listen.mockImplementation(()=>new Promise(()=>{}));render();agree();button(render(),'코칭 시작').props.onClick();await flush();const panel=nodes(render()).find(x=>typeof x.props?.onBusyChange==='function'&&'coachingActive' in x.props);expect(panel.props.coachingActive).toBe(true);});

it('prepares Moonshine model before speaking and listening',async()=>{
 render();agree();
 expect(text(render())).toContain('Moonshine v2 / 영어 Small Streaming');
 expect(h.moonshinePrepare).not.toHaveBeenCalled();
 button(render(),'코칭 시작').props.onClick();
 await flush();
 expect(h.moonshinePrepare).toHaveBeenCalledOnce();
 expect(h.speak).toHaveBeenCalled();
 expect(h.listen).toHaveBeenCalled();
});

it('text mode skips Moonshine preparation entirely',async()=>{
 render();agree();
 button(render(),'텍스트 모드로 전환').props.onClick();
 (button(render(),'코칭 시작')??button(render(),'다시 시작')).props.onClick();
 await flush();
 expect(h.moonshinePrepare).not.toHaveBeenCalled();
});

it('double click on start does not trigger duplicate prepare calls',async()=>{
 render();agree();
 let release: () => void = () => {};
 h.moonshinePrepare.mockImplementation(()=>new Promise<void>(resolve=>{release=resolve;}));
 const startBtn = button(render(),'코칭 시작');
 startBtn.props.onClick();
 startBtn.props.onClick();
 await flush();
 expect(h.moonshinePrepare).toHaveBeenCalledOnce();
 release();
 await flush();
});

it('pausing or pagehide during prepare cancels pending prepare without late start',async()=>{
 render();agree();
 let release: () => void = () => {};
 h.moonshinePrepare.mockImplementation(()=>new Promise<void>(resolve=>{release=resolve;}));
 button(render(),'코칭 시작').props.onClick();
 await flush();
 expect(button(render(),'다운로드 취소')).toBeDefined();
 h.listeners.pagehide();
 await flush();
 expect(h.cancelInput).toHaveBeenCalled();
 release();
 await flush();
 expect(h.speak).not.toHaveBeenCalled();
 expect(h.listen).not.toHaveBeenCalled();
});

it('unmounting while prepare is pending cancels and prevents late start',async()=>{
 render();agree();
 let release: () => void = () => {};
 h.moonshinePrepare.mockImplementation(()=>new Promise<void>(resolve=>{release=resolve;}));
 button(render(),'코칭 시작').props.onClick();
 await flush();
 h.cleanup?.();
 h.cleanup = undefined;
 release();
 await flush();
 expect(h.moonshineDispose).toHaveBeenCalled();
 expect(h.speak).not.toHaveBeenCalled();
 expect(h.listen).not.toHaveBeenCalled();
});

it('failed prepare shows retry and text options and retry re-prepares',async()=>{
 render();agree();
 h.moonshinePrepare.mockRejectedValueOnce(new Error('Network download error'));
 button(render(),'코칭 시작').props.onClick();
 await flush();
 expect(text(render())).toContain('음성 모델을 준비하지 못했습니다');
 expect(text(render())).not.toContain('Network download error');
 expect(button(render(),'다시 시도')).toBeDefined();
 expect(button(render(),'텍스트 모드로 전환')).toBeDefined();
 expect(h.speak).not.toHaveBeenCalled();

 h.moonshinePrepare.mockImplementationOnce(async()=>{h.moonshineReady=true;});
 button(render(),'다시 시도').props.onClick();
 await flush();
 expect(h.moonshinePrepare).toHaveBeenCalledTimes(2);
 expect(h.speak).toHaveBeenCalled();
});

it('Next question routes through prepare gate and reuses idle prepared model',async()=>{
 render();agree();
 button(render(),'코칭 시작').props.onClick();
 await flush();
 expect(h.moonshinePrepare).toHaveBeenCalledOnce();
 expect(button(render(),'다음 질문으로')).toBeDefined();

 button(render(),'다음 질문으로').props.onClick();
 await flush();
 expect(h.moonshinePrepare).toHaveBeenCalledOnce(); // Reused without re-preparing
});

it('annotates diagnostics with Moonshine engine metadata on voice and text engine on text',async()=>{
 render();agree();
 button(render(),'코칭 시작').props.onClick();
 await flush();
 const voiceBtn = button(render(),'진단 기록 복사');
 expect(voiceBtn.props.disabled).toBe(false);
 const diagRecords = nodes(render()).filter(n=>n.type==='details'&&text(n).includes('원본 인식'));
 expect(diagRecords.length).toBeGreaterThan(0);
 expect(text(diagRecords[0])).toContain('Moonshine');
 expect(text(diagRecords[0])).toContain('SmallStreaming');

 // Switch to text mode and submit text answer
 button(render(),'텍스트 모드로 전환').props.onClick();
 (button(render(),'다시 시작')??button(render(),'코칭 시작')).props.onClick();
 await flush();
 await submitAnswer('I would like coffee, please.');
 const updatedDiagRecords = nodes(render()).filter(n=>n.type==='details'&&text(n).includes('원본 인식'));
 expect(updatedDiagRecords.length).toBeGreaterThan(1);
 expect(text(updatedDiagRecords[0])).toContain('text');
});
