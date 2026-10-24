# 보드 생성과 검증

원본 baseline.html / baseline.md / baseline.json은 불변 비교 자료입니다. 기존 수기 설명과 검사 이력도 이 파일에 보존합니다. 현재 보드는 baseline 데이터에 conversationNodes.json 및 생성기의 방향 간선을 합친 boardData.json을 HTML/MD에 동일하게 반영합니다.

실행: `node scripts/algorithm-board/generateBoard.mjs`

자동검사: `npx vitest run tests/algorithmBoard.test.ts`

생성기는 앱·학습 데이터·의존성·Git을 수정하지 않습니다. HTML은 외부 CDN 없는 독립 파일입니다. 동일 입력으로 두 번 생성한 해시를 비교하세요. 감사 보고서는 시험 증거를 확인한 뒤 별도 작성하며 생성기가 PASS를 자동 선언하지 않습니다.

BOARD-06/12의 실제 브라우저·모바일 가독성 및 첨부 비교는 자동시험과 별도입니다. baseline의 과거 PASS 기록은 신규 기능의 실서비스 PASS를 의미하지 않습니다.
