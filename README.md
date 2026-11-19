# 김치 🥬 — 나만의 AI 비서 (v1.1)

말로 하고 눌러서 쓰는 개인 비서 웹앱. **https://ageofwar-kr.github.io/kimchi/**

- **홈**: 빨간 `ㄱ` 마스코트(숨쉬기·눈 깜빡임) + 빠른 질문 칩
- **대화**: 오늘 브리핑 · 할 일 정리 · 메뉴 추천 · 잡담 (Gemini 실시간 응답)
- **음성 통화**: 📞 버튼 → 0.26초 만에 연결 → 통화 중(타이머·웨이브) → 음성으로 듣고 말하기(`SpeechRecognition` + `speechSynthesis`)
- **목소리**: 설정에서 프리셋(기본 / 밝고 빠른 / 차분한 / 낮고 묵직한) + 기기의 한국어 음성 선택 + 🔊 미리듣기
- **말투**: 존댓말 / 반말 토글 (대화·통화·안내 문구 전부 반영)
- **테마**: 화이트 / 다크 (모노톤 + 레드 포인트)
- **앱 설치**: `manifest.json` + `sw.js` (standalone PWA, 홈 화면에 추가)
- **할 일**: localStorage 저장, 설정 시트에서 추가·완료·삭제

## v1.1 변경 (응답 속도·목소리·다듬기)
- **사전 예열**: 페이지 진입 · 입력창 포커스 · 통화 버튼에서 중계 서버를 GET으로 미리 깨운다(90초 스로틀). `script.google.com`·`script.googleusercontent.com` `preconnect` 추가.
- **문맥 압축**: 요청 `history` 를 최근 6메시지·160자(통화는 4메시지·100자)로 축소.
- **서버 출력 토큰**: 채팅 400 → **320**, 음성 통화(`call:true`)는 **140** + "1~2문장·60자 안팎" 전용 프롬프트로 생성·TTS 대기 단축. 시스템 프롬프트도 한 덩어리로 압축.
- **통화 체감**: 인위적 연결 대기 0.85s → **0.26s**, 첫 인사 TTS 즉시, `SpeechRecognition` 재시작 지연 350ms → **0ms**.
- **목소리**: 프리셋 4종(rate·pitch 조합) + 기기 한국어 음성 목록 + 미리듣기. 선택은 `localStorage(kimchi.voice)`.
- **기본 호칭 `드카`**: 처음 열면 `드카님` / 반말 `드카야`로 부른다(설정에서 변경 가능).
- **한국어 다듬기**: `좋은 오후이에요` → `좋은 오후예요`, `좋은 저녁이에요` 유지, 반말 호격 `원재아` → 받침에 맞춰 `원재야`.
- **캐시버스트**: `sw.js` 캐시 `kimchi-v1.1.1`, 자산 URL `?v=1.1`, 서비스워커를 **네트워크 우선**으로 바꿔 업데이트 후 옛 js/css 가 남지 않게 함.

## 구조
```
index.html        화면 (ㄱ 마스코트 SVG 스프라이트, 통화 화면, 설정 시트)
css/style.css     모노톤 + 레드 포인트 스타일, 다크 테마, 모션, 목소리 선택 UI
js/config.js      중계 서버 주소·모델·문맥 길이·예열 TTL
js/app.js         대화·음성·목소리·할 일·테마·설치·서비스워커
manifest.json     PWA 매니페스트
sw.js             오프라인 셸 캐시(네트워크 우선)
assets/           아이콘(192/512/maskable/apple-touch) · og.png · favicon.svg
tools/            아이콘/OG 생성, test_app.py(UI 검증), bench_proxy.py·bench_live.py(속도 실측)
screenshots/      검증 스크린샷 · bench-*.json
```

## AI 연결 (키 노출 없음)
브라우저는 Google Apps Script 중계 서버(`dorati-smart-proxy`)로만 요청하고, Gemini API 키는 그 프로젝트의
**Script Properties(`GEMINI_API_KEY`)**에만 있다. 이 저장소에는 키·개인정보가 없다.

요청 본문:
```json
{"action":"chat","app":"kimchi","tone":"formal|casual","call":true,"text":"...","nick":"이름",
 "ctx":"현재 시각·할 일","history":[{"r":"u","t":"..."}],"model":"gemini-3.5-flash-lite"}
```
`call` 은 음성 통화 중일 때만 붙는다. 중계 서버의 `Kimchi.gs`가 `app:"kimchi"`일 때만 김치 프롬프트
(존댓말/반말 + 통화 모드 + 상황 정보)를 쓰고, 그 외 요청은 기존 **도랏이 똑똑이 모드** 동작을 그대로 수행한다.

## 검증
```bash
python3 tools/test_app.py https://ageofwar-kr.github.io/kimchi/
```
데스크톱(1440×900) · 모바일(390×844)에서 기본 호칭 `드카`, 한국어 조사, 가로 넘침, 실제 Gemini 응답,
목소리 프리셋·저장·미리듣기, 통화 연결 지연(≤0.6초)·타이머·키보드 폴백 한 턴·종료, 요청 본문 압축
(history ≤6·160자, 통화 `call:true`), 말투·테마, 매니페스트, console error 0건을 확인하고 `screenshots/`에 저장한다.

```bash
python3 tools/bench_proxy.py before   # 중계 서버 직접 측정
python3 tools/bench_live.py before    # 라이브 앱 체감 측정
```
