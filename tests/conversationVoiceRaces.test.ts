import {afterEach,describe,expect,it,vi} from 'vitest';
import {VoiceInputService} from '../src/features/conversation/services/voiceInput';
import {VoiceOutputService} from '../src/features/conversation/services/voiceOutput';
afterEach(()=>vi.unstubAllGlobals());
function mockAudio(){
  const audios:FakeAudio[]=[];
  const rejects:Array<(error:Error)=>void>=[];
  const revoke=vi.fn();
  vi.stubGlobal('URL',{createObjectURL:vi.fn(()=>`blob:mock-${audios.length}`),revokeObjectURL:revoke});
  class FakeAudio {
    currentTime=0; playbackRate=1; onended:(()=>void)|null=null; onerror:(()=>void)|null=null;
    pause=vi.fn();
    constructor(){audios.push(this);}
    play(){return new Promise<void>((_resolve,reject)=>rejects.push(reject));}
  }
  vi.stubGlobal('Audio',FakeAudio);
  return {audios,rejects,revoke};
}
describe('음성 취소 세대 경계 회귀',()=>{
  it('정상 서버 오디오 완료는 취소로 오인하지 않으며 배속·고정표현 캐시를 적용한다',async()=>{
    const {audios}=mockAudio();const service=new VoiceOutputService();
    const pending=service.speak('Hello.',{audioBase64:'YWJj',mimeType:'audio/wav',isFixedKeyExpression:true,rate:1.2});
    expect(audios[0].playbackRate).toBe(1.2);audios[0].onended!();
    expect((await pending).success).toBe(true);expect(service.getCachedExpression('Hello.')).toBeDefined();
  });
  it('이전 오디오의 지연 오류가 새 재생의 URL과 Promise를 정리하지 않는다',async()=>{
    const {audios,rejects,revoke}=mockAudio();const service=new VoiceOutputService();
    const old=service.speak('Old',{audioBase64:'YWJj'});
    const current=service.speak('New',{audioBase64:'YWJj'});
    rejects[0](new Error('late decoder failure'));await Promise.resolve();await Promise.resolve();
    expect(revoke).toHaveBeenCalledTimes(1);
    audios[1].onended!();expect((await current).success).toBe(true);expect((await old).success).toBe(false);
  });
  it('취소 후 이전 getUserMedia 응답이 도착해도 새 녹음 트랙을 중단하지 않는다',async()=>{
    let releaseOld!:(stream:unknown)=>void;
    const oldPermission=new Promise(resolve=>releaseOld=resolve);
    const oldStop=vi.fn(),newStop=vi.fn();
    const getUserMedia=vi.fn().mockReturnValueOnce(oldPermission).mockResolvedValueOnce({getTracks:()=>[{stop:newStop}]});
    vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});
    class Recorder {
      static isTypeSupported(){return true;}
      state='inactive';mimeType='audio/webm';
      onstop:unknown;ondataavailable:unknown;onerror:unknown;
      start(){this.state='recording';} stop(){this.state='inactive';}
    }
    vi.stubGlobal('MediaRecorder',Recorder);
    const service=new VoiceInputService();
    const old=service.startRecording().catch(error=>error);
    service.cancelRecording();await service.startRecording();
    releaseOld({getTracks:()=>[{stop:oldStop}]});await old;
    expect(oldStop).toHaveBeenCalledTimes(1);expect(newStop).not.toHaveBeenCalled();expect(service.getState()).toBe('recording');
    service.cancelRecording();expect(newStop).toHaveBeenCalledTimes(1);
  });
});
