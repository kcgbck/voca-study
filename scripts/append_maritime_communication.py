import json

# 93번부터 150번까지 58개 실전 해사 통신 문항 정의
ADDITIONAL_COMMUNICATION_WORDS = [
    {
        "id": 93,
        "partOfSpeech": "통신문",
        "topic": "navigation",
        "word": "What are your intentions? I intend to pass you port-to-port.",
        "meaning": ["귀선의 의도는 무엇인가? 본선은 좌현 대 좌현으로 귀선을 통과하고자 한다."],
        "distractors": [
            "귀선의 의도는 무엇인가? 본선은 귀선의 우현을 추월하고자 한다.",
            "현재 침로는 무엇인가? 본선은 침로를 유지하고자 한다.",
            "귀선의 속력은 얼마인가? 본선은 기관을 정지하고자 한다."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Navigation Traffic - Meeting vessels port-to-port",
        "standardExample": "Vessel on my port bow, what are your intentions? - I intend to pass you port-to-port.",
        "exampleMeaning": "본선 좌현 선수의 선박, 귀선의 의도는 무엇인가? - 본선은 좌현 대 좌현으로 귀선을 통과하고자 한다."
    },
    {
        "id": 94,
        "partOfSpeech": "통신문",
        "topic": "navigation",
        "word": "I am altering my course to starboard to give way to you.",
        "meaning": ["본선은 귀선에게 피항하기 위해 우현으로 변침 중이다."],
        "distractors": [
            "본선은 선속을 감속하여 귀선 후미를 통과할 예정이다.",
            "본선은 조종불능선이므로 귀선이 본선을 피항하라.",
            "본선은 좌현으로 변침하여 정박지로 진입 중이다."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Collision Avoidance - Starboard alteration",
        "standardExample": "Calling vessel ahead: I am altering my course to starboard to give way to you.",
        "exampleMeaning": "전방의 선박 호출: 본선은 귀선에게 피항하기 위해 우현으로 변침 중이다."
    },
    {
        "id": 95,
        "partOfSpeech": "통신문",
        "topic": "vts",
        "word": "Ulsan VTS, this is M/V OCEAN STAR. Request permission to enter the inbound fairway.",
        "meaning": ["울산 VTS, 본선은 오션스타호. 입항 항로 진입 허가를 요청한다."],
        "distractors": [
            "울산 VTS, 본선은 오션스타호. 출항 항로 진입 허가를 요청한다.",
            "울산 VTS, 본선은 오션스타호. 정박지 변경 허가를 요청한다.",
            "울산 VTS, 본선은 오션스타호. 도선사 승선 지점 진입 허가를 요청한다."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP VTS Reporting - Fairway entrance request",
        "standardExample": "Ulsan VTS, this is M/V OCEAN STAR. Request permission to enter the inbound fairway.",
        "exampleMeaning": "울산 VTS, 본선은 오션스타호. 입항 항로 진입 허가를 요청한다."
    },
    {
        "id": 96,
        "partOfSpeech": "통신문",
        "topic": "vts",
        "word": "M/V OCEAN STAR, this is VTS. Permission granted. Maintain speed 10 knots.",
        "meaning": ["오션스타호, 여기는 VTS. 허가한다. 속력 10노트를 유지하라."],
        "distractors": [
            "오션스타호, 여기는 VTS. 진입을 대기하라. 정박지로 이동하라.",
            "오션스타호, 여기는 VTS. 허가한다. 속력을 최대 15노트로 증속하라.",
            "오션스타호, 여기는 VTS. 통항이 혼잡하므로 속력을 6노트로 감속하라."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP VTS Instruction - Fairway entry granted",
        "standardExample": "M/V OCEAN STAR, permission granted to enter fairway. Maintain speed 10 knots.",
        "exampleMeaning": "오션스타호, 항로 진입을 허가한다. 속력 10노트를 유지하라."
    },
    {
        "id": 97,
        "partOfSpeech": "통신문",
        "topic": "vts",
        "word": "Warning. You are running into danger. Shallow water ahead of you.",
        "meaning": ["경고. 귀선은 위험으로 향하고 있다. 귀선 전방에 천소가 있다."],
        "distractors": [
            "주의. 귀선은 항로를 이탈했다. 즉시 본래 침로로 복귀하라.",
            "경고. 귀선 전방에 표류 선박이 있다. 즉시 좌현으로 변침하라.",
            "정보. 귀선 후방에서 고속선이 접근 중이다."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Navigation Warning - Running into shallow danger",
        "standardExample": "Warning, M/V BLUE SKY. You are running into danger. Shallow water ahead of you.",
        "exampleMeaning": "경고, 블루스카이호. 귀선은 위험으로 향하고 있다. 귀선 전방에 천소가 있다."
    },
    {
        "id": 98,
        "partOfSpeech": "통신문",
        "topic": "pilot",
        "word": "Pilot ladder must be rigged on the port side, 1.5 meters above water.",
        "meaning": ["도선사용 사다리는 수면 상 1.5미터 높이로 좌현에 설치되어야 한다."],
        "distractors": [
            "도선사용 사다리는 수면 상 2.0미터 높이로 우현에 설치되어야 한다.",
            "도선사용 현현사다리는 수면과 수평이 되도록 선미 쪽에 설치하라.",
            "도선사용 승선 로프는 선수 좌현에 단단히 결박되어야 한다."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Pilotage - Pilot ladder rigging instruction",
        "standardExample": "Pilot boat approaching: Pilot ladder must be rigged on the port side, 1.5 meters above water.",
        "exampleMeaning": "도선선 접근 중: 도선사용 사다리는 수면 상 1.5미터 높이로 좌현에 설치되어야 한다."
    },
    {
        "id": 99,
        "partOfSpeech": "통신문",
        "topic": "pilot",
        "word": "Make a good lee on your starboard side for the pilot boat.",
        "meaning": ["도선선을 위해 귀선의 우현 쪽에 양호한 풍하측(피바람 구역)을 형성하라."],
        "distractors": [
            "도선선 승선을 위해 본선의 좌현 쪽으로 접근하라.",
            "도선선을 위해 선미 쪽에 견인줄을 내릴 준비를 하라.",
            "도선선의 안전한 접안을 위해 기관을 즉시 정지하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Pilotage - Make a good lee",
        "standardExample": "Please alter course to 180 degrees and make a good lee on your starboard side for the pilot boat.",
        "exampleMeaning": "침로를 180도로 변경하여 도선선을 위해 귀선의 우현 쪽에 양호한 풍하측을 형성하라."
    },
    {
        "id": 100,
        "partOfSpeech": "통신문",
        "topic": "pilot",
        "word": "Pilot is embarking now. Stand by on the bridge.",
        "meaning": ["도선사가 지금 승선 중이다. 선교에서 대기하라."],
        "distractors": [
            "도선사가 지금 하선 완료했다. 기관을 전속 전진하라.",
            "도선사가 승선을 거부했다. 지정된 묘지에 투묘하라.",
            "도선선이 본선 선미에 계류 중이다. 당직자는 사다리를 점검하라."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Pilotage - Pilot embarkation in progress",
        "standardExample": "Deck report: Pilot is embarking now. Bridge stand by.",
        "exampleMeaning": "갑판 보고: 도선사가 지금 승선 중이다. 선교는 대기하라."
    },
    {
        "id": 101,
        "partOfSpeech": "통신문",
        "topic": "tug",
        "word": "Tug KOREA ONE, make fast on the port bow with ship's line.",
        "meaning": ["예인선 코리아원, 본선의 로프로 좌현 선수에 줄을 잡으라."],
        "distractors": [
            "예인선 코리아원, 예선 로프로 우현 선미에 줄을 잡으라.",
            "예인선 코리아원, 즉시 좌현 선수를 밀착하여 밀어내라.",
            "예인선 코리아원, 선수 중앙에 와이어를 연결하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Tug Operations - Make fast with ship line",
        "standardExample": "Tug KOREA ONE, make fast on the port bow with ship's line.",
        "exampleMeaning": "예인선 코리아원, 본선의 로프로 좌현 선수에 줄을 잡으라."
    },
    {
        "id": 102,
        "partOfSpeech": "통신문",
        "topic": "tug",
        "word": "Tug KOREA TWO, push full power on starboard quarter.",
        "meaning": ["예인선 코리아투, 우현 선미 사분도 구역을 전력으로 밀어라."],
        "distractors": [
            "예인선 코리아투, 좌현 중앙부를 전력으로 당겨라.",
            "예인선 코리아투, 우현 선수부를 미속으로 밀어라.",
            "예인선 코리아투, 선미 예인줄을 즉시 늦춰라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Tug Operations - Push full power",
        "standardExample": "Pilot to tug: Tug KOREA TWO, push full power on starboard quarter.",
        "exampleMeaning": "도선사가 예선에: 예인선 코리아투, 우현 선미 사분도 구역을 전력으로 밀어라."
    },
    {
        "id": 103,
        "partOfSpeech": "통신문",
        "topic": "tug",
        "word": "All tugs, stop pushing and stand by.",
        "meaning": ["모든 예인선, 밀기를 멈추고 대기하라."],
        "distractors": [
            "모든 예인선, 예인줄을 방출하고 귀항하라.",
            "모든 예인선, 최대 마력으로 선체를 안벽으로 당겨라.",
            "모든 예인선, 선수와 선미의 위치를 교대하라."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Tug Operations - Stop pushing",
        "standardExample": "Bridge to tugs: All tugs, stop pushing and stand by.",
        "exampleMeaning": "선교가 예선들에: 모든 예인선, 밀기를 멈추고 대기하라."
    },
    {
        "id": 104,
        "partOfSpeech": "통신문",
        "topic": "tug",
        "word": "Cast off the tug line forward. Let go forward tug.",
        "meaning": ["선수의 예인줄을 벗겨내라. 선수 예인선을 방출하라."],
        "distractors": [
            "선미 예인줄을 팽팽하게 감아라. 선미 예인선을 연결하라.",
            "선수 홋줄을 안벽 비트에 고정하라. 닻을 투하하라.",
            "선수 예인선의 추진력을 올려 선수를 외측으로 밀어라."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Tug Operations - Cast off tug line",
        "standardExample": "Forward station: Cast off the tug line forward. Let go forward tug.",
        "exampleMeaning": "선수 배치처: 선수의 예인줄을 벗겨내라. 선수 예인선을 방출하라."
    },
    {
        "id": 105,
        "partOfSpeech": "통신문",
        "topic": "anchoring",
        "word": "Stand by the starboard anchor. Let go starboard anchor.",
        "meaning": ["우현 닻 대기. 우현 닻을 놓아라(투묘하라)."],
        "distractors": [
            "좌현 닻 대기. 좌현 닻줄을 한 샤클 감아올려라.",
            "양현 닻 대기. 비상 양묘를 준비하라.",
            "우현 닻 브레이크 체결. 투묘를 일시 중지하라."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Anchoring - Stand by and let go anchor",
        "standardExample": "Master ordered: Stand by the starboard anchor. Let go starboard anchor!",
        "exampleMeaning": "선장이 지시했다: 우현 닻 대기. 우현 닻을 놓아라!"
    },
    {
        "id": 106,
        "partOfSpeech": "통신문",
        "topic": "anchoring",
        "word": "How is the cable leading? Cable is leading four o'clock, long stay.",
        "meaning": ["닻줄의 신장 방향은 어떠한가? 닻줄은 4시 방향으로 길게 뻗어 있다."],
        "distractors": [
            "닻줄의 장력은 어떠한가? 닻줄이 느슨하게 아래로 처져 있다.",
            "닻줄의 길이는 얼마인가? 닻줄 5샤클이 수중에 들어가 있다.",
            "닻이 해저에 박혔는가? 닻이 펄에 완전히 묻혀 고정되었다."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Anchoring - Cable leading and stay",
        "standardExample": "Bridge to forecastle: How is the cable leading? - Cable is leading four o'clock, long stay.",
        "exampleMeaning": "선교가 선수에: 닻줄의 신장 방향은 어떠한가? - 닻줄은 4시 방향으로 길게 뻗어 있다."
    },
    {
        "id": 107,
        "partOfSpeech": "통신문",
        "topic": "anchoring",
        "word": "Anchor is aweigh. Vessel is under way.",
        "meaning": ["닻이 해저에서 완전히 떨어졌다(무게가 실렸다). 본선은 항해 중이다."],
        "distractors": [
            "닻이 수면 위로 올라왔다. 닻에 해저 진흙이 묻어 있다.",
            "닻이 해저에 단단히 박혔다. 본선은 안전하게 묘박 완료했다.",
            "닻줄이 엉켜 감기지 않는다. 기관을 후진하여 풀어내라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Anchoring - Anchor is aweigh",
        "standardExample": "Forecastle report: Anchor is aweigh. Vessel is under way.",
        "exampleMeaning": "선수부 보고: 닻이 해저에서 완전히 떨어졌다. 본선은 항해 중이다."
    },
    {
        "id": 108,
        "partOfSpeech": "통신문",
        "topic": "helm",
        "word": "Midships. Ease the helm to midships.",
        "meaning": ["정앙(중립). 타를 중앙 중립으로 되돌려라."],
        "distractors": [
            "우현 전타. 타를 우현 끝까지 돌려라.",
            "좌현 10도. 타각을 좌현 10도로 유지하라.",
            "키를 고정하라. 조타기를 수동에서 자동 조타로 전환하라."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Wheel Orders - Midships",
        "standardExample": "Helmsman, midships! - Midships, sir.",
        "exampleMeaning": "조타수, 정앙! - 정앙했습니다."
    },
    {
        "id": 109,
        "partOfSpeech": "통신문",
        "topic": "helm",
        "word": "Port ten. Steer course two seven zero.",
        "meaning": ["좌현 10도. 침로 270도로 조타하라."],
        "distractors": [
            "우현 10도. 침로 090도로 조타하라.",
            "좌현 20도. 침로 180도를 유지하라.",
            "침로 270도로 자동 항법을 가동하라."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Wheel Orders - Port ten and steer course",
        "standardExample": "Conning officer: Port ten. Steer course two seven zero.",
        "exampleMeaning": "조타 지휘관: 좌현 10도. 침로 270도로 조타하라."
    },
    {
        "id": 110,
        "partOfSpeech": "통신문",
        "topic": "helm",
        "word": "Steady as she goes. Keep the ship heading zero four five.",
        "meaning": ["곧바로(키 멈춰). 선수를 현재 방위 045도로 유지하라."],
        "distractors": [
            "우현으로 더 돌려라. 선수를 090도로 계속 선회하라.",
            "선수를 유지하지 말고 파도를 정면으로 받도록 조타하라.",
            "키를 좌현 최대로 돌려 회두 속도를 늦춰라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Wheel Orders - Steady as she goes",
        "standardExample": "Steady as she goes! - Steady on zero four five, sir.",
        "exampleMeaning": "곧바로! - 현재 방위 045도로 유지 중입니다."
    },
    {
        "id": 111,
        "partOfSpeech": "통신문",
        "topic": "engine",
        "word": "Dead slow ahead. Stand by engine for maneuvering.",
        "meaning": ["미속 전진. 입출항 조종을 위해 기관 대기하라."],
        "distractors": [
            "반속 전진. 주기관을 항해 전속으로 전환하라.",
            "미속 후진. 선박을 정박지에 정지시키기 위해 역추진하라.",
            "기관 정지. 당직 기관사는 연료유 밸브를 차단하라."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Engine Orders - Dead slow ahead and stand by engine",
        "standardExample": "Bridge to engine room: Dead slow ahead. Stand by engine for maneuvering.",
        "exampleMeaning": "선교가 기관실에: 미속 전진. 입출항 조종을 위해 기관 대기하라."
    },
    {
        "id": 112,
        "partOfSpeech": "통신문",
        "topic": "engine",
        "word": "Full astern. Crash stop the vessel immediately.",
        "meaning": ["전속 후진. 비상시 본선을 즉각 급정지하라."],
        "distractors": [
            "반속 후진. 선미를 안벽 쪽으로 서서히 접근시켜라.",
            "전속 전진. 전방 장애물을 회피하기 위해 최고 속력으로 통과하라.",
            "기관 비상 정지. 주기관 트립 버튼을 눌러 정지하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Engine Orders - Full astern crash stop",
        "standardExample": "Emergency collision risk: Ring full astern! Crash stop the vessel immediately.",
        "exampleMeaning": "비상 충돌 위험: 전속 후진을 발령하라! 본선을 즉각 급정지하라."
    },
    {
        "id": 113,
        "partOfSpeech": "통신문",
        "topic": "engine",
        "word": "Finished with engine. Bridge control off.",
        "meaning": ["기관 사용 완료. 선교 제어 해제."],
        "distractors": [
            "기관 비상 대기. 선교 수동 조작으로 전환.",
            "기관 고장 발생. 타기실 제어로 전환.",
            "기관 시운전 개시. 기관실 제어 유지."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Engine Orders - Finished with engine",
        "standardExample": "Vessel safely all fast at berth: Finished with engine. Bridge control off.",
        "exampleMeaning": "선박이 안벽에 안전하게 전 계류 완료됨: 기관 사용 완료. 선교 제어 해제."
    },
    {
        "id": 114,
        "partOfSpeech": "통신문",
        "topic": "berthing",
        "word": "Send heaving line forward. Make fast headline and forward breast line.",
        "meaning": ["선수에 히빙 라인(던짐줄)을 던져라. 헤드라인(선수줄)과 선수 브레스트 라인을 묶어라."],
        "distractors": [
            "선미에 와이어를 던져라. 스턴라인과 선미 스프링 라인을 결박하라.",
            "선수 홋줄을 모두 풀어내고 출항 준비를 갖추어라.",
            "안벽 계류 비트에 휀다(완충재)를 설치하고 대기하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Mooring - Heaving line and mooring lines",
        "standardExample": "Forward station: Send heaving line forward. Make fast headline and breast line.",
        "exampleMeaning": "선수 배치처: 선수에 히빙 라인을 던져라. 헤드라인과 브레스트 라인을 묶어라."
    },
    {
        "id": 115,
        "partOfSpeech": "통신문",
        "topic": "berthing",
        "word": "Heave in on the forward spring line to bring the bow close.",
        "meaning": ["선수를 안벽 쪽으로 바짝 붙이기 위해 선수 스프링 라인을 감아들여라."],
        "distractors": [
            "선미를 안벽에 붙이기 위해 선미 스프링 라인을 방출하라.",
            "선체가 안벽에서 떨어지도록 선수 스프링을 천천히 늦춰라.",
            "선수 닻줄을 감아들이면서 후진 기관을 사용하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Mooring - Heave in spring line",
        "standardExample": "Pilot to mooring crew: Heave in on the forward spring line to bring the bow close.",
        "exampleMeaning": "도선사가 계류요원에게: 선수를 안벽 쪽으로 바짝 붙이기 위해 선수 스프링 라인을 감아들여라."
    },
    {
        "id": 116,
        "partOfSpeech": "통신문",
        "topic": "berthing",
        "word": "All fast forward and aft. Gangway secured.",
        "meaning": ["선수와 선미 모두 계류 완료(올 패스트). 트랩(승강 통로) 고정 완료."],
        "distractors": [
            "선수와 선미 모든 홋줄 이탈. 출항 조타 개시.",
            "선수만 계류 완료. 선미는 추가 홋줄 연결 필요.",
            "도선사 하선 완료. 안벽 하역 준비 미완료."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Mooring - All fast and gangway secured",
        "standardExample": "Master to port control: Vessel is all fast forward and aft. Gangway secured.",
        "exampleMeaning": "선장이 항만관제에: 본선은 선수와 선미 모두 계류 완료. 트랩 고정 완료."
    },
    {
        "id": 117,
        "partOfSpeech": "통신문",
        "topic": "cargo",
        "word": "Commence loading dangerous goods in container hold number three.",
        "meaning": ["3번 컨테이너 화물창에 위험물 적재를 개시하라."],
        "distractors": [
            "3번 컨테이너 화물창의 일반 화물 양하를 개시하라.",
            "2번 화물창의 위험물 누출을 점검하고 적재를 중단하라.",
            "모든 화물창의 해치를 개방하고 통풍기를 가동하라."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Cargo Handling - Commence loading dangerous goods",
        "standardExample": "Chief officer instructed stevedores: Commence loading dangerous goods in hold number three.",
        "exampleMeaning": "일등항해사가 하역인부들에게 지시했다: 3번 컨테이너 화물창에 위험물 적재를 개시하라."
    },
    {
        "id": 118,
        "partOfSpeech": "통신문",
        "topic": "cargo",
        "word": "Stop cargo discharge immediately. Toxic vapour leakage detected.",
        "meaning": ["화물 양하를 즉각 중단하라. 유독 가스 누출이 감지되었다."],
        "distractors": [
            "화물 적재를 계속하라. 유류 누출 경보가 해제되었다.",
            "화물창 덮개를 밀폐하고 화재 진압 가스를 방출하라.",
            "갑판 통풍을 차단하고 작업원들에게 방독면을 지급하라."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Cargo Safety - Toxic vapour leakage stop discharge",
        "standardExample": "Emergency order: Stop cargo discharge immediately. Toxic vapour leakage detected!",
        "exampleMeaning": "비상 지령: 화물 양하를 즉각 중단하라. 유독 가스 누출이 감지되었다!"
    },
    {
        "id": 119,
        "partOfSpeech": "통신문",
        "topic": "cargo",
        "word": "Cargo crane number two is unserviceable due to hydraulic pressure loss.",
        "meaning": ["2번 갑판 크레인은 유압 상실로 인해 운용 불가 상태이다."],
        "distractors": [
            "2번 갑판 크레인은 와이어 파단 위험으로 정격 하중이 제한된다.",
            "1번 갑판 크레인의 전원 공급이 복구되어 정상 가동 중이다.",
            "하역 크레인의 붐대를 수평으로 눕히고 해상 고박을 실시하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Cargo Gear - Crane unserviceable",
        "standardExample": "Deck log entry: Cargo crane number two is unserviceable due to hydraulic pressure loss.",
        "exampleMeaning": "갑판일지 기록: 2번 갑판 크레인은 유압 상실로 인해 운용 불가 상태이다."
    },
    {
        "id": 120,
        "partOfSpeech": "통신문",
        "topic": "safety",
        "word": "All crew assemble at designated muster stations. Don lifejackets.",
        "meaning": ["전 승무원은 지정된 비상소집 장소로 집합하라. 구명조끼를 착용하라."],
        "distractors": [
            "전 승무원은 거주 구역에 대기하라. 소방원 장구를 착용하라.",
            "비상 퇴선 지령. 모든 구명벌을 즉시 투하하라.",
            "화재 진압조는 1차 진압을 위해 기관실 입구로 집결하라."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Safety Drills - Muster stations and lifejackets",
        "standardExample": "General alarm sounded: All crew assemble at designated muster stations. Don lifejackets!",
        "exampleMeaning": "비상경보 발령: 전 승무원은 지정된 비상소집 장소로 집합하라. 구명조끼를 착용하라!"
    },
    {
        "id": 121,
        "partOfSpeech": "통신문",
        "topic": "safety",
        "word": "Abandon ship. Abandon ship into starboard lifeboats.",
        "meaning": ["퇴선하라. 우현 구명정으로 퇴선하라."],
        "distractors": [
            "퇴선 준비. 좌현 구명벌을 바다로 투하하라.",
            "비상 정지. 전 승무원은 선교로 즉각 대피하라.",
            "구명정을 보트 데크 위치까지 강하시키고 대기하라."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Distress - Abandon ship order",
        "standardExample": "Master gave final order: Abandon ship! Abandon ship into starboard lifeboats!",
        "exampleMeaning": "선장이 최종 명령을 내렸다: 퇴선하라! 우현 구명정으로 퇴선하라!"
    },
    {
        "id": 122,
        "partOfSpeech": "통신문",
        "topic": "weather",
        "word": "Gale warning in force. Expect northwest wind force 8 to 9, rough sea.",
        "meaning": ["강풍 경보 발효 중. 북서풍 풍력 8~9계급 및 거친 파도가 예상됨."],
        "distractors": [
            "풍랑 주의보 해제. 남동풍 풍력 3~4계급 및 잔잔한 바다 예상됨.",
            "태풍 경보 발효 중. 시정이 50미터 미만으로 악화될 것으로 예상됨.",
            "농무 경보 발효 중. 모든 항행 선박은 무중신호를 취명하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Weather - Gale warning",
        "standardExample": "NAVTEX broadcast: Gale warning in force. Expect northwest wind force 8 to 9, rough sea.",
        "exampleMeaning": "나브텍스 방송: 강풍 경보 발효 중. 북서풍 풍력 8~9계급 및 거친 파도가 예상됨."
    },
    {
        "id": 123,
        "partOfSpeech": "통신문",
        "topic": "weather",
        "word": "Visibility is reduced by dense fog to less than 0.5 nautical miles.",
        "meaning": ["농무로 인해 시정이 0.5해리 미만으로 악화되었다."],
        "distractors": [
            "폭우로 인해 시정이 일시적으로 2해리 정도로 제한되었다.",
            "황사로 인해 시야가 불투명하므로 레이더 항행을 유지하라.",
            "안개가 걷혀 시정이 5해리 이상으로 호전되었다."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Weather - Visibility reduced by fog",
        "standardExample": "Bridge announcement: Visibility is reduced by dense fog to less than 0.5 nautical miles. Sound fog horn.",
        "exampleMeaning": "선교 안내: 농무로 인해 시정이 0.5해리 미만으로 악화되었다. 무중신호를 취명하라."
    },
    {
        "id": 124,
        "partOfSpeech": "통신문",
        "topic": "navigation",
        "word": "I require a tug. My steering gear is defective.",
        "meaning": ["본선은 예인선이 필요하다. 본선의 조타기가 고장 났다."],
        "distractors": [
            "본선은 도선사가 필요하다. 본선의 레이더가 고장 났다.",
            "본선은 배수펌프가 필요하다. 기관실 침수가 발생했다.",
            "본선은 급유선이 필요하다. 주기관 연료유가 고갈되었다."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Distress/Urgency - Require tug due to steering defect",
        "standardExample": "M/V SUNSHINE to VTS: I require a tug. My steering gear is defective.",
        "exampleMeaning": "선샤인호가 VTS에: 본선은 예인선이 필요하다. 본선의 조타기가 고장 났다."
    },
    {
        "id": 125,
        "partOfSpeech": "통신문",
        "topic": "navigation",
        "word": "Keep clear of me. I am not under command.",
        "meaning": ["본선으로부터 떨어져라(피항하라). 본선은 조종불능선이다."],
        "distractors": [
            "본선 후방을 통과하라. 본선은 흘수제약선이다.",
            "본선 우현 쪽으로 접근하라. 본선은 정박선이다.",
            "본선의 선수 방향을 횡단하라. 본선은 어로종사선이다."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Collision Avoidance - Not under command keep clear",
        "standardExample": "Urgent radio call: Keep clear of me. I am not under command.",
        "exampleMeaning": "긴급 무선 호출: 본선으로부터 떨어져라. 본선은 조종불능선이다."
    },
    {
        "id": 126,
        "partOfSpeech": "통신문",
        "topic": "navigation",
        "word": "I am constrained by my draft. Do not impede my safe passage.",
        "meaning": ["본선은 흘수제약선이다. 본선의 안전한 통항을 방해하지 마라."],
        "distractors": [
            "본선은 조종제한선이다. 본선의 주변 1마일 이내로 진입하지 마라.",
            "본선은 예인 작업 중이다. 본선의 예인줄을 횡단하지 마라.",
            "본선은 항로 중심선으로 복귀 중이다. 본선의 추월을 허가하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Navigation - Constrained by draft",
        "standardExample": "VLCC to crossing small vessel: I am constrained by my draft. Do not impede my safe passage.",
        "exampleMeaning": "초대형유조선이 횡단 소형선에: 본선은 흘수제약선이다. 본선의 안전한 통항을 방해하지 마라."
    },
    {
        "id": 127,
        "partOfSpeech": "통신문",
        "topic": "vts",
        "word": "Report at reporting point BRAVO. State your ETA at pilot station.",
        "meaning": ["브라보 보고점에서 보고하라. 도선사 승선 지점 도착 예정 시간을 통보하라."],
        "distractors": [
            "알파 보고점을 통과하라. 현재 대수속력과 흘수를 보고하라.",
            "정박지 입구에서 대기하라. 도선선 승선 준비 상태를 보고하라.",
            "차리 보고점에서 침로를 우현으로 변경하고 속력을 감속하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP VTS Reporting - Reporting point and ETA",
        "standardExample": "VTS instruction: Report at reporting point BRAVO. State your ETA at pilot station.",
        "exampleMeaning": "VTS 지시: 브라보 보고점에서 보고하라. 도선사 승선 지점 도착 예정 시간을 통보하라."
    },
    {
        "id": 128,
        "partOfSpeech": "통신문",
        "topic": "vts",
        "word": "You are navigating against the traffic flow. Alter course to your starboard.",
        "meaning": ["귀선은 통항 흐름에 역행하여 항해하고 있다. 귀선의 우현으로 변침하라."],
        "distractors": [
            "귀선은 정박 구역을 침범하고 있다. 즉시 투묘를 준비하라.",
            "귀선은 제한 속력을 초과했다. 즉시 속력을 8노트로 감속하라.",
            "귀선은 추천 항로의 중심에 있다. 현재 침로를 유지하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP VTS Warning - Navigating against traffic flow",
        "standardExample": "VTS alert: Vessel at position 35N: You are navigating against the traffic flow. Alter course to your starboard.",
        "exampleMeaning": "VTS 경보: 북위 35도 위치의 선박: 귀선은 통항 흐름에 역행하여 항해하고 있다. 귀선의 우현으로 변침하라."
    },
    {
        "id": 129,
        "partOfSpeech": "통신문",
        "topic": "vts",
        "word": "Proceed to Anchorage NUMBER THREE and anchor until further orders.",
        "meaning": ["3번 정박지로 이동하여 추가 지시가 있을 때까지 묘박 대기하라."],
        "distractors": [
            "3번 부두로 접안하여 하역 작업을 대기하라.",
            "비상 정박지로 이동하여 기관 점검을 완료하라.",
            "외항 정박지를 통과하여 곧바로 내항 항로로 진입하라."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP VTS Instructions - Proceed to anchorage",
        "standardExample": "Port control to incoming ship: Proceed to Anchorage NUMBER THREE and anchor until further orders.",
        "exampleMeaning": "항만관제가 입항선에: 3번 정박지로 이동하여 추가 지시가 있을 때까지 묘박 대기하라."
    },
    {
        "id": 130,
        "partOfSpeech": "통신문",
        "topic": "pilot",
        "word": "Rig the accommodation ladder combined with the pilot ladder.",
        "meaning": ["현현사다리와 도선사용 사다리를 결합(조합 사다리)하여 설치하라."],
        "distractors": [
            "도선사용 외줄 사다리만 단독으로 선수 우현에 설치하라.",
            "현현사다리를 수면 직상까지 내려 계류정에 인계하라.",
            "조합 사다리를 철거하고 승강용 윈치를 준비하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Pilotage - Combination ladder rigging",
        "standardExample": "Due to high freeboard, rig the accommodation ladder combined with the pilot ladder.",
        "exampleMeaning": "높은 건현으로 인해, 현현사다리와 도선사용 사다리를 결합하여 설치하라."
    },
    {
        "id": 131,
        "partOfSpeech": "통신문",
        "topic": "bunkering",
        "word": "All scuppers and deck drains must be plugged before bunkering starts.",
        "meaning": ["급유(벙커링)를 시작하기 전에 모든 갑판 배수구와 드레인을 틀어막아야 한다."],
        "distractors": [
            "연료유 수급 전에 모든 통풍 통로를 개방하여 환기하라.",
            "벙커링 중에는 소화 호스 밸브를 차단하고 작업에 집중하라.",
            "유류 넘침을 방지하기 위해 밸러스트 탱크를 완전히 배수하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Bunkering Safety - Plug scuppers",
        "standardExample": "Chief engineer checked safety checklist: All scuppers and deck drains must be plugged before bunkering starts.",
        "exampleMeaning": "기관장이 안전 체크리스트를 확인했다: 급유를 시작하기 전에 모든 갑판 배수구와 드레인을 틀어막아야 한다."
    },
    {
        "id": 132,
        "partOfSpeech": "통신문",
        "topic": "bunkering",
        "word": "Emergency stop bunkering! Fuel oil overflow on port bunker station.",
        "meaning": ["급유 비상 정지! 좌현 급유 매니폴드 구역에 연료유 넘침(오버플로) 발생."],
        "distractors": [
            "급유 압력을 높여라! 연료 공급관에 누설이 감지되지 않는다.",
            "급유 호스를 분리하라! 본선의 연료 탱크가 만재되었다.",
            "좌현 탱크 밸브를 닫고 우현 탱크로 수급을 전환하라."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Bunkering - Emergency stop fuel overflow",
        "standardExample": "Deck watch shouted: Emergency stop bunkering! Fuel oil overflow on port bunker station!",
        "exampleMeaning": "갑판 당직자가 외쳤다: 급유 비상 정지! 좌현 급유 구역에 연료유 넘침 발생!"
    },
    {
        "id": 133,
        "partOfSpeech": "통신문",
        "topic": "distress",
        "word": "MAYDAY RELAY. Fishing vessel SUNGJIN is sinking in position 34-10 North, 128-45 East.",
        "meaning": ["메이데이 릴레이. 어선 성진호가 북위 34도 10분, 동경 128도 45분 위치에서 침몰 중이다."],
        "distractors": [
            "팬팬 릴레이. 어선 성진호가 기관 고장으로 표류 중이다.",
            "세퀴리테 릴레이. 어선 성진호가 부설한 어망 구역을 주의하라.",
            "메이데이 취소. 어선 성진호는 안전하게 예인되어 입항했다."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Distress Traffic - Mayday Relay for sinking vessel",
        "standardExample": "Coast guard broadcast: MAYDAY RELAY. Fishing vessel SUNGJIN is sinking in position 34-10 North, 128-45 East.",
        "exampleMeaning": "해양경찰 방송: 메이데이 릴레이. 어선 성진호가 북위 34도 10분, 동경 128도 45분 위치에서 침몰 중이다."
    },
    {
        "id": 134,
        "partOfSpeech": "통신문",
        "topic": "urgency",
        "word": "PAN PAN. Crew member sustained severe head injury and requires urgent medical evacuation.",
        "meaning": ["팬팬. 승무원이 심각한 두부 손상을 입어 긴급 항공 의료후송(메디백)이 필요하다."],
        "distractors": [
            "메이데이. 승무원이 바다로 추락하여 수색 구조를 요청한다.",
            "세퀴리테. 선내 식중독 환자가 발생하여 원격 의료 조언을 요청한다.",
            "팬팬. 선장이 피로 누적으로 당직을 인계하고 휴식을 취한다."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Urgency Traffic - Medical evacuation",
        "standardExample": "PAN PAN, PAN PAN, PAN PAN. Crew member sustained severe head injury and requires urgent medical evacuation.",
        "exampleMeaning": "팬팬, 팬팬, 팬팬. 승무원이 심각한 두부 손상을 입어 긴급 항공 의료후송이 필요하다."
    },
    {
        "id": 135,
        "partOfSpeech": "통신문",
        "topic": "safety",
        "word": "SECURITE. Submerged rock reported uncharted near fairway buoy number four.",
        "meaning": ["세퀴리테. 4번 항로 부표 부근에 해도에 없는 암초(수중 암초)가 보고됨."],
        "distractors": [
            "세퀴리테. 4번 항로 부표의 등화가 꺼져 있으니 주의하라.",
            "경고. 4번 항로 부표가 파손되어 표류 중이다.",
            "팬팬. 4번 항로 부표 부근에서 준설선이 준설 작업 중이다."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Safety Traffic - Uncharted submerged rock",
        "standardExample": "SECURITE, SECURITE, SECURITE. Submerged rock reported uncharted near fairway buoy number four.",
        "exampleMeaning": "세퀴리테, 세퀴리테, 세퀴리테. 4번 항로 부표 부근에 해도에 없는 암초가 보고됨."
    },
    {
        "id": 136,
        "partOfSpeech": "통신문",
        "topic": "security",
        "word": "Security alert. Suspicious skiff with armed men approaching port quarter.",
        "meaning": ["보안 경보. 무장한 인원을 태운 의심스러운 소형 보트가 좌현 선미 사분도로 접근 중이다."],
        "distractors": [
            "보안 점검. 세관 단속정이 불시 검문을 위해 본선 우현에 접안 중이다.",
            "해적 퇴치 완료. 의심스러운 선박이 선수를 가로질러 멀어졌다.",
            "비상 방송. 무장 해적들이 선내 거주 구역을 이미 장악했다."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP ISPS Security - Suspicious skiff approach",
        "standardExample": "Bridge to citadel: Security alert. Suspicious skiff with armed men approaching port quarter.",
        "exampleMeaning": "선교가 피난처에: 보안 경보. 무장한 인원을 태운 의심스러운 소형 보트가 좌현 선미 사분도로 접근 중이다."
    },
    {
        "id": 137,
        "partOfSpeech": "통신문",
        "topic": "security",
        "word": "Activate Ship Security Alert System and muster non-duty crew into the citadel.",
        "meaning": ["선박보안경보장치(SSAS)를 작동시키고 비당직 승무원을 피난처(시타델)로 집결시켜라."],
        "distractors": [
            "조난신호 송신기를 작동시키고 전 승무원은 구명벌에 승선하라.",
            "소방 펌프를 최고 압력으로 가동하여 갑판 전체에 해수를 방수하라.",
            "항해등을 모두 소등하고 레이더 전원을 차단하여 야간 은폐하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP ISPS Security - Activate SSAS and enter citadel",
        "standardExample": "Master ordered SSO: Activate Ship Security Alert System and muster non-duty crew into the citadel.",
        "exampleMeaning": "선장이 선박보안책임자에게 지시했다: 선박보안경보장치를 작동시키고 비당직 승무원을 피난처로 집결시켜라."
    },
    {
        "id": 138,
        "partOfSpeech": "통신문",
        "topic": "navigation",
        "word": "I am unable to alter course to starboard due to an overtaking vessel on my starboard beam.",
        "meaning": ["우현 정횡에 추월선이 있어 본선은 우현으로 변침할 수 없다."],
        "distractors": [
            "좌현 정횡에 마주치는 선박이 있어 본선은 좌현으로 변침할 수 없다.",
            "본선의 선속이 빨라 변침할 경우 전복될 위험이 있다.",
            "천소 구역에 근접하여 변침하지 않고 직진해야 한다."
        ],
        "difficulty": "hard",
        "englishDefinition": "IMO SMCP Navigation Traffic - Unable to alter starboard due to overtaking vessel",
        "standardExample": "VHF call: I am unable to alter course to starboard due to an overtaking vessel on my starboard beam.",
        "exampleMeaning": "VHF 통신: 우현 정횡에 추월선이 있어 본선은 우현으로 변침할 수 없다."
    },
    {
        "id": 139,
        "partOfSpeech": "통신문",
        "topic": "sar",
        "word": "I am proceeding to the distress position. My ETA is 0300 UTC.",
        "meaning": ["본선은 조난 위치로 진행 중이다. 본선의 도착 예정 시간은 UTC 03:00이다."],
        "distractors": [
            "본선은 조난 선박 수색을 종료하고 본래 항로로 복귀한다.",
            "본선은 조난 위치로부터 10해리 이탈하여 대기 중이다.",
            "구조 헬리콥터가 조난 위치에 03:00에 먼저 도착할 예정이다."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP SAR - Proceeding to distress position",
        "standardExample": "M/V HANJIN to MRCC: I am proceeding to the distress position. My ETA is 0300 UTC.",
        "exampleMeaning": "한진호가 구조본부에: 본선은 조난 위치로 진행 중이다. 본선의 도착 예정 시간은 UTC 03:00이다."
    },
    {
        "id": 140,
        "partOfSpeech": "통신문",
        "topic": "sar",
        "word": "I have located the capsized liferaft. No survivors observed so far.",
        "meaning": ["본선은 전복된 구명벌을 발견했다. 현재까지 생존자는 관측되지 않는다."],
        "distractors": [
            "본선은 손상되지 않은 구명벌을 인양했다. 5명의 생존자를 구조했다.",
            "본선은 표류 중인 구명환을 수거했다. 생존자의 위치를 파악했다.",
            "선체 파편이 해상에 널려 있으나 구명벌은 발견하지 못했다."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP SAR - Located capsized liferaft",
        "standardExample": "Search unit report: I have located the capsized liferaft. No survivors observed so far.",
        "exampleMeaning": "수색대 보고: 본선은 전복된 구명벌을 발견했다. 현재까지 생존자는 관측되지 않는다."
    },
    {
        "id": 141,
        "partOfSpeech": "통신문",
        "topic": "sar",
        "word": "Prepare the rescue boat for immediate launching. Crew get into immersion suits.",
        "meaning": ["즉각적인 진수를 위해 구조정을 준비하라. 승조원은 방한 구명복을 착용하라."],
        "distractors": [
            "선미 프리폴 구명정을 점검하라. 작업원은 작업복을 착용하라.",
            "구조정 인양 와이어를 수리하라. 구명벌에 비상 식량을 보급하라.",
            "본선 좌현 사다리를 내리고 구조 헬리콥터 유도를 준비하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP SAR - Launch rescue boat and immersion suits",
        "standardExample": "Bridge command: Prepare the rescue boat for immediate launching. Crew get into immersion suits.",
        "exampleMeaning": "선교 명령: 즉각적인 진수를 위해 구조정을 준비하라. 승조원은 방한 구명복을 착용하라."
    },
    {
        "id": 142,
        "partOfSpeech": "통신문",
        "topic": "navigation",
        "word": "Do not overtake me on my port side. Narrow fairway ahead.",
        "meaning": ["본선의 좌현 쪽으로 본선을 추월하지 마라. 전방에 좁은 수로가 있다."],
        "distractors": [
            "본선의 우현 쪽으로 신속히 추월하라. 수로 폭이 충분하다.",
            "본선을 추월하기 전에 예인선을 배치하고 통과하라.",
            "본선 후방에 1마일 간격을 두고 같은 침로로 추종하라."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Navigation - Do not overtake on port",
        "standardExample": "To following vessel: Do not overtake me on my port side. Narrow fairway ahead.",
        "exampleMeaning": "후속 선박에: 본선의 좌현 쪽으로 본선을 추월하지 마라. 전방에 좁은 수로가 있다."
    },
    {
        "id": 143,
        "partOfSpeech": "통신문",
        "topic": "navigation",
        "word": "I agree to be overtaken on my starboard side. I will reduce speed.",
        "meaning": ["귀선이 본선의 우현 쪽으로 본선을 추월하는 것에 동의한다. 본선은 속력을 감속하겠다."],
        "distractors": [
            "본선은 추월을 허용할 수 없다. 귀선은 즉시 기관을 후진하라.",
            "본선의 좌현으로 추월하라. 본선은 침로를 우현으로 크게 돌리겠다.",
            "추월선은 본선의 정횡을 통과할 때까지 속력을 5노트로 제한하라."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Navigation - Agree to starboard overtaking",
        "standardExample": "Radio reply: I agree to be overtaken on my starboard side. I will reduce speed.",
        "exampleMeaning": "무선 응답: 귀선이 본선의 우현 쪽으로 본선을 추월하는 것에 동의한다. 본선은 속력을 감속하겠다."
    },
    {
        "id": 144,
        "partOfSpeech": "통신문",
        "topic": "communication",
        "word": "Say again your message. Words were distorted due to radio static.",
        "meaning": ["귀선의 메시지를 다시 말하라. 무선 잡음으로 인해 말이 왜곡되었다."],
        "distractors": [
            "귀선의 메시지를 명확히 수신했다. 지시대로 즉각 이행하겠다.",
            "다른 채널로 통신을 변경하라. 현재 채널에 혼선이 발생했다.",
            "귀선의 송신 출력을 높여라. 수신 감도가 너무 미약하다."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Procedure - Say again message distorted",
        "standardExample": "Bridge to VTS: Say again your message. Words were distorted due to radio static.",
        "exampleMeaning": "선교가 VTS에: 귀선의 메시지를 다시 말하라. 무선 잡음으로 인해 말이 왜곡되었다."
    },
    {
        "id": 145,
        "partOfSpeech": "통신문",
        "topic": "communication",
        "word": "Correction. My present draft forward is 8.5 meters, aft 9.2 meters.",
        "meaning": ["정정한다. 본선의 현재 선수 흘수는 8.5미터, 선미 흘수는 9.2미터이다."],
        "distractors": [
            "재확인한다. 본선의 최대 만재흘수는 12.0미터이다.",
            "통보한다. 본선은 트림 없이 등흘수 상태로 항행 중이다.",
            "취소한다. 본선은 밸러스트를 배수하여 흘수를 낮췄다."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Procedure - Correction of draft report",
        "standardExample": "Correction. My present draft forward is 8.5 meters, aft 9.2 meters.",
        "exampleMeaning": "정정한다. 본선의 현재 선수 흘수는 8.5미터, 선미 흘수는 9.2미터이다."
    },
    {
        "id": 146,
        "partOfSpeech": "통신문",
        "topic": "vts",
        "word": "Keep clear of the TSS separation zone. Fishing is strictly prohibited.",
        "meaning": ["통항분리수역(TSS)의 분리대 구역에 접근하지 마라. 조업은 엄격히 금지된다."],
        "distractors": [
            "통항분리수역 진입로를 따라 항행하라. 속력 제한은 해제되었다.",
            "통항분리선 안쪽으로 진입하여 반대편 항로로 안전하게 횡단하라.",
            "연안통항대로를 이용하는 소형 선박은 무선 침묵을 유지하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP VTS Warning - TSS separation zone clear",
        "standardExample": "VTS broadcast to local boats: Keep clear of the TSS separation zone. Fishing is strictly prohibited.",
        "exampleMeaning": "VTS가 지역 선박들에 방송: 통항분리수역의 분리대 구역에 접근하지 마라. 조업은 엄격히 금지된다."
    },
    {
        "id": 147,
        "partOfSpeech": "통신문",
        "topic": "safety",
        "word": "Fire in container hold extinguished. Boundary cooling is maintained.",
        "meaning": ["컨테이너 화물창의 화재가 진압되었다. 인접 구역 냉각(경계 냉각)이 유지되고 있다."],
        "distractors": [
            "기관실 화재가 재발화되었다. 전 구역 이산화탄소 방출을 지시한다.",
            "갑판 화재가 진압 불가능하다. 전 승무원은 구명정으로 피난하라.",
            "화재 경보가 오작동으로 확인되었다. 정상 하역 작업을 재개하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Firefighting - Fire extinguished and boundary cooling",
        "standardExample": "Chief officer to master: Fire in container hold extinguished. Boundary cooling is maintained.",
        "exampleMeaning": "일등항해사가 선장에게: 컨테이너 화물창의 화재가 진압되었다. 인접 구역 냉각이 유지되고 있다."
    },
    {
        "id": 148,
        "partOfSpeech": "통신문",
        "topic": "anchoring",
        "word": "You are dragging your anchor. Pay out more cable or heave up anchor.",
        "meaning": ["귀선은 주묘(닻이 끌림)되고 있다. 닻줄을 더 내어주거나 닻을 감아 올려라."],
        "distractors": [
            "귀선의 닻줄이 팽팽하게 고정되었다. 투묘 작업을 완료하라.",
            "귀선은 정박 구역을 벗어났다. 즉시 다른 선박과 나란히 계류하라.",
            "귀선의 닻이 암초에 걸렸다. 역추진하여 닻줄을 절단하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Anchoring - Dragging anchor warning",
        "standardExample": "VTS urgent call to anchored tanker: You are dragging your anchor. Pay out more cable or heave up anchor.",
        "exampleMeaning": "VTS가 정박 중인 유조선에 긴급 호출: 귀선은 주묘되고 있다. 닻줄을 더 내어주거나 닻을 감아 올려라."
    },
    {
        "id": 149,
        "partOfSpeech": "통신문",
        "topic": "berthing",
        "word": "Prepare to unmoor. Single up to headlines and sternlines.",
        "meaning": ["이안(출항 계류 해제)을 준비하라. 헤드라인과 스턴라인만 남기고 홋줄을 줄여라(싱글업)."],
        "distractors": [
            "접안을 준비하라. 모든 스프링 라인과 브레스트 라인을 추가 연결하라.",
            "비상 이안하라. 도선사 탑승 없이 모든 홋줄을 즉시 절단하라.",
            "선체 이동을 준비하라. 기관을 전속 후진으로 가동하라."
        ],
        "difficulty": "medium",
        "englishDefinition": "IMO SMCP Mooring - Single up for unmooring",
        "standardExample": "Master ordered: Prepare to unmoor. Single up to headlines and sternlines.",
        "exampleMeaning": "선장이 지시했다: 이안을 준비하라. 헤드라인과 스턴라인만 남기고 홋줄을 줄여라."
    },
    {
        "id": 150,
        "partOfSpeech": "통신문",
        "topic": "navigation",
        "word": "Understood. I will keep a sharp lookout and report passing the light beacon.",
        "meaning": ["이해했다. 본선은 철저한 경계를 유지할 것이며 등표 통과 시 보고하겠다."],
        "distractors": [
            "거부한다. 본선은 기상 악화로 인해 등표를 통과할 수 없다.",
            "질문한다. 등표 부근의 수심과 조류 속도는 얼마인가?",
            "동의한다. 본선은 등표 부근에 임시 묘박하여 날씨 호전을 기다리겠다."
        ],
        "difficulty": "low",
        "englishDefinition": "IMO SMCP Navigation - Sharp lookout and passing report",
        "standardExample": "Bridge acknowledged: Understood. I will keep a sharp lookout and report passing the light beacon.",
        "exampleMeaning": "선교 수신 확인: 이해했다. 본선은 철저한 경계를 유지할 것이며 등표 통과 시 보고하겠다."
    }
]

# 기존 파일 로드
with open('public/data/maritime_communication_v1.json', 'r', encoding='utf-8') as f:
    comm_data = json.load(f)

existing_words = comm_data.get('words', [])
existing_ids = {w['id'] for w in existing_words}

added_count = 0
for item in ADDITIONAL_COMMUNICATION_WORDS:
    if item['id'] not in existing_ids:
        existing_words.append(item)
        added_count += 1

comm_data['words'] = existing_words
comm_data['wordCount'] = len(existing_words)

with open('public/data/maritime_communication_v1.json', 'w', encoding='utf-8') as f:
    json.dump(comm_data, f, ensure_ascii=False, indent=2)

print(f"Added {added_count} words. Total words in maritime_communication_v1.json: {len(existing_words)}")
