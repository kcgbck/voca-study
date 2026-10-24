import {beforeEach,expect,it,vi} from 'vitest';
import React from 'react';
const h=vi.hoisted(()=>({states:[] as any[],refs:[] as any[],s:0,r:0,
  settings:{allowExternalFreeGeminiCalls:true,cloudConsent:{isAdult:true,sendCurrentTurnOnlyAgreed:true,googleReviewDisclosureAgreed:true,noSensitiveInfoAgreed:true,policyVersion:'probe-policy'}},
  synth:vi.fn(),speak:vi.fn(),cancel:vi.fn(),cache:vi.fn(),cleanups:[] as any[]}));
vi.mock('react',async original=>{const real=await original<any>();return {...real,
  useState:(initial:any)=>{const i=h.s++;if(!(i in h.states))h.states[i]=initial;return[h.states[i],(next:any)=>{h.states[i]=next}];},
  useRef:(initial:any)=>{const i=h.r++;return h.refs[i]??(h.refs[i]={current:initial});},
  useEffect:(fn:any)=>{h.cleanups.push(fn());}}});
vi.mock('../src/features/conversation/services/storageService',()=>({storageService:{getSettings:async()=>h.settings}}));
vi.mock('../src/features/conversation/services/conversationApi',()=>({conversationApi:{synthesizeSpeech:h.synth}}));
vi.mock('../src/features/conversation/services/voiceOutput',()=>({voiceOutput:{speak:h.speak,cancel:h.cancel,getCachedExpression:h.cache}}));
vi.mock('../src/features/conversation/components/ConversationSettingsModal',()=>({CONVERSATION_POLICY_VERSION:'probe-policy'}));
import {AudioPlayerButton} from '../src/features/conversation/components/AudioPlayerButton';
function render(){h.s=0;h.r=0;return AudioPlayerButton({text:'Hello Alex.',showSpeedSelector:true,isKeyExpression:true}) as any;}
function nodes(tree:any):any[]{if(!tree||typeof tree!=='object')return[];return[tree,...React.Children.toArray(tree.props?.children).flatMap(nodes)];}
function button(tree:any,label:string){const found=nodes(tree).find(n=>n.type==='button'&&n.props['aria-label']===label);if(!found)throw Error('Missing button '+label);return found;}
beforeEach(()=>{h.states=[];h.refs=[];h.cleanups=[];h.s=0;h.r=0;h.settings.allowExternalFreeGeminiCalls=true;
  vi.clearAllMocks();h.synth.mockResolvedValue({audioBase64:'YWJj',mimeType:'audio/wav'});h.speak.mockResolvedValue({success:true,method:'browser_speech'});h.cache.mockReturnValue(undefined);});
it('default listening with full consent spends zero cloud TTS and preserves selected rate',async()=>{
  let tree=render();button(tree,'재생 속도 1.2배').props.onClick();tree=render();
  await button(tree,'음성 듣기').props.onClick();
  expect(h.synth).not.toHaveBeenCalled();expect(h.cache).not.toHaveBeenCalled();
  expect(h.speak).toHaveBeenCalledWith('Hello Alex.',expect.objectContaining({audioBase64:undefined,rate:1.2,isFixedKeyExpression:false}));
});
it('cloud listening is explicit and uses the existing current-policy consent',async()=>{
  const tree=render();await button(tree,'클라우드 음성 듣기 (한도 사용)').props.onClick();
  expect(h.synth).toHaveBeenCalledTimes(1);expect(h.synth.mock.calls[0][1]).toMatchObject({isAdult:true,noSensitiveInfoAgreed:true});
  expect(h.speak).toHaveBeenCalledWith('Hello Alex.',expect.objectContaining({audioBase64:'YWJj'}));
});
it('cloud listening without opt-in makes zero cloud requests',async()=>{
  h.settings.allowExternalFreeGeminiCalls=false;const tree=render();await button(tree,'클라우드 음성 듣기 (한도 사용)').props.onClick();
  expect(h.synth).not.toHaveBeenCalled();
});
it('browser failure does not silently spend cloud quota',async()=>{
  h.speak.mockResolvedValue({success:false,method:'none',error:'unsupported browser voice'});
  await button(render(),'음성 듣기').props.onClick();expect(h.synth).not.toHaveBeenCalled();
});
it('stop during explicit cloud request aborts it and prevents late playback',async()=>{
  let resolve:any;h.synth.mockImplementation(()=>new Promise(r=>{resolve=r}));
  const pending=button(render(),'클라우드 음성 듣기 (한도 사용)').props.onClick();
  await Promise.resolve();await Promise.resolve();
  expect(h.synth).toHaveBeenCalledTimes(1);
  await button(render(),'음성 재생 중지').props.onClick();
  expect(h.synth.mock.calls[0][2].aborted).toBe(true);expect(h.cancel).toHaveBeenCalled();
  resolve({audioBase64:'YWJj',mimeType:'audio/wav'});await pending;
  expect(h.speak).not.toHaveBeenCalled();
});
