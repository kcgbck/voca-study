---
type: session-summary
status: active
created: 2026-10-24
updated: 2026-10-24
source_project: "TOEIC_STUDY"
summary: "카페 실제운영 1차검증 완료: 제품9caa7f8/main/운영반영. 합성Controller+실제공개API+Google+D1으로5문항6호출(iced tea후coffee변경재평가),6문항7호출(단답교정+동일반복재사용),총11문항13평가 모두성공. consumed73→86(+13),유닛1207464→1428521(+221057),STT/TTS0유지. API왕복1245~2003ms/중앙1436ms; 실제S25마이크/TTS측정아님. 360px가로넘침없음. 실제피드백에서carrier만거절했는데sleeve도거절한것으로넓힌문제발견하여Gemini에부정범위보존/미언급항목추측금지/짧은한국어피드백/영문예문중복금지 최소프롬프트수정시킴. 수정후전체86파일907시험/타입/린트/빌드/보호경로/diff PASS. 13RPM/225000유"
tags: [save]
tools: [coding-partner]
related_paths: [project_status.md, docs/partner/CURRENT.md]
related_knowledge_cards: []
verification: [source-hash-verified]
sensitivity: public-safe
source_commit: 9caa7f87e6f02aac1557bfc625274d014684fc03
session_scope: baseline-compared
---
카페 실제운영 1차검증 완료: 제품9caa7f8/main/운영반영. 합성Controller+실제공개API+Google+D1으로5문항6호출(iced tea후coffee변경재평가),6문항7호출(단답교정+동일반복재사용),총11문항13평가 모두성공. consumed73→86(+13),유닛1207464→1428521(+221057),STT/TTS0유지. API왕복1245~2003ms/중앙1436ms; 실제S25마이크/TTS측정아님. 360px가로넘침없음. 실제피드백에서carrier만거절했는데sleeve도거절한것으로넓힌문제발견하여Gemini에부정범위보존/미언급항목추측금지/짧은한국어피드백/영문예문중복금지 최소프롬프트수정시킴. 수정후전체86파일907시험/타입/린트/빌드/보호경로/diff PASS. 13RPM/225000유닛/450RPD와기본16384계량/단일20초/noexternretry/무료모델/단어장/사용자저장소보존. 이번수정커밋/main푸시/운영반영후carrier와sleeve부정2건/단답coffee/iced분기와브라우저텍스트학습을재검증예정. 실제S25발음·Whisper비교는여전히미검증. 원본자료와인증자료커밋제외. 상세FOLLOWUP-36.

Operation: followup36-cafe-feedback-scope-20261024
Parent HEAD: 9caa7f87e6f02aac1557bfc625274d014684fc03
