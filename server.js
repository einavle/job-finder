import express from 'express'
import cron from 'node-cron'
import companies from './companies.js'
import { scanCompany } from './scanner.js'

const app = express()
const PORT = process.env.PORT || 3006

app.use(express.json())

// ── State ─────────────────────────────────────────────────────────────────────

const jobStore = new Map()   // id → { id, company, title, location, url, firstSeen }
let lastScanned = null
let scanning = false

// ── Scanner ───────────────────────────────────────────────────────────────────

async function runScan() {
  if (scanning) return
  scanning = true
  console.log('[scout] scan started —', companies.length, 'companies')
  const seen = new Set()

  await Promise.allSettled(
    companies.map(async company => {
      const jobs = await scanCompany(company)
      for (const job of jobs) {
        seen.add(job.id)
        if (!jobStore.has(job.id)) {
          jobStore.set(job.id, { ...job, firstSeen: new Date().toISOString() })
          console.log(`[scout] NEW  ${job.company} — ${job.title}`)
        }
      }
    })
  )

  // Remove jobs no longer listed
  for (const id of jobStore.keys()) {
    if (!seen.has(id)) {
      console.log(`[scout] GONE ${jobStore.get(id).company} — ${jobStore.get(id).title}`)
      jobStore.delete(id)
    }
  }

  lastScanned = new Date()
  scanning = false
  console.log(`[scout] scan done — ${jobStore.size} DevOps positions found`)
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => res.json({ ok: true }))

app.get('/api/results', (req, res) => {
  const jobs = [...jobStore.values()].sort((a, b) => b.firstSeen.localeCompare(a.firstSeen))
  res.json({ jobs, lastScanned, scanning, total: jobs.length })
})

app.post('/api/scan', (req, res) => {
  if (scanning) return res.json({ ok: false, message: 'Scan already in progress' })
  runScan().catch(console.error)
  res.json({ ok: true, message: 'Scan started' })
})

app.get('/', (req, res) => {
  const jobs = [...jobStore.values()].sort((a, b) => b.firstSeen.localeCompare(a.firstSeen))
  const ts = lastScanned
    ? lastScanned.toLocaleString('en-IL', { timeZone: 'Asia/Jerusalem' })
    : null

  const rows = jobs.length === 0 && !scanning
    ? `<tr><td colspan="5" style="text-align:center;padding:2rem;color:#888">No DevOps positions found yet — try scanning again.</td></tr>`
    : jobs.map(j => `
      <tr>
        <td><strong>${esc(j.company)}</strong></td>
        <td>${esc(j.title)}</td>
        <td>${esc(j.location)}</td>
        <td style="white-space:nowrap">${new Date(j.firstSeen).toLocaleDateString('en-IL')}</td>
        <td><a href="${esc(j.url)}" target="_blank" rel="noreferrer">Apply →</a></td>
      </tr>`).join('')

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="1800">
  <title>Tel Aviv DevOps Jobs</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #1a1a1a; }
    header { background: #1e293b; color: #fff; padding: 1.25rem 2rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
    header h1 { font-size: 1.25rem; font-weight: 700; }
    .meta { font-size: .85rem; color: #94a3b8; }
    .scan-btn { padding: .45rem 1rem; background: #3b82f6; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: .9rem; font-weight: 600; }
    .scan-btn:hover { background: #2563eb; }
    .summary { padding: 1rem 2rem; background: #fff; border-bottom: 1px solid #e2e8f0; font-size: .9rem; color: #475569; }
    .summary strong { color: #1e293b; }
    main { padding: 1.5rem 2rem; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    th { background: #f1f5f9; text-align: left; padding: .75rem 1rem; font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; color: #64748b; }
    td { padding: .75rem 1rem; border-top: 1px solid #f1f5f9; font-size: .9rem; vertical-align: middle; }
    tr:hover td { background: #f8fafc; }
    td a { color: #3b82f6; text-decoration: none; font-weight: 600; }
    td a:hover { text-decoration: underline; }
    .scanning { display: inline-block; width: 10px; height: 10px; background: #22c55e; border-radius: 50%; animation: pulse 1s ease-in-out infinite; margin-right: .4rem; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>🔍 Tel Aviv DevOps Jobs</h1>
      <p class="meta">
        ${scanning ? '<span class="scanning"></span> Scanning…' : ts ? `Last scanned: ${ts}` : 'Not yet scanned'}
        &nbsp;·&nbsp; ${companies.length} companies tracked
      </p>
    </div>
    <form method="POST" action="/api/scan" id="scanForm">
      <button class="scan-btn" type="button" onclick="triggerScan()">⟳ Scan now</button>
    </form>
  </header>
  <div class="summary">
    <strong>${jobs.length}</strong> open DevOps position${jobs.length !== 1 ? 's' : ''} across
    <strong>${new Set(jobs.map(j => j.company)).size}</strong> compan${new Set(jobs.map(j => j.company)).size !== 1 ? 'ies' : 'y'}
  </div>
  <main>
    <table>
      <thead>
        <tr>
          <th>Company</th>
          <th>Role</th>
          <th>Location</th>
          <th>First seen</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
  <script>
    async function triggerScan() {
      await fetch('/api/scan', { method: 'POST' })
      setTimeout(() => location.reload(), 1000)
    }
  </script>
</body>
</html>`)
})

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ── Boot ──────────────────────────────────────────────────────────────────────

// Scan every 6 hours
cron.schedule('0 */6 * * *', () => runScan().catch(console.error))

app.listen(PORT, () => {
  console.log(`Job Scout on http://localhost:${PORT}`)
  runScan().catch(console.error)
})
