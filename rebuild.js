// snapshot_full.json 을 공유용 HTML의 /*__SNAP__*/ ... /*__/SNAP__*/ 사이에 재주입
const fs = require("fs");
const HTML = "부산 카페 상권분석 대시보드 (공유용).html";
const OPEN = "/*__SNAP__*/", CLOSE = "/*__/SNAP__*/";

const html = fs.readFileSync(HTML, "utf8");
const snap = fs.readFileSync("snapshot_full.json", "utf8");

const i = html.indexOf(OPEN);
const j = html.indexOf(CLOSE, i);
if (i < 0 || j < 0) { console.error("마커를 찾을 수 없음 — 중단"); process.exit(1); }

const out = html.slice(0, i + OPEN.length) + snap + html.slice(j);
// 백업
fs.copyFileSync(HTML, HTML + ".bak");
fs.writeFileSync(HTML, out);
console.log("재빌드 완료:", (out.length/1048576).toFixed(2), "MB (백업:", HTML + ".bak)");
