const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TABLES = {
  articles: {
    select: 'id,title,summary,url,category,country,verification_status,published_at,collected_at',
    order: 'collected_at.desc',
  },
  deals: {
    select: 'id,announcement_date,title,deal_type,value_amount,currency,source_url,summary,company_id',
    order: 'announcement_date.desc',
  },
  events: {
    select: 'id,event_date,title,description,event_type,country,source_url',
    order: 'event_date.desc',
  },
};

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
    'X-Content-Type-Options': 'nosniff',
  },
  body: JSON.stringify(body),
});

export default async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json(503, { error: 'Server configuration incomplete. Add the required Netlify environment variables.' });
  }

  const entries = await Promise.all(Object.entries(TABLES).map(async ([table, config]) => {
    const url = new URL(`/rest/v1/${table}`, SUPABASE_URL);
    url.searchParams.set('select', config.select);
    url.searchParams.set('order', config.order);
    url.searchParams.set('limit', '100');

    try {
      const response = await fetch(url, {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Accept: 'application/json',
        },
      });
      if (!response.ok) return [table, { data: [], error: `Unable to load ${table}.` }];
      const data = await response.json();
      return [table, { data: Array.isArray(data) ? data : [], error: null }];
    } catch {
      return [table, { data: [], error: `Unable to load ${table}.` }];
    }
  }));

  const result = Object.fromEntries(entries);
  return json(200, {
    articles: result.articles.data,
    deals: result.deals.data,
    events: result.events.data,
    errors: Object.fromEntries(entries.filter(([, value]) => value.error).map(([key, value]) => [key, value.error])),
    fetched_at: new Date().toISOString(),
  });
};
