#!/usr/bin/env python3
"""김치 라이브 체감 속도 실측 — v1.0(개선 전) / v1.1(개선 후) 비교

사용: python3 tools/bench_live.py <tag> [base_url]
  예: python3 tools/bench_live.py before
      python3 tools/bench_live.py after https://ageofwar-kr.github.io/kimchi/
측정:
  · 첫 답까지 걸린 시간(ms) — 페이지 진입 후 첫 질문 (콜드 스타트 포함)
  · 이후 답까지 걸린 시간(ms) — 2~4번째 질문
  · 통화: 클릭 → '통화 중' 전환(ms), 클릭 → 첫 인사 자막(ms)
"""
import os, sys, json, time
from playwright.sync_api import sync_playwright

EXE = "/workspace/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "screenshots")
TAG = sys.argv[1] if len(sys.argv) > 1 else "run"
URL = sys.argv[2] if len(sys.argv) > 2 else "https://ageofwar-kr.github.io/kimchi/"

PROMPTS = ["오늘 브리핑해줘", "할 일 정리 도와줘", "오늘 뭐 먹을까", "심심한데 얘기해줘"]


def measure(p, viewport, mobile):
    out = {"url": URL, "viewport": viewport, "chat_ms": [], "call": {}, "errors": []}
    b = p.chromium.launch(executable_path=EXE, args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport=viewport, device_scale_factor=2, is_mobile=mobile, has_touch=mobile,
                        locale="ko-KR", timezone_id="Asia/Seoul", permissions=["microphone"] if mobile else [])
    page = ctx.new_page()
    page.on("pageerror", lambda e: out["errors"].append("pageerror: " + str(e)[:160]))
    page.on("console", lambda m: out["errors"].append("console: " + m.text[:160]) if m.type == "error" else None)
    page.goto(URL, wait_until="load")
    page.wait_for_timeout(700)

    # 채팅 응답 시간 — 캐시버스트 쿼리로 서비스워커 영향 최소화
    for i, prompt in enumerate(PROMPTS):
        n_before = page.eval_on_selector_all(".msg.ai", "els => els.length")
        t0 = time.time()
        page.fill("#input", prompt)
        page.press("#input", "Enter")
        try:
            page.wait_for_function(
                """(n) => {
                    const ai = document.querySelectorAll('.msg.ai .bubble');
                    const typing = document.querySelectorAll('.msg.ai .bubble .typing');
                    return ai.length > n && typing.length === 0;
                }""", arg=n_before, timeout=60000)
            ms = int((time.time() - t0) * 1000)
            reply = page.eval_on_selector_all(".msg.ai .bubble", "els => els[els.length-1].innerText")
            out["chat_ms"].append({"i": i + 1, "prompt": prompt, "ms": ms, "len": len(reply), "reply": reply[:90]})
        except Exception as e:
            out["chat_ms"].append({"i": i + 1, "prompt": prompt, "ms": -1, "err": str(e)[:120]})
        page.wait_for_timeout(200)

    # 통화 진입
    page.click("#callBtn")
    t0 = time.time()
    try:
        page.wait_for_function("() => document.getElementById('callStatus').textContent.indexOf('통화 중') >= 0",
                               timeout=15000)
        out["call"]["connected_ms"] = int((time.time() - t0) * 1000)
    except Exception as e:
        out["call"]["connected_ms"] = -1
        out["errors"].append("call_connect: " + str(e)[:120])
    try:
        page.wait_for_function("() => (document.getElementById('callSub').innerText || '').trim().length > 4",
                               timeout=15000)
        out["call"]["greet_sub_ms"] = int((time.time() - t0) * 1000)
        out["call"]["greet_sub"] = page.inner_text("#callSub")[:80]
    except Exception as e:
        out["call"]["greet_sub_ms"] = -1
        out["errors"].append("call_greet: " + str(e)[:120])

    # 통화 중 한 턴 (키보드 폴백) 응답 시간
    page.click("#kbBtn")
    page.fill("#callInput", "지금 내 할 일 뭐 있어?")
    t0 = time.time()
    page.click("#callForm button[type=submit]")
    try:
        page.wait_for_function("""() => {
            const s = document.getElementById('callSub');
            return s && s.innerText.trim().length > 8 && s.innerText.indexOf('지금 내 할 일') < 0;
        }""", timeout=60000)
        out["call"]["turn_ms"] = int((time.time() - t0) * 1000)
        out["call"]["turn_reply"] = page.inner_text("#callSub")[:100]
    except Exception as e:
        out["call"]["turn_ms"] = -1
        out["errors"].append("call_turn: " + str(e)[:120])
    page.screenshot(path=os.path.join(SHOTS, "bench-%s-call.png" % TAG))
    page.click("#endBtn")
    b.close()
    return out


if __name__ == "__main__":
    res = {"tag": TAG, "at": time.strftime("%Y-%m-%d %H:%M:%S"), "runs": []}
    with sync_playwright() as p:
        res["runs"].append(measure(p, {"width": 1440, "height": 900}, False))
        res["runs"].append(measure(p, {"width": 390, "height": 844}, True))
    ok = [c["ms"] for r in res["runs"] for c in r["chat_ms"] if c["ms"] > 0]
    if ok:
        first = [r["chat_ms"][0]["ms"] for r in res["runs"] if r["chat_ms"] and r["chat_ms"][0]["ms"] > 0]
        rest = [c["ms"] for r in res["runs"] for c in r["chat_ms"][1:] if c["ms"] > 0]
        res["summary"] = {"n": len(ok), "first_ms": first, "first_avg": int(sum(first) / len(first)) if first else None,
                          "rest_avg": int(sum(rest) / len(rest)) if rest else None,
                          "rest_min": min(rest) if rest else None}
        print("SUMMARY", json.dumps(res["summary"], ensure_ascii=False))
    for r in res["runs"]:
        print(json.dumps({k: v for k, v in r.items() if k != "errors"}, ensure_ascii=False)[:1400])
        if r["errors"]:
            print("ERRORS", r["errors"][:4])
    with open(os.path.join(SHOTS, "bench-live-%s.json" % TAG), "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print("saved screenshots/bench-live-%s.json" % TAG)
