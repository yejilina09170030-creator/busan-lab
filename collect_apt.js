// 부산 아파트 단지·세대수 수집 (재개 가능 캐시). 결과 → apt_data.json
// 국토부 공동주택 단지목록(AptListService3) + 기본정보(AptBasisInfoServiceV4, 세대수)
const fs = require("fs");
const https = require("https");
const KEY = require("./config.json").dataGoKr;
const SGG = { "중구":"26110","서구":"26140","동구":"26170","영도구":"26200","부산진구":"26230",
  "동래구":"26260","남구":"26290","북구":"26320","해운대구":"26350","사하구":"26380",
  "금정구":"26410","강서구":"26440","연제구":"26470","수영구":"26500","사상구":"26530","기장군":"26710" };

const get = u => new Promise(r => { https.get(u, x => { let d=""; x.on("data",c=>d+=c); x.on("end",()=>r({c:x.statusCode,d})); }).on("error",e=>r({c:0,d:String(e)})); });
const asArr = x => !x ? [] : (Array.isArray(x) ? x : [x]);
const sleep = ms => new Promise(r=>setTimeout(r,ms));

// 재개용 캐시: kaptCode -> {units, dong}
const CACHE_FILE = "apt_cache.json";
let cache = {};
try { if (fs.existsSync(CACHE_FILE)) cache = JSON.parse(fs.readFileSync(CACHE_FILE,"utf8")); } catch(e){}

async function fetchUnits(kaptCode){
  for (let t=0;t<2;t++){
    const u = `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4?serviceKey=${KEY}&kaptCode=${kaptCode}&_type=json`;
    const b = await get(u);
    try { const it = JSON.parse(b.d).response.body.item; return +it.kaptdaCnt || 0; }
    catch(e){ await sleep(300); }
  }
  return null;
}

(async () => {
  const gus = Object.keys(SGG);
  let allDanji = [];   // {gu, kaptCode, name, dong}
  for (const gu of gus){
    const u = `https://apis.data.go.kr/1613000/AptListService3/getSigunguAptList3?serviceKey=${KEY}&sigunguCode=${SGG[gu]}&pageNo=1&numOfRows=600&_type=json`;
    const a = await get(u);
    let items=[]; try { const it=JSON.parse(a.d).response.body.items; items = asArr(it && it.item ? it.item : it); } catch(e){}
    items.forEach(it => allDanji.push({ gu, kaptCode: it.kaptCode, name: it.kaptName, dong: it.as3 || "" }));
    console.log(`${gu}: ${items.length}단지`);
  }
  console.log("총 단지:", allDanji.length, "· 캐시된:", Object.keys(cache).length);

  // 세대수 조회 (미캐시분만), 동시성 6, 진행 저장
  const todo = allDanji.filter(d => !(d.kaptCode in cache));
  console.log("조회 필요:", todo.length);
  let done = 0, fail = 0;
  const CONC = 6;
  for (let i=0;i<todo.length;i+=CONC){
    const batch = todo.slice(i, i+CONC);
    await Promise.all(batch.map(async d => {
      const u = await fetchUnits(d.kaptCode);
      if (u===null){ fail++; cache[d.kaptCode] = { units:0, dong:d.dong, fail:true }; }
      else { cache[d.kaptCode] = { units:u, dong:d.dong }; }
      done++;
    }));
    if (i % 60 === 0){ fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); process.stdout.write(`\r  진행 ${done}/${todo.length} (실패 ${fail})   `); }
  }
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  console.log(`\n세대수 조회 완료: ${done} (실패 ${fail})`);

  // 집계: gu -> {source, total, totalUnits, byDong:{법정동:{count,units,names:[{name,units}]}}}
  const out = {};
  for (const d of allDanji){
    const c = cache[d.kaptCode] || { units:0, dong:d.dong };
    const g = out[d.gu] || (out[d.gu] = { source:"LIVE", total:0, totalUnits:0, byDong:{} });
    g.total++; g.totalUnits += (c.units||0);
    const dong = d.dong || "기타";
    const bd = g.byDong[dong] || (g.byDong[dong] = { count:0, units:0, names:[] });
    bd.count++; bd.units += (c.units||0); bd.names.push({ name:d.name, units:c.units||0 });
  }
  for (const gu in out) for (const dong in out[gu].byDong) out[gu].byDong[dong].names.sort((a,b)=>b.units-a.units);
  fs.writeFileSync("apt_data.json", JSON.stringify(out));
  const tot = Object.values(out).reduce((a,g)=>a+g.totalUnits,0);
  const gs = out["강서구"];
  console.log("apt_data.json 저장. 부산 총 세대수:", tot.toLocaleString(), gs?("· 강서구: "+gs.total+"단지 "+gs.totalUnits.toLocaleString()+"세대"):"");
})();
