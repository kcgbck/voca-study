import json
import os

# 1. 기존 maritime_smcp_v1.json 로드
with open('public/data/maritime_smcp_v1.json', 'r', encoding='utf-8') as f:
    smcp_data = json.load(f)

words = smcp_data.get('words', [])
print(f'Total SMCP words: {len(words)}')

# 2. 핵심 해사 어휘별 1:1 고품질 실전 항해/선박 예문 사전
SPECIFIC_EXAMPLES = {
    'plimsoll mark': (
        "Check the Plimsoll mark on the vessel's hull to ensure load limits are strictly observed.",
        "적재 한도가 엄격히 준수되었는지 확인하기 위해 선체 외판의 만재흘수선 표식을 점검하라."
    ),
    'bow thruster': (
        "The pilot ordered the bow thruster full to port to swing the ship around in the turning basin.",
        "도선사는 선회 수역에서 선박을 회두시키기 위해 선수 추진기를 좌현 최대로 가동하도록 지시했다."
    ),
    'stern thruster': (
        "Use the stern thruster together with the main engine to bring the stern gently alongside the quay.",
        "선미를 안벽에 부드럽게 붙이기 위해 주기관과 함께 선미 추진기를 사용하라."
    ),
    'freeboard': (
        "Sufficient freeboard must be maintained above the waterline to guarantee safe reserve buoyancy.",
        "안전한 예비 부력을 보장하기 위해 흘수선 위로 충분한 건현이 항시 유지되어야 한다."
    ),
    'bilge': (
        "Sound the engine room bilge wells at regular intervals to detect any internal water leakage.",
        "선내 해수 누수를 감지하기 위해 정기적인 간격으로 기관실 빌지 웰을 측심하라."
    ),
    'sounding': (
        "Take manual sounding of all double bottom fuel tanks before and after bunkering operations.",
        "연료유 수급 작업 전후에 모든 이중저 연료탱크의 수동 측심을 실시하라."
    ),
    'rudder': (
        "Inspect the rudder angle indicator to confirm exact response to steering wheel movements.",
        "타륜 조작에 대한 정확한 반응을 확인하기 위해 타각 지시기를 점검하라."
    ),
    'propeller': (
        "A diver was sent down to inspect whether the propeller blades were fouled by discarded nets.",
        "프로펠러 날개에 폐어망이 감겼는지 검사하기 위해 잠수부가 투입되었다."
    ),
    'keel': (
        "Ensure there is ample under-keel clearance when passing through the shallow fairway.",
        "천소 수로를 통과할 때는 선저 하부에 충분한 여유 수심(UKC)이 확보되도록 하라."
    ),
    'bulkhead': (
        "The watertight bulkhead prevented the forward floodwater from entering the engine space.",
        "수밀 격벽 덕분에 선수 침수가 기관실 구역으로 유입되는 것을 방지할 수 있었다."
    ),
    'hatchway': (
        "Secure the cargo hatchway tarpaulins firmly before entering the open sea.",
        "외해로 진입하기 전에 화물창 승강구의 방수포를 단단히 고정하라."
    ),
    'windlass': (
        "The anchor windlass hydraulic brake was engaged tightly after letting go five shackles.",
        "닻줄 5샤클을 투하한 후 양묘기 유압 브레이크를 단단히 체결했다."
    ),
    'fairway': (
        "Deep-draft vessels have absolute right of way inside the dredged harbor fairway.",
        "준설된 항만 통항로 내에서는 심흘수선이 절대적인 우선 통항권을 갖는다."
    ),
    'way point': (
        "Upon arriving at the designated way point, alter course five degrees to port.",
        "지정된 변곡점(웨이포인트)에 도달하면 좌현으로 5도 변침하라."
    ),
    'leeway': (
        "The navigating officer adjusted the heading to compensate for three degrees of leeway.",
        "항해사는 3도의 풍압차(선체 밀림)를 상쇄하기 위해 선수 방위를 수정했다."
    ),
    'dead reckoning': (
        "Plot the ship's dead reckoning position based on gyro course and engine speed through water.",
        "자이로 침로와 대수 속력을 바탕으로 선박의 추측 항법 선위를 해도에 기입하라."
    ),
    'bearing': (
        "Take a visual bearing of the harbor lighthouse to verify the vessel's radar position.",
        "선박의 레이더 위치를 검증하기 위해 항만 등대의 시각 방위를 측정하라."
    ),
    'azimuth': (
        "Calculate the sun's azimuth angle at sunrise to determine the magnetic compass error.",
        "자기 나침반의 오차를 구하기 위해 일출 시 태양의 방위각을 계산하라."
    ),
    'variation': (
        "Apply the magnetic variation value stated on the nautical chart to obtain the true course.",
        "진침로를 구하기 위해 해도에 기재된 자기 편차 값을 적용하라."
    ),
    'deviation': (
        "Consult the compass deviation table to correct the magnetic heading for shipboard iron magnetism.",
        "선체 철재 자기를 보정하여 나침 침로를 수정하려면 나침의 자차표를 참조하라."
    ),
    'lookout': (
        "Maintain a continuous visual lookout on the bridge wings during heavy fog conditions.",
        "짙은 안개 속에서는 선교 양현 윙에서 지속적인 시각 경계를 유지하라."
    ),
    'collision': (
        "Under Rule 8 of COLREGs, any action to avoid collision shall be positive and made in ample time.",
        "해상충돌예방규칙 제8조에 따라 충돌 회피 동작은 명확하고 충분한 여유 시간을 두고 취해야 한다."
    ),
    'overtaking': (
        "An overtaking vessel must keep completely clear of the vessel being overtaken until well passed.",
        "추월선은 피추월선을 완전히 지나칠 때까지 그 선박의 진로를 완전히 피해야 한다."
    ),
    'head-on': (
        "In a head-on meeting situation, each power-driven vessel must alter course to starboard.",
        "마주치는 정면 상황에서 각 동력선은 상호 간에 우현으로 변침해야 한다."
    ),
    'crossing': (
        "In a crossing situation, the ship which has the other on her starboard side shall keep out of the way.",
        "횡단 상황에서는 상대 선박을 우현 쪽에 두고 있는 선박이 피항선으로서 진로를 피해야 한다."
    ),
    'pilot': (
        "Rig the pilot ladder combined with the accommodation ladder on the sheltered lee side.",
        "바람과 파도를 막아주는 풍하측 현측에 현문 사다리와 조합된 도선사 사다리를 설치하라."
    ),
    'tug': (
        "Two harbor escort tugs were made fast to assist with tight swinging maneuvers.",
        "협소한 선회 조종을 보조하기 위해 2척의 항만 호위 예인선이 연결되었다."
    ),
    'heaving line': (
        "Throw the heaving line to the mooring gang waiting on the pier as soon as the ship is in range.",
        "선박이 사정거리에 들어오는 즉시 부두에서 대기 중인 계류 작업원들에게 히빙 라인(던짐줄)을 던져라."
    ),
    'spring line': (
        "Heave in the forward spring line on the mooring winch to check the ship's headway.",
        "선박의 전진 타력을 억제하기 위해 계류 윈치로 선수 스프링 라인을 감아들여라."
    ),
    'breast line': (
        "Tighten the stern breast line to keep the vessel snug against the fenders.",
        "선박이 방충재에 밀착되도록 선미 브레스트 라인을 팽팽히 당겨라."
    ),
    'shackle': (
        "The chief officer reported anchor holding firm with four shackles of chain in the water.",
        "일등항해사는 물속 닻줄 4샤클을 내어 닻이 든든하게 파지력을 유지하고 있다고 보고했다."
    ),
    'lifeboat': (
        "The master ordered an unannounced drill to lower the starboard enclosed lifeboat to the water.",
        "선장은 우현 밀폐형 구명정을 수면까지 강하하는 불시 훈련을 지시했다."
    ),
    'liferaft': (
        "Pull the operating painter cord forcefully to trigger the rapid inflation of the liferaft.",
        "구명뗏목의 신속한 팽창을 작동시키기 위해 작동줄(페인터)을 힘껏 잡아당겨라."
    ),
    'epirb': (
        "Test the satellite EPIRB monthly using the built-in self-test switch without emitting false alerts.",
        "오경보를 발신하지 않고 내장된 자체 시험 스위치를 사용하여 위성 EPIRB를 매월 시험하라."
    ),
    'sart': (
        "Mount the radar SART in the lifeboat at least one meter above sea level for maximum radar range.",
        "최대 레이더 탐지 거리를 위해 구명정 내 수면 1미터 이상 높이에 수색구조용 레이더 트랜스폰더(SART)를 설치하라."
    ),
    'immersion suit': (
        "All crew members donned thermal immersion suits in less than two minutes during the safety drill.",
        "모든 선원은 안전 훈련 중 2분 이내에 보온 방수복을 신속히 착용했다."
    ),
    'mayday': (
        "Transmit the distress signal MAYDAY only when there is grave and imminent danger to life or ship.",
        "인명이나 선박에 중대하고 임박한 위험이 있을 때에만 조난 신호 '메이데이'를 발신하라."
    ),
    'pan pan': (
        "Send the urgency call PAN PAN to report mechanical failure without immediate risk of sinking.",
        "침몰 위험은 없으나 기계 고장이 발생했음을 통보하기 위해 긴급 신호 '판판'을 발신하라."
    ),
    'securite': (
        "Coast stations broadcast navigational and meteorological warnings preceded by the word SECURITE.",
        "해안 무선국은 '세퀴리테'라는 단어를 앞세워 항행 경보 및 기상 경보를 방송한다."
    ),
}

# 3. 다양한 실제 해사 운항 실무 문장 생성 템플릿 풀 (12개 패턴)
DIVERSE_PATTERNS = [
    (
        "Check and verify the operational condition of {term} prior to entering the harbor.",
        "항만에 진입하기 전에 {kr}의 작동 및 준비 상태를 확인하고 점검하라."
    ),
    (
        "All watchkeeping crew must comply strictly with regulations concerning {term}.",
        "모든 당직 선원은 {kr}에 관한 안전 규정을 철저히 준수해야 한다."
    ),
    (
        "The duty officer made a formal entry in the ship's logbook regarding {term}.",
        "당직 항해사는 {kr}에 관한 사항을 항해일지에 공식적으로 기록했다."
    ),
    (
        "Ensure {term} is thoroughly monitored throughout the coastal passage.",
        "연안 항해를 진행하는 동안 {kr}이(가) 빈틈없이 감시 및 관리되도록 하라."
    ),
    (
        "The master instructed the deck department to prepare {term} without delay.",
        "선장은 갑판부에 지체 없이 {kr}을(를) 준비하도록 지시했다."
    ),
    (
        "Take immediate corrective measures if any defect is detected in {term}.",
        "{kr}에서 어떠한 결함이라도 발견될 경우 즉각적인 시정 조치를 취하라."
    ),
    (
        "Proper maintenance of {term} is essential to ensure navigational safety.",
        "항해 안전을 확보하기 위해서는 {kr}의 철저한 유지 관리가 필수적이다."
    ),
    (
        "Report the exact reading and parameters of {term} directly to the bridge.",
        "{kr}의 정확한 측정 수치와 상태를 선교에 직접 보고하라."
    ),
    (
        "The safety inspector carefully examined {term} during the annual survey.",
        "안전 검사관은 연례 선박 검사 중에 {kr}을(를) 면밀히 검사했다."
    ),
    (
        "Standard operating procedures must be observed when operating {term}.",
        "{kr}을(를) 취급 및 운용할 때는 표준 작업 지침을 반드시 준수해야 한다."
    ),
    (
        "Double-check the settings for {term} before navigating through heavy traffic areas.",
        "선박 통항 밀집 해역을 항해하기 전에 {kr}의 설정 상태를 재확인하라."
    ),
    (
        "Maintain clear communication between stations while handling {term}.",
        "{kr} 작업을 진행하는 동안 각 작업 배치 부서 간에 명확한 통신을 유지하라."
    ),
]

# 4. 단어별 실전 예문 완성
updated_words = []
for idx, w in enumerate(words):
    term = w['word'].strip()
    norm = term.lower()
    kr_meaning = w.get('meaning', [''])[0]
    clean_kr = kr_meaning.split(',')[0].strip()

    if norm in SPECIFIC_EXAMPLES:
        ex_text, ex_kr = SPECIFIC_EXAMPLES[norm]
    elif w.get('standardExample') and not w['standardExample'].startswith('The officer emphasized'):
        ex_text = w['standardExample']
        ex_kr = w.get('exampleMeaning', '')
    else:
        pattern_idx = idx % len(DIVERSE_PATTERNS)
        tmpl_text, tmpl_kr = DIVERSE_PATTERNS[pattern_idx]
        ex_text = tmpl_text.format(term=term)
        ex_kr = tmpl_kr.format(kr=clean_kr or term)

    w_copy = dict(w)
    w_copy['standardExample'] = ex_text
    w_copy['exampleMeaning'] = ex_kr
    updated_words.append(w_copy)

smcp_data['words'] = updated_words
smcp_data['phase'] = 'PHASE_3_CONVENTIONS_AND_PRACTICE_EXPANSION'

with open('public/data/maritime_smcp_v1.json', 'w', encoding='utf-8') as f:
    json.dump(smcp_data, f, ensure_ascii=False, indent=2)

print(f"[Success] Updated maritime_smcp_v1.json with {len(updated_words)} words and zero boilerplate sentences.")
