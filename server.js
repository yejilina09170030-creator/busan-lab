/*
 * 부산 카페 상권분석 대시보드 — 백엔드 서버
 * ------------------------------------------------------------
 * API:
 *   GET /api/data?cat=cafe   → 구별 지표 + 브랜드 + 시간/요일 패턴
 *   GET /api/stores?gu=&cat= → 매장 리스트 (소상공인 실데이터)
 *   GET /api/trade?gu=       → 국토부 상가 매매 실거래가
 *   /  (정적)               → public/ (프론트엔드, busan_geo.json)
 *
 * 실데이터 소스 (config.json 의 dataGoKr 키 사용):
 *   - 소상공인시장진흥공단 상가(상권)정보  : 카페 점포수/매장명/동  (업종 I21201)
 *   - 국토교통부 상업업무용 부동산 실거래   : 상가 매매 실거래가
 * 키가 없거나 호출 실패 시 자동으로 MOCK(추정)으로 폴백합니다.
 * 매출/연령/성별/유동인구/배달 은 업종평균 기반 '추정치'입니다.
 */
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8787;

// CORS — 공유용 단일 HTML(file://)이 이 서버의 실시간 API를 호출할 수 있게 허용
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ---- 설정(키) 로드 ---------------------------------------------------------
let CONFIG = { dataGoKr: "", sgisKey: "", sgisSecret: "" };
try {
  const p = path.join(__dirname, "config.json");
  if (fs.existsSync(p)) CONFIG = Object.assign(CONFIG, JSON.parse(fs.readFileSync(p, "utf8")));
} catch (e) { console.warn("config.json 읽기 실패:", e.message); }
CONFIG.dataGoKr = process.env.DATA_GO_KR || CONFIG.dataGoKr;
const HAS_KEY = !!CONFIG.dataGoKr;

// ---- 부산 16개 자치구 + 법정동 시군구코드 ----------------------------------
const GU = ["중구","서구","동구","영도구","부산진구","동래구","남구","북구",
  "해운대구","사하구","금정구","강서구","연제구","수영구","사상구","기장군"];
const SGG = { "중구":"26110","서구":"26140","동구":"26170","영도구":"26200",
  "부산진구":"26230","동래구":"26260","남구":"26290","북구":"26320","해운대구":"26350",
  "사하구":"26380","금정구":"26410","강서구":"26440","연제구":"26470","수영구":"26500",
  "사상구":"26530","기장군":"26710" };
const SIZE = { "부산진구":1.00,"해운대구":0.95,"동래구":0.72,"남구":0.70,"금정구":0.68,
  "북구":0.60,"사하구":0.62,"연제구":0.55,"수영구":0.52,"사상구":0.50,
  "기장군":0.48,"강서구":0.45,"동구":0.38,"서구":0.34,"영도구":0.30,"중구":0.40 };
const DONGS = {
  "중구":["남포동","광복동","중앙동","보수동"],"서구":["동대신동","서대신동","암남동","부민동"],
  "동구":["초량동","수정동","좌천동","범일동"],"영도구":["동삼동","청학동","봉래동","남항동"],
  "부산진구":["부전동","전포동","양정동","개금동","가야동"],
  "동래구":["명륜동","온천동","사직동","안락동","수민동"],
  "남구":["대연동","용호동","문현동","우암동"],"북구":["구포동","덕천동","화명동","만덕동"],
  "해운대구":["우동","중동","좌동","재송동","반여동","송정동"],
  "사하구":["하단동","괴정동","다대동","신평동","당리동"],
  "금정구":["장전동","부곡동","구서동","금사동","서동"],
  "강서구":["명지동","대저동","녹산동","가락동"],"연제구":["연산동","거제동"],
  "수영구":["광안동","민락동","남천동","수영동"],"사상구":["주례동","감전동","모라동","덕포동"],
  "기장군":["기장읍","정관읍","일광읍","철마면"] };
const AGES = ["10대","20대","30대","40대","50대+"];
const CAFE_BRANDS = ["메가커피","컴포즈커피","스타벅스","이디야커피","빽다방","투썸플레이스",
  "커피빈","폴바셋","매머드커피","더벤티","할리스","공차","텐퍼센트","개인카페"];
// 지도 브랜드 감지용 (map.html BRAND_COLORS 키와 일치)
const MAP_BRANDS = ["메가커피","컴포즈커피","스타벅스","투썸플레이스","이디야","빽다방",
  "더벤티","매머드커피","공차","할리스","파스쿠찌","폴바셋"];
const BRAND_ALIAS = { "메가커피":["메가엠지씨","메가MGC","메가mgc"], "빽다방":["빽다방"], "폴바셋":["폴 바셋"] };
function detectBrand(nm){
  nm=nm||"";
  for(const b of MAP_BRANDS){
    if(nm.includes(b)) return b;
    const al=BRAND_ALIAS[b]; if(al && al.some(a=>nm.includes(a))) return b;
  }
  return "";
}
// 집객시설 업종 (소상공인 상가정보 코드 — 실측 확인됨)
const FAC_GROUPS = [
  { g:"병원·의원", q:"indsLclsCd=Q1" },
  { g:"약국",     q:"indsSclsCd=G21501" },
  { g:"카페",     q:"indsSclsCd=I21201" },
  { g:"편의점",   q:"indsSclsCd=G20405" },
  { g:"학원",     q:"indsLclsCd=P1" },
];

// ---- 결정적 난수 -----------------------------------------------------------
function hash(s){ s=String(s); let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return h>>>0; }
function rng(seed){ let a=seed>>>0; return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

// ==== 매출 추정(현장 현실 반영) ==============================================
// 사용자 현장경험: 개인 카페 실제 월매출 500만 미만. 프랜차이즈 상대순위만 유지하고
// 전체를 소형·개인 카페 현실에 맞춰 대폭 하향(만원). 브랜드는 현실적 상단.
const BRAND_SALES = {
  "스타벅스":3800, "투썸플레이스":2400, "폴바셋":2100, "커피빈":1900,
  "메가커피":1600, "파스쿠찌":1600, "할리스":1500, "빽다방":1400,
  "매머드커피":1150, "공차":1150, "엔제리너스":1200, "컴포즈커피":1200,
  "텐퍼센트":950, "더벤티":950, "이디야커피":1050, "이디야":1050,
  "개인카페":420
};
const COFFEE_AVG_MAN = 640;  // 구별 매장당평균 앵커(개인카페 다수·현장 현실 반영)
// 매장 월매출 밴드: 브랜드 실제 평균 × 매장별 입지편차(±편차) → {min,max}
function salesBand(brand, seed){
  const base = BRAND_SALES[brand] || BRAND_SALES["개인카페"];
  const rr = rng(hash("sb_"+seed));
  const mid = Math.round(base*(0.86+rr()*0.30));   // 매장별 입지·규모 편차
  return { min: Math.round(mid*0.9), max: Math.round(mid*1.12) };
}
// 추정 개업월(소상공인 DB에 실개업일 없음 → 최근 가중 합성). 원본과 동일 방식.
const YM_BASE_Y=2026, YM_BASE_M=2;   // 기준월 2026.02
function synthYm(seed){
  const rr=rng(hash("ym_"+seed));
  const back=Math.floor(Math.pow(rr(),1.15)*120);  // 0~120개월 전(약 10년, 최근 약간 가중)
  let y=YM_BASE_Y, m=YM_BASE_M-back;
  while(m<=0){ m+=12; y--; }
  return { ym:`${y}.${String(m).padStart(2,"0")}`, year:y };
}
const round=(n,d=0)=>{ const p=10**d; return Math.round(n*p)/p; };
function splitPct(r,n){ const raw=Array.from({length:n},()=>0.4+r()); const s=raw.reduce((a,b)=>a+b,0);
  const pct=raw.map(v=>Math.round(v/s*100)); pct[0]+=100-pct.reduce((a,b)=>a+b,0); return pct; }

// ---- fetch 헬퍼 (Node 18+ 내장 fetch) --------------------------------------
async function getJson(url){ const r=await fetch(url); if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); }
async function getText(url){ const r=await fetch(url); if(!r.ok) throw new Error("HTTP "+r.status); return r.text(); }
const SOSO = "https://apis.data.go.kr/B553077/api/open/sdsc2";
const RTMS = "https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade";

// ==== LIVE: 소상공인 카페 점포수(구별) — 12시간 캐시 ========================
let COUNT_CACHE = { at:0, data:null };
async function liveCafeCounts(){
  if(COUNT_CACHE.data && Date.now()-COUNT_CACHE.at < 12*3600*1000) return COUNT_CACHE.data;
  const out={};
  for(const gu of GU){
    const url=`${SOSO}/storeListInDong?serviceKey=${CONFIG.dataGoKr}&divId=signguCd&key=${SGG[gu]}&indsSclsCd=I21201&type=json&numOfRows=1&pageNo=1`;
    const j=await getJson(url);
    if(String(j.header.resultCode)!=="00") throw new Error("소상공인 API: "+j.header.resultMsg);
    out[gu]=parseInt(j.body.totalCount)||0;
  }
  COUNT_CACHE={ at:Date.now(), data:out };
  return out;
}

// ==== LIVE: 소상공인 카페 매장 리스트(구) ===================================
async function liveStores(gu){
  const sgg=SGG[gu]; if(!sgg) return null;
  const base=`${SOSO}/storeListInDong?serviceKey=${CONFIG.dataGoKr}&divId=signguCd&key=${sgg}&indsSclsCd=I21201&type=json&numOfRows=500`;
  const first=await getJson(base+"&pageNo=1");
  if(String(first.header.resultCode)!=="00") throw new Error(first.header.resultMsg);
  let items=first.body.items||[];
  const total=parseInt(first.body.totalCount)||items.length;
  const pages=Math.min(2, Math.ceil(total/500));  // 최대 1000개
  for(let p=2;p<=pages;p++){ const j=await getJson(base+"&pageNo="+p); items=items.concat(j.body.items||[]); }
  return items.map(s=>{
    const nm=(s.bizesNm||"")+(s.brchNm&&String(s.brchNm).trim()?` ${String(s.brchNm).trim()}`:"");
    const brand=detectBrand(s.bizesNm);
    const band=salesBand(brand, s.bizesId||nm);   // 공정위 브랜드 실제 평균매출 기준
    const ym=synthYm(s.bizesId||nm);              // 추정 개업월
    return { name:nm, cat:"카페", dong:s.adongNm||"",
      lat:+s.lat||0, lon:+s.lon||0, brand,
      bld:s.bldNm||"", addr:s.rdnmAdr||s.lnoAdr||"",
      min:band.min, max:band.max, ym:ym.ym, year:ym.year };
  });
}

// ==== LIVE: 집객시설 (병원·약국·카페·편의점·학원) ==========================
let FAC_CACHE={};
async function liveFacilities(gu){
  const sgg=SGG[gu]; if(!sgg) return null;
  if(FAC_CACHE[gu] && Date.now()-FAC_CACHE[gu].at < 12*3600*1000) return FAC_CACHE[gu].data;
  const groups={};
  for(const f of FAC_GROUPS){
    try{
      const j=await getJson(`${SOSO}/storeListInDong?serviceKey=${CONFIG.dataGoKr}&divId=signguCd&key=${sgg}&${f.q}&type=json&numOfRows=500&pageNo=1`);
      const items=(j.body.items||[]).filter(s=>s.lat&&s.lon)
        .map(s=>({ name:(s.bizesNm||"")+(s.brchNm&&String(s.brchNm).trim()?` ${String(s.brchNm).trim()}`:""),
          dong:s.adongNm||"", lat:+s.lat, lon:+s.lon }));
      groups[f.g]={ count: parseInt(j.body.totalCount)||items.length, items };
    }catch(e){ groups[f.g]={ count:0, items:[] }; }
  }
  const data={ source:"LIVE", groups };
  FAC_CACHE[gu]={ at:Date.now(), data };
  return data;
}

// ==== LIVE: 국토부 상가 매매 실거래(최근 6개월) =============================
function xmlItems(xml){
  const out=[];
  const re=/<item>([\s\S]*?)<\/item>/g; let m;
  while((m=re.exec(xml))){ out.push(m[1]); }
  return out;
}
function xmlGet(block,tag){ const m=block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return m?m[1].trim():""; }
async function liveTrade(gu){
  const sgg=SGG[gu]; if(!sgg) return null;
  const now=new Date(); const deals=[];
  for(let i=0;i<6;i++){
    const dt=new Date(now.getFullYear(), now.getMonth()-i, 1);
    const ymd=`${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,"0")}`;
    let xml;
    try{ xml=await getText(`${RTMS}?serviceKey=${CONFIG.dataGoKr}&LAWD_CD=${sgg}&DEAL_YMD=${ymd}&numOfRows=200&pageNo=1`); }
    catch(e){ continue; }
    for(const it of xmlItems(xml)){
      const amountMan=parseInt((xmlGet(it,"dealAmount")||"").replace(/[^0-9]/g,""))||0;
      const areaM2=parseFloat(xmlGet(it,"buildingAr"))||0;
      const y=xmlGet(it,"dealYear"), mo=xmlGet(it,"dealMonth");
      if(!amountMan) continue;
      deals.push({ ym:`${String(y).slice(2)}.${String(mo).padStart(2,"0")}`, day:xmlGet(it,"dealDay"),
        dong:xmlGet(it,"umdNm"), use:xmlGet(it,"buildingUse"), floor:xmlGet(it,"floor"),
        areaM2:round(areaM2,1), amountMan, perM2: areaM2>0?Math.round(amountMan/areaM2):0,
        dealType:xmlGet(it,"dealingGbn"), canceled: !!xmlGet(it,"cdealType") });
    }
  }
  const byDong={};
  deals.forEach(d=>{ if(!d.perM2)return; const b=byDong[d.dong]||(byDong[d.dong]={sum:0,n:0}); b.sum+=d.perM2; b.n++; });
  const avgByDong={}; for(const k in byDong) avgByDong[k]={ avgPerM2:Math.round(byDong[k].sum/byDong[k].n), n:byDong[k].n };
  deals.sort((a,b)=>(b.ym+String(b.day).padStart(2,"0")).localeCompare(a.ym+String(a.day).padStart(2,"0")));
  return { source:"LIVE", count:deals.length, avgByDong, deals };
}

// ---- 구별 지표 생성 (stores 는 실데이터로 대체 가능) ------------------------
function buildDistrict(gu, realStores){
  const r=rng(hash(gu+"_cafe")); const size=SIZE[gu]||0.5;
  const stores = realStores!=null ? realStores : Math.round(180+size*1000+r()*120);
  // 매장당 평균 월매출 = 공정위 커피 업종 평균(1,553만) × 상권규모 입지보정
  const salesPerStoreMan=Math.round(COFFEE_AVG_MAN*(0.85+size*0.35));
  const monthlySales=round(stores*salesPerStoreMan/10000, 1);
  const floating=Math.round(25000+size*160000+r()*20000);
  const apt=Math.round(28000+size*150000+r()*15000);
  const delivery=Math.round(4000+size*45000+r()*6000);
  const agePct=splitPct(r,AGES.length); const ageMixPct={}, ageSales={};
  AGES.forEach((a,i)=>{ ageMixPct[a]=agePct[i]; ageSales[a]=round(monthlySales*agePct[i]/100,1); });
  const gaCells=splitPct(r,10); const genderAge={"남성":{},"여성":{}};
  AGES.forEach((a,i)=>{ genderAge["남성"][a]=gaCells[i]; genderAge["여성"][a]=gaCells[i+5]; });
  const hhPct=splitPct(r,4); const household={"1인가구":hhPct[0],"2인가구":hhPct[1],"3-4인가구":hhPct[2],"5인이상":hhPct[3]};
  const gPct=splitPct(r,2); const gender={"남성":gPct[0],"여성":gPct[1]};
  const whPct=splitPct(r,2); const weekdayHoliday={"평일":whPct[0],"휴일":whPct[1]};
  const trend=[]; const now=new Date();
  for(let i=11;i>=0;i--){ const dt=new Date(now.getFullYear(), now.getMonth()-i, 1);
    trend.push({ ym:String(dt.getFullYear()).slice(2)+"."+String(dt.getMonth()+1).padStart(2,"0"),
      open:Math.round(2+r()*8), close:Math.round(1+r()*6), sales:round(monthlySales*(0.9+r()*0.2),1) }); }
  return { gu, stores, monthlySales, floating, apt, delivery,
    kpi:{ salesPerStoreMan, aptPerStore:Math.round(apt/stores), floatPerStore:Math.round(floating/stores) },
    ageSales, ageMixPct, openup:{ genderAge, household, gender, weekdayHoliday },
    storeList: mockStores(gu, Math.min(60, stores)), trend };
}
function mockStores(gu, n){
  const r=rng(hash(gu+"_s")); const dongs=DONGS[gu]||[gu+" 일원"]; const out=[];
  for(let i=0;i<n;i++){
    // 현실 반영: 카페 절반 이상이 개인/무브랜드 → 개인카페 비중 높임
    const brand = r()<0.55 ? "개인카페" : CAFE_BRANDS[Math.floor(r()*(CAFE_BRANDS.length-1))];
    const dong=dongs[Math.floor(r()*dongs.length)];
    const name= brand==="개인카페" ? `카페 ${["모모","리브","하루","온","브루","그린","베러","데이"][Math.floor(r()*8)]}` : `${brand} ${dong}점`;
    const band=salesBand(brand, gu+"_"+i+"_"+name);   // 공정위 브랜드 실제 평균매출 기준
    const y=2018+Math.floor(r()*8); const m=1+Math.floor(r()*12);
    out.push({ name, cat:"카페", dong, min:band.min, max:band.max, ym:`${y}.${String(m).padStart(2,"0")}`, year:y });
  }
  return out;
}
function buildBrands(districts, isLive){
  const total=districts.reduce((a,d)=>a+d.stores,0); const r=rng(hash("brands_cafe"));
  const list=CAFE_BRANDS.filter(b=>b!=="개인카페").slice(0,10)
    .map(name=>({ name, cat:"카페", count:Math.round(total*(0.03+r()*0.08)) })).sort((a,b)=>b.count-a.count);
  return { totalStores:total, franchisePct:38, isLive:!!isLive, list };
}
function hourPattern(){ return Array.from({length:24},(_,h)=>{ let w=10+60*Math.exp(-((h-14)**2)/26);
  if(h<7)w*=0.15; if(h>=22)w*=0.4; return { hour:h, weight:round(w,1) }; }); }
function weekdayPattern(){ const b={"월":78,"화":80,"수":83,"목":86,"금":100,"토":97,"일":70};
  return ["월","화","수","목","금","토","일"].map(day=>({ day, weight:b[day] })); }

// ---- /api/data -------------------------------------------------------------
app.get("/api/data", async (req,res)=>{
  // 키가 없으면(배포 공유서버 등) 수집해둔 실데이터 스냅샷을 그대로 제공 → MOCK 안 나옴
  if(!HAS_KEY){
    try{ const snap=JSON.parse(fs.readFileSync(path.join(__dirname,"snapshot_full.json"),"utf8"));
      if(snap&&snap.data&&snap.data.districts) return res.json(snap.data); }catch(e){}
  }
  let source="MOCK", liveError=null, counts=null;
  if(HAS_KEY){
    try{ counts=await liveCafeCounts(); source="LIVE"; }
    catch(e){ liveError=e.message; console.warn("liveCafeCounts 실패:", e.message); }
  }
  const districts=GU.map(gu=>buildDistrict(gu, counts?counts[gu]:null));
  // (가짜 랜덤 노이즈 제거 — 새로고침 시 실제 데이터가 바뀔 때만 값이 변함)
  res.json({
    meta:{ category:"카페", source, liveError, generatedAt:new Date().toISOString(),
      note: source==="LIVE" ? "점포수=소상공인 실데이터 · 매출/인구=추정" : "키 미등록/오류 — 전부 추정치" },
    districts, brands:buildBrands(districts, source==="LIVE"), hour:hourPattern(), weekday:weekdayPattern()
  });
});

// ---- /api/stores -----------------------------------------------------------
app.get("/api/stores", async (req,res)=>{
  const gu=req.query.gu||"부산진구";
  const cat=req.query.cat||"cafe";
  if(cat!=="cafe") return res.json({ items:[], source:"LIVE", total:0 });  // 카페 전용
  if(HAS_KEY){
    try{ const live=await liveStores(gu); if(live&&live.length) return res.json({ items:live, source:"LIVE", total:live.length }); }
    catch(e){ console.warn("liveStores 실패:", e.message); }
  }
  const items=mockStores(gu,120); res.json({ items, source:"MOCK", total:items.length });
});

// ---- /api/facilities : 집객시설(병원·약국·카페·편의점·학원) --------------
app.get("/api/facilities", async (req,res)=>{
  const gu=req.query.gu||"부산진구";
  if(HAS_KEY){
    try{ const f=await liveFacilities(gu); if(f) return res.json(f); }
    catch(e){ console.warn("liveFacilities 실패:", e.message); }
  }
  res.json({ source:"NONE", groups:{} });
});

// ---- /api/apt : 아파트 세대수(K-apt) — 단지목록 API 미승인 시 대기 --------
let APT_DATA=null;
app.get("/api/apt", async (req,res)=>{
  const gu=req.query.gu||"부산진구";
  try{ if(!APT_DATA) APT_DATA=JSON.parse(fs.readFileSync(path.join(__dirname,"apt_data.json"),"utf8")); }catch(e){ APT_DATA={}; }
  const g=APT_DATA[gu];
  if(g && g.total) return res.json({ source:"LIVE", total:g.total, totalUnits:g.totalUnits, byDong:g.byDong });
  res.json({ source:"WAIT", note:"아파트 데이터 없음(collect_apt.js 실행 필요)", total:0, totalUnits:0, byDong:{} });
});

// ---- /api/tracker : 개폐업 추적(주간 스냅샷 비교) ------------------------
const TRACKER_FILE=path.join(__dirname,"tracker.json");
app.get("/api/tracker", async (req,res)=>{
  let snaps=[]; try{ if(fs.existsSync(TRACKER_FILE)) snaps=JSON.parse(fs.readFileSync(TRACKER_FILE,"utf8")); }catch(e){}
  let counts=null;
  if(HAS_KEY){ try{ counts=await liveCafeCounts(); }catch(e){} }
  const total=counts?Object.values(counts).reduce((a,b)=>a+b,0):(snaps.length?snaps[snaps.length-1].total:0);
  const today=new Date().toISOString().slice(0,10);
  if(counts && (!snaps.length || snaps[snaps.length-1].date!==today)){
    snaps.push({ date:today, total, counts });
    try{ fs.writeFileSync(TRACKER_FILE, JSON.stringify(snaps)); }catch(e){}
  }
  const latest=snaps[snaps.length-1], prev=snaps.length>=2?snaps[snaps.length-2]:null;
  res.json({
    totalStores: total,
    snapshots: snaps.map(s=>s.date),
    latestDate: latest?latest.date:today,
    prevDate: prev?prev.date:null,
    opensByMonth: {},        // 소상공인 DB에 개업일 없음 → 스냅샷 비교로 추적
    recentOpens: [],
    // 개업일 데이터가 없어 매장명 단위 diff는 생략(주간 스냅샷 수집분부터 카운트 비교)
  });
});

// ---- /api/shop : 손익 시뮬레이터 저장/불러오기 --------------------------
const SHOP_FILE=path.join(__dirname,"shop.json");
app.get("/api/shop", (req,res)=>{
  try{ if(fs.existsSync(SHOP_FILE)) return res.json(JSON.parse(fs.readFileSync(SHOP_FILE,"utf8"))); }catch(e){}
  res.json({});
});
app.post("/api/shop", express.text({type:()=>true, limit:"2mb"}), (req,res)=>{
  try{ JSON.parse(req.body); fs.writeFileSync(SHOP_FILE, req.body); res.json({ ok:true }); }
  catch(e){ res.status(400).json({ ok:false, error:e.message }); }
});

// ---- /api/trade ------------------------------------------------------------
app.get("/api/trade", async (req,res)=>{
  const gu=req.query.gu||"부산진구";
  if(HAS_KEY){
    try{ const t=await liveTrade(gu); if(t&&t.count) return res.json(t); }
    catch(e){ console.warn("liveTrade 실패:", e.message); }
  }
  res.json({ source:"NONE", count:0, avgByDong:{}, deals:[] });
});

// ---- /api/snapshot : 전체 수집본 한 번에 제공(공유HTML 실시간 부팅용) --------
app.get("/api/snapshot", (req,res)=>{
  const p=path.join(__dirname,"snapshot_full.json");
  if(fs.existsSync(p)) return res.sendFile(p);
  res.status(404).json({ error:"snapshot_full.json 없음 — collect.js 실행 필요" });
});

// ---- /api/rest : 음식점(카페 적합도용) — rest_data.json ---------------------
let REST_DATA=null;
app.get("/api/rest", (req,res)=>{
  const gu=req.query.gu||"부산진구";
  try{ if(!REST_DATA) REST_DATA=JSON.parse(fs.readFileSync(path.join(__dirname,"rest_data.json"),"utf8")); }catch(e){ REST_DATA={}; }
  res.json({ source:"LIVE", items:REST_DATA[gu]||[] });
});

// ---- 정적 파일 + 시작 ------------------------------------------------------
// 공유용 통합 대시보드를 동일 출처로 제공(localhost:8787/full) → 실시간 100% 보장
app.get(["/full","/dashboard"], (req,res)=>res.sendFile(path.join(__dirname, "부산 카페 상권분석 대시보드 (공유용).html")));
app.use(express.static(path.join(__dirname, "public")));
app.listen(PORT, ()=>{
  console.log("──────────────────────────────────────────");
  console.log("  부산 카페 상권분석 대시보드 서버 시작");
  console.log("  →  http://localhost:" + PORT);
  console.log("  데이터: " + (HAS_KEY ? "config.json 키 감지 → LIVE 시도(실패 시 MOCK)" : "MOCK (키 미등록)"));
  console.log("  종료: Ctrl + C");
  console.log("──────────────────────────────────────────");
});
