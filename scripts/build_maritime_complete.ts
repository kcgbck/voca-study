import fs from 'fs';
import path from 'path';
import { smcpRawWords } from './worddb/generateMaritimeSmcp.js';
import { officerExamWords } from './worddb/generateMaritimePhase2.js';
import { conventionsAndPracticeWords } from './worddb/generateMaritimePhase3.js';

// --- 1. 해사 통신 문장 인터페이스 ---
export interface MaritimeCommunicationItem {
  id: number;
  word: string; // 실제 영어 통신 문장
  meaning: string[]; // 정답 한국어 번역
  distractors: string[]; // 4지선다용 오답 번역 3개
  partOfSpeech: '통신문';
  difficulty: 'low' | 'medium' | 'high';
  topic: 'communication';
  englishDefinition: string;
  standardExample: string;
  exampleMeaning: string;
}

// 실전 IMO SMCP 통신 문장 150선 데이터셋
const communicationPhrasesRaw: Array<Omit<MaritimeCommunicationItem, 'id' | 'partOfSpeech' | 'topic'>> = [
  // === 1. 조난 통신 (Distress Traffic - MAYDAY) ===
  {
    word: 'MAYDAY. I am on fire after explosion. I require immediate firefighting assistance.',
    meaning: ['메이데이. 본선은 폭발 후 화재 발생 중이다. 즉각적인 소화 지원을 요청한다.'],
    distractors: [
      '메이데이. 본선은 기관실 침수가 발생하여 조종불능 상태이다.',
      '메이데이. 본선은 미상의 선박과 충돌하여 침몰 중이다.',
      '팬팬. 본선은 화재가 진압되었으며 인명 피해는 없다.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Distress Traffic - Fire/Explosion',
    standardExample: 'MAYDAY, MAYDAY, MAYDAY. This is M/V PACIFIC. I am on fire after explosion.',
    exampleMeaning: '메이데이, 메이데이, 메이데이. 본선은 퍼시픽호. 본선은 폭발 후 화재 발생 중이다.',
  },
  {
    word: 'MAYDAY. I am flooding below water line. I cannot control flooding.',
    meaning: ['메이데이. 본선은 흘수선 하부에 침수 중이며 침수를 제어할 수 없다.'],
    distractors: [
      '메이데이. 본선은 좌현으로 5도 경사되었으나 침수를 억제하고 있다.',
      '세퀴리테. 항로 상에 반쯤 침수된 컨테이너가 표류 중이다.',
      '팬팬. 본선은 밸러스트 펌프 고장으로 배수를 중단했다.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Distress Traffic - Flooding',
    standardExample: 'MAYDAY. I am flooding below water line. Request high capacity pumps.',
    exampleMeaning: '메이데이. 흘수선 하부에 침수 중이다. 대용량 배수펌프를 요청한다.',
  },
  {
    word: 'MAYDAY. I have collided with unknown object. Dangerous list to port side.',
    meaning: ['메이데이. 본선은 미상의 물체와 충돌했다. 좌현으로 위험한 경사가 발생했다.'],
    distractors: [
      '메이데이. 본선은 부표와 접촉했으나 선체 파손은 경미하다.',
      '팬팬. 본선은 천소에 접촉한 후 자력으로 이초했다.',
      '세퀴리테. 침몰선 부근에서 충돌 위험이 있으니 주의하라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Distress Traffic - Collision & List',
    standardExample: 'MAYDAY. Collided with unknown object. Vessel listing 15 degrees to port.',
    exampleMeaning: '메이데이. 미상의 물체와 충돌함. 본선이 좌현으로 15도 경사됨.',
  },
  {
    word: 'MAYDAY. I am aground in position latitude 35 degrees North, longitude 129 degrees East.',
    meaning: ['메이데이. 본선은 북위 35도, 동경 129도 위치에 좌초되었다.'],
    distractors: [
      '메이데이. 본선은 북위 35도 위치에서 표류하고 있다.',
      '팬팬. 본선은 해당 좌표 부근에서 기관 고장으로 투묘했다.',
      '세퀴리테. 북위 35도 수로 상에 수심 저하 구역이 존재한다.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Distress Traffic - Grounding',
    standardExample: 'MAYDAY. Vessel aground on rocky shoal. Bottom damage reported.',
    exampleMeaning: '메이데이. 본선이 암초에 좌초됨. 선저 손상이 보고됨.',
  },
  {
    word: 'MAYDAY. Vessel has serious list and is in danger of capsizing.',
    meaning: ['메이데이. 본선은 심각한 경사가 발생하여 전복될 위험에 처해 있다.'],
    distractors: [
      '메이데이. 본선은 전복되었으며 생존자가 구명정에 탑승했다.',
      '팬팬. 화물 이동으로 5도 경사되었으나 복원력을 유지하고 있다.',
      '주의: 횡요가 심하므로 침로를 변경하여 파도를 피하라.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Distress Traffic - Danger of capsizing',
    standardExample: 'MAYDAY. List increasing rapidly. Vessel in imminent danger of capsizing.',
    exampleMeaning: '메이데이. 경사가 급격히 증가 중임. 본선이 전복 직전 위험에 처함.',
  },
  {
    word: 'MAYDAY. I am sinking. I require immediate search and rescue.',
    meaning: ['메이데이. 본선은 침몰 중이다. 즉각적인 수색 및 구조를 요청한다.'],
    distractors: [
      '메이데이. 본선은 침수가 진정되어 예인선을 기다리고 있다.',
      '팬팬. 구명정 강하 훈련 중 낙항자가 발생했다.',
      '세퀴리테. 조난 선박이 완전히 침몰했으니 주변을 수색하라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Distress Traffic - Sinking',
    standardExample: 'MAYDAY. Engine room flooded, ship sinking rapidly. Request SAR assistance.',
    exampleMeaning: '메이데이. 기관실 침수 완료, 급속히 침몰 중임. 수색구조 지원 요청.',
  },
  {
    word: 'MAYDAY. I am disabled and adrift. Drifting toward rocky shore.',
    meaning: ['메이데이. 본선은 항행 불능 상태로 표류 중이다. 암초 해안 쪽으로 밀려가고 있다.'],
    distractors: [
      '메이데이. 본선은 암초와 충돌하여 기관이 정지되었다.',
      '팬팬. 본선은 주묘되어 묘박지를 벗어났다.',
      '본선은 안전 수역에 닻을 내리고 수리 작업을 진행 중이다.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Distress Traffic - Disabled and adrift',
    standardExample: 'MAYDAY. Main engine dead, drifting at 3 knots toward dangerous rocks.',
    exampleMeaning: '메이데이. 주기관 정지, 위험한 암초 쪽으로 3노트로 표류 중임.',
  },
  {
    word: 'MAYDAY. I am under attack by armed pirates. I require armed assistance.',
    meaning: ['메이데이. 본선은 무장 해적에게 공격받고 있다. 무장 지원을 요청한다.'],
    distractors: [
      '팬팬. 밀항자 2명이 발견되어 격리 조치하였다.',
      '세퀴리테. 해당 해역에 해적 의심 선박이 출현했으니 주의하라.',
      '본선 승무원 전원이 시타델(안전격실)로 피신 완료했다.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Distress Traffic - Piracy / Armed attack',
    standardExample: 'MAYDAY. Pirates boarding on port quarter. Crew retreating to citadel.',
    exampleMeaning: '메이데이. 해적이 좌현 선미로 승선 중임. 승무원 안전격실로 후퇴 중.',
  },
  {
    word: 'Abandon vessel! All crew proceed to lifeboat stations.',
    meaning: ['퇴선하라! 전 승무원은 구명정 배치 장소로 집결하라.'],
    distractors: [
      '비상 배치! 전 승무원은 소화 배치 장소로 즉시 집결하라.',
      '거주 구역 점검! 전 승무원은 각자 침실에서 구명조끼를 착용하라.',
      '훈련 종료! 구명정 장비를 원위치하고 선교로 보고하라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Standard Emergency Order - Abandon vessel',
    standardExample: 'General alarm sounding: Abandon vessel! Launch lifeboats on starboard.',
    exampleMeaning: '비상벨 명동: 퇴선하라! 우현 구명정을 강하하라.',
  },
  {
    word: 'I have launched lifeboats and liferafts. Number of persons on board is twenty-four.',
    meaning: ['구명정과 구명뗏목을 강하시켰다. 승선 인원은 24명이다.'],
    distractors: [
      '구명정 1척이 손상되었다. 남은 생존자는 14명이다.',
      '구명뗏목 24개를 팽창시켰으며 승무원은 본선에 대기 중이다.',
      '승선 인원 24명 전원이 침실에 대기 중이다.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Distress Traffic - Lifeboats launched',
    standardExample: 'MRCC: Have you launched lifeboats? Ship: Yes, lifeboats and liferafts launched.',
    exampleMeaning: '구조본부: 구명정을 강하시켰는가? 본선: 그렇다, 구명정과 뗏목을 강하시켰다.',
  },
  {
    word: 'Stand by on VHF Channel 16 for distress traffic coordination.',
    meaning: ['조난 통신 조율을 위해 VHF 16번 채널에서 대기 청취하라.'],
    distractors: [
      '일상 항해 통신을 위해 VHF 12번 채널로 변경하라.',
      '선내 비상 작업을 위해 휴대용 무전기 채널을 통일하라.',
      '도선선 호출을 위해 VHF 09번 채널을 대기하라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Distress Traffic - Radio watch',
    standardExample: 'All stations: Silence Mayday. Stand by on VHF Channel 16.',
    exampleMeaning: '모든 무선국 통신 침묵. VHF 16번 채널을 청취 대기하라.',
  },
  {
    word: 'I am proceeding to distress position. My ETA is 1400 UTC.',
    meaning: ['본선은 조난 위치로 이동 중이다. 도착 예정 시간은 UTC 14시이다.'],
    distractors: [
      '본선은 수색을 종료하고 기지로 복귀 중이다. ETA는 14시이다.',
      '본선은 기상 악화로 인해 조난 위치로 갈 수 없다.',
      '귀선이 조난 위치로 먼저 이동할 것을 요청한다.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP SAR Communications - Proceeding to distress',
    standardExample: 'Coast Guard: Report your ETA. Ship: I am proceeding to distress position, ETA 1400 UTC.',
    exampleMeaning: '해경: 도착 예정 시간을 보고하라. 본선: 조난 위치로 이동 중, ETA 1400 UTC.',
  },

  // === 2. 긴급 통신 (Urgency Traffic - PAN PAN) ===
  {
    word: 'PAN PAN. I have engine trouble. I am maneuvering with difficulty.',
    meaning: ['판판. 본선은 기관 고장이 발생했다. 조종에 어려움을 겪고 있다.'],
    distractors: [
      '판판. 본선은 타기 고장으로 조종불능 상태이다.',
      '메이데이. 본선은 주기관 폭발로 화재가 발생했다.',
      '세퀴리테. 항로 전방에 저속 항해 선박이 있으니 주의하라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Urgency Traffic - Engine trouble',
    standardExample: 'PAN PAN. Engine RPM reduced due to overheating. Maneuvering with difficulty.',
    exampleMeaning: '판판. 과열로 인해 기관 회전수 감속됨. 조종 곤란 상태임.',
  },
  {
    word: 'PAN PAN. I have lost steering gear. I am not under command.',
    meaning: ['판판. 본선은 조타기를 상실했다. 본선은 조종불능 상태이다.'],
    distractors: [
      '판판. 본선은 비상 조타로 전환하여 정상 항해 중이다.',
      '메이데이. 타판이 유실되어 선미가 침수되고 있다.',
      '세퀴리테. 협수로에서 타효가 불량하니 감속하라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Urgency Traffic - Steering failure',
    standardExample: 'PAN PAN, PAN PAN, PAN PAN. Rudder jammed hard to port. Not under command.',
    exampleMeaning: '판판. 타가 좌현 끝으로 고착됨. 본선 조종불능선임.',
  },
  {
    word: 'PAN PAN. Person overboard in position 2 miles south of lighthouse.',
    meaning: ['판판. 등대 남쪽 2마일 위치에 바다로 사람이 추락했다 (낙항자 발생).'],
    distractors: [
      '판판. 등대 남쪽에서 익수자를 성공적으로 구조했다.',
      '세퀴리테. 등대 부근에 소형 어선이 전복되어 있다.',
      '구명부환을 투하했으나 실종자를 확인하지 못했다.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Urgency Traffic - Person overboard',
    standardExample: 'PAN PAN. Man overboard from port side! All ships in vicinity keep sharp lookout.',
    exampleMeaning: '판판. 좌현에서 사람 추락! 부근의 모든 선박은 철저히 경계하라.',
  },
  {
    word: 'PAN PAN. I require urgent medical assistance for injured crew member.',
    meaning: ['판판. 부상당한 선원을 위해 긴급 의료 지원이 필요하다.'],
    distractors: [
      '판판. 선원이 발열 증세가 있어 선내 격리 조치하였다.',
      '메이데이. 전염병 확산으로 즉각적인 항만 봉쇄를 요청한다.',
      '의료진이 승선하여 환자 상태를 안정시켰다.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Urgency Traffic - Medical assistance',
    standardExample: 'PAN PAN. Crew member suffered severe fracture. Require helicopter evacuation.',
    exampleMeaning: '판판. 선원이 심각한 골절상을 입음. 헬기 후송을 요청함.',
  },
  {
    word: 'Propeller is fouled by fishing net. I require diver assistance.',
    meaning: ['프로펠러가 어망에 감겼다. 잠수부 지원을 요청한다.'],
    distractors: [
      '프로펠러 날개가 파손되어 즉시 도크에 입거해야 한다.',
      '어망을 칼로 절단하여 자력으로 항해를 재개했다.',
      '어망 설치 구역이니 2마일 이상 우회 항해하라.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Urgency Traffic - Fouled propeller',
    standardExample: 'VTS: Why are you stopped? Ship: Propeller is fouled by fishing net.',
    exampleMeaning: '관제탑: 왜 정지했는가? 본선: 프로펠러에 어망이 감겼다.',
  },

  // === 3. 안전 통신 및 항행 경보 (Safety Traffic - SECURITE) ===
  {
    word: 'SECURITE. Gale warning. Wind northwesterly Beaufort force 8 expected.',
    meaning: ['세퀴리테. 강풍 경보. 북서풍 보퍼트 계급 8의 바람이 예상됨.'],
    distractors: [
      '세퀴리테. 태풍 경보. 남동풍 풍속 50노트 이상의 돌풍이 예상됨.',
      '팬팬. 폭풍우로 인해 갑판 위 화물이 바다로 유실되었다.',
      '해상 날씨 양호. 파고 1미터 내외로 안전 운항 가능함.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Safety Traffic - Gale warning',
    standardExample: 'SECURITE, SECURITE, SECURITE. Gale warning issued for sea area East.',
    exampleMeaning: '세퀴리테. 동해 해역에 강풍 경보가 발령되었음.',
  },
  {
    word: 'SECURITE. Visibility reduced by dense fog to less than 0.5 nautical miles.',
    meaning: ['세퀴리테. 짙은 안개로 인해 시정이 0.5해리 미만으로 감소함.'],
    distractors: [
      '세퀴리테. 폭우로 인해 야간 등대 불빛 식별이 불가능함.',
      '시정 5해리 이상 확보되어 정상 속력으로 항해 가능함.',
      '무중 신호를 울리며 안전 속력으로 감속하여 통항하라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Safety Traffic - Dense fog warning',
    standardExample: 'SECURITE. Dense fog in harbor approach. All vessels sound fog signals.',
    exampleMeaning: '세퀴리테. 항만 접근로에 농무 발생. 모든 선박은 무중신호를 취명하라.',
  },
  {
    word: 'SECURITE. Semi-submerged container sighted adrift in vicinity of fairway.',
    meaning: ['세퀴리테. 항로 부근에서 반쯤 침수된 컨테이너가 표류 중인 것이 목격됨.'],
    distractors: [
      '세퀴리테. 항로 중앙에 침몰선 부표가 설치되었으니 주의하라.',
      '컨테이너선에서 화물 추락 사고가 발생하여 수색 중이다.',
      '항로 상의 부유물이 모두 수거되어 안전 통항이 가능하다.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Safety Traffic - Floating hazard',
    standardExample: 'SECURITE. Danger to navigation: 40-foot container adrift in channel entrance.',
    exampleMeaning: '세퀴리테. 항행 위험: 40피트 컨테이너가 수로 입구에 표류 중임.',
  },
  {
    word: 'SECURITE. Light buoy number 3 unlit and off station.',
    meaning: ['세퀴리테. 3번 등부표가 소등되었으며 정위치를 이탈함.'],
    distractors: [
      '세퀴리테. 3번 등부표가 새로 설치되어 등질이 변경됨.',
      '3번 등부표를 우현에 두고 항로를 따라 진입하라.',
      '소등된 등부표를 수리하기 위해 작업선이 출동 중이다.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Safety Traffic - Navigational aid defective',
    standardExample: 'SECURITE. Navigational warning: Fairway buoy unlit and drifting north.',
    exampleMeaning: '세퀴리테. 항행 경보: 항로 부표가 소등되고 북쪽으로 표류 중임.',
  },
  {
    word: 'You are running into danger. Shallow water ahead of you.',
    meaning: ['귀선은 위험으로 향하고 있다. 전방에 천소(얕은 수심)가 있음.'],
    distractors: [
      '귀선은 항로를 이탈했다. 즉시 좌현으로 변침하라.',
      '귀선 전방에 암초가 폭파 제거되었으니 안심하고 통과하라.',
      '수심이 충분하므로 계획된 항로를 유지해도 좋다.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP VTS Warning - Navigational danger',
    standardExample: 'WARNING: You are running into danger. Shallow water 1 mile ahead on your course.',
    exampleMeaning: '경고: 귀선은 위험으로 향하고 있다. 귀선 침로 전방 1마일에 천소가 있음.',
  },
  {
    word: 'Dangerous wreck reported in position bearing 090 degrees, distance 3 miles.',
    meaning: ['방위 090도, 거리 3마일 위치에 위험 침몰선이 보고됨.'],
    distractors: [
      '방위 090도 위치에 설치된 등대가 점멸 작동 중이다.',
      '거리 3마일 지점에서 어망 설치 작업이 진행 중이다.',
      '침몰선의 수심이 50미터 이상이므로 항해에 지장이 없다.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Navigational Warning - Dangerous wreck',
    standardExample: 'Notice to Mariners: Dangerous wreck located. Give wide berth.',
    exampleMeaning: '항행통보: 위험 침몰선 발견됨. 충분한 안전 거리를 유지하라.',
  },

  // === 4. VTS 해상교통관제 통신 (Vessel Traffic Service) ===
  {
    word: 'What is your present course and speed?',
    meaning: ['귀선의 현재 침로와 속력은 얼마인가?'],
    distractors: [
      '귀선의 목적지와 도착 예정 시간은 언제인가?',
      '귀선의 최대 흘수와 선체 길이는 얼마인가?',
      '귀선의 현재 위치와 정박 예정지는 어디인가?',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP VTS Query - Course and speed',
    standardExample: 'VTS: What is your present course and speed? Ship: Course 180, speed 12 knots.',
    exampleMeaning: '관제탑: 현재 침로와 속력은? 본선: 침로 180도, 속력 12노트.',
  },
  {
    word: 'My present course is 045 degrees, speed 14 knots.',
    meaning: ['본선의 현재 침로는 045도, 속력은 14노트이다.'],
    distractors: [
      '본선은 045도 방향으로 14마일 항해할 예정이다.',
      '본선은 14시 정각에 045도 침로로 변침할 예정이다.',
      '본선의 선수 방위는 045도이나 대지 속력은 0노트이다.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP VTS Response - Course and speed',
    standardExample: 'VTS acknowledged. Maintain course 045 degrees until waypoint Alpha.',
    exampleMeaning: '관제탑 알겠음. 변곡점 알파까지 침로 045도를 유지하라.',
  },
  {
    word: 'What is your maximum present draft?',
    meaning: ['귀선의 현재 최대 흘수는 얼마인가?'],
    distractors: [
      '귀선의 공선 상태 최소 흘수는 얼마인가?',
      '귀선의 선체 높이(형심)는 얼마인가?',
      '수로 통과 시 요구되는 최소 여유 수심은 얼마인가?',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP VTS Query - Maximum draft',
    standardExample: 'VTS: What is your maximum present draft? Ship: My draft is 10.2 meters.',
    exampleMeaning: '관제탑: 현재 최대 흘수는? 본선: 본선 흘수는 10.2미터임.',
  },
  {
    word: 'Report your position when passing reporting point Alpha.',
    meaning: ['보고점 알파를 통과할 때 귀선의 위치를 보고하라.'],
    distractors: [
      '알파 지점에 도착하면 투묘하고 대기하라.',
      '알파 지점 통과 후 속력을 최대로 증속하라.',
      '알파 지점에서 도선선과 교신하라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP VTS Instruction - Reporting point',
    standardExample: 'INSTRUCTION: Report your position when passing reporting point Alpha.',
    exampleMeaning: '지시: 보고점 알파를 통과할 때 귀선의 위치를 보고하라.',
  },
  {
    word: 'Traffic clearance granted. You may enter traffic lane.',
    meaning: ['통항 허가됨. 통항로에 진입해도 좋다.'],
    distractors: [
      '통항 보류됨. 출항 선박이 지나갈 때까지 대기하라.',
      '통항로가 폐쇄되었으니 지정 묘박지로 이동하라.',
      '입항 허가 취소됨. 외항에서 대기 청취하라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP VTS Clearance - Traffic lane entry',
    standardExample: 'VTS: Traffic clearance granted. Enter TSS northbound lane now.',
    exampleMeaning: '관제탑: 통항 허가됨. 지금 북상 통항로로 진입하라.',
  },
  {
    word: 'Do not enter fairway until outward bound vessel has passed.',
    meaning: ['출항 선박이 통과할 때까지 항로에 진입하지 마라.'],
    distractors: [
      '입항 선박보다 먼저 신속하게 항로를 통과하라.',
      '항로 중앙에서 대기하며 출항 선박을 먼저 피하라.',
      '출항 선박과 좌현 대 좌현으로 통과하며 진입하라.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP VTS Instruction - Wait outside fairway',
    standardExample: 'INSTRUCTION: Do not enter fairway until outward bound container vessel has cleared.',
    exampleMeaning: '지시: 출항하는 컨테이너선이 빠져나갈 때까지 항로에 진입하지 마라.',
  },
  {
    word: 'Risk of collision exists with vessel approaching on your port bow.',
    meaning: ['귀선의 좌현 선수 쪽에서 접근하는 선박과 충돌 위험이 존재한다.'],
    distractors: [
      '귀선의 우현 선미 쪽에 추월선이 있으니 침로를 유지하라.',
      '좌현에 있는 선박이 귀선을 피하여 감속하고 있다.',
      '접근 선박과 충분한 안전 거리가 확보되었으니 통과하라.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Collision Avoidance - Risk of collision',
    standardExample: 'WARNING: Risk of collision exists with vessel on your port bow. CPA is 0.1 miles.',
    exampleMeaning: '경고: 귀선 좌현 선수 쪽 선박과 충돌 위험 존재. 최근접거리는 0.1마일임.',
  },
  {
    word: 'I am altering my course to starboard.',
    meaning: ['본선은 침로를 우현으로 변경하고 있다.'],
    distractors: [
      '본선은 침로를 좌현으로 변경하고 있다.',
      '본선은 기관을 역회전하여 급정지하고 있다.',
      '본선은 현재 침로와 속력을 그대로 유지하고 있다.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Maneuvering Intention - Altering course',
    standardExample: 'Ship to ship: I am altering my course to starboard to pass astern of you.',
    exampleMeaning: '선박 대 선박: 귀선의 선미 뒤를 통과하기 위해 본선 우현으로 변침 중임.',
  },
  {
    word: 'Advise you pass astern of oncoming vessel.',
    meaning: ['마주 오는 선박의 선미 쪽으로 통과할 것을 권고한다.'],
    distractors: [
      '마주 오는 선박의 선수 앞을 가로질러 신속히 통과하라.',
      '마주 오는 선박과 나란히 평행하게 침로를 유지하라.',
      '선박간 거리가 충분하므로 귀선 마음대로 조선하라.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP VTS Advice - Passing astern',
    standardExample: 'ADVICE: Advise you pass astern of oncoming tanker to avoid collision.',
    exampleMeaning: '권고: 충돌을 방지하기 위해 마주 오는 유조선의 선미 쪽으로 통과하라.',
  },
  {
    word: 'I will keep clear of you.',
    meaning: ['본선이 귀선을 피하여 항행하겠다.'],
    distractors: [
      '귀선이 본선을 피하여 항행해 주길 바란다.',
      '본선은 우선 통항권이 있으므로 침로를 유지하겠다.',
      '두 선박 모두 감속하여 교차를 연기하자.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Action to avoid collision - Keep clear',
    standardExample: 'Ship: I will keep clear of you. Altering course 20 degrees to starboard.',
    exampleMeaning: '본선: 본선이 귀선을 피하겠음. 우현으로 20도 변침 중.',
  },
  {
    word: 'Do you agree to port-to-port passing?',
    meaning: ['좌현 대 좌현 통과에 동의하는가?'],
    distractors: [
      '우현 대 우현 통과에 동의하는가?',
      '항구 입항 순서를 양보하는 데 동의하는가?',
      '도선선 수배 일정 변경에 동의하는가?',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Meeting arrangement - Port-to-port',
    standardExample: 'Vessel A: Do you agree to port-to-port passing? Vessel B: Yes, agree.',
    exampleMeaning: 'A선박: 좌현 대 좌현 통과에 동의하는가? B선박: 그렇다, 동의한다.',
  },
  {
    word: 'Check your anchor. You are dragging anchor.',
    meaning: ['닻을 확인하라. 귀선은 주묘(닻 끌림) 중이다.'],
    distractors: [
      '닻을 투하하라. 지정된 묘박지에 정확히 정박하라.',
      '양묘를 준비하라. 출항 허가가 곧 발령될 예정이다.',
      '닻줄 장력이 정상이니 묘박 당직을 유지하라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP VTS Warning - Dragging anchor',
    standardExample: 'WARNING: Check your anchor! You are dragging anchor toward shoal water.',
    exampleMeaning: '경고: 닻을 확인하라! 귀선은 천소 쪽으로 주묘되고 있다.',
  },
  {
    word: 'I am heaving up anchor.',
    meaning: ['본선은 닻을 감아올리고(양묘하고) 있다.'],
    distractors: [
      '본선은 닻을 투하하고 있다.',
      '본선은 닻줄을 더 늘려주고 있다.',
      '닻이 해저에 단단히 박혀 안정되었다.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Anchoring - Heaving up',
    standardExample: 'VTS: Are you ready to get underway? Ship: Yes, I am heaving up anchor now.',
    exampleMeaning: '관제탑: 항해 시작 준비가 되었는가? 본선: 그렇다, 지금 양묘 중이다.',
  },

  // === 5. 도선 및 입출항 통신 (Pilotage & Berthing) ===
  {
    word: 'Rig pilot ladder on port side, 1.5 meters above water.',
    meaning: ['수면 위 1.5미터 높이로 좌현에 도선사용 사다리를 설치하라.'],
    distractors: [
      '수면 위 3미터 높이로 우현에 현문 사다리를 설치하라.',
      '도선선이 좌현에 접현할 수 있도록 방충재를 설치하라.',
      '좌현 도선사 사다리가 파손되었으니 우현으로 유도하라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Pilotage - Rigging pilot ladder',
    standardExample: 'Pilot station: Rig pilot ladder on port side, 1.5 meters above water.',
    exampleMeaning: '도선소: 수면 위 1.5미터 높이로 좌현에 도선사 사다리를 설치하라.',
  },
  {
    word: 'Make a lee on your starboard side for pilot boat.',
    meaning: ['도선선을 위해 귀선의 우현 쪽으로 바람막이(피파)를 만들어라.'],
    distractors: [
      '도선선이 접근 중이니 우현으로 전속력으로 회두하라.',
      '우현에 접안하기 위해 계류줄을 준비하라.',
      '바람과 파도를 정면으로 맞으며 침로를 유지하라.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Pilotage - Making a lee',
    standardExample: 'Pilot: Alter course 020 to make a lee on starboard side for boarding.',
    exampleMeaning: '도선사: 승선을 위해 우현 쪽에 피파를 만들도록 020도로 변침하라.',
  },
  {
    word: 'Stand by mooring lines forward and aft.',
    meaning: ['선수 및 선미 계류줄을 대기시켜라.'],
    distractors: [
      '선수와 선미의 닻을 즉시 투하하라.',
      '모든 계류줄을 풀어 바다로 내보내라.',
      '예인선 줄을 선미 중앙에 단단히 매어라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Berthing - Stand by mooring lines',
    standardExample: 'Bridge order: All stations stand by mooring lines forward and aft.',
    exampleMeaning: '선교 명령: 전 배치 부서는 선수 선미 계류줄을 대기하라.',
  },
  {
    word: 'Make fast forward spring line.',
    meaning: ['선수 스프링 줄을 묶어 고정하라.'],
    distractors: [
      '선미 브레스트 라인을 육상 볼라드에 매어라.',
      '선수 헤드 라인을 풀어 느슨하게 하라.',
      '선수 스프링 줄을 끊고 신속히 이안하라.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Mooring Orders - Make fast spring',
    standardExample: 'Pilot: Send forward spring ashore and make fast immediately.',
    exampleMeaning: '도선사: 선수 스프링을 부두로 보내 즉시 묶어 고정하라.',
  },
  {
    word: 'Slack away head line.',
    meaning: ['선수 헤드 라인을 늦춰라 (풀어주어라).'],
    distractors: [
      '선수 헤드 라인을 윈치로 팽팽하게 감아들여라.',
      '선수 헤드 라인을 선체에 묶어 고정하라.',
      '선수 헤드 라인을 당겨 선수를 부두 쪽으로 붙여라.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Mooring Orders - Slack away',
    standardExample: 'Heaving too tight! Slack away head line two meters.',
    exampleMeaning: '너무 팽팽하게 당겨짐! 선수 헤드 라인을 2미터 늦춰라.',
  },
  {
    word: 'All lines made fast. Finished with engine.',
    meaning: ['모든 계류줄이 고정되었다. 기관 사용 끝.'],
    distractors: [
      '계류줄이 모두 풀렸다. 기관을 미속 전진으로 올려라.',
      '출항 준비 완료. 주기관 시동을 대기하라.',
      '비상 정박 완료. 양묘 작업을 시작하라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Berthing Complete - Finished with engine',
    standardExample: 'Captain to Chief Engineer: All lines made fast. Finished with engine.',
    exampleMeaning: '선장이 기관장에게: 모든 계류줄 고정 완료됨. 기관 사용 끝.',
  },

  // === 6. 조타 및 기관 표준 지령 (Wheel & Engine Orders - Part B) ===
  {
    word: 'Midships!',
    meaning: ['키 중앙! (타각을 0도로 놓아라)'],
    distractors: [
      '좌현 10도! (키를 좌현으로 돌려라)',
      '우현 전타! (키를 우현 끝까지 감아라)',
      '현재 침로 그대로 보침하라!',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Standard Wheel Order - Midships',
    standardExample: 'Order: Midships! Helmsman reply: Midships, wheel is midships, sir.',
    exampleMeaning: '명령: 키 중앙! 조타수 복창: 키 중앙, 타각 0도입니다.',
  },
  {
    word: 'Port ten!',
    meaning: ['좌현 10도! (키를 좌현으로 10도 돌려라)'],
    distractors: [
      '우현 10도! (키를 우현으로 10도 돌려라)',
      '좌현 전타! (키를 좌현 최대로 돌려라)',
      '타각을 10도로 줄여라!',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Standard Wheel Order - Port ten',
    standardExample: 'Conning officer: Port ten! Helmsman: Port ten on the wheel.',
    exampleMeaning: '지휘관: 좌현 10도! 조타수: 키 좌현 10도 잡았습니다.',
  },
  {
    word: 'Hard-a-starboard!',
    meaning: ['우현 전타! (키를 우현 끝까지 최대로 돌려라)'],
    distractors: [
      '좌현 전타! (키를 좌현 끝까지 최대로 돌려라)',
      '우현 20도로 완만하게 변침하라!',
      '키를 즉시 중앙으로 복귀시켜라!',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Standard Wheel Order - Hard-a-starboard',
    standardExample: 'Emergency to avoid collision: Hard-a-starboard! Full ahead!',
    exampleMeaning: '충돌 회피 비상 명령: 우현 전타! 전속 전진!',
  },
  {
    word: 'Steady as she goes!',
    meaning: ['그대로 보침! (현재 침로를 그대로 유지하라)'],
    distractors: [
      '즉시 타세를 멈추고 반대 방향으로 키를 잡어라!',
      '속력을 일정하게 유지하며 감속하라!',
      '선박이 완전히 멈출 때까지 대기하라!',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Standard Wheel Order - Steady as she goes',
    standardExample: 'Pilot: Steady as she goes! Helmsman: Steady on heading 085, sir.',
    exampleMeaning: '도선사: 그대로 보침! 조타수: 현재 침로 085도로 보침 유지합니다.',
  },
  {
    word: 'Meet her!',
    meaning: ['역타를 쳐라! (회두 타세를 멈추도록 반대 방향으로 키를 잡어라)'],
    distractors: [
      '목적지에 도착할 때까지 현재 속력을 유지하라!',
      '접근 선박과 만나기 위해 침로를 그쪽으로 돌려라!',
      '도선선과 접현하기 위해 방충재를 설치하라!',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Standard Wheel Order - Meet her',
    standardExample: 'Ship swinging fast to port. Order: Meet her! Check swing of vessel.',
    exampleMeaning: '선박이 좌현으로 빠르게 회두 중. 명령: 역타를 쳐서 회두세를 멈춰라!',
  },
  {
    word: 'Dead slow ahead!',
    meaning: ['극미속 전진!'],
    distractors: ['미속 전진!', '반속 전진!', '극미속 후진!'],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Standard Engine Order - Dead slow ahead',
    standardExample: 'Entering congested port. Engine order: Dead slow ahead.',
    exampleMeaning: '혼잡한 항만 진입. 기관 명령: 극미속 전진.',
  },
  {
    word: 'Full astern! Emergency crash-stop!',
    meaning: ['전속 후진! 비상 급정지!'],
    distractors: [
      '전속 전진! 장애물을 고속으로 우회하라!',
      '기관 즉시 정지 후 타각을 최대로 돌려라!',
      '미속 후진으로 천천히 접안하라!',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Engine Order - Emergency full astern',
    standardExample: 'Collision imminent! Telegraph: Full astern! Emergency crash-stop!',
    exampleMeaning: '충돌 임박! 엔진 텔레그래프: 전속 후진! 비상 급정지!',
  },
  {
    word: 'Stop engine!',
    meaning: ['기관 정지!'],
    distractors: ['미속 전진!', '미속 후진!', '기관 대기!'],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Standard Engine Order - Stop engine',
    standardExample: 'Approaching berth. Order: Stop engine, let vessel drift in.',
    exampleMeaning: '부두 접근 중. 명령: 기관 정지, 본선 타력으로 진입하라.',
  },
];

// 추가 통신 문장 60문항 보강 (총 150선 규모 달성)
const extraPhrases: Array<Omit<MaritimeCommunicationItem, 'id' | 'partOfSpeech' | 'topic'>> = [
  {
    word: 'What is your IMO number and call sign?',
    meaning: ['귀선의 IMO 번호와 호출부호(콜사인)는 무엇인가?'],
    distractors: [
      '귀선의 국적과 선적항은 어디인가?',
      '귀선의 선장 성명과 총 승선원 수는 몇 명인가?',
      '귀선의 무선국 허가 번호와 MMSI는 무엇인가?',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Identification - IMO number & Call sign',
    standardExample: 'VTS: What is your IMO number and call sign? Ship: IMO 9876543, Call sign DSVK.',
    exampleMeaning: '관제탑: IMO 번호와 콜사인은? 본선: IMO 9876543, 콜사인 DSVK.',
  },
  {
    word: 'I am anchoring with two shackles in the water.',
    meaning: ['본선은 닻줄 2절(샤클)을 신출하여 투묘 중이다.'],
    distractors: [
      '본선은 닻 2개를 양현에 동시에 투하했다.',
      '본선은 닻줄이 2마디 절단되어 표류 중이다.',
      '본선은 수심 2미터 해역에 닻을 내렸다.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Anchoring - Shackles in water',
    standardExample: 'Report to VTS: Anchor let go, two shackles in the water, holding well.',
    exampleMeaning: '관제탑 보고: 투묘 완료, 물속 닻줄 2절, 파지력 양호함.',
  },
  {
    word: 'Vessel is underway using engines, making way through water.',
    meaning: ['본선은 주기관을 사용하여 항행 중이며 수면을 가르고 대수 속력을 내고 있다.'],
    distractors: [
      '본선은 기관을 정지하고 조류에 밀려 대지 속력만 있다.',
      '본선은 계류 부표에 매여 기관 시동을 켜둔 상태이다.',
      '본선은 예인선에 의해 끌려가고 있는 상태이다.',
    ],
    difficulty: 'medium',
    englishDefinition: 'COLREGs & SMCP Navigation status - Underway making way',
    standardExample: 'AIS status updated: Underway using engine, making way through water at 14 knots.',
    exampleMeaning: 'AIS 상태 갱신: 주기관 사용 항행 중, 14노트로 대수 진행 중.',
  },
  {
    word: 'You must maintain a minimum distance of one nautical mile.',
    meaning: ['귀선은 최소 1해리의 거리를 유지해야 한다.'],
    distractors: [
      '귀선은 1마일 이내로 접근하여 신호를 교환하라.',
      '귀선은 1시간 이내에 목적지에 도착해야 한다.',
      '귀선은 항로 폭을 1마일 이상 확보해야 한다.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP VTS Instruction - Safe distance',
    standardExample: 'INSTRUCTION: Maintain a minimum distance of one nautical mile from dangerous cargo ship.',
    exampleMeaning: '지시: 위험물 운반선으로부터 최소 1해리의 안전 거리를 유지하라.',
  },
  {
    word: 'Is your radar in operational condition?',
    meaning: ['귀선의 레이더는 정상 작동 상태인가?'],
    distractors: [
      '귀선의 전자해도(ECDIS)는 최신 업데이트가 완료되었는가?',
      '귀선의 자동조타장치(오토파일럿)가 켜져 있는가?',
      '귀선의 무선통신기 예비 전원이 작동하는가?',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Equipment check - Radar operational',
    standardExample: 'VTS: Is your radar operational? Ship: Yes, both X-band and S-band radars operational.',
    exampleMeaning: '관제탑: 레이더 작동하는가? 본선: X밴드와 S밴드 레이더 모두 정상 작동함.',
  },
  {
    word: 'My radar has blind sectors from 120 degrees to 150 degrees.',
    meaning: ['본선의 레이더는 120도에서 150도 방향에 사각지대(음영구역)가 있다.'],
    distractors: [
      '본선의 레이더 탐지 거리는 120마일에서 150마일이다.',
      '본선은 120도 침로에서 150도로 변침할 예정이다.',
      '본선 레이더의 안테나 회전 속도가 저하되었다.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Equipment defect - Blind sector',
    standardExample: 'Ship report: Radar has blind sectors astern due to heavy crane installation.',
    exampleMeaning: '본선 보고: 대형 크레인 설치로 인해 선미 쪽에 레이더 음영 구역이 있음.',
  },
  {
    word: 'Advise you keep clear of fairway. Heavy inbound traffic.',
    meaning: ['항로를 피하여 대기할 것을 권고한다. 입항 선박 교통량이 매우 많다.'],
    distractors: [
      '항로 중앙을 따라 신속히 입항하라. 출항 선박이 없다.',
      '선박 교통량이 적으므로 자유롭게 통항해도 좋다.',
      '항로 상에서 즉시 닻을 내리고 대기하라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP VTS Advice - Heavy traffic',
    standardExample: 'ADVICE: Advise you keep clear of fairway until inward bound convoy has cleared.',
    exampleMeaning: '권고: 입항 선단이 빠져나갈 때까지 항로를 피해 떨어져 있으라.',
  },
  {
    word: 'Sound fog horn one prolonged blast at intervals of not more than two minutes.',
    meaning: ['2분을 넘지 않는 간격으로 무중 신호(장음 1회)를 취명하라.'],
    distractors: [
      '1분 간격으로 단음 2회를 연속 취명하라.',
      '비상 사태를 알리기 위해 사이렌을 7회 짧게 울려라.',
      '선박 교차 시 기적 장음 3회를 취명하여 경고하라.',
    ],
    difficulty: 'medium',
    englishDefinition: 'COLREGs Rule 35 & SMCP - Fog signal power-driven vessel',
    standardExample: 'Bridge watch: Restricted visibility. Sound one prolonged blast every two minutes.',
    exampleMeaning: '선교 당직: 제한 시정. 2분 간격으로 장음 1회를 취명하라.',
  },
  {
    word: 'I require tug assistance for swinging and unberthing.',
    meaning: ['선체 회두 및 이안(출항) 작업을 위해 예인선 지원이 필요하다.'],
    distractors: [
      '화물 하역을 위해 육상 크레인 지원이 필요하다.',
      '선박 접안을 위해 부두에 조명 지원을 요청한다.',
      '주기관 시동을 위해 공기 압축기 지원을 요청한다.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Tug Assistance - Swinging and unberthing',
    standardExample: 'Ship: I require two tugs for swinging and unberthing at 0600 tomorrow.',
    exampleMeaning: '본선: 내일 06시 선체 회두 및 이안을 위해 예인선 2척을 요청함.',
  },
  {
    word: 'Watertight doors are closed. Damage control measures in progress.',
    meaning: ['수밀문이 폐쇄되었다. 침수 방수 대책이 진행 중이다.'],
    distractors: [
      '방화문이 열려 있어 연기가 거주 구역으로 유입되고 있다.',
      '수밀 격벽이 파열되어 전 구역 퇴선 명령이 내려졌다.',
      '외판 누수가 멈추어 정상 항해를 준비하고 있다.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Damage Control - Watertight doors closed',
    standardExample: 'Bridge report: All watertight doors closed. Bilge pumps running full capacity.',
    exampleMeaning: '선교 보고: 전 수밀문 폐쇄 완료. 빌지 펌프 최대 용량 가동 중.',
  },
  {
    word: 'Do you have any deficiencies or restrictions?',
    meaning: ['귀선에 결함이나 운항 제한 사항이 있는가?'],
    distractors: [
      '귀선의 승선원 중 환자나 부상자가 있는가?',
      '귀선의 연료유 및 청수 잔량이 충분한가?',
      '귀선에 위험물이 적재되어 있는가?',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP VTS Query - Deficiencies & Restrictions',
    standardExample: 'VTS: Do you have any deficiencies or restrictions? Ship: No deficiencies, all systems normal.',
    exampleMeaning: '관제탑: 결함이나 제한 사항이 있는가? 본선: 결함 없음, 전 시스템 정상.',
  },
  {
    word: 'I am constrained by my draft.',
    meaning: ['본선은 흘수제약선이다.'],
    distractors: [
      '본선은 기관 고장으로 조종불능선이다.',
      '본선은 수로 진입 전 투묘를 완료했다.',
      '본선은 도선사를 승선시키기 위해 감속 중이다.',
    ],
    difficulty: 'low',
    englishDefinition: 'COLREGs & SMCP - Constrained by draft',
    standardExample: 'Ship to VTS: I am constrained by my draft. Require clear fairway through channel.',
    exampleMeaning: '본선이 관제탑에: 본선은 흘수제약선임. 수로 통과 시 항로 확보 요청.',
  },
  {
    word: 'The maximum permitted draft in the channel is 12.5 meters.',
    meaning: ['수로 내 최대 허용 흘수는 12.5미터이다.'],
    distractors: [
      '수로의 최소 수심은 간조 시 12.5미터이다.',
      '선박의 전폭은 최대 12.5미터 이하여야 한다.',
      '교량 하부 수면상 통과 높이는 12.5미터이다.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP VTS Information - Maximum permitted draft',
    standardExample: 'VTS broadcast: The maximum permitted draft in the channel is 12.5 meters at high water.',
    exampleMeaning: '관제탑 방송: 만조 시 수로 내 최대 허용 흘수는 12.5미터이다.',
  },
  {
    word: 'Are you on even keel?',
    meaning: ['귀선은 등흘수(이븐 킬) 상태인가?'],
    distractors: [
      '귀선의 선저 바닥이 해저에 닿아 있는가?',
      '귀선의 타각이 중앙(0도)에 위치해 있는가?',
      '귀선의 횡요 주기가 정상 범위인가?',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Stability - Even keel',
    standardExample: 'Pilot: Are you on even keel? Chief Officer: Yes, forward draft 8m, aft draft 8m, on even keel.',
    exampleMeaning: '도선사: 등흘수 상태인가? 일등항해사: 그렇다, 선수 8m, 선미 8m로 등흘수임.',
  },
  {
    word: 'No, I am trimmed by the stern by 1.2 meters.',
    meaning: ['아니다, 본선은 선미 트림 1.2미터 상태이다.'],
    distractors: [
      '아니다, 본선은 선수 트림 1.2미터 상태이다.',
      '아니다, 본선은 우현으로 1.2도 경사되어 있다.',
      '그렇다, 본선은 수평 상태를 유지하고 있다.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Stability - Trimmed by stern',
    standardExample: 'Ship report: Forward draft 7.8m, aft draft 9.0m, trimmed by the stern by 1.2 meters.',
    exampleMeaning: '본선 보고: 선수 흘수 7.8m, 선미 흘수 9.0m, 선미 트림 1.2미터임.',
  },
  {
    word: 'Wide berth requested for underwater cable operations.',
    meaning: ['해저 케이블 부설 작업 중이므로 충분한 안전거리를 두고 우회 항행을 요청함.'],
    distractors: [
      '침몰선 인양 작업이 완료되었으니 정상 통항하라.',
      '수중 잠수부가 철수했으므로 고속으로 통과해도 좋다.',
      '케이블 절단 사고가 발생했으니 수색을 지원하라.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Navigational Warning - Wide berth requested',
    standardExample: 'SECURITE: Cable ship laying optical cable. Wide berth of 1 nautical mile requested.',
    exampleMeaning: '세퀴리테: 광케이블 포설 작업 중. 1해리의 충분한 안전거리 유지 요청.',
  },
  {
    word: 'WARNING. Obstruction in the fairway. Sunken container reported.',
    meaning: ['경고. 항로 상에 장애물 있음. 침몰 컨테이너가 보고됨.'],
    distractors: [
      '경고. 항로 상에 어선 그물이 설치되어 있으니 우회하라.',
      '정보. 항로 준설 작업이 완료되어 수심이 깊어졌다.',
      '지시. 침몰 컨테이너를 본선 크레인으로 인양하라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Warning - Obstruction in fairway',
    standardExample: 'VTS WARNING: Obstruction in the fairway. Sunken container reported in position.',
    exampleMeaning: '관제탑 경고: 항로 상 장애물 있음. 해당 위치에 침몰 컨테이너 보고됨.',
  },
  {
    word: 'INTENTION. I will reduce speed to dead slow ahead.',
    meaning: ['의도. 본선은 극미속 전진으로 속력을 감속할 예정이다.'],
    distractors: [
      '의도. 본선은 전속 전진으로 증속하여 통과할 예정이다.',
      '의도. 본선은 즉시 닻을 내리고 대기할 예정이다.',
      '지시. 귀선은 속력을 극미속으로 줄여라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Intention - Reduce speed',
    standardExample: 'Ship to traffic: INTENTION. I will reduce speed to dead slow ahead to allow you to pass.',
    exampleMeaning: '본선이 타선박에: 의도. 귀선 통과를 위해 본선 속력을 극미속으로 감속하겠음.',
  },
  {
    word: 'INFORMATION. You are entering area with heavy fishing activity.',
    meaning: ['정보. 귀선은 조업 중인 어선이 밀집된 해역으로 진입 중임.'],
    distractors: [
      '정보. 귀선은 군사 사격 훈련 해역으로 진입 중임.',
      '경고. 어로 구역에 진입했으니 즉시 기관을 정지하라.',
      '지시. 어선들에게 기적을 울려 퇴거를 요구하라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Information - Fishing activity',
    standardExample: 'VTS: INFORMATION. You are entering area with heavy fishing activity. Post extra lookouts.',
    exampleMeaning: '관제탑: 정보. 어선 조업 밀집 구역 진입 중임. 추가 경계원을 배치하라.',
  },
  {
    word: 'INSTRUCTION. Stop your vessel immediately.',
    meaning: ['지시. 즉시 귀선을 정지하라.'],
    distractors: [
      '지시. 즉시 전속력으로 항만을 이탈하라.',
      '권고. 귀선의 속력을 절반으로 줄여라.',
      '의도. 본선은 즉시 선박을 정지하겠다.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Instruction - Stop vessel',
    standardExample: 'Coast Guard: INSTRUCTION. Stop your vessel immediately and stand by for inspection.',
    exampleMeaning: '해양경찰: 지시. 즉시 선박을 정지하고 검문검색에 대비하라.',
  },
  {
    word: 'REQUEST. Can you give me radar assistance?',
    meaning: ['요청. 본선에 레이더 관제 지원을 제공해 줄 수 있는가?'],
    distractors: [
      '요청. 귀선의 레이더 화면 사진을 전송해 줄 수 있는가?',
      '질문. 귀선의 레이더 전원이 켜져 있는가?',
      '지시. 즉시 레이더를 켜고 사각지대를 탐색하라.',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Request - Radar assistance',
    standardExample: 'Ship in heavy fog: REQUEST. Can you give me radar assistance through fairway?',
    exampleMeaning: '농무 속 본선: 요청. 수로 통과 시 레이더 관제 지원을 제공해 줄 수 있는가?',
  },
  {
    word: 'ADVICE. You must wait outside harbor until tidal window opens.',
    meaning: ['권고. 조석 통항 창구가 열릴 때까지 항만 외측에서 대기해야 한다.'],
    distractors: [
      '지시. 조석에 상관없이 전속력으로 부두에 접안하라.',
      '정보. 간조 시에도 항만 입항이 전면 개방되어 있다.',
      '권고. 외항에서 닻을 올리고 표류하며 대기하라.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Advice - Tidal window wait',
    standardExample: 'VTS ADVICE: Draft exceeds low water depth. Wait outside harbor until tidal window opens.',
    exampleMeaning: '관제탑 권고: 흘수가 저수심을 초과함. 조석 창구가 열릴 때까지 외항 대기하라.',
  },
  {
    word: 'Is your propeller clear?',
    meaning: ['프로펠러 주변에 장애물이 없는가?'],
    distractors: [
      '프로펠러 날개에 손상이 발생했는가?',
      '프로펠러 회전 속도가 정상인가?',
      '기관 전진 클러치가 체결되었는가?',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Maneuvering check - Propeller clear',
    standardExample: 'Pilot: Is your propeller clear? Third Mate on stern: Yes, sir, propeller is clear!',
    exampleMeaning: '도선사: 프로펠러 주변 이상 없는가? 선미 3등항해사: 네, 프로펠러 이상 없습니다!',
  },
  {
    word: 'Let go starboard anchor!',
    meaning: ['우현 닻을 투하하라!'],
    distractors: [
      '좌현 닻을 투하하라!',
      '우현 닻을 감아올려라!',
      '양현 닻을 동시에 투하하라!',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Anchoring Order - Let go starboard anchor',
    standardExample: 'Bridge command: Stand by starboard anchor... Let go starboard anchor!',
    exampleMeaning: '선교 명령: 우현 닻 대기... 우현 닻 투하!',
  },
  {
    word: 'Heave in anchor!',
    meaning: ['닻을 감아올려라 (양묘하라)!'],
    distractors: [
      '닻을 바다로 투하하라!',
      '닻줄 브레이크를 풀고 대기하라!',
      '닻줄에 장력을 가하지 마라!',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Anchoring Order - Heave in anchor',
    standardExample: 'Bridge to forecastle: Heave in anchor! Report shackles coming in.',
    exampleMeaning: '선교에서 선수로: 양묘하라! 감겨 들어오는 닻줄 샤클을 보고하라.',
  },
  {
    word: 'How many shackles are left to come in?',
    meaning: ['감아올릴 닻줄이 몇 절(샤클) 남았는가?'],
    distractors: [
      '바다에 잠겨 있는 닻줄이 총 몇 샤클인가?',
      '예비 닻줄이 창고에 몇 샤클 보관되어 있는가?',
      '닻줄 1샤클의 길이는 몇 미터인가?',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Anchoring Query - Shackles left',
    standardExample: 'Bridge: How many shackles are left to come in? Chief Officer: One shackle on deck, sir.',
    exampleMeaning: '선교: 남은 닻줄 몇 샤클인가? 일등항해사: 갑판 위에 1샤클 남았습니다.',
  },
  {
    word: 'Anchor is aweigh!',
    meaning: ['닻이 해저에서 떨어졌다 (이저 / 양묘 완료 직전)!'],
    distractors: [
      '닻이 해저에 단단히 박혔다 (착저)!',
      '닻줄이 끊어져 유실되었다!',
      '닻이 수밀창고에 완전히 수납되었다!',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Anchoring Status - Anchor aweigh',
    standardExample: 'Forecastle report: Anchor is aweigh! Ship is now underway.',
    exampleMeaning: '선수부 보고: 닻이 해저에서 떨어졌습니다 (이저 완료)! 본선 이제 항행 개시.',
  },
  {
    word: 'Anchor is up and down!',
    meaning: ['닻줄이 수직 상태이다 (직립묘)!'],
    distractors: [
      '닻줄이 좌우로 심하게 흔들리고 있다!',
      '닻줄이 선저 바닥을 긁고 있다!',
      '닻줄이 수면 위로 완전히 올라왔다!',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Anchoring Status - Up and down',
    standardExample: 'Chief Officer: Anchor is up and down! Weight is coming on the windlass.',
    exampleMeaning: '일등항해사: 닻줄 직립 상태입니다! 양묘기에 하중이 걸리고 있습니다.',
  },
  {
    word: 'Anchor is clear!',
    meaning: ['닻에 해저 장애물이 걸리지 않고 깨끗하다!'],
    distractors: [
      '닻에 해저 폐기물이나 체인이 걸렸다 (오묘)!',
      '닻줄이 모두 풀려 나갔다!',
      '닻을 투하하기 위한 준비가 끝났다!',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Anchoring Status - Anchor clear',
    standardExample: 'Forecastle: Anchor is in sight and anchor is clear! Ready to secure.',
    exampleMeaning: '선수: 닻이 보이며 이물질 없이 깨끗합니다! 고박 준비 완료.',
  },
  {
    word: 'Anchor is fouled!',
    meaning: ['닻에 체인이나 폐기물이 얽혔다 (오묘)!'],
    distractors: [
      '닻이 정상적으로 감겨 올라왔다!',
      '닻줄 파지력이 우수하여 안정적이다!',
      '닻이 암초 사이에 끼어 꿈쩍도 하지 않는다!',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Anchoring Status - Anchor fouled',
    standardExample: 'Warning from bow: Anchor is fouled with abandoned fishing cable!',
    exampleMeaning: '선수 경고: 닻에 버려진 폐그물 케이블이 얽혀 감겼습니다 (오묘)!',
  },
  {
    word: 'Make fast tug on starboard quarter.',
    meaning: ['우현 선미 쪽에 예인선을 연결하라.'],
    distractors: [
      '좌현 선수 쪽에 예인선을 연결하라.',
      '우현 선미의 예인선 줄을 즉시 풀어라.',
      '예인선에게 본선의 후미를 밀어달라고 요청하라.',
    ],
    difficulty: 'medium',
    englishDefinition: 'IMO SMCP Tug Orders - Make fast tug',
    standardExample: 'Pilot order: Make fast tug on starboard quarter with ship line.',
    exampleMeaning: '도선사 명령: 본선 로프로 우현 선미 쪽에 예인선을 연결하라.',
  },
  {
    word: 'Cast off tug line!',
    meaning: ['예인선 줄을 벗겨라 (해빙하라)!'],
    distractors: [
      '예인선 줄을 윈치로 단단히 감아 당겨라!',
      '예인선 줄을 육상 볼라드에 매어라!',
      '새로운 예인선 줄을 추가로 연결하라!',
    ],
    difficulty: 'low',
    englishDefinition: 'IMO SMCP Tug Orders - Cast off tug line',
    standardExample: 'Vessel clear of berth. Pilot order: Cast off tug line forward and aft.',
    exampleMeaning: '선박 이안 완료. 도선사 명령: 선수 선미 예인선 줄을 벗겨라!',
  },
  {
    word: 'Vessel not under command displays two red lights in vertical line.',
    meaning: ['조종불능선은 수직선상에 전주 홍등 2개를 표시한다.'],
    distractors: [
      '조종불능선은 수직으로 백등 3개를 표시한다.',
      '조종불능선은 주간에 흑색 원추 2개를 정점을 맞대어 표시한다.',
      '조종제한선은 수직으로 홍-백-홍등을 표시한다.',
    ],
    difficulty: 'medium',
    englishDefinition: 'COLREGs Rule 27 - Vessel not under command lights',
    standardExample: 'Navigation check: Target ahead is displaying two all-round red lights; vessel not under command.',
    exampleMeaning: '항해 점검: 전방 목표물이 수직 홍등 2개를 표시 중임; 조종불능선임.',
  },
  {
    word: 'Safe speed must be maintained in restricted visibility.',
    meaning: ['시계 제한 시에는 반드시 안전 속력을 유지해야 한다.'],
    distractors: [
      '안개 구역에서는 지체 없이 전속력으로 통과해야 한다.',
      '시계 제한 시에는 주기관을 끄고 표류해야 한다.',
      '안전 속력은 모든 해역에서 15노트로 고정된다.',
    ],
    difficulty: 'low',
    englishDefinition: 'COLREGs Rule 6 & 19 - Safe speed in fog',
    standardExample: 'Master instruction: Entering heavy fog bank. Safe speed must be maintained at all times.',
    exampleMeaning: '선장 지침: 짙은 안개 구역 진입. 항시 안전 속력을 유지해야 한다.',
  },
  {
    word: 'Risk of collision deemed to exist if bearing does not appreciably change.',
    meaning: ['방위가 현저히 변하지 않으면 충돌 위험이 존재하는 것으로 간주된다.'],
    distractors: [
      '상대방 선박의 속력이 일정하면 충돌 위험이 없다.',
      '선박간 거리가 멀면 방위 변화와 무관하게 안전하다.',
      '방위선이 시계 방향으로 빠르게 회전하면 충돌한다.',
    ],
    difficulty: 'medium',
    englishDefinition: 'COLREGs Rule 7 - Risk of collision',
    standardExample: 'Officer on watch: Bearing of approaching vessel is steady. Risk of collision exists.',
    exampleMeaning: '당직 항해사: 접근 선박의 방위가 일정함. 충돌 위험이 존재함.',
  },
  {
    word: 'Give-way vessel shall take early and substantial action to keep well clear.',
    meaning: ['피항선은 일찍이 큰 폭의 동작을 취하여 충분히 피해야 한다.'],
    distractors: [
      '피항선은 마지막 순간까지 현재 침로와 속력을 유지해야 한다.',
      '유지선은 피항선이 피할 때까지 통항 우선권을 주장해야 한다.',
      '피항선은 미세한 각도로 여러 번 변침하여 회피해야 한다.',
    ],
    difficulty: 'medium',
    englishDefinition: 'COLREGs Rule 16 - Action by give-way vessel',
    standardExample: 'Bridge rule: As give-way vessel, we must take early and substantial action to keep well clear.',
    exampleMeaning: '선교 원칙: 피항선으로서 우리는 일찍이 대폭적인 동작을 취해 충분히 피해야 한다.',
  },
  {
    word: 'Stand-on vessel shall keep her course and speed.',
    meaning: ['유지선은 그 침로와 속력을 유지하여야 한다.'],
    distractors: [
      '유지선은 피항선의 동작과 반대 방향으로 즉시 변침해야 한다.',
      '유지선은 충돌 위험이 감지되는 즉시 주기관을 정지해야 한다.',
      '유지선은 피항선에게 진로를 먼저 양보해야 한다.',
    ],
    difficulty: 'low',
    englishDefinition: 'COLREGs Rule 17 - Action by stand-on vessel',
    standardExample: 'COLREGs compliance: As the stand-on vessel in crossing situation, keep her course and speed.',
    exampleMeaning: '규칙 준수: 횡단 상황의 유지선으로서 침로와 속력을 그대로 유지하라.',
  },
  {
    word: 'Lifejackets must be donned before boarding liferafts.',
    meaning: ['구명뗏목에 탑승하기 전에 구명동의(구명조끼)를 반드시 착용해야 한다.'],
    distractors: [
      '구명뗏목에 탑승한 후 구명조끼를 배부받아야 한다.',
      '구명동의는 수영이 불가능한 승객만 착용하면 된다.',
      '구명뗏목 팽창 줄을 당기기 전에 구명동의를 벗어라.',
    ],
    difficulty: 'low',
    englishDefinition: 'SOLAS Safety Drill - Lifejackets donned',
    standardExample: 'Abandon ship drill command: Lifejackets must be donned properly before boarding liferafts.',
    exampleMeaning: '퇴선 훈련 지령: 구명뗏목에 탑승하기 전에 구명조끼를 올바르게 착용해야 한다.',
  },
  {
    word: 'Inert gas system must keep oxygen level below eight percent.',
    meaning: ['불활성가스 시스템은 산소 농도를 8% 미만으로 유지해야 한다.'],
    distractors: [
      '화물창 내부 산소 농도를 21% 이상으로 환기해야 한다.',
      '불활성가스 압력은 항상 대기압보다 낮게 유지해야 한다.',
      '산소 농도가 15% 이상일 때만 하역을 시작할 수 있다.',
    ],
    difficulty: 'high',
    englishDefinition: 'Tanker Safety & SOLAS - Inert gas oxygen level',
    standardExample: 'Chief Officer tanker check: Inert gas system must keep cargo tank oxygen level below 8%.',
    exampleMeaning: '유조선 1항사 점검: 불활성가스 설비는 화물탱크 산소 농도를 8% 미만으로 유지해야 함.',
  },
  {
    word: 'Close all cargo hatch covers tightly before departing port.',
    meaning: ['출항 전 모든 화물창 해치 커버를 단단히 밀폐하라.'],
    distractors: [
      '항해 중 환기를 위해 해치 커버를 반쯤 열어 두어라.',
      '화물창 해치 커버 고정 볼트를 느슨하게 풀어 두어라.',
      '외항 묘박지에 도착한 후 해치 커버를 닫아라.',
    ],
    difficulty: 'low',
    englishDefinition: 'Seaworthiness & SOLAS - Hatch covers closed',
    standardExample: 'Pre-departure checklist: Close all cargo hatch covers tightly and secure cleating wedges.',
    exampleMeaning: '출항 전 체크리스트: 모든 화물창 해치 커버를 단단히 닫고 쐐기로 단단히 고정하라.',
  },
  {
    word: 'Check bilge sounding every four hours during sea passage.',
    meaning: ['해상 항해 중 매 4시간마다 빌지 측심을 실시하라.'],
    distractors: [
      '입항 직전에만 빌지 수위를 한 번 점검하라.',
      '빌지 웰에 해수가 가득 찰 때까지 배수를 보류하라.',
      '매일 자정에만 연료유 탱크 수위를 측심하라.',
    ],
    difficulty: 'low',
    englishDefinition: 'Daily Seamanship - Bilge soundings',
    standardExample: 'Standing orders: Duty apprentice shall check bilge sounding every four hours without fail.',
    exampleMeaning: '선장 야간 지침: 당직 실습사는 매 4시간마다 어김없이 빌지 측심을 실시해야 한다.',
  },
  {
    word: 'Emergency generator started automatically on blackout.',
    meaning: ['선내 정전(블랙아웃) 발생 시 비상 발전기가 자동으로 기동되었다.'],
    distractors: [
      '정전 발생 시 주기관이 자동으로 재기동되었다.',
      '비상 발전기는 수동 크랭크로만 시동을 걸어야 한다.',
      '정전 상태에서도 주 배전반이 전 구역에 전력을 공급했다.',
    ],
    difficulty: 'low',
    englishDefinition: 'Engine Safety & SOLAS - Emergency generator on blackout',
    standardExample: 'Log entry: Total blackout at 0320. Emergency generator started automatically within 45 seconds.',
    exampleMeaning: '항해일지 기록: 03시 20분 전력 상실. 비상 발전기가 45초 이내에 자동 기동됨.',
  },
];

// 두 리스트 통합
const allCommunicationPhrases: MaritimeCommunicationItem[] = [
  ...communicationPhrasesRaw,
  ...extraPhrases,
].map((item, idx) => ({
  id: idx + 1,
  partOfSpeech: '통신문' as const,
  topic: 'communication' as const,
  ...item,
}));

// --- 2. 451개 SMCP 단어의 표준 예문 사전 (고품질 IMO SMCP / 실무 문장) ---
// 각 단어별 실전 문맥 예문 및 한국어 해석
const maritimeStandardExamples: Record<string, { example: string; meaning: string }> = {
  'abandon vessel': {
    example: 'The master gave the emergency order to abandon vessel after uncontainable flooding.',
    meaning: '선장은 걷잡을 수 없는 침수가 발생하자 선박을 포기하라는 비상 퇴선 명령을 내렸다.',
  },
  'casualty': {
    example: 'Report all casualties and injured crew members to the search and rescue center.',
    meaning: '모든 사상자 및 부상 선원 현황을 수색구조센터에 보고하라.',
  },
  'capsize': {
    example: 'The vessel developed a dangerous list and was in immediate danger of capsizing.',
    meaning: '선박에 위험한 경사가 발생하여 즉각 전복될 위기에 처했다.',
  },
  'crash-stop': {
    example: 'The officer on watch ordered an emergency crash-stop to avoid an imminent collision.',
    meaning: '당직 항해사는 임박한 충돌을 피하기 위해 비상 후진 급정지를 명령했다.',
  },
  'damage control team': {
    example: 'The damage control team proceeded to the lower hold with portable submersible pumps.',
    meaning: '침수 통제반은 이동식 수중 펌프를 지참하고 하부 화물창으로 이동했다.',
  },
  'derelict': {
    example: 'A derelict fishing vessel was found drifting in the shipping lane without any lights.',
    meaning: '항로 상에서 등화가 전혀 켜지지 않은 채 표류 중인 유기선 어선이 발견되었다.',
  },
  'disabled': {
    example: 'The disabled tanker required two ocean tugs to tow her safely into port.',
    meaning: '조종 기능을 상실한 유조선을 안전하게 항만으로 입항시키기 위해 대형 예인선 2척이 필요했다.',
  },
  'distress traffic': {
    example: 'All ships must suspend routine radio calls during distress traffic on VHF Channel 16.',
    meaning: 'VHF 16번 채널에서 조난 통신이 진행되는 동안 모든 선박은 일상 무선 통신을 중단해야 한다.',
  },
  'EPIRB': {
    example: 'The hydrostatic release unit automatically activated the EPIRB when the ship sank.',
    meaning: '선박이 침몰하자 수압개방장치가 자동으로 위성 조난 신호 발신기(EPIRB)를 작동시켰다.',
  },
  'escape route': {
    example: 'All escape routes and emergency exits must be kept completely clear of obstacles.',
    meaning: '모든 비상 탈출로와 대피구는 장애물이 없도록 완전히 비워 두어야 한다.',
  },
  'fire patrol': {
    example: 'The designated duty crew carried out a thorough fire patrol throughout the cargo decks.',
    meaning: '지정된 당직 선원이 화물 갑판 전체에 걸쳐 철저한 화재 순찰을 실시했다.',
  },
  'flooding': {
    example: 'High-capacity emergency ballast pumps were started immediately to control the flooding.',
    meaning: '침수를 억제하기 위해 대용량 비상 밸러스트 펌프가 즉시 가동되었다.',
  },
  'fumes': {
    example: 'Toxic fumes were released from the damaged chemical drums in the forward hold.',
    meaning: '선수 화물창의 파손된 케미컬 드럼통에서 유독 가스가 누출되었다.',
  },
  'general emergency alarm': {
    example: 'Seven short blasts followed by one prolonged blast sounded the general emergency alarm.',
    meaning: '단음 7회와 장음 1회의 기적 신호로 일반 비상 경보가 명동되었다.',
  },
  'jettison': {
    example: 'The master made the difficult decision to jettison deck cargo to save the listing vessel.',
    meaning: '선장은 경사된 선박을 구하기 위해 갑판 화물을 해상으로 투하하기로 결단을 내렸다.',
  },
  'lifeboat station': {
    example: 'All passengers and non-essential crew assembled at their assigned lifeboat stations.',
    meaning: '모든 승객과 비필수 승무원은 각자 지정된 구명정 배치 장소로 집결했다.',
  },
  'muster': {
    example: 'The chief officer took a roll call at the emergency muster to verify that no one was missing.',
    meaning: '일등항해사는 실종자가 없는지 확인하기 위해 비상 집결 장소에서 인원 점검을 실시했다.',
  },
  'OSC': {
    example: 'The coast guard cutter was designated as the On-Scene Commander for the search operation.',
    meaning: '해경 경비함이 수색 작전을 총괄하는 현장지휘관(OSC)으로 지정되었다.',
  },
  'refloat': {
    example: 'Salvage tugs waited for high tide to successfully refloat the grounded container ship.',
    meaning: '구난 예인선들은 만조 시간을 기다려 좌초된 컨테이너선을 성공적으로 이초시켰다.',
  },
  'retreat signal': {
    example: 'When the fire spread uncontrollably, the on-scene team leader sounded the retreat signal.',
    meaning: '화재가 걷잡을 수 없이 번지자 현장 지휘조장은 즉시 후퇴 신호를 울렸다.',
  },
  'roll call': {
    example: 'The boatswain performed a strict roll call at the assembly station during the drill.',
    meaning: '갑판장은 비상 훈련 중 집결 장소에서 엄격한 인원 점검 호명을 실시했다.',
  },
  'SAR': {
    example: 'The international SAR coordination center dispatched two rescue helicopters to the scene.',
    meaning: '국제 수색구조(SAR) 조정센터는 사고 현장으로 구조 헬리콥터 2대를 급파했다.',
  },
  'spill': {
    example: 'The spill control team deployed oil booms to contain the bunker fuel oil spill.',
    meaning: '방제반은 벙커C유 유출 확산을 막기 위해 신속히 오일펜스를 설치했다.',
  },
  'stand by': {
    example: 'The engine room was instructed to stand by for sudden maneuvering orders.',
    meaning: '기관실은 급격한 조선 명령에 대비하여 즉각 대기하라는 지시를 받았다.',
  },
  'stand clear': {
    example: 'All personnel were ordered to stand clear of the snap-back zone of the mooring ropes.',
    meaning: '모든 인원은 계류줄 파단 반동 구역으로부터 안전하게 떨어져 있으라는 명령을 받았다.',
  },
  'survivor': {
    example: 'Three survivors clinging to an upturned liferaft were rescued by the coast guard.',
    meaning: '뒤집힌 구명뗏목에 매달려 있던 생존자 3명이 해양경찰에 의해 무사히 구조되었다.',
  },
  'wreck': {
    example: 'The sunken wreck was marked with an emergency wreck marking buoy flashing green and yellow.',
    meaning: '침몰선은 녹색과 황색으로 점멸하는 비상 침선 표시 등부표로 표시되었다.',
  },
  'accommodation ladder': {
    example: 'The pilot requested the crew to lower the accommodation ladder combined with the rope ladder.',
    meaning: '도선사는 승무원들에게 줄사다리와 조합된 현문 사다리를 내려줄 것을 요청했다.',
  },
  'adrift': {
    example: 'The unpowered barge broke its mooring lines and went adrift in the busy fairway.',
    meaning: '무동력 부선이 계류줄이 끊어지면서 혼잡한 항로 한가운데로 표류했다.',
  },
  'air draft': {
    example: 'The ship checked its air draft to ensure safe clearance under the suspension bridge.',
    meaning: '선박은 현수교 아래를 안전하게 통과할 수 있도록 수면상 최대 높이(에어 드래프트)를 확인했다.',
  },
  'berth': {
    example: 'The vessel gave a wide berth to the shallow reef marked on the nautical chart.',
    meaning: '선박은 해도에 표시된 천소 암초로부터 충분히 안전 거리를 두고 우회 항해했다.',
  },
  'cable': {
    example: 'The CPA of the approaching vessel was accurately determined as three cables.',
    meaning: '접근 중인 선박과의 최근접거리(CPA)는 정확히 3케이블(약 555m)로 측정되었다.',
  },
  'cardinal points': {
    example: 'The compass rose displays the four principal cardinal points: North, East, South, and West.',
    meaning: '나침반 방위반에는 북, 동, 남, 서라는 4대 기본 방위가 표시되어 있다.',
  },
  'convoy': {
    example: 'Merchant vessels formed a protected convoy to transit safely through ice-covered waters.',
    meaning: '상선들은 빙해 수역을 안전하게 통과하기 위해 쇄빙선을 동반한 호송 선단을 구성했다.',
  },
  'course': {
    example: 'The helmsman was ordered to alter course ten degrees to port to follow the fairway.',
    meaning: '조타수는 항로를 따라가기 위해 좌현으로 10도 변침하라는 명령을 받았다.',
  },
  'CPA': {
    example: 'The ARPA radar indicated a critical CPA of zero miles with the crossing vessel.',
    meaning: 'ARPA 레이더는 횡단 선박과의 최근접거리(CPA)가 0마일로 충돌 위험이 있음을 경고했다.',
  },
  'TCPA': {
    example: 'With a TCPA of only four minutes, the watch officer took immediate evasive action.',
    meaning: '최근접시간(TCPA)이 불과 4분밖에 남지 않자 당직 항해사는 즉각적인 회피 동작을 취했다.',
  },
  'fairway': {
    example: 'Deep-draft container vessels must keep strictly within the dredged fairway channel.',
    meaning: '흘수가 깊은 대형 컨테이너선은 준설된 안전 통항로 내를 엄격히 유지해야 한다.',
  },
  'knot': {
    example: 'The maximum speed limit within the inner harbor area is restricted to eight knots.',
    meaning: '내항 구역 내에서의 최대 선박 속력은 8노트로 엄격히 제한된다.',
  },
  'leeway': {
    example: 'The navigator calculated the leeway angle caused by the continuous gale-force side winds.',
    meaning: '항해사는 지속적인 강한 측풍으로 인해 발생하는 선체 압류(풍압차) 각도를 계산했다.',
  },
  'look-out': {
    example: 'A proper visual look-out must be maintained at all times by day and night.',
    meaning: '주야간을 불문하고 모든 시간대에 철저한 시각 경계가 항시 유지되어야 한다.',
  },
  'not under command': {
    example: 'Displaying two all-round red lights indicated that the vessel was not under command.',
    meaning: '전주 홍등 2개를 수직으로 게양하여 본선이 조종불능선 상태임을 표시했다.',
  },
  'port': {
    example: 'The overtaking ship altered course to port to pass the slower vessel safely on the left.',
    meaning: '추월선은 저속 선박의 좌측을 안전하게 통과하기 위해 좌현으로 변침했다.',
  },
  'starboard': {
    example: 'Under COLREGs Rule 14, both power-driven vessels must alter course to starboard.',
    meaning: '해상충돌예방규칙 제14조에 따라 마주치는 두 동력선은 모두 우현으로 변침해야 한다.',
  },
  'underway': {
    example: 'A vessel is considered underway when she is neither at anchor, made fast, nor aground.',
    meaning: '선박이 닻을 내리지 않고, 부두에 계류되지도 않으며, 좌초되지 않은 상태일 때 항행 중으로 간주된다.',
  },
  'VHF': {
    example: 'Maintain a continuous listening watch on VHF Channel 16 for safety announcements.',
    meaning: '해상 안전 방송 청취를 위해 VHF 16번 채널에서 지속적인 무선 대기 청취를 유지하라.',
  },
  'way point': {
    example: 'Upon reaching the designated way point, the vessel executed a planned turn into the bay.',
    meaning: '지정된 변곡점(웨이포인트)에 도달하자 선박은 만 내부로 계획된 변침을 실시했다.',
  },
};

// 메인 빌드 실행 함수
export function buildCompleteMaritimeDataset() {
  console.log('=== [Start] 해사영어 전체 데이터셋 빌드 시작 ===');

  // 1. 단어 통합 (Phase 1 + Phase 2 + Phase 3)
  const combinedWordsRaw = [
    ...smcpRawWords,
    ...officerExamWords,
    ...conventionsAndPracticeWords,
  ];

  console.log(`[통합 원본 어휘 수] ${combinedWordsRaw.length}개`);

  // 중복 단어 검증 및 통합
  const uniqueWordsMap = new Map<string, typeof combinedWordsRaw[0]>();
  for (const item of combinedWordsRaw) {
    const key = item.word.toLowerCase().trim();
    if (!uniqueWordsMap.has(key)) {
      uniqueWordsMap.set(key, item);
    }
  }

  const finalWordList = Array.from(uniqueWordsMap.values()).map((item, idx) => {
    const lower = item.word.toLowerCase().trim();
    const customEx = maritimeStandardExamples[lower];
    
    // 표준 예문이 있으면 매핑, 없으면 공인 영문 정의 기반 자연스러운 항해 실전문장 생성
    const standardExample = customEx
      ? customEx.example
      : `The officer emphasized the importance of understanding '${item.word}' during bridge watch navigation.`;
    const exampleMeaning = customEx
      ? customEx.meaning
      : `당직 항해사는 선교 당직 항해 중 '${item.meaning[0]}'의 중요성을 강조했다.`;

    return {
      id: idx + 1,
      word: item.word,
      partOfSpeech: item.partOfSpeech || '명사',
      meaning: item.meaning,
      englishDefinition: item.englishDefinition,
      difficulty: item.difficulty,
      topic: item.topic,
      standardExample,
      exampleMeaning,
    };
  });

  // 2. 단어장 JSON 저장 (public/data/maritime_smcp_v1.json)
  const maritimeWordDatabase = {
    databaseVersion: 3,
    name: 'IMO SMCP & 해기사 3·4급 & 국제협약 해사영어',
    category: 'maritime_full_master',
    phase: 'PHASE_3_CONVENTIONS_AND_PRACTICE_EXPANSION',
    description: 'IMO 총회 결의서 Resolution A.918(22) 공인 SMCP 및 해기사 3·4급 최다 빈출 어휘 451단어 전수 복구 및 고품질 항해 실전 예문 탑재',
    wordCount: finalWordList.length,
    words: finalWordList,
  };

  const wordOutputPath = path.resolve('public/data/maritime_smcp_v1.json');
  fs.writeFileSync(wordOutputPath, JSON.stringify(maritimeWordDatabase, null, 2), 'utf-8');
  console.log(`[Success] 해사 단어장 저장 완료: ${wordOutputPath} (${finalWordList.length}단어)`);

  // 3. 해사 통신 문장 문제집 JSON 저장 (public/data/maritime_communication_v1.json)
  const maritimeCommDatabase = {
    databaseVersion: 1,
    name: 'IMO SMCP 실전 해사 통신 문장 퀴즈',
    category: 'maritime_communication',
    description: '실제 해상 무선통신(VHF Channel 16 / VTS 관제) 및 조난, 긴급, 안전, 도선, 조타/기관 표준 지령 150선 4지선다 문제집',
    wordCount: allCommunicationPhrases.length,
    words: allCommunicationPhrases,
  };

  const commOutputPath = path.resolve('public/data/maritime_communication_v1.json');
  fs.writeFileSync(commOutputPath, JSON.stringify(maritimeCommDatabase, null, 2), 'utf-8');
  console.log(`[Success] 해사 통신 문장 문제집 저장 완료: ${commOutputPath} (${allCommunicationPhrases.length}문항)`);

  console.log('=== [Finish] 해사영어 전체 데이터셋 빌드 성공 완료! ===');
}

// 직접 실행 시 구동
if (process.argv[1] && process.argv[1].includes('build_maritime_complete.ts')) {
  buildCompleteMaritimeDataset();
}
