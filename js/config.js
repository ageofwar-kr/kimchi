/* 김치 v1.0 — 설정 */
window.KIMCHI_CONFIG = {
  version: "v1.0",
  app: "kimchi",
  /* Gemini 중계 서버(Google Apps Script). 키는 서버에만 있고 여기엔 없다. */
  proxy: "https://script.google.com/macros/s/AKfycbwnHX4qyLBYiK5Eg4kK6t31n1gZ3a9995VuxufJn3moUz85wZXYZ-SZJh1IuSZtJUG8/exec",
  model: "gemini-3.5-flash-lite",
  timeoutMs: 26000,
  historyMsgs: 8
};
