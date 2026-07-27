// 부산 구별 음식점(카페 제외) 위치 수집 → rest_data.json. 카페 적합도 분석용.
const fs = require("fs");
const https = require("https");
const KEY = require("./config.json").dataGoKr;
const SOSO = "https://apis.data.go.kr/B553077/api/open/sdsc2";
const SGG = { "중구":"26110","서구":"26140","동구":"26170","영도구":"26200","부산진구":"26230",
  "동래구":"26260","남구":"26290","북구":"26320","해운대구":"26350","사하구":"26380",
  "금정구":"26410","강서구":"26440","연제구":"26470","수영구":"26500","사상구":"26530","기장군":"26710" };
const get = u => new Promise(r => { https.get(u, x => { let d=""; x.on("data",c=>d+=c); x.on("end",()=>r(d)); }).on("error",e=>r("{}")); });

(async () => {
  const out = {}, cnt = {};
  for (const gu in SGG) {
    const base = `${SOSO}/storeListInDong?serviceKey=${KEY}&divId=signguCd&key=${SGG[gu]}&indsLclsCd=I2&type=json&numOfRows=500`;
    let items = [];
    for (let p = 1; p <= 3; p++) {   // 최대 1500개 표본
      try { const j = JSON.parse(await get(base + "&pageNo=" + p)); const it = j.body.items || []; if (!it.length) break; items = items.concat(it); }
      catch (e) { break; }
    }
    // 카페(I21201) 제외 = 순수 음식점
    const rest = items.filter(s => s.indsSclsCd !== "I21201" && s.lat && s.lon)
      .map(s => ({
        name: (s.bizesNm || "") + (s.brchNm && String(s.brchNm).trim() ? ` ${String(s.brchNm).trim()}` : ""),
        lat: +s.lat, lon: +s.lon, dong: s.adongNm || "",
        cat: s.indsSclsNm || s.indsMclsNm || "음식점"
      }));
    out[gu] = rest; cnt[gu] = rest.length;
    console.log(`${gu}: 음식점 ${rest.length}개 (표본)`);
  }
  fs.writeFileSync("rest_data.json", JSON.stringify(out));
  const tot = Object.values(cnt).reduce((a, b) => a + b, 0);
  console.log("rest_data.json 저장 · 부산 음식점 표본 총", tot.toLocaleString(), "개");
})();
