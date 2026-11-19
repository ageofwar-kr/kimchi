/* 김치 v1.1 — 오프라인 셸 캐시 (앱 설치 요건 + 재방문 속도)
   v1.1.1: 네트워크 우선(network-first)으로 바꿔 새 버전을 올린 뒤에도
   설치된 앱이 예전 js/css 를 계속 물고 있지 않게 한다. 오프라인이면 캐시로 연다. */
var CACHE = "kimchi-v1.1.1";
var ASSETS = [
  "./",
  "./index.html",
  "./css/style.css?v=1.1",
  "./js/config.js?v=1.1",
  "./js/app.js?v=1.1",
  "./manifest.json",
  "./assets/favicon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(ASSETS).catch(function () {});
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      if (k !== CACHE) return caches.delete(k);
      return null;
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;                       /* 중계 서버 POST는 그대로 통과 */
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;             /* 외부(스크립트·폰트)는 손대지 않는다 */
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok && res.type === "basic") {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {                                /* 오프라인 — 캐시로 연다 */
      return caches.match(req).then(function (hit) {
        return hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined);
      });
    })
  );
});
