const TABLES = {
  articles: { order: "collected_at", fields: ["title","url","verification_status","category","published_at","collected_at","summary","country"] },
  deals: { order: "announcement_date", fields: ["announcement_date","title","deal_type","value_amount","currency","summary","source_url"] },
  events: { order: "event_date", fields: ["event_date","country","title","description","event_type","source_url"] }
};

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STATIC_SOURCES = [
  ["Times of Israel - Drones","https://www.timesofisrael.com/topic/drones/","Israel"],
  ["Israel Defense","https://www.israeldefense.co.il/","Israel"],
  ["Globes","https://www.globes.co.il/","Israel"],
  ["Calcalist","https://www.calcalist.co.il/","Israel"],
  ["Ynet","https://www.ynet.co.il/","Israel"],
  ["Israel Hayom","https://www.israelhayom.co.il/","Israel"],
  ["DroneDJ","https://dronedj.com/","United States"],
  ["DroneXL","https://dronexl.co/news/","United States"],
  ["Unmanned Airspace","https://www.unmannedairspace.info/","United Kingdom"],
  ["Unmanned Magazine","https://unmannedmagazine.com/news/","Germany"],
  ["Commercial UAV News","https://www.commercialuavnews.com/news","United States"],
  ["Unmanned Systems Technology","https://www.unmannedsystemstechnology.com/category/news/uav-news/","United Kingdom"],
  ["Unmanned Times","https://www.unmannedtimes.com/news","United States"],
  ["UAS Vision","https://www.uasvision.com/","United Kingdom"],
  ["Dronewatch","https://www.dronewatch.nl/","Netherlands"],
  ["sUAS News","https://www.suasnews.com/","United Kingdom"],
  ["DroneLife","https://dronelife.com/","United States"],
  ["AUVSI","https://www.auvsi.org/","United States"]
].map(([name,url,country]) => ({ name,url,country,source_type:"media",language:"en",is_active:true,curated:true }));

const json = (data,status=200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","access-control-allow-origin":"same-origin" }
});
const decodeXml = value => String(value||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/<[^>]*>/g," ")
  .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"')
  .replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
  .replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/\s+/g," ").trim();
function tagValue(block,names) {
  for (const name of names) {
    const re = new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}\\s*>`,"i");
    const match=block.match(re); if(match) return decodeXml(match[1]);
  }
  return "";
}
function parseFeed(xml,feedUrl) {
  const blocks=[...xml.matchAll(/<(item|entry)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)].map(m=>m[0]);
  return blocks.slice(0,80).map(block=>{
    const title=tagValue(block,["title"]);
    let link=block.match(/<(?:[\w.-]+:)?link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1] || tagValue(block,["link"]);
    try { link=new URL(link,feedUrl).href; } catch { link=""; }
    const rawDate=tagValue(block,["pubDate","published","updated","date","dc:date"]);
    const d=rawDate?new Date(rawDate):null;
    return {title:title.slice(0,500),url:link,published_at:d&&!Number.isNaN(d.getTime())?d.toISOString():null,summary:tagValue(block,["description","summary","content"]).slice(0,2000)};
  }).filter(x=>x.title&&x.url&&/^https?:\/\//i.test(x.url));
}
function withinWeek(value) {
  if (!value) return false;
  const t=Date.parse(value), now=Date.now();
  return Number.isFinite(t) && t<=now+6*60*60*1000 && t>=now-MAX_AGE_MS;
}
function publisherCountry(source) {
  const host=(()=>{try{return new URL(source.url).hostname.toLowerCase().replace(/^www\./,"")}catch{return ""}})();
  if (host.endsWith(".il") || /timesofisrael\.com|israeldefense\.co\.il/.test(host)) return "Israel";
  return source.country || null;
}
function categoryFor(item) {
  const s=(item.title+" "+(item.summary||"")).toLowerCase();
  const rules=[
    ["Counter-UAS & הגנה נגד רחפנים",/counter.?uas|anti.?drone|counter.?drone|c-uas|drone detection|interceptor|יירוט רחפנים|נגד רחפנים|שיבוש רחפנים/],
    ["ביטחון וצבא",/military|defen[cs]e|army|navy|air force|combat|warfare|משרד הביטחון|צבא|צה.?ל|כטב.?ם קרבי/],
    ["אוטונומיה ובינה מלאכותית",/autonom|artificial intelligence|\bai\b|machine learning|swarm|נחיל|אוטונומ|בינה מלאכותית/],
    ["טכנולוגיה ופיתוח",/technology|prototype|sensor|payload|navigation|avionics|טכנולוג|חיישן|ניווט|פיתוח/],
    ["סוללות ואנרגיה",/battery|hydrogen|fuel cell|power system|energy|סולל|מימן|אנרגיה|הנעה/],
    ["רגולציה ובטיחות",/regulat|faa|easa|airspace|safety|legislation|תקנות|רגולציה|בטיחות/],
    ["עסקאות והשקעות",/acqui[rs]|merger|funding|investment|contract|award|גיוס|רכישה|השקעה|חוזה|מכרז/],
    ["תעשייה וייצור",/manufactur|production|factory|supply chain|ייצור|מפעל|שרשרת אספקה/],
    ["חקלאות, מיפוי ותשתיות",/agricultur|farming|mapping|survey|inspection|חקלא|מיפוי|מדידה|תשתיות/],
    ["לוגיסטיקה ותעופה אזרחית",/delivery|cargo|logistics|evtol|urban air mobility|transport|משלוחים|לוגיסטיקה|תעופה אזרחית/]
  ];
  return rules.find(([,re])=>re.test(s))?.[0] || "חדשות כלליות";
}
async function discoverFeed(source) {
  const headers={"user-agent":"AERO-INTEL/2.0 (+manual open-source monitoring)","accept":"application/atom+xml, application/rss+xml, application/feed+json, application/xml, text/xml, text/html;q=0.9"};
  const candidates=[source.url];
  try {
    const home=await fetch(source.url,{headers,redirect:"follow",signal:AbortSignal.timeout(12000)});
    if(!home.ok) throw new Error("Homepage HTTP "+home.status);
    const body=await home.text(), type=home.headers.get("content-type")||"";
    if(/xml|rss|atom/i.test(type)||/<rss\b|<feed\b|<rdf:RDF\b/i.test(body.slice(0,2000))) return {url:home.url||source.url,xml:body};
    for(const m of body.matchAll(/<link\b[^>]*>/gi)) {
      const tag=m[0], href=tag.match(/href=["']([^"']+)["']/i)?.[1];
      if(href && (/alternate/i.test(tag)||/(rss|atom|feed)/i.test(tag)) && /(rss|atom|xml|json)/i.test(tag+" "+href)) {
        try{candidates.push(new URL(href,home.url||source.url).href)}catch{}
      }
    }
    const base=new URL(home.url||source.url);
    for(const p of ["/feed/","/feed","/rss/","/rss","/rss.xml","/feed.xml","/atom.xml","/feed.json","/?feed=rss2","/category/drones/feed/"]) candidates.push(new URL(p,base.origin).href);
  } catch(e) { if(!candidates.length) throw e; }
  for(const candidate of [...new Set(candidates)].slice(0,14)) {
    try {
      const r=await fetch(candidate,{headers,redirect:"follow",signal:AbortSignal.timeout(9000)});
      if(!r.ok) continue;
      const body=await r.text();
      if(/<rss\b|<feed\b|<rdf:RDF\b/i.test(body.slice(0,2500))) return {url:r.url||candidate,xml:body};
    } catch {}
  }
  return null;
}
async function sb(base,key,path,options={}) {
  return fetch(new URL("/rest/v1/"+path,base),{...options,headers:{apikey:key,authorization:"Bearer "+key,accept:"application/json",...(options.body?{"content-type":"application/json",prefer:"return=minimal"}:{}),...(options.headers||{})}});
}
async function exists(base,key,table,field,value) {
  const u=new URL("/rest/v1/"+table,base);u.searchParams.set("select",field);u.searchParams.set(field,"eq."+value);u.searchParams.set("limit","1");
  const r=await fetch(u,{headers:{apikey:key,authorization:"Bearer "+key,accept:"application/json"}});
  if(!r.ok) throw new Error("Duplicate check failed "+table+" HTTP "+r.status);
  return (await r.json()).length>0;
}
async function insertDerived(base,key,article) {
  const text=(article.title+" "+(article.summary||"")).toLowerCase();
  const url=article.url, date=article.published_at;
  const isDeal=/acqui[rs]|merger|funding|investment|contract|order worth|wins? .*contract|awarded|גיוס|רכישה|השקעה|חוזה|מכרז/.test(text);
  const isEvent=/exercise|demonstrat|test flight|trial|deployed|operation|conflict|war in|מבצע|ניסוי|הדגמה|פריסה|הופעל/.test(text);
  let added={deal:false,event:false};
  if(isDeal && !await exists(base,key,"deals","source_url",url)) {
    const r=await sb(base,key,"deals",{method:"POST",body:JSON.stringify({announcement_date:date,title:article.title,deal_type:"Investment / Contract / Acquisition",value_amount:null,currency:null,summary:article.summary||null,source_url:url})});
    if(r.ok) added.deal=true;
  }
  if(isEvent && !await exists(base,key,"events","source_url",url)) {
    const r=await sb(base,key,"events",{method:"POST",body:JSON.stringify({event_date:date,country:article.country,title:article.title,description:article.summary||null,event_type:"Industry / Operational report",source_url:url})});
    if(r.ok) added.event=true;
  }
  return added;
}
async function ingestSources(env) {
  const base=new URL(env.SUPABASE_URL).origin, key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  if(!key) throw new Error("Supabase server secret is not configured");
  const sr=await sb(base,key,"sources?select=id,name,url,source_type,country,language,is_active,last_checked_at&is_active=eq.true&limit=150");
  if(!sr.ok) throw new Error("Could not read sources HTTP "+sr.status);
  const dbSources=await sr.json();
  const known=new Set(dbSources.map(s=>String(s.url||"").replace(/\/$/,"").toLowerCase()));
  const sources=[...dbSources,...STATIC_SOURCES.filter(s=>!known.has(s.url.replace(/\/$/,"").toLowerCase()))].slice(0,150);
  const report={started_at:new Date().toISOString(),sources_total:sources.length,sources_checked:0,feeds_found:0,articles_added:0,articles_skipped_old:0,articles_skipped_undated:0,deals_added:0,events_added:0,errors:[]};
  for(let i=0;i<sources.length;i+=4) {
    await Promise.all(sources.slice(i,i+4).map(async source=>{
      report.sources_checked++;
      try {
        const feed=await discoverFeed(source);
        if(!feed) throw new Error("No RSS/Atom feed discovered");
        report.feeds_found++;
        const items=parseFeed(feed.xml,feed.url);
        for(const item of items) {
          if(!item.published_at){report.articles_skipped_undated++;continue}
          if(!withinWeek(item.published_at)){report.articles_skipped_old++;continue}
          if(await exists(base,key,"articles","url",item.url)) continue;
          const article={...item,country:publisherCountry(source),category:categoryFor(item)};
          const ins=await sb(base,key,"articles",{method:"POST",body:JSON.stringify({title:article.title,url:article.url,verification_status:"unverified",category:article.category,published_at:article.published_at,collected_at:new Date().toISOString(),summary:article.summary||null,country:article.country})});
          if(!ins.ok) throw new Error("Article insert HTTP "+ins.status);
          report.articles_added++;
          const derived=await insertDerived(base,key,article);
          if(derived.deal)report.deals_added++;
          if(derived.event)report.events_added++;
        }
        if(source.id) await sb(base,key,"sources?id=eq."+source.id,{method:"PATCH",body:JSON.stringify({last_checked_at:new Date().toISOString()})});
      } catch(e) {report.errors.push({source:source.name||source.url,error:String(e).slice(0,220)})}
    }));
  }
  report.finished_at=new Date().toISOString();
  return report;
}
async function readTable(base,key,table,config) {
  const u=new URL("/rest/v1/"+table,base);u.searchParams.set("select",config.fields.join(","));u.searchParams.set("order",config.order+".desc.nullslast");u.searchParams.set("limit","250");
  if(table==="articles") u.searchParams.set("published_at","gte."+new Date(Date.now()-MAX_AGE_MS).toISOString());
  const r=await fetch(u,{headers:{apikey:key,authorization:"Bearer "+key,accept:"application/json"}});
  if(!r.ok)return {data:[],error:"Supabase HTTP "+r.status};
  const rows=await r.json();
  return {data:Array.isArray(rows)?rows.map(x=>Object.fromEntries(config.fields.map(k=>[k,x[k]??null]))):[],error:null};
}
let lastManualRun=0, manualRun=null;
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname==="/api/public-data" && request.method==="GET") {
      const key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
      if(!env.SUPABASE_URL||!key)return json({error:"Server data connection is not configured",code:"SUPABASE_SERVER_SECRET_MISSING"},503);
      const base=new URL(env.SUPABASE_URL).origin;
      const [a,d,e]=await Promise.all([readTable(base,key,"articles",TABLES.articles),readTable(base,key,"deals",TABLES.deals),readTable(base,key,"events",TABLES.events)]);
      const errors={};if(a.error)errors.articles=a.error;if(d.error)errors.deals=d.error;if(e.error)errors.events=e.error;
      return json({fetched_at:new Date().toISOString(),articles:a.data,deals:d.data,events:e.data,errors});
    }
    if(url.pathname==="/api/refresh-sources") {
      if(request.method!=="POST")return json({error:"Method not allowed"},405);
      const origin=request.headers.get("origin");
      if(!origin || new URL(origin).host!==url.host)return json({error:"Same-origin request required"},403);
      if(manualRun)return json({status:"running",message:"עדכון המקורות כבר מתבצע"});
      if(Date.now()-lastManualRun<60_000)return json({error:"אפשר להפעיל עדכון נוסף רק לאחר דקה"},429);
      lastManualRun=Date.now();
      manualRun=ingestSources(env).finally(()=>{manualRun=null});
      try{return json({status:"completed",report:await manualRun})}
      catch(e){return json({status:"failed",error:String(e)},500)}
    }
    if(url.pathname==="/api/innovation-scan" && request.method==="POST") {
      const origin=request.headers.get("origin");if(!origin||new URL(origin).host!==url.host)return json({error:"Same-origin request required"},403);
      const key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,base=new URL(env.SUPABASE_URL).origin;
      const focus=url.searchParams.get("focus")||"";
      const r=await readTable(base,key,"articles",TABLES.articles);
      const terms=focus.toLowerCase().split(/[\s,()/-]+/).filter(x=>x.length>3);
      const innovation=/prototype|patent|breakthrough|new platform|autonom|artificial intelligence|battery|hydrogen|sensor|payload|swarm|navigation|חדשנות|פטנט|פיתוח|אוטונומ|בינה מלאכותית|סוללה/;
      const matches=r.data.filter(a=>innovation.test((a.title+" "+(a.summary||"")).toLowerCase())&&(terms.length===0||terms.some(t=>(a.title+" "+(a.summary||"")).toLowerCase().includes(t))));
      return json({status:"completed",mode:"rule-based open-source scan (not generative AI)",focus,scanned:r.data.length,results:matches.slice(0,50)});
    }
    if(url.pathname.startsWith("/api/"))return json({error:"Not found"},404);
    return env.ASSETS.fetch(request);
  }
};
