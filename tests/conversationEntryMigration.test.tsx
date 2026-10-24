import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({render:vi.fn(),App:()=>null,Coach:()=>null,OldCheck:()=>null}));
vi.mock('react-dom/client',()=>({default:{createRoot:()=>({render:h.render})}}));
vi.mock('../src/app/App',()=>({App:h.App}));
vi.mock('../src/features/conversation/components/CoachTutorView',()=>({CoachTutorView:h.Coach}));
vi.mock('../src/features/conversation/components/HandsFreeSpeechCheck',()=>({HandsFreeSpeechCheck:h.OldCheck}));
function components(t:any):any[]{return !t||typeof t!=='object'?[]:[t.type,...React.Children.toArray(t.props?.children).flatMap(components)];}
const replaceState=vi.fn();
async function boot(search:string){vi.resetModules();h.render.mockClear();replaceState.mockClear();vi.stubGlobal('window',{location:{search,pathname:'/',hash:'',assign:vi.fn()},history:{state:{tab:'home'},replaceState}});vi.stubGlobal('document',{getElementById:()=>({})});await import('../src/main');return components(h.render.mock.calls[0][0]);}
afterEach(()=>vi.unstubAllGlobals());
it('retired test bookmarks normalize to the main app without a separate coach root or reload',async()=>{
 const types=await boot('?voice-check=1&build=20261023-2');expect(types).toContain(h.App);expect(types).not.toContain(h.Coach);expect(types).not.toContain(h.OldCheck);
 expect(replaceState).toHaveBeenCalledWith({tab:'home'},'','/');
});
it('the regular homepage still opens the complete study app',async()=>{
 const types=await boot('');expect(types).toContain(h.App);expect(types).not.toContain(h.OldCheck);
});
it('retired query cleanup preserves unrelated diagnostic parameters',async()=>{
 await boot('?speech-check=1&voice-check=1&build=old&speech-debug=1');expect(replaceState).toHaveBeenCalledWith({tab:'home'},'','/?speech-debug=1');
});
it('normal main navigation needs no URL rewrite',async()=>{
 await boot('');expect(replaceState).not.toHaveBeenCalled();
});
