#!/usr/bin/env node
// Simple bundle budget checker for Next.js app directory
// - Fail if any page initial chunk > 180 KB gz
// - Warn/fail if server-only SDKs leak into client bundles

import { createGzip } from 'zlib'
import { pipeline } from 'stream'
import { promisify } from 'util'
import { globby } from 'globby'
import fs from 'fs'
import path from 'path'

const pipe = promisify(pipeline)

async function gzipSize(buf) {
  const src = fs.createReadStream(buf)
  const gzip = createGzip()
  let size = 0
  const dst = new (class extends fs.WriteStream {
    constructor() { super('/dev/null'); }
    write(chunk, enc, cb) { size += chunk.length; cb && cb(); return true }
  })()
  await pipe(src, gzip, dst)
  return size
}

async function main() {
  const root = '.next/static/chunks/app'
  const exists = fs.existsSync(root)
  if (!exists) {
    console.log(`[bundle-budgets] No ${root} folder found. Skipping.`)
    return
  }

  const files = await globby(['.next/static/chunks/app/**/page-*.js'])
  const limit = 180 * 1024 // 180 KB
  let failed = false

  for (const f of files) {
    const abs = path.resolve(f)
    const gz = await gzipFile(abs)
    if (gz > limit) {
      console.error(`[bundle-budgets] FAIL: ${f} gz=${gz} > ${limit}`)
      failed = true
    } else {
      console.log(`[bundle-budgets] OK: ${f} gz=${gz}`)
    }
  }

  // Check for server SDKs in client bundles
  const clientFiles = await globby(['.next/static/chunks/**/*.js'])
  const forbiddenPatterns = [
    '@sentry/node',
    'fs/promises',
    'child_process',
    'net',
    'tls',
  ]
  for (const f of clientFiles) {
    const content = fs.readFileSync(f, 'utf8')
    for (const p of forbiddenPatterns) {
      if (content.includes(p)) {
        console.error(`[bundle-budgets] FAIL: server-only dependency '${p}' found in ${f}`)
        failed = true
      }
    }
  }

  if (failed) process.exit(1)
}

async function gzipFile(file) {
  const input = fs.readFileSync(file)
  return await new Promise((resolve, reject) => {
    import('zlib').then(({ gzip }) => {
      gzip(input, (err, res) => {
        if (err) reject(err)
        else resolve(res.length)
      })
    }).catch(reject)
  })
}

main().catch((e) => {
  console.error('[bundle-budgets] Error:', e)
  process.exit(1)
})

