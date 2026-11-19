/* 김치 v1.1 — 설정 */
window.KIMCHI_CONFIG = {
  version: "v1.1",
  app: "kimchi",
  /* Gemini 중계 서버(Google Apps Script). 키는 서버에만 있고 여기엔 없다. */
  proxy: "https://script.google.com/macros/s/AKfycbwnHX4qyLBYiK5Eg4kK6t31n1gZ3a9995VuxufJn3moUz85wZXYZ-SZJh1IuSZtJUG8/exec",
  model: "gemini-3.5-flash-lite",
  timeoutMs: 26000,
  /* 보내는 문맥 — 짧을수록 왕복·생성이 빠르다 */
  historyMsgs: 6,
  historyChars: 160,
  callHistoryMsgs: 4,
  callHistoryChars: 100,
  /* 사전 예열 재사용 시간(ms) */
  warmTtlMs: 90000
};
