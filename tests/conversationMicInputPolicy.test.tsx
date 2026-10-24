import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import React from 'react';
import {CONVERSATION_POLICY_VERSION} from '../src/features/conversation/types';
const h=vi.hoisted(()=>({states:[] as any[],refs:[] as any[],s:0,r:0,cleanup:null as any,effect:false,
  localStart:vi.fn(),localStop:vi.fn(),localCancel:vi.fn(),cloudStart:vi.fn(),cloudStop:vi.fn(),cloudCancel:vi.fn(),transcribe:vi.fn(),received:vi.fn(),install:vi.fn()}));
vi.mock('react',async original=>{const real=await original<any>();return {...real,
  useState:(initial:any)=>{const i=h.s++;if(!(i in h.states))h.states[i]=initial;return[h.states[i],(next:any)=>{h.states[i]=typeof next==='function'?next(h.states[i]):next;}];},
  useRef:(initial:any)=>{const i=h.r++;return h.refs[i]??(h.refs[i]={current:initial});},
  useEffect:(fn:any)=>{if(!h.effect){h.effect=true;h.cleanup=fn();}}};});
vi.mock('../src/features/conversation/services/localSpeechInput',()=>({localSpeechInput:{start:h.localStart,stop:h.localStop,cancel:h.localCancel}}));
const cloud=vi.hoisted(()=>({startRecording:h.cloudStart,stopRecording:h.cloudStop,cancelRecording:h.cloudCancel,onAutoStop:undefined as any}));
vi.mock('../src/features/conversation/services/voiceInput',()=>({voiceInput:cloud}));
vi.mock('../src/features/conversation/services/conversationApi',()=>({conversationApi:{transcribeAudio:h.transcribe}}));
import {MicRecorderButton} from '../src/features/conversation/components/MicRecorderButton';
let settings:any;
function render(){h.s=0;h.r=0;return MicRecorderButton({settings,onTranscribed:h.received}) as any;}
function nodes(tree:any):any[]{if(!tree||typeof tree!=='object')return[];return[tree,...React.Children.toArray(tree.props?.children).flatMap(nodes)];}
function text(node:any):string{return typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';}
function button(tree:any,label:string){const found=nodes(tree).find(n=>n.type==='button'&&(n.props['aria-label']===label||text(n)===label));if(!found)throw Error('Missing button '+label);return found;}
function cloudConsent(){settings.allowExternalFreeGeminiCalls=true;settings.cloudConsent={isAdult:true,sendCurrentTurnOnlyAgreed:true,googleReviewDisclosureAgreed:true,noSensitiveInfoAgreed:true,policyVersion:CONVERSATION_POLICY_VERSION};}
beforeEach(()=>{h.states=[];h.refs=[];h.s=0;h.r=0;h.effect=false;h.cleanup=null;vi.clearAllMocks();settings={useSpeechInput:true,allowExternalFreeGeminiCalls:false};cloud.onAutoStop=undefined;
 h.localStart.mockResolvedValue('Hello Alex.');h.cloudStart.mockResolvedValue(undefined);h.transcribe.mockResolvedValue('Hello Alex.');h.install.mockResolvedValue(true);
 h.cloudStop.mockImplementation(async()=>{cloud.onAutoStop?.({audioBase64:'YWJj',mimeType:'audio/wav',durationSeconds:1});});
 class Native {processLocally=false;static available=vi.fn();static install=h.install;}
 vi.stubGlobal('window',{SpeechRecognition:Native});
});
afterEach(()=>{h.cleanup?.();vi.unstubAllGlobals();});
it('default local microphone fills editable text without cloud consent or cloud STT',async()=>{
 const tree=render();expect(button(tree,'마이크 음성 녹음 시작').props.disabled).toBe(false);
 await button(tree,'마이크 음성 녹음 시작').props.onClick();
 expect(h.localStart).toHaveBeenCalledTimes(1);expect(h.received).toHaveBeenCalledWith('Hello Alex.');expect(h.cloudStart).not.toHaveBeenCalled();expect(h.transcribe).not.toHaveBeenCalled();expect(h.install).not.toHaveBeenCalled();
});
it('local recognition failure never silently starts cloud recording',async()=>{
 cloudConsent();h.localStart.mockRejectedValue(new Error('local unavailable'));
 await button(render(),'마이크 음성 녹음 시작').props.onClick();expect(h.cloudStart).not.toHaveBeenCalled();expect(h.transcribe).not.toHaveBeenCalled();expect(h.received).not.toHaveBeenCalled();
});
it('explicit cloud recording keeps consent and converts only after stop',async()=>{
 cloudConsent();await button(render(),'클라우드 음성 입력 (한도 사용)').props.onClick();
 expect(h.cloudStart).toHaveBeenCalledTimes(1);expect(h.localStart).not.toHaveBeenCalled();expect(h.transcribe).not.toHaveBeenCalled();
 await button(render(),'녹음 완료 및 텍스트 변환').props.onClick();for(let i=0;i<5;i++)await Promise.resolve();
 expect(h.transcribe).toHaveBeenCalledTimes(1);expect(h.received).toHaveBeenCalledWith('Hello Alex.');
});
it('cloud input remains disabled without cloud consent while local input stays available',async()=>{
 const tree=render();expect(button(tree,'클라우드 음성 입력 (한도 사용)').props.disabled).toBe(true);
 await button(tree,'클라우드 음성 입력 (한도 사용)').props.onClick();expect(h.cloudStart).not.toHaveBeenCalled();expect(h.transcribe).not.toHaveBeenCalled();
});
it('language data download happens only on its own explicit button and starts no microphone',async()=>{
 const tree=render();expect(h.install).not.toHaveBeenCalled();await button(tree,'영어 음성팩 설치').props.onClick();
 expect(h.install).toHaveBeenCalledTimes(1);expect(h.install).toHaveBeenCalledWith({langs:['en-US']});expect(h.localStart).not.toHaveBeenCalled();expect(h.cloudStart).not.toHaveBeenCalled();expect(h.received).not.toHaveBeenCalled();
});
it('a false native install result is reported as failure rather than success',async()=>{
 h.install.mockResolvedValue(false);await button(render(),'영어 음성팩 설치').props.onClick();
 const status=nodes(render()).find(n=>n.props?.role==='status');expect(text(status)).toMatch(/실패|불가/);
 expect(h.localStart).not.toHaveBeenCalled();expect(h.cloudStart).not.toHaveBeenCalled();
});
it('cancel prevents a late local transcript from filling the input',async()=>{
 let release:any;h.localStart.mockImplementation(()=>new Promise(resolve=>{release=resolve}));
 const pending=button(render(),'마이크 음성 녹음 시작').props.onClick();await Promise.resolve();
 await button(render(),'녹음 취소').props.onClick();expect(h.localCancel).toHaveBeenCalled();release('old transcript');await pending;
 expect(h.received).not.toHaveBeenCalled();expect(h.transcribe).not.toHaveBeenCalled();
});
