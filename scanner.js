import fetch from 'node-fetch'
import * as cheerio from 'cheerio'

const KEYWORDS = [
  'devops', 'dev ops', 'site reliability', 'sre', 'platform engineer',
  'platform engineering', 'infrastructure engineer', 'cloud engineer',
  'devsecops', 'kubernetes', 'k8s engineer',
]

function isDevOps(title) {
  const lower = title.toLowerCase()
  return KEYWORDS.some(kw => lower.includes(kw))
}

async function get(url, options = {}) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 12000)
  try {
    return await fetch(url, {
      ...options,
      signal: ac.signal,
      headers: { 'User-Agent': 'job-scout/1.0 (personal job tracker)', ...options.headers },
    })
  } finally {
    clearTimeout(timer)
  }
}

async function scanGreenhouse(company) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${company.slug}/jobs?content=true`
  const r = await get(url)
  if (!r.ok) return []
  const { jobs = [] } = await r.json()
  return jobs
    .filter(j => isDevOps(j.title))
    .map(j => ({
      id: `gh-${j.id}`,
      company: company.name,
      title: j.title,
      location: j.location?.name ?? '',
      url: j.absolute_url ?? `https://boards.greenhouse.io/${company.slug}/jobs/${j.id}`,
    }))
}

async function scanLever(company) {
  const url = `https://api.lever.co/v0/postings/${company.slug}?mode=json`
  const r = await get(url)
  if (!r.ok) return []
  const postings = await r.json()
  if (!Array.isArray(postings)) return []
  return postings
    .filter(j => isDevOps(j.text))
    .map(j => ({
      id: `lv-${j.id}`,
      company: company.name,
      title: j.text,
      location: j.categories?.location ?? '',
      url: j.hostedUrl ?? `https://jobs.lever.co/${company.slug}/${j.id}`,
    }))
}

async function scanWorkable(company) {
  const url = `https://apply.workable.com/api/v3/accounts/${company.slug}/jobs`
  const r = await get(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [] }),
  })
  if (!r.ok) return []
  const { results = [] } = await r.json()
  return results
    .filter(j => isDevOps(j.title))
    .map(j => ({
      id: `wk-${j.shortcode}`,
      company: company.name,
      title: j.title,
      location: j.location ?? '',
      url: `https://apply.workable.com/${company.slug}/j/${j.shortcode}/`,
    }))
}

async function scanHtml(company) {
  const r = await get(company.careersUrl)
  if (!r.ok) return []
  const html = await r.text()
  const $ = cheerio.load(html)
  const found = new Map()
  $('a').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim()
    if (!text || !isDevOps(text)) return
    const href = $(el).attr('href')
    if (!href) return
    const fullUrl = href.startsWith('http')
      ? href
      : new URL(href, company.careersUrl).href
    const key = text.toLowerCase()
    if (!found.has(key)) {
      found.set(key, {
        id: `html-${company.name}-${key}`.replace(/[^a-z0-9-]/g, '-'),
        company: company.name,
        title: text,
        location: 'Tel Aviv',
        url: fullUrl,
      })
    }
  })
  return [...found.values()]
}

export async function scanCompany(company) {
  try {
    switch (company.type) {
      case 'greenhouse': return await scanGreenhouse(company)
      case 'lever':      return await scanLever(company)
      case 'workable':   return await scanWorkable(company)
      case 'html':       return await scanHtml(company)
      default:           return []
    }
  } catch (err) {
    console.warn(`[scout] ${company.name}: ${err.message}`)
    return []
  }
}
