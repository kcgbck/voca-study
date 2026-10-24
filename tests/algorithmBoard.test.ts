import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';

const root = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('docs/토익_스터디_앱_전체_알고리즘_보드.html');
const md = read('docs/토익_스터디_앱_전체_알고리즘_보드.md');
const data = JSON.parse(read('docs/algorithm-board/boardData.json'));
const baseline = JSON.parse(read('docs/algorithm-board/baseline.json'));
const embedded = (name: string) => JSON.parse(html.match(new RegExp('const '+name+' = ([\\s\\S]*?);\\s*\\n'))![1]);
const nodes = embedded('NODES');
const tabs = embedded('TABS');
const edges = embedded('EDGES');
const normalized = (value: string) => value.replace(/`/g, '').replace(/\r/g, '').trim();
const fieldNames = ['역할','기술 / 스킬','입력','처리 / 분기','출력','실패 시 처리','상태 읽기','상태 저장','출처','파일','함수','관련 테스트','실행 근거','확인 수준','위험도'];
const fieldKeys = ['역할','기술_스킬','입력','처리_분기','출력','실패_시_처리','상태_읽기','상태_저장','출처','파일','함수','관련_테스트','실행_근거','확인_수준','위험도'];
const mdNodes = [...md.matchAll(/^### \[((?:NODE|CONV)-[^\]]+)\] (.+)\r?\n([\s\S]*?)(?=^### \[|^## |$(?![\s\S]))/gm)];

describe('알고리즘 보드 로컬 자동 관문 (브라우저/첨부 검증은 별도)', () => {
  it('BOARD-01: 로컬 기준선 원문 바이트와 기존 98개 ID를 보존한다', () => {
    for (const [name,hash] of [['html','0edb5ba995c877fc19ba5f53bf9b5bd2a3b7855c710938bea2f651f8fdf050b7'],['md','ba596450d5da959f66ce5d97eaad8fb92fe9e4ce265ffa37f2f8fae2d04d31ae']]) {
      expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'docs/algorithm-board/baseline.'+name))).digest('hex')).toBe(hash);
    }
    expect(baseline.nodeIds).toHaveLength(98);
    for (const id of baseline.nodeIds) expect(nodes.some((n: any) => n.id === id)).toBe(true);
  });
  it('BOARD-02: 탭18·노드125·간선52의 고유성과 참조/조건을 검증한다', () => {
    for (const [values,count] of [[nodes,125],[tabs,18],[edges,52]] as const) {
      expect(values).toHaveLength(count);
      expect(new Set(values.map((v: any)=>v.id)).size).toBe(count);
    }
    for (const n of nodes) expect(tabs.some((t: any)=>t.id===n.tab_id)).toBe(true);
    for (const [tabId,count] of [['tab-16',8],['tab-17',9],['tab-18',10]]) {
      const members=nodes.filter((n: any)=>n.tab_id===tabId);
      expect(members).toHaveLength(count as number);
      expect(members.every((n: any)=>n.id.startsWith('CONV-'))).toBe(true);
    }
    for (const e of edges) {
      expect(nodes.some((n: any)=>n.id===e.from)).toBe(true);
      expect(nodes.some((n: any)=>n.id===e.to)).toBe(true);
      for(const key of ['type','condition','summary']) expect(e[key].trim().length).toBeGreaterThan(0);
    }
  });
  it('BOARD-03: 신규27개 노드의 상세15항목과 canonical 제목을 확인한다', () => {
    const appendix=read('docs/ai회화/보카스터디_알고리즘보드_보강규격_부록_v2.2.md');
    const canonical=[...appendix.matchAll(/^\| (CONV-\d+) \| \d+ \| ([^|]+) \|/gm)];
    expect(canonical).toHaveLength(27);
    for(const [,id,title] of canonical) {
      const n=nodes.find((n: any)=>n.id===id);
      expect(n.title).toBe(title.trim());
      expect(Object.keys(n.details)).toHaveLength(15);
      for(const key of fieldKeys) expect(n.details[key].trim().length).toBeGreaterThan(0);
    }
  });
  it('BOARD-04: 실제 HTML 배열과 실제 MD 각 노드의 메타·15상세·간선 모든 필드를 비교한다', () => {
    expect(nodes).toEqual(data.nodes); expect(tabs).toEqual(data.tabs); expect(edges).toEqual(data.edges);
    expect(mdNodes).toHaveLength(nodes.length);
    for(const [,id,title,body] of mdNodes) {
      const n=nodes.find((n: any)=>n.id===id);
      expect(title).toBe(n.title);
      for(const [label,key] of [['범주','category'],['상태 배지','badge'],['위험도','risk'],['확인 수준','verification'],['요약','summary']]) {
        expect(normalized(body.match(new RegExp('^- \\*\\*'+label+'\\*\\*: (.*)$','m'))![1])).toBe(normalized(n[key]));
      }
      const details=[...body.matchAll(/^\d+\. \*\*(.+?)\*\*: (.*)$/gm)];
      expect(details).toHaveLength(15);
      details.forEach((d,index)=> {expect(d[1]).toBe(fieldNames[index]);expect(normalized(d[2])).toBe(normalized(n.details[fieldKeys[index]]));});
      const preceding=md.slice(0,md.indexOf('### ['+id+']'));
      const tabHeading=[...preceding.matchAll(/^## \[탭 (\d+)\] (.+)$/gm)].at(-1)!;
      expect(Number(tabHeading[1])).toBe(tabs.find((t: any)=>t.id===n.tab_id).num);
    }
    const mdEdges=[...md.matchAll(/^\| (EDGE-\d+) \| (.*?) \| (.*?) \| (.*?) \| (.*?) \| (.*?) \|$/gm)];
    expect(mdEdges).toHaveLength(edges.length);
    for(const [,id,from,to,type,condition,summary] of mdEdges) expect(edges.find((e: any)=>e.id===id)).toEqual({id,from,to,type,condition,summary});
  });
  it('BOARD-05: 데이터 집계와 헤더 총계·확인수준·보류관문이 일치한다', () => {
    expect(html).toContain('id="statTabs">'+tabs.length+'개 탭');
    expect(html).toContain('id="statNodes">'+nodes.length+'개 노드');
    expect(html).toContain('id="statEdges">'+edges.length+'개 연결');
    expect(data.summary.p0_nodes).toBe(nodes.filter((n: any)=>n.risk.startsWith('P0')).length);
    expect(data.summary.pending_gates).toBe(data.gates.filter((g: any)=>g.status==='보류').length);
    expect(Object.values(data.summary.verification_counts).reduce((a: any,b: any)=>a+b,0)).toBe(nodes.length);
    expect(html).toContain('id="resultCount"');
  });
  it('BOARD-06: 브라우저 스크립트 문법과 키보드/검색/경로 조작 연결을 검사한다 (실제 조작 별도)', () => {
    for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) expect(()=>new vm.Script(script[1])).not.toThrow();
    for(const name of ['switchTab','setCategoryFilter','setRiskFilter','applyFilters','openDrawer','closeDrawer','focusNode','drawerTrigger','card.onkeydown','Escape']) expect(html).toContain(name);
  });
  it('BOARD-07: 부록 필수경로와 재개·복원·실패분기가 명시되어 있다', () => {
    const pairs=['NODE-01>CONV-01','CONV-01>CONV-02','CONV-02>CONV-03','CONV-03>CONV-04','CONV-04>CONV-05','CONV-05>CONV-13','CONV-13>CONV-21','CONV-21>CONV-22','CONV-22>CONV-23','CONV-23>CONV-14','CONV-05>CONV-09','CONV-09>CONV-10','CONV-10>CONV-11','CONV-11>CONV-12','CONV-12>CONV-13','CONV-09>CONV-05','CONV-14>CONV-15','CONV-15>CONV-06','CONV-06>CONV-07','CONV-07>CONV-05','CONV-06>CONV-08','CONV-08>CONV-18','CONV-18>CONV-19','CONV-19>CONV-02','CONV-15>CONV-16','CONV-16>CONV-05','CONV-14>CONV-17','CONV-17>CONV-05','CONV-11>CONV-17','CONV-18>CONV-20','CONV-03>CONV-25','CONV-14>CONV-25','CONV-18>CONV-25','CONV-24>CONV-26','CONV-25>CONV-26','NODE-49>CONV-18','NODE-58B>CONV-17','NODE-96>CONV-21','NODE-91>CONV-21','NODE-65>CONV-25','NODE-66>CONV-25','NODE-67>CONV-25','CONV-27>CONV-14','CONV-18>CONV-04','CONV-20>CONV-18'];
    for(const pair of pairs) expect(edges.some((e: any)=>e.from+'>'+e.to===pair),pair).toBe(true);
    expect(edges.find((e: any)=>e.from==='CONV-27').type).toContain('설계');
    for(const word of ['권한','429','오프라인','중단','복원','보안','동의']) expect(edges.some((e: any)=>JSON.stringify(e).includes(word))).toBe(true);
  });
  it('BOARD-08: 17개 충돌의 이전값을 보존하며 자동 작동 승격하지 않는다', () => {
    expect(baseline.conflicting).toHaveLength(17);
    for(const id of baseline.conflicting) { const n=nodes.find((n: any)=>n.id===id);expect(n.badge).toContain('설계 단계');expect(n.verification).toContain('실행 미검증'); }
    expect(read('docs/algorithm-board/CHANGE_HISTORY.md')).toContain('이전값');
  });
  it('BOARD-09: 신규 소스·함수·테스트를 실제 파일에서 확인하고 과거 누락을 표시한다', () => {
    for(const n of nodes.filter((n: any)=>n.id.startsWith('CONV-'))) {
      const sources=n.details.파일.split(',').map((p: string)=>p.trim());
      for(const source of sources) expect(fs.existsSync(path.join(root,source)),n.id+': '+source).toBe(true);
      const sourceText=sources.map(read).join('\n');
      if(!n.details.함수.startsWith('해당 없음')) for(const item of n.details.함수.split(',')) for(const symbol of item.trim().split('.')) expect(sourceText,n.id+': '+symbol).toContain(symbol);
      if(!n.details.관련_테스트.startsWith('해당 없음')) for(const test of n.details.관련_테스트.split(',')) expect(fs.existsSync(path.join(root,test.trim())),n.id+': '+test).toBe(true);
    }
    for(const n of nodes.filter((n: any)=>n.id.startsWith('NODE-'))) { expect(n.currentNote).toContain('재검증하지'); expect(n.referenceChecks.length).toBeGreaterThan(0); }
    expect(html).toContain('과거 근거·미확인'); expect(md).toContain('과거 근거·미확인');
  });
  it('BOARD-10: 보안 설명이 실제 기본차단·동의·cleanup 코드와 일치한다', () => {
    expect(read('functions/api/conversation/[[action]].ts')).toContain('allowExternalFreeGeminiCalls');
    expect(nodes.find((n: any)=>n.id==='CONV-21').details.실패_시_처리).toContain('미구성');
    expect(nodes.find((n: any)=>n.id==='CONV-22').details.실패_시_처리).toContain('미검증');
    expect(nodes.find((n: any)=>n.id==='CONV-24').details.실패_시_처리).toContain('미실행');
    expect(nodes.find((n: any)=>n.id==='CONV-26').summary).toContain('NOT_APPROVED');
    expect(nodes.find((n: any)=>n.id==='CONV-27').verification).toContain('미구현');
  });
  it('BOARD-11: 기존 상세15항목·제목·탭관계를 모두 보존하고 변경2항목만 이력화한다', () => {
    for(const before of baseline.data.nodes) {
      const after=nodes.find((n: any)=>n.id===before.id);
      for(const key of ['id','title','category','summary','risk']) expect(after[key],before.id+': '+key).toBe(before[key]);
      if(['NODE-96','NODE-97','NODE-98'].includes(before.id)) {
        expect(after.originalTab).toEqual({id:before.tab_id,name:before.tab_name});
        expect(after.tab_id).toBe(before.id==='NODE-98'?'tab-1':'tab-11');
      } else { expect(after.tab_id).toBe(before.tab_id); expect(after.tab_name).toBe(before.tab_name); }
      for(const key of fieldKeys) if(!(baseline.conflicting.includes(before.id)&&['확인_수준','실행_근거'].includes(key))) expect(after.details[key],before.id+': '+key).toBe(before.details[key]);
    }
  });
  it('BOARD-12: 외부 CDN 없이 독립 HTML 및 원본 MD를 제공한다 (모바일 실제 확인 별도)', () => {
    expect(html).not.toMatch(/<script[^>]+src=/); expect(html).not.toMatch(/<link[^>]+https?:/);
    expect(md).toContain('algorithm-board/baseline.md');
    expect(read('scripts/algorithm-board/generateBoard.mjs')).not.toContain('.agy-work/');
  });
  it('현재 공개 코치 근거와 이전 128차시 설계를 구분한다',()=>{
    for(const document of [html,md]){
      for(const phrase of ['현재 공개 코치','이전 128차시 설계','FOLLOWUP-19','13 RPM','450 RPD','S25'])expect(document).toContain(phrase);
      expect(document).not.toContain('API: 기본 비활성·운영 Access/독립 예산 DB 미구성');
    }
    expect(md).toContain('BOARD-01');expect(md).toContain('BOARD-12A');
  });
});
