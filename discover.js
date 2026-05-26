#!/usr/bin/env node
/**
 * Discover job boards from a CSV of company names + websites.
 *
 * Usage:
 *   node discover.js companies.csv           # print new entries to stdout
 *   node discover.js companies.csv --append  # also append to companies.js
 *
 * CSV format (Crunchbase-compatible — first two columns used):
 *   "Organization Name","Website",...
 *
 * Detects: Greenhouse, Lever, Workable — falls back to html type.
 * Skips companies whose slug already exists in companies.js.
 */

import { readFileSync, appendFileSync, existsSync } from 'fs'
import fetch from 'node-fetch'
import companies from './companies.js'

const APPEND = process.argv.includes('--append')
const csvPath = process.argv.find(a => a.endsWith('.csv'))

if (!csvPath || !existsSync(csvPath)) {
  console.error('Usage: node discover.js <file.csv> [--append]')
  process.exit(1)
}

// ── CSV parser (handles quoted fields with embedded commas) ───────────────────

function parseCsvLine(line) {
  const fields = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQ = !inQ; continue }
    if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  fields.push(cur.trim())
  return fields
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase())
  const nameIdx = headers.findIndex(h => h.includes('name'))
  const urlIdx  = headers.findIndex(h => h.includes('website') || h.includes('url') || h.includes('domain'))
  if (nameIdx < 0 || urlIdx < 0) {
    console.error('CSV must have columns containing "name" and "website" (or "url"/"domain")')
    process.exit(1)
  }
  return lines.slice(1)
    .map(l => parseCsvLine(l))
    .filter(f => f[urlIdx])
    .map(f => ({ name: f[nameIdx], website: f[urlIdx].replace(/\/$/, '') }))
}

// ── Known slugs already in companies.js ──────────────────────────────────────

const knownSlugs = new Set(companies.map(c => c.slug).filter(Boolean))
const knownNames = new Set(companies.map(c => c.name.toLowerCase()))

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function fetchHtml(url, ms = 10000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; job-scout/1.0)',
        'Accept': 'text/html',
      },
    })
    if (!r.ok) return null
    return await r.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ── Job board detector ────────────────────────────────────────────────────────

const PATTERNS = [
  {
    type: 'greenhouse',
    re: /(?:boards(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/)?|job-boards\.greenhouse\.io\/)([a-z0-9_-]+)/i,
  },
  {
    type: 'lever',
    re: /(?:jobs\.lever\.co|api\.lever\.co\/v0\/postings)\/([a-z0-9_-]+)/i,
  },
  {
    type: 'workable',
    re: /apply\.workable\.com\/([a-z0-9_-]+)/i,
  },
]

function detectBoard(html) {
  for (const { type, re } of PATTERNS) {
    const m = html.match(re)
    if (m) {
      const slug = m[1].toLowerCase().replace(/\/jobs.*$/, '')
      if (knownSlugs.has(slug)) return { type, slug, alreadyKnown: true }
      return { type, slug }
    }
  }
  return null
}

async function discoverCompany({ name, website }) {
  // Try homepage first, then /careers
  for (const url of [website, `${website}/careers`, `${website}/jobs`]) {
    const html = await fetchHtml(url)
    if (!html) continue
    const board = detectBoard(html)
    if (board) return board
  }
  // Fallback: html type pointing to /careers
  const careersUrl = `${website}/careers`
  const r = await fetchHtml(careersUrl)
  if (r) return { type: 'html', careersUrl }
  return null
}

// ── Main ──────────────────────────────────────────────────────────────────────

const rows = parseCsv(readFileSync(csvPath, 'utf8'))
console.log(`Loaded ${rows.length} companies from CSV`)

const fresh = rows.filter(r => !knownNames.has(r.name.toLowerCase()))
console.log(`${fresh.length} not yet in companies.js — scanning...\n`)

const BATCH = 5
const results = []

for (let i = 0; i < fresh.length; i += BATCH) {
  const batch = fresh.slice(i, i + BATCH)
  const settled = await Promise.allSettled(
    batch.map(async row => {
      const board = await discoverCompany(row)
      return { row, board }
    })
  )
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue
    const { row, board } = s.value
    if (!board) {
      console.warn(`  ✗  ${row.name} — no job board detected`)
      continue
    }
    if (board.alreadyKnown) {
      console.log(`  ~  ${row.name} — slug '${board.slug}' already in list`)
      continue
    }
    results.push({ name: row.name, ...board })
    const label = board.type === 'html' ? `html  ${board.careersUrl}` : `${board.type.padEnd(11)} slug: ${board.slug}`
    console.log(`  ✓  ${row.name.padEnd(30)} ${label}`)
  }
  // polite delay between batches
  if (i + BATCH < fresh.length) await new Promise(r => setTimeout(r, 400))
}

if (results.length === 0) {
  console.log('\nNothing new to add.')
  process.exit(0)
}

// ── Format output entries ─────────────────────────────────────────────────────

const lines = results.map(r => {
  if (r.type === 'html')
    return `  { name: '${r.name}', type: 'html', careersUrl: '${r.careersUrl}' },`
  return `  { name: '${r.name}', type: '${r.type}', slug: '${r.slug}' },`
})

console.log(`\n── ${results.length} new entries ──────────────────────────────────────\n`)
console.log(lines.join('\n'))

if (APPEND) {
  const block = '\n  // ── Auto-discovered ──\n' + lines.join('\n') + '\n'
  // Insert before the closing bracket of the array
  const path = new URL('./companies.js', import.meta.url).pathname
  let src = readFileSync(path, 'utf8')
  // Insert the new entries inside the array, just before the closing ]
  src = src.replace(/\n]\n\nexport default companies/, block + ']\n\nexport default companies')
  const { writeFileSync } = await import('fs')
  writeFileSync(path, src)
  console.log(`\nAppended ${results.length} entries to companies.js`)
} else {
  console.log('\nRun with --append to add these to companies.js automatically.')
}
