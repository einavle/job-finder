# job-scout


## Run locally

```bash
node server.js
```

Then open **http://localhost:3006** — the dashboard will populate as the scan finishes (54 companies scanned in parallel).

## How it works

- **Greenhouse / Lever / Workable** companies are queried via their public JSON APIs — no scraping needed
- **Custom careers pages** are fetched and parsed with cheerio
- Results are kept in memory; stale positions (no longer listed) are removed on each scan
- A "Scan now" button on the dashboard triggers an immediate re-scan

## Bulk-discover companies from Crunchbase

1. Go to **crunchbase.com** → search Companies → filter: **Location = Tel Aviv** · **Status = Operating** · **Industry = Software / Cybersecurity / Fintech**
2. Export as CSV (free account gives ~1000 rows)
3. Run the discovery script:

```bash
# dry run — prints new entries
node discover.js crunchbase_export.csv

# auto-append to companies.js
node discover.js crunchbase_export.csv --append
```

The script detects Greenhouse / Lever / Workable boards automatically by scanning each company's homepage and careers page, skips companies already in the list, and processes in parallel batches of 5.

---

## Add a company manually

Edit `companies.js` and append an entry:

```js
// Greenhouse
{ name: 'Acme Corp', type: 'greenhouse', slug: 'acmecorp' }

// Lever
{ name: 'Acme Corp', type: 'lever', slug: 'acme-corp' }

// Workable
{ name: 'Acme Corp', type: 'workable', slug: 'acmecorp' }

// Custom HTML careers page
{ name: 'Acme Corp', type: 'html', careersUrl: 'https://acmecorp.com/careers' }
```

To find the correct slug for Greenhouse or Lever, look at the URL of any job listing on their board — the slug is the company identifier in the path.
