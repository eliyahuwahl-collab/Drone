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
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: "application/json"
    }
  });

  if (!response.ok) {
    return { data: [], error: `Supabase returned HTTP ${response.status}` };
  }

  const rows = await response.json();
  if (!Array.isArray(rows)) return { data: [], error: "Unexpected database response" };

  // Only explicitly approved display fields leave this Worker.
  const data = rows.map(row => Object.fromEntries(
    config.fields.map(field => [field, row[field] ?? null])
  ));
  return { data, error: null };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/public-data") {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed" }, 405);
      }

      const supabaseUrl = env.SUPABASE_URL;
      const supabaseKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !supabaseKey) {
        return json({
          error: "Server data connection is not configured yet.",
          code: "SUPABASE_SERVER_SECRET_MISSING"
        }, 503);
      }

      let normalizedUrl;
      try {
        normalizedUrl = new URL(supabaseUrl).origin;
      } catch {
        return json({ error: "Server configuration is invalid." }, 500);
      }

      const entries = await Promise.all(
        Object.entries(TABLES).map(async ([table, config]) => [
          table,
          await readPublicTable(normalizedUrl, supabaseKey, table, config)
        ])
      );

      const payload = { fetched_at: new Date().toISOString(), articles: [], deals: [], events: [], errors: {} };
      for (const [table, result] of entries) {
        payload[table] = result.data;
        if (result.error) payload.errors[table] = result.error;
      }
      return json(payload);
    }

    return env.ASSETS.fetch(request);
  }
};
