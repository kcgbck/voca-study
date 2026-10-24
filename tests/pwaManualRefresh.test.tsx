import 'fake-indexeddb/auto';
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<any>(),useState:(initial:any)=>[typeof initial==='function'?initial():initial,vi.fn()],useEffect:vi.fn()}));
import {App} from '../src/app/App';
function nodes(t:any):any[]{return t&&typeof t==='object'?[t,...React.Children.toArray(t.props?.children).flatMap(nodes)]:[];}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('manual refresh preserves unrelated app caches, workers and local learning records',async()=>{
 vi.useFakeTimers();const clear=vi.fn();const deleteDatabase=vi.fn();const remove=vi.fn().mockResolvedValue(true);const reload=vi.fn();
 const root={scope:'https://study.example/',active:{postMessage:vi.fn()},update:vi.fn().mockResolvedValue(undefined)};
 const other={scope:'https://study.example/other-app/',active:{postMessage:vi.fn()},update:vi.fn().mockResolvedValue(undefined)};
 vi.stubGlobal('window',{history:{state:{tab:'home'}},location:{origin:'https://study.example',href:'https://study.example/',reload},caches:{}});
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn(),clear});
 vi.stubGlobal('indexedDB',{deleteDatabase});vi.stubGlobal('caches',{keys:async()=>['voca-study-cache-v7','voca-study-cache-v8','unrelated-cache'],delete:remove});
 vi.stubGlobal('navigator',{serviceWorker:{getRegistrations:async()=>[root,other]}});
 const button=nodes(App({})).find(n=>n.type==='button'&&n.props['aria-label']==='새로고침');expect(button).toBeTruthy();
 await button.props.onClick();await vi.advanceTimersByTimeAsync(401);
 expect(remove.mock.calls.map(c=>c[0]).sort()).toEqual(['voca-study-cache-v7','voca-study-cache-v8']);
 expect(root.update).toHaveBeenCalledOnce();expect(root.active.postMessage).toHaveBeenCalledWith({type:'CLEAR_CACHE'});
 expect(other.update).not.toHaveBeenCalled();expect(other.active.postMessage).not.toHaveBeenCalled();
 expect(clear).not.toHaveBeenCalled();expect(deleteDatabase).not.toHaveBeenCalled();expect(reload).toHaveBeenCalledOnce();
});
