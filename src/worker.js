const TABLES = {
  articles: {
    order: "collected_at",
    fields: ["title", "url", "verification_status", "category", "published_at", "collected_at", "summary", "country"]
  },
  deals: {
    order: "announcement_date",
    fields: ["announcement_date", "title", "deal_type", "value_amount", "currency", "summary", "source_url"]
  },
  events: {
    order: "event_date",
    fields: ["event_date", "country", "title", "description", "event_type", "source_url"]
  }
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60, s-maxage=60",
    "x-content-type-options": "nosniff"
  }
});

async function readPublicTable(baseUrl, key, table, config) {
  const url = new URL(`/rest/v1/${table}`, baseUrl);
  url.searchParams.set("select", config.fields.join(","));
  url.searchParams.set("order", `${config.order}.desc.nullslast`);
  url.searchParams.set("limit", "100");
  const response = await fetch(url, {
    headers: { apikey: key, authorization: `Bearer ${key}`, accept: "application/json" }
  });
  if (!response.ok) return { data: [], error: `Supabase returned HTTP ${response.status}` };
  const rows = await response.json();
  if (!Array.isArray(rows)) return { data: [], error: "Unexpected database response" };
  return {
    data: rows.map(row => Object.fromEntries(config.fields.map(field => [field, row[field] ?? null]))),
    error: null
  };
}

const decodeXml = value => String(value || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]*>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/\s+/g, " ").trim();

function tagValue(block, names) {
  for (const name of names) {
    const re = new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}\\s*>`, "i");
    const match = block.match(re);
    if (match) return decodeXml(match[1]);
  }
  return "";
}

function parseFeed(xml, feedUrl) {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)].map(m => m[0]);
  return blocks.slice(0, 40).map(block => {
    const title = tagValue(block, ["title"]);
    let link = "";
    const atomLink = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
    if (atomLink) link = atomLink[1];
    if (!link) link = tagValue(block, ["link"]);
    if (!/^https?:\/\//i.test(link)) {
      try { link = new URL(link, feedUrl).href; } catch { link = ""; }
    }
    const dateText = tagValue(block, ["pubDate", "published", "updated", "date"]);
    const parsedDate = dateText ? new Date(dateText) : null;
    const description = tagValue(block, ["description", "summary", "content"]);
    return {
      title: title.slice(0, 500),
      url: link,
      published_at: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
      summary: description.slice(0, 2000)
    };
  }).filter(item => item.title && item.url && /^https?:\/\//i.test(item.url));
}

async function discoverFeed(source) {
  const headers = { "user-agent": "AERO-INTEL/1.0 (+hourly public-source monitoring)", accept: "application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.8" };
  const candidates = [source.url];
  try {
    const home = await fetch(source.url, { headers, redirect: "follow", signal: AbortSignal.timeout(12000) });
    if (!home.ok) return null;
    const type = home.headers.get("content-type") || "";
    const body = await home.text();
    if (/xml|rss|atom/i.test(type) || /<rss\b|<feed\b|<rdf:RDF\b/i.test(body.slice(0, 1500))) {
      return { url: home.url || source.url, xml: body };
    }
    const links = [...body.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]);
    for (const tag of links) {
      if (!/alternate/i.test(tag) || !/(rss|atom|xml)/i.test(tag)) continue;
      const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
      if (href) { try { candidates.push(new URL(href, home.url || source.url).href); } catch {} }
    }
    const base = new URL(home.url || source.url);
    for (const path of ["/feed", "/feed/", "/rss", "/rss.xml", "/feed.xml", "/atom.xml"]) {
      candidates.push(new URL(path, base.origin).href);
    }
  } catch { return null; }

  for (const candidate of [...new Set(candidates)].slice(0, 8)) {
    try {
      const response = await fetch(candidate, { headers, redirect: "follow", signal: AbortSignal.timeout(10000) });
      if (!response.ok) continue;
      const body = await response.text();
      if (/<rss\b|<feed\b|<rdf:RDF\b/i.test(body.slice(0, 2000))) return { url: response.url || candidate, xml: body };
    } catch {}
  }
  return null;
}

async function supabaseRequest(baseUrl, key, path, options = {}) {
  return fetch(new URL(`/rest/v1/${path}`, baseUrl), {
    ...options,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json", prefer: "return=minimal" } : {}),
      ...(options.headers || {})
    }
  });
}

async function ingestSources(env) {
  const baseUrl = new URL(env.SUPABASE_URL).origin;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Supabase server secret is not configured");

  const sourcesResponse = await supabaseRequest(baseUrl, key,
    "sources?select=id,name,url,source_type,country,language,is_active&is_active=eq.true&limit=100");
  if (!sourcesResponse.ok) throw new Error(`Could not read sources (HTTP ${sourcesResponse.status})`);
  const sources = await sourcesResponse.json();
  const report = { started_at: new Date().toISOString(), sources_checked: 0, feeds_found: 0, articles_added: 0, errors: [] };

  for (let i = 0; i < sources.length; i += 4) {
    await Promise.all(sources.slice(i, i + 4).map(async source => {
      report.sources_checked++;
      try {
        const feed = await discoverFeed(source);
        if (!feed) throw new Error("No RSS/Atom feed discovered");
        report.feeds_found++;
        const items = parseFeed(feed.xml, feed.url);
        for (const item of items) {
          const existsUrl = new URL("/rest/v1/articles", baseUrl);
          existsUrl.searchParams.set("select", "url");
          existsUrl.searchParams.set("url", `eq.${item.url}`);
          existsUrl.searchParams.set("limit", "1");
          const exists = await fetch(existsUrl, {
            headers: { apikey: key, authorization: `Bearer ${key}`, accept: "application/json" }
          });
          if (!exists.ok) throw new Error(`Article lookup failed (HTTP ${exists.status})`);
          if ((await exists.json()).length) continue;

          const insert = await supabaseRequest(baseUrl, key, "articles", {
            method: "POST",
            body: JSON.stringify({
              title: item.title,
              url: item.url,
              verification_status: "unverified",
              category: "Industry News",
              published_at: item.published_at,
              collected_at: new Date().toISOString(),
              summary: item.summary || null,
              country: source.country || null
            })
          });
          if (!insert.ok) throw new Error(`Article insert failed (HTTP ${insert.status})`);
          report.articles_added++;
        }
        await supabaseRequest(baseUrl, key, `sources?id=eq.${source.id}`, {
          method: "PATCH",
          body: JSON.stringify({ last_checked_at: new Date().toISOString() })
        });
      } catch (error) {
        report.errors.push({ source: source.name || source.url, error: String(error).slice(0, 240) });
      }
    }));
  }
  report.finished_at = new Date().toISOString();
  return report;
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(ingestSources(env).then(report => console.log("AERO-INTEL hourly ingestion", JSON.stringify(report)))
      .catch(error => console.error("AERO-INTEL ingestion failed", error)));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/public-data") {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      const supabaseUrl = env.SUPABASE_URL;
      const supabaseKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !supabaseKey) {
        return json({
          error: "Server data connection is not configured yet.",
          code: "SUPABASE_SERVER_SECRET_MISSING",
          diagnostics: { hasSupabaseUrl: Boolean(supabaseUrl), hasSupabaseSecretKey: Boolean(supabaseKey) }
        }, 503);
      }
      let normalizedUrl;
      try { normalizedUrl = new URL(supabaseUrl).origin; }
      catch { return json({ error: "Server configuration is invalid." }, 500); }

      const [articlesResult, dealsResult, eventsResult] = await Promise.all([
        readPublicTable(normalizedUrl, supabaseKey, "articles", TABLES.articles),
        readPublicTable(normalizedUrl, supabaseKey, "deals", TABLES.deals),
        readPublicTable(normalizedUrl, supabaseKey, "events", TABLES.events)
      ]);
      const payload = {
        fetched_at: new Date().toISOString(),
        articles: articlesResult.data,
        deals: dealsResult.data,
        events: eventsResult.data,
        errors: {}
      };
      if (articlesResult.error) payload.errors.articles = articlesResult.error;
      if (dealsResult.error) payload.errors.deals = dealsResult.error;
      if (eventsResult.error) payload.errors.events = eventsResult.error;
      return json(payload);
    }
    return env.ASSETS.fetch(request);
  }
};
