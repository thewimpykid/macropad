// Confirms the beta lockdown is actually in force against the PUBLIC anon key
// (the key shipped in every browser bundle). Run before and after applying
// supabase/lockdown.sql. Reads creds from .env.local:
//   node --env-file=.env.local supabase/verify-lockdown.mjs
//
// PASS = anon key can read NOTHING from these tables. Any 200 with rows is a
// live data leak (the whole point of the beta lockdown is that the raw data,
// and above all the `source` column, never reaches a client).

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (use --env-file=.env.local).");
  process.exit(1);
}

const TABLES = ["macro_series", "gex_snapshots", "referrals"];
let leaked = false;

for (const t of TABLES) {
  const res = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  });
  const body = await res.json().catch(() => null);
  const rows = Array.isArray(body) ? body.length : 0;
  if (res.status === 200 && rows > 0) {
    leaked = true;
    console.log(`LEAK  ${t.padEnd(14)} HTTP 200, anon key read ${rows}+ row(s) — locked down? NO`);
  } else {
    console.log(`ok    ${t.padEnd(14)} HTTP ${res.status} — anon key gets nothing`);
  }
}

console.log(leaked ? "\nFAIL — a table is publicly readable. Apply supabase/lockdown.sql." : "\nPASS — no anon-readable tables.");
process.exit(leaked ? 1 : 0);
