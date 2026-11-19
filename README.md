# 김치 🥬 — 나만의 AI 비서 (v1.0)

말로 하고 눌러서 쓰는 개인 비서 웹앱. **https://ageofwar-kr.github.io/kimchi/**

- **홈**: 빨간 `ㄱ` 마스코트(숨쉬기·눈 깜빡임) + 빠른 질문 칩
- **대화**: 오늘 브리핑 · 할 일 정리 · 메뉴 추천 · 잡담 (Gemini 실시간 응답)
- **음성 통화**: 📞 버튼 → 연결 중 → 통화 중(타이머·웨이브) → 음성으로 듣고 말하기(`SpeechRecognition` + `speechSynthesis`)
- **말투**: 존댓말 / 반말 토글 (대화·통화·안내 문구 전부 반영)
- **테마**: 화이트 / 다크 (모노톤 + 레드 포인트)
- **앱 설치**: `manifest.json` + `sw.js` (standalone PWA, 홈 화면에 추가)
- **할 일**: localStorage 저장, 설정 시트에서 추가·완료·삭제

## 구조
```
index.html        화면 (ㄱ 마스코트 SVG 스프라이트, 통화 화면, 설정 시트)
css/style.css     모노톤 + 레드 포인트 스타일, 다크 테마, 모션
js/config.js      중계 서버 주소·모델
js/app.js         대화·음성·할 일·테마·설치·서비스워커
manifest.json     PWA 매니페스트
sw.js             오프라인 셸 캐시
assets/           아이콘(192/512/maskable/apple-touch) · og.png · favicon.svg
tools/            아이콘/OG 생성 스크립트, Playwright 검증 스크립트
screenshots/      검증 스크린샷
```

## AI 연결 (키 노출 없음)
브라우저는 Google Apps Script 중계 서버(`dorati-smart-proxy`)로만 요청하고, Gemini API 키는 그 프로젝트의
**Script Properties(`GEMINI_API_KEY`)**에만 있다. 이 저장소에는 키·개인정보가 없다.

요청 본문:
```json
{"action":"chat","app":"kimchi","tone":"formal|casual","text":"...","nick":"이름",
 "ctx":"현재 시각·할 일","history":[{"r":"u","t":"..."}],"model":"gemini-3.5-flash-lite"}
```
중계 서버의 `Kimchi.gs`가 `app:"kimchi"`일 때만 김치 프롬프트(존댓말/반말 + 상황 정보)를 쓰고,
그 외 요청은 기존 **도랏이 똑똑이 모드** 동작을 그대로 수행한다.

## 검증
```bash
python3 tools/test_app.py https://ageofwar-kr.github.io/kimchi/
```
데스크톱(1440×900) · 모바일(390×844)에서 초기 화면·가로 넘침·실제 Gemini 응답·통화 화면/타이머/종료·
말투·테마·매니페스트를 확인하고 `screenshots/`에 저장한다.
