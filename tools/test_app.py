#!/usr/bin/env python3
"""김치 v1.0 검증 — 데스크톱 / 모바일(390x844) 실사용 테스트
사용: python3 tools/test_app.py [base_url]
"""
import sys, os, time, json, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright

EXE = "/workspace/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "screenshots")
os.makedirs(SHOTS, exist_ok=True)

BASE = sys.argv[1] if len(sys.argv) > 1 else None
PORT = 8765


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd


def run(url, label, viewport, mobile=False):
    print("\n=== " + label + " " + url + " ===")
    report = {"label": label, "url": url, "ok": True, "errors": [], "console": [], "checks": {}}
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=EXE, args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        ctx = b.new_context(viewport=viewport, device_scale_factor=2, is_mobile=mobile, has_touch=mobile,
                            locale="ko-KR", timezone_id="Asia/Seoul",
                            permissions=["microphone"] if mobile else [])
        page = ctx.new_page()
        page.on("console", lambda m: report["console"].append({"type": m.type, "text": m.text}) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: report["errors"].append("pageerror: " + str(e)))

        page.goto(url, wait_until="load")
        page.wait_for_timeout(900)

        # 1) 초기 화면
        report["checks"]["greet"] = page.inner_text("#greet")
        report["checks"]["chips"] = page.eval_on_selector_all(".chip", "els => els.map(e => e.textContent.trim())")
        ov = page.evaluate("""() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth,
            bodyW: document.body.scrollWidth, mascot: !!document.querySelector('.mascot-hero') })""")
        report["checks"]["overflow"] = ov
        report["ok"] = report["ok"] and ov["sw"] <= ov["iw"] + 1
        page.screenshot(path=os.path.join(SHOTS, label + "-01-home.png"))

        # 2) 빠른 칩 → 실제 Gemini 응답
        page.click(".chip:nth-child(2)")   # '오늘 브리핑해줘'
        reply = ""
        try:
            page.wait_for_function("""() => {
                const b = document.querySelectorAll('.msg.ai .bubble .typing');
                const ai = document.querySelectorAll('.msg.ai .bubble');
                return ai.length > 0 && b.length === 0;
            }""", timeout=40000)
            reply = page.eval_on_selector_all(".msg.ai .bubble", "els => els[els.length-1].innerText")
        except Exception as e:
            report["ok"] = False
            report["errors"].append("no_reply: " + str(e)[:160])
        report["checks"]["reply"] = reply
        page.wait_for_timeout(400)
        page.screenshot(path=os.path.join(SHOTS, label + "-02-chat.png"))

        # 3) 할 일 추가 → 칩 '내 할 일' 시트
        page.click("#settingsBtn")
        page.fill("#nameInput", "하늘")  # 공개 저장소 스크린샷용 데모 이름
        page.click("#nameSave")
        page.wait_for_timeout(300)
        page.click("#settingsBtn")
        page.fill("#todoInput", "우유 사기")
        page.click("#todoAdd")
        page.wait_for_timeout(200)
        report["checks"]["todo_count"] = page.eval_on_selector_all("#todoList li", "els => els.length")
        report["checks"]["greet_after_name"] = page.inner_text("#greet")
        page.screenshot(path=os.path.join(SHOTS, label + "-03-sheet.png"))
        page.click(".sheet .wide-btn.ghost")
        page.wait_for_timeout(300)

        # 4) 통화 화면
        page.click("#callBtn")
        page.wait_for_timeout(1500)
        st = page.inner_text("#callStatus")
        t1 = page.inner_text("#callTimer")
        page.wait_for_timeout(1600)
        t2 = page.inner_text("#callTimer")
        report["checks"]["call_status"] = st
        report["checks"]["timer"] = [t1, t2]
        report["ok"] = report["ok"] and ("통화" in st) and (t1 != t2)
        page.screenshot(path=os.path.join(SHOTS, label + "-04-call.png"))

        # 통화 중 텍스트 폴백으로 한 턴
        page.click("#kbBtn")
        said = "지금 내 할 일 뭐 있어?"
        page.fill("#callInput", said)
        page.click("#callForm button[type=submit]")
        call_reply = ""
        try:
            page.wait_for_function("""(said) => {
                const s = document.querySelector('#callSub');
                if (!s) return false;
                const t = s.innerText.trim();
                return t.length > 10 && t !== said;
            }""", arg=said, timeout=45000)
            call_reply = page.inner_text("#callSub")
        except Exception as e:
            report["ok"] = False
            report["errors"].append("no_call_reply: " + str(e)[:160])
        report["checks"]["call_reply"] = call_reply[:200]
        page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(SHOTS, label + "-05-call-turn.png"))
        page.click("#endBtn")
        page.wait_for_timeout(400)
        report["checks"]["call_closed"] = page.eval_on_selector("#call", "el => el.hidden")

        # 5) 다크 + 반말
        page.click("#themeBtn")
        page.click("#toneCasual")
        page.wait_for_timeout(500)
        th = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
        tn = page.evaluate("() => document.documentElement.getAttribute('data-tone')")
        report["checks"]["theme"] = th
        report["checks"]["tone"] = tn
        report["checks"]["greet_casual"] = page.inner_text("#greet")
        page.screenshot(path=os.path.join(SHOTS, label + "-06-dark-casual.png"))

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
        page.screenshot(path=os.path.join(SHOTS, label + "-07-dark-chat.png"))

        # PWA 확인
        report["checks"]["manifest"] = page.evaluate("""async () => {
            const r = await fetch('manifest.json'); const j = await r.json();
            return { name: j.name, display: j.display, icons: j.icons.length, theme: j.theme_color };
        }""")
        b.close()

    errs = [c for c in report["console"] if c["type"] == "error"]
    report["console_errors"] = errs
    report["ok"] = report["ok"] and not report["errors"] and not errs
    print(json.dumps(report, ensure_ascii=False, indent=1)[:4000])
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
