#!/usr/bin/env node
// JAY-63 — one-time backfill: encrypts any pre-existing plaintext bank
// routing/account numbers in employee_forms rows that were submitted before
// the encryption fix shipped. Safe to run more than once — rows that already
// have `${field}_encrypted` are skipped, so a partial/interrupted run can
// just be re-run.
//
// This is a standalone script (not run by the app itself, and never run
// automatically) — you run it yourself, once, after both the
// 026_document_views.sql migration (not actually needed by this script, but
// should already be applied) and the BANK_DATA_ENCRYPTION_KEY env var are in
// place.
//
// Usage (from the repo root, with your real Supabase + encryption env vars
// available — e.g. via `node --env-file=.env.local scripts/backfill-encrypt-bank-data.mjs`
// on Node 20.6+, or export them in your shell first):
//
//   node scripts/backfill-encrypt-bank-data.mjs           # dry run — reports what it WOULD change
//   node scripts/backfill-encrypt-bank-data.mjs --apply   # actually writes the updates
//
// Required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// BANK_DATA_ENCRYPTION_KEY (same three the app itself needs).

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const APPLY = process.argv.includes('--apply')

const SENSITIVE_FIELDS = ['routingNumber', 'accountNumber']

function getKey() {
  const b64 = process.env.BANK_DATA_ENCRYPTION_KEY
  if (!b64) throw new Error('BANK_DATA_ENCRYPTION_KEY is not set.')
  const key = Buffer.from(b64, 'base64')
  if (key.length !== 32) throw new Error('BANK_DATA_ENCRYPTION_KEY must decode to exactly 32 bytes.')
  return key
}

// Mirrors src/app/lib/fieldEncryption.ts exactly — duplicated here rather
// than imported since this script runs standalone via plain Node (no
// TypeScript build step), not through the Next.js app.
function encryptField(plaintext) {
  const key = getKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':')
}

function last4(value) {
  return value.slice(-4)
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(1)
  }
  getKey() // fail fast if the encryption key isn't set/valid, before touching any rows

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: rows, error } = await supabaseAdmin
    .from('employee_forms')
    .select('id, form_data')
    .eq('form_type', 'direct_deposit')

  if (error) {
    console.error('Failed to fetch employee_forms rows:', error.message)
    process.exit(1)
  }

  console.log(`Found ${rows.length} direct_deposit form(s).`)

  let alreadyEncrypted = 0
  let migrated = 0
  let skippedNoPlaintext = 0
  let failed = 0

  for (const row of rows) {
    const formData = { ...row.form_data }
    const hasAnyEncrypted = SENSITIVE_FIELDS.some(f => formData[`${f}_encrypted`])
    const hasAnyPlaintext = SENSITIVE_FIELDS.some(f => typeof formData[f] === 'string' && formData[f])

    if (hasAnyEncrypted && !hasAnyPlaintext) {
      alreadyEncrypted++
      continue
    }
    if (!hasAnyPlaintext) {
      skippedNoPlaintext++
      continue
    }

    try {
      for (const field of SENSITIVE_FIELDS) {
        const value = formData[field]
        if (typeof value !== 'string' || !value) continue
        formData[`${field}_encrypted`] = encryptField(value)
        formData[`${field}_last4`] = last4(value)
        delete formData[field]
      }
      delete formData.confirmAccountNumber

      console.log(`${APPLY ? 'Updating' : '[dry run] Would update'} employee_forms.id=${row.id}`)
      if (APPLY) {
        const { error: updateError } = await supabaseAdmin
          .from('employee_forms')
          .update({ form_data: formData })
          .eq('id', row.id)
        if (updateError) throw updateError
      }
      migrated++
    } catch (e) {
      console.error(`  Failed on row ${row.id}:`, e.message)
      failed++
    }
  }

  console.log('\n--- Summary ---')
  console.log(`Already encrypted:   ${alreadyEncrypted}`)
  console.log(`No plaintext found:  ${skippedNoPlaintext}`)
  console.log(`${APPLY ? 'Migrated' : 'Would migrate'}:            ${migrated}`)
  console.log(`Failed:              ${failed}`)
  if (!APPLY && migrated > 0) {
    console.log('\nThis was a dry run — no data was changed. Re-run with --apply to actually update these rows.')
  }
}

main()
