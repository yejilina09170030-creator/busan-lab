// 도로망 사전수집 — 구별 OSM 도로를 따라 점 샘플 → roads_data.json
// 공유서버가 매 방문자마다 Overpass를 때리지 않도록 미리 구워서 /api/roads 로 제공한다.
const fs = require("fs");

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const UA = "busan-sangkwon-lab/1.0 (road prebake; contact junil1997@gmail.com)";
const M_LA = 111000, M_LO = Math.cos(35.2 * Math.PI / 180) * 111000;
const distM = (a, b, c, d) => { const dx = (b - d) * M_LO, dy = (a - c) * M_LA; return Math.sqrt(dx * dx + dy * dy); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function overpass(ql) {
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of MIRRORS) {
      try {
        const ac = new AbortController(), to = setTimeout(() => ac.abort(), 40000);
        const rs = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA }, body: "data=" + encodeURIComponent(ql), signal: ac.signal });
        clearTimeout(to);
        const txt = await rs.text();
        if (txt[0] !== "{") { process.stdout.write(` [${url.split("/")[2]}:${rs.status}]`); continue; }
        return JSON.parse(txt);
      } catch (e) { process.stdout.write(` [${url.split("/")[2]}:${e.name}]`); }
    }
    await sleep(3000);
  }
  return null;
}

function sampleWays(ways) {
  const STEP = 35, raw = [];
  for (const w of ways) {
    const g = w.geometry; if (!g) continue;
    for (let i = 0; i < g.length - 1; i++) {
      const a = g[i], b = g[i + 1], segM = distM(a.lat, a.lon, b.lat, b.lon), n = Math.max(1, Math.round(segM / STEP));
      for (let k = 0; k < n; k++) { const t = k / n; raw.push([a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t]); }
    }
  }
  const seen = new Set(), dq = 0.00022, ded = [];
  for (const s of raw) { const k = Math.round(s[0] / dq) + "," + Math.round(s[1] / dq); if (seen.has(k)) continue; seen.add(k); ded.push([+s[0].toFixed(5), +s[1].toFixed(5)]); }
  return ded;
}

(async () => {
  const snap = JSON.parse(fs.readFileSync("snapshot_full.json", "utf8"));
  const out = fs.existsSync("roads_data.json") ? JSON.parse(fs.readFileSync("roads_data.json", "utf8")) : {};
  const gus = Object.keys(snap.stores || {});
  let doneTotal = 0;
  for (const gu of gus) {
    if (out[gu] && out[gu].pts && out[gu].pts.length) { console.log(`· ${gu}: 이미 있음(${out[gu].pts.length}점) — 건너뜀`); doneTotal++; continue; }
    const items = (snap.stores[gu] || []).filter(s => s.lat);
    if (!items.length) { console.log(`· ${gu}: 매장 없음 — 건너뜀`); continue; }
    const lats = items.map(s => s.lat), lons = items.map(s => s.lon), pad = 0.0025;
    const bbox = `${Math.min(...lats) - pad},${Math.min(...lons) - pad},${Math.max(...lats) + pad},${Math.max(...lons) + pad}`;
    const ql = `[out:json][timeout:60];way[highway~"^(trunk|primary|secondary|tertiary|residential|living_street|pedestrian|unclassified|service)$"](${bbox});out geom;`;
    process.stdout.write(`· ${gu}: 요청...`);
    const js = await overpass(ql);
    if (!js) { console.log(" 실패(모든 미러)"); continue; }
    const ways = (js.elements || []).filter(w => w.geometry && w.geometry.length > 1);
    const pts = sampleWays(ways);
    out[gu] = { ways: ways.length, pts };
    fs.writeFileSync("roads_data.json", JSON.stringify(out));
    doneTotal++;
    console.log(` OK 도로 ${ways.length}개 → 점 ${pts.length}개 (저장)`);
    await sleep(2000); // 미러 배려
  }
  const totPts = Object.values(out).reduce((a, g) => a + (g.pts ? g.pts.length : 0), 0);
  const sz = (fs.statSync("roads_data.json").size / 1048576).toFixed(2);
  console.log(`\n완료: ${doneTotal}/${gus.length}개 구 · 총 ${totPts.toLocaleString()}점 · roads_data.json ${sz}MB`);
})();
