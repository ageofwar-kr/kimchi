#!/usr/bin/env python3
"""김치 v1.1 검증 — 데스크톱 / 모바일(390x844) 실사용 테스트

사용: python3 tools/test_app.py [base_url]

확인 항목
  · 기본 호칭 '드카' (첫 실행), 한국어 조사 다듬기(좋은 저녁이에요 / 좋은 오후예요 / 드카야)
  · 실제 Gemini 응답 + 요청 본문 압축(history ≤ 6, 160자)·통화 요청 call:true
  · 목소리: 프리셋 4개·기기 한국어 음성 목록·선택 저장·미리듣기
  · 통화: 연결 지연(≤ 0.6초)·타이머·키보드 폴백 한 턴·종료
  · 테마/말투 전환, PWA 매니페스트, console error·pageerror 0건
"""
import sys, os, time, json, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright

EXE = "/workspace/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "screenshots")
os.makedirs(SHOTS, exist_ok=True)

BASE = sys.argv[1] if len(sys.argv) > 1 else None
PORT = 8765
DEMO = "하늘"   # 공개 저장소 스크린샷용 데모 이름


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd


def run(url, label, viewport, mobile=False):
    print("\n=== " + label + " " + url + " ===")
    report = {"label": label, "url": url, "ok": True, "errors": [], "console": [], "checks": {}, "fails": []}

    def chk(name, cond, extra=None):
        if not cond:
            report["fails"].append(name + ((": " + str(extra)) if extra is not None else ""))
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=EXE, args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        ctx = b.new_context(viewport=viewport, device_scale_factor=2, is_mobile=mobile, has_touch=mobile,
                            locale="ko-KR", timezone_id="Asia/Seoul",
                            permissions=["microphone"] if mobile else [])
        page = ctx.new_page()
        page.on("console", lambda m: report["console"].append({"type": m.type, "text": m.text}) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: report["errors"].append("pageerror: " + str(e)))
        posts = []
        page.on("request", lambda r: posts.append(r.post_data) if ("script.google.com/macros" in r.url and r.method == "POST") else None)

        page.goto(url, wait_until="load")
        page.wait_for_timeout(900)

        # 0) 첫 실행 기본값 — 호칭 '드카', 저장 전 localStorage 비어 있음
        report["checks"]["default_greet"] = page.inner_text("#greet")
        report["checks"]["default_name_ls"] = page.evaluate("() => localStorage.getItem('kimchi.name')")
        report["checks"]["version_badge"] = page.inner_text(".ver")
        g0 = report["checks"]["default_greet"]
        chk("default_greet", g0.startswith("드카님, "), g0)
        chk("no_oohu_ieyo", "오후이에요" not in g0)
        chk("default_name_ls", report["checks"]["default_name_ls"] is None, report["checks"]["default_name_ls"])

        # 스크린샷용 데모 이름으로 바꾸고 다시 연다
        page.evaluate("(n) => localStorage.setItem('kimchi.name', JSON.stringify(n))", DEMO)
        page.reload(wait_until="load")
        page.wait_for_timeout(700)

        # 1) 초기 화면
        report["checks"]["greet"] = page.inner_text("#greet")
        report["checks"]["chips"] = page.eval_on_selector_all(".chip", "els => els.map(e => e.textContent.trim())")
        ov = page.evaluate("""() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth,
            bodyW: document.body.scrollWidth, mascot: !!document.querySelector('.mascot-hero'),
            preconnect: Array.prototype.some.call(document.querySelectorAll('link[rel=preconnect]'),
              function (l) { return (l.href || '').indexOf('script.google.com') >= 0; }) })""")
        report["checks"]["overflow"] = ov
        chk("overflow", ov["sw"] <= ov["iw"] + 1, ov["sw"])
        chk("preconnect", ov["preconnect"])
        chk("mascot", ov["mascot"])
        page.screenshot(path=os.path.join(SHOTS, label + "-01-home.png"))

        # 2) 빠른 칩 → 실제 Gemini 응답 + 응답 시간
        t0 = time.time()
        page.click(".chip:nth-child(2)")   # '오늘 브리핑해줘'
        reply = ""
        try:
            page.wait_for_function("""() => {
                const b = document.querySelectorAll('.msg.ai .bubble .typing');
                const ai = document.querySelectorAll('.msg.ai .bubble');
                return ai.length > 0 && b.length === 0;
            }""", timeout=40000)
            reply = page.eval_on_selector_all(".msg.ai .bubble", "els => els[els.length-1].innerText")
            report["checks"]["first_reply_ms"] = int((time.time() - t0) * 1000)
        except Exception as e:
            report["ok"] = False
            report["errors"].append("no_reply: " + str(e)[:160])
        report["checks"]["reply"] = reply
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(SHOTS, label + "-02-chat.png"))

        # 3) 설정 시트 — 이름·목소리
        page.click("#settingsBtn")
        page.wait_for_timeout(250)
        report["checks"]["name_input"] = page.input_value("#nameInput")
        report["checks"]["voice_presets"] = page.eval_on_selector_all(".voice-chip", "els => els.map(e => e.textContent.trim())")
        report["checks"]["voice_rows"] = page.eval_on_selector_all(".voice-row", "els => els.map(e => e.textContent.trim())")
        report["checks"]["voice_note"] = page.inner_text("#voiceNote")
        # '낮고 묵직한' 프리셋 선택 → 저장 + 미리듣기 버튼
        page.click(".voice-chip[data-preset=deep]")
        page.wait_for_timeout(250)
        report["checks"]["deep_pressed"] = page.get_attribute(".voice-chip[data-preset=deep]", "aria-pressed")
        report["checks"]["voice_ls"] = page.evaluate("() => localStorage.getItem('kimchi.voice')")
        page.click("#voiceTest")
        page.wait_for_timeout(300)
        chk("deep_pressed", report["checks"]["deep_pressed"] == "true", report["checks"]["deep_pressed"])
        chk("voice_ls", (report["checks"]["voice_ls"] or "").find("deep") >= 0, report["checks"]["voice_ls"])
        chk("voice_presets", len(report["checks"]["voice_presets"]) == 4, report["checks"]["voice_presets"])
        page.screenshot(path=os.path.join(SHOTS, label + "-03-sheet.png"))

        # 할 일 추가
        page.fill("#todoInput", "우유 사기")
        page.click("#todoAdd")
        page.wait_for_timeout(200)
        report["checks"]["todo_count"] = page.eval_on_selector_all("#todoList li", "els => els.length")
        page.screenshot(path=os.path.join(SHOTS, label + "-04-sheet-todo.png"))
        page.click(".sheet .wide-btn.ghost")
        page.wait_for_timeout(300)

        # 4) 통화 — 연결 지연 실측
        t0 = time.time()
        page.click("#callBtn")
        try:
            page.wait_for_function("() => document.getElementById('callStatus').textContent.indexOf('통화 중') >= 0",
                                   timeout=15000)
            report["checks"]["call_connect_ms"] = int((time.time() - t0) * 1000)
        except Exception as e:
            report["ok"] = False
            report["errors"].append("call_connect: " + str(e)[:120])
        try:
            page.wait_for_function("() => (document.getElementById('callSub').innerText || '').trim().length > 4",
                                   timeout=15000)
            report["checks"]["call_greet_ms"] = int((time.time() - t0) * 1000)
            report["checks"]["call_greet"] = page.inner_text("#callSub")
        except Exception as e:
            report["ok"] = False
            report["errors"].append("call_greet: " + str(e)[:120])
        t1 = page.inner_text("#callTimer")
        page.wait_for_timeout(1600)
        t2 = page.inner_text("#callTimer")
        report["checks"]["timer"] = [t1, t2]
        chk("timer", t1 != t2, [t1, t2])
        chk("call_connect_ms", report["checks"].get("call_connect_ms", 9999) <= 600, report["checks"].get("call_connect_ms"))
        page.screenshot(path=os.path.join(SHOTS, label + "-05-call.png"))

        # 통화 중 텍스트 폴백으로 한 턴
        page.click("#kbBtn")
        said = "내 할 일 뭐 있어?"
        page.fill("#callInput", said)
        t0 = time.time()
        page.click("#callForm button[type=submit]")
        call_reply = ""
        try:
            page.wait_for_function("""(said) => {
                const s = document.querySelector('#callSub');
                if (!s) return false;
                const t = s.innerText.trim();
                return t.length > 6 && t !== said && t.indexOf(said) < 0;
            }""", arg=said, timeout=45000)
            call_reply = page.inner_text("#callSub")
            report["checks"]["call_turn_ms"] = int((time.time() - t0) * 1000)
        except Exception as e:
            report["ok"] = False
            report["errors"].append("no_call_reply: " + str(e)[:160])
        report["checks"]["call_reply"] = call_reply[:200]
        page.wait_for_timeout(400)
        page.screenshot(path=os.path.join(SHOTS, label + "-06-call-turn.png"))
        page.click("#endBtn")
        page.wait_for_timeout(400)
        report["checks"]["call_closed"] = page.eval_on_selector("#call", "el => el.hidden")

        # 5) 다크 + 반말 — 조사/호칭 확인
        page.click("#themeBtn")
        page.click("#toneCasual")
        page.wait_for_timeout(400)
        report["checks"]["theme"] = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
        report["checks"]["tone"] = page.evaluate("() => document.documentElement.getAttribute('data-tone')")
        report["checks"]["greet_casual"] = page.inner_text("#greet")
        gc = report["checks"]["greet_casual"]
        chk("greet_casual", gc.startswith(DEMO + "아, "), gc)
        # 호격 조사(아/야) 표 — 받침 없는 '드카'는 '야', 받침 있는 '하늘'은 '아'
        report["checks"]["josa"] = page.evaluate("""() => {
            const s = window.Kimchi.state, out = {}, n0 = s.name, t0 = s.tone;
            s.tone = 'casual';
            ['드카', '하늘', '민수', '지우'].forEach(function (n) { s.name = n; out[n] = window.Kimchi.ui().greet.split(',')[0]; });
            s.name = n0; s.tone = t0;
            return out;
        }""")
        want = {"드카": "드카야", "하늘": "하늘아", "민수": "민수야", "지우": "지우야"}
        chk("josa", report["checks"]["josa"] == want, report["checks"]["josa"])
        page.screenshot(path=os.path.join(SHOTS, label + "-07-dark-casual.png"))

        # 반말로 한 번 더 대화
        page.fill("#input", "오늘 뭐 먹을까?")
        page.press("#input", "Enter")
        try:
            page.wait_for_function("""() => {
                const b = document.querySelectorAll('.msg.ai .bubble .typing');
                const ai = document.querySelectorAll('.msg.ai .bubble');
                return ai.length > 0 && b.length === 0;
            }""", timeout=40000)
            report["checks"]["reply_casual"] = page.eval_on_selector_all(".msg.ai .bubble", "els => els[els.length-1].innerText")[:200]
        except Exception as e:
            report["ok"] = False
            report["errors"].append("no_casual_reply: " + str(e)[:120])
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(SHOTS, label + "-08-dark-chat.png"))

        # 6) 요청 본문 검사 — 문맥 압축 / 통화 플래그
        bodies = []
        for d in posts:
            try:
                bodies.append(json.loads(d))
            except Exception:
                pass
        chat_bodies = [x for x in bodies if not x.get("call")]
        call_bodies = [x for x in bodies if x.get("call")]
        report["checks"]["req_chat_n"] = len(chat_bodies)
        report["checks"]["req_call_n"] = len(call_bodies)
        report["checks"]["max_history"] = max([len(x.get("history") or []) for x in chat_bodies] or [0])
        report["checks"]["max_hist_chars"] = max([len(m.get("t") or "") for x in chat_bodies for m in (x.get("history") or [])] or [0])
        report["checks"]["call_history_len"] = [len(x.get("history") or []) for x in call_bodies]
        chk("max_history", report["checks"]["max_history"] <= 6, report["checks"]["max_history"])
        chk("max_hist_chars", report["checks"]["max_hist_chars"] <= 160, report["checks"]["max_hist_chars"])
        chk("call_history", len(call_bodies) >= 1 and all(n <= 4 for n in report["checks"]["call_history_len"]), report["checks"]["call_history_len"])

        # PWA 확인
        report["checks"]["manifest"] = page.evaluate("""async () => {
            const r = await fetch('manifest.json'); const j = await r.json();
            return { name: j.name, display: j.display, icons: j.icons.length, theme: j.theme_color };
        }""")
        b.close()

    errs = [c for c in report["console"] if c["type"] == "error"]
    report["console_errors"] = errs
    chk("pageerrors", not report["errors"], report["errors"][:2])
    chk("console_errors", not errs, [e["text"][:120] for e in errs][:2])
    report["ok"] = not report["fails"]
    print("FAILS:", report["fails"])
    print(json.dumps({k: v for k, v in report.items() if k != "console"}, ensure_ascii=False, indent=1)[:4500])
    return report


if __name__ == "__main__":
    httpd = None
    if not BASE:
        httpd = serve()
        BASE = "http://127.0.0.1:%d/" % PORT
        time.sleep(0.4)
    r1 = run(BASE, "desktop", {"width": 1440, "height": 900})
    r2 = run(BASE, "mobile", {"width": 390, "height": 844}, mobile=True)
    if httpd:
        httpd.shutdown()
    print("\nSUMMARY:", "OK" if (r1["ok"] and r2["ok"]) else "ISSUES")
