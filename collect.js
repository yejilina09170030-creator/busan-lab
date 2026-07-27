// 공유용 단일 HTML 에 심을 전체 스냅샷 수집 (서버 실행 중일 때)
const fs = require("fs");
const GU = ["중구","서구","동구","영도구","부산진구","동래구","남구","북구",
  "해운대구","사하구","금정구","강서구","연제구","수영구","사상구","기장군"];
const base = "http://localhost:8787";
const g = async u => (await fetch(base + u)).json();

(async () => {
  const data = await g("/api/data?cat=cafe");
  const geo = await g("/busan_geo.json");
  const stores = {}, facilities = {}, trade = {};
  for (const gu of GU) {
    const e = encodeURIComponent(gu);
    stores[gu] = (await g(`/api/stores?gu=${e}&cat=cafe`)).items || [];
    const f = await g(`/api/facilities?gu=${e}`);
    const groups = {};
    if (f.groups) for (const k in f.groups)
      groups[k] = { count: f.groups[k].count, items: (f.groups[k].items || []).slice(0, 250) };
    facilities[gu] = { source: f.source, groups };
    trade[gu] = await g(`/api/trade?gu=${e}`);
    console.log(gu, stores[gu].length, "매장 ·", Object.values(groups).reduce((a,b)=>a+b.items.length,0), "시설");
  }
  // ── 개폐업 트래커 데이터 (추정 개업월 기반, 원본과 동일 방식) ──
  const opensByMonth = {}, allOpens = [];
  for (const gu of GU) for (const s of (stores[gu] || [])) {
    if (!s.ym) continue;
    if (s.ym >= "2023.01") opensByMonth[s.ym] = (opensByMonth[s.ym] || 0) + 1;
    allOpens.push({ ym: s.ym, nm: s.name, cat: "cafe", gu, dong: s.dong });
  }
  const cutoff = "2025.03";  // 기준월 2026.02 기준 최근 12개월
  const recentOpens = allOpens.filter(s => s.ym >= cutoff).sort((a, b) => b.ym.localeCompare(a.ym));
  const totalStores = GU.reduce((a, gu) => a + (stores[gu] || []).length, 0);
  const day = data.meta.generatedAt.slice(0, 10);
  const tracker = { totalStores, snapshots: [day], latestDate: day, prevDate: null,
    opensByMonth, recentOpens, added: null, removed: null };
  console.log("트래커: 총", totalStores, "· 최근12개월 신규", recentOpens.length, "· 월수", Object.keys(opensByMonth).length);

  // 아파트 세대수(주거밀집·상업주거 지도모드용) — collect_apt.js 산출물
  let apt = {};
  try { if (fs.existsSync("apt_data.json")) apt = JSON.parse(fs.readFileSync("apt_data.json", "utf8")); } catch (e) {}
  const aptTot = Object.values(apt).reduce((a, g) => a + (g.totalUnits || 0), 0);
  console.log("아파트: 구", Object.keys(apt).length, "· 부산 총세대", aptTot.toLocaleString());

  // 음식점(카페 적합도 분석용) — collect_rest.js 산출물(소상공인 음식점 표본)
  let rest = {};
  try { if (fs.existsSync("rest_data.json")) rest = JSON.parse(fs.readFileSync("rest_data.json", "utf8")); } catch (e) {}
  console.log("음식점 표본:", Object.values(rest).reduce((a, b) => a + b.length, 0), "개");

  // 브랜드 TOP10 — 실제 매장명에서 감지한 브랜드로 집계(기존 랜덤 추정 대체)
  const brandCnt = {};
  for (const gu of GU) for (const s of (stores[gu] || [])) if (s.brand) brandCnt[s.brand] = (brandCnt[s.brand] || 0) + 1;
  const brandList = Object.entries(brandCnt).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, cat: "카페", count }));
  const totalStores2 = GU.reduce((a, gu) => a + (stores[gu] || []).length, 0);
  const totalBrand = Object.values(brandCnt).reduce((a, b) => a + b, 0);
  data.brands = { totalStores: totalStores2, franchisePct: totalStores2 ? Math.round(totalBrand / totalStores2 * 100) : 0, isLive: true, list: brandList };
  console.log("브랜드 TOP10(실집계):", brandList.slice(0, 5).map(b => b.name + " " + b.count).join(" · "), "· 프랜차이즈", data.brands.franchisePct + "%");

  const snap = { data, geo, stores, facilities, trade, tracker, apt, rest, builtAt: data.meta.generatedAt };
  fs.writeFileSync("snapshot_full.json", JSON.stringify(snap));
  console.log("DONE", (fs.statSync("snapshot_full.json").size / 1048576).toFixed(2), "MB");
})();
