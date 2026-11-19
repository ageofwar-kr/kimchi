#!/usr/bin/env python3
"""김치 중계 서버 응답 시간 실측 (v1.0 -> v1.1 비교용)

사용: python3 tools/bench_proxy.py [tag]
  tag 는 결과 파일 이름에 붙는다 (예: before / after).
"""
import json, sys, time, urllib.request, statistics, os

URL = "https://script.google.com/macros/s/AKfycbwnHX4qyLBYiK5Eg4kK6t31n1gZ3a9995VuxufJn3moUz85wZXYZ-SZJh1IuSZtJUG8/exec"
TAG = sys.argv[1] if len(sys.argv) > 1 else "run"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "screenshots", "bench-%s.json" % TAG)


def post(body, timeout=90):
    req = urllib.request.Request(URL, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "text/plain;charset=utf-8"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
        ms = int((time.time() - t0) * 1000)
        try:
            j = json.loads(raw)
        except Exception:
            j = {"raw": raw[:200]}
        return ms, j
    except Exception as e:
        return int((time.time() - t0) * 1000), {"ERR": str(e)[:200]}


def ping():
    t0 = time.time()
    try:
        with urllib.request.urlopen(URL, timeout=60) as r:
            body = r.read().decode()[:200]
        return int((time.time() - t0) * 1000), body
    except Exception as e:
        return int((time.time() - t0) * 1000), "ERR " + str(e)[:200]


ctx = "지금은 2026년 11월 19일 목요일 오후 6시 10분입니다. (한국 시간)\n사용자 말투 설정: 존댓말.\n사용자가 저장해 둔 할 일: 우유 사기"
hist = [
    {"r": "u", "t": "오늘 브리핑해줘"},
    {"r": "b", "t": "오늘은 목요일이에요. 우유 사기 하나 챙기시고, 저녁 약속 시간 여유 있게 잡으세요."},
]

res = {"tag": TAG, "at": time.strftime("%Y-%m-%d %H:%M:%S"), "ping_ms": None, "chat": [], "call": [], "dorati": []}

ms, body = ping()
res["ping_ms"] = ms
res["ping_body"] = body[:120]
print("PING", ms, body[:80])

for i in range(4):
    ms, j = post({"action": "chat", "app": "kimchi", "tone": "formal",
                  "text": "오늘 뭐 챙겨야 할까? 세 문장 안으로.", "nick": "원재", "ctx": ctx, "history": hist,
                  "model": "gemini-3.5-flash-lite"})
    res["chat"].append({"ms": ms, "len": len(str(j.get("reply", ""))), "reply": str(j.get("reply", ""))[:120],
                        "model": j.get("model"), "err": j.get("ERR") or j.get("error")})
    print("CHAT", i, ms, "ms", len(str(j.get("reply", ""))), "chars", j.get("ERR") or j.get("error") or "")

for i in range(3):
    ms, j = post({"action": "chat", "app": "kimchi", "tone": "formal", "call": True,
                  "text": "지금 내 할 일 뭐 있어?", "nick": "원재", "ctx": ctx, "history": hist,
                  "model": "gemini-3.5-flash-lite"})
    res["call"].append({"ms": ms, "len": len(str(j.get("reply", ""))), "reply": str(j.get("reply", ""))[:120],
                        "err": j.get("ERR") or j.get("error")})
    print("CALL", i, ms, "ms", len(str(j.get("reply", ""))), "chars", str(j.get("reply", ""))[:60])

for i in range(2):
    ms, j = post({"action": "chat", "text": "안녕, 한 줄 소개 해줘", "nick": "철수", "history": []})
    res["dorati"].append({"ms": ms, "reply": str(j.get("reply", ""))[:80], "err": j.get("ERR") or j.get("error")})
    print("DORATI", i, ms, "ms", str(j.get("reply", ""))[:60])

for k in ("chat", "call"):
    v = [x["ms"] for x in res[k] if not x.get("err")]
    if v:
        res[k + "_stats"] = {"n": len(v), "min": min(v), "median": int(statistics.median(v)), "max": max(v)}
        print(k.upper(), res[k + "_stats"])

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(res, f, ensure_ascii=False, indent=1)
print("saved", os.path.abspath(OUT))
