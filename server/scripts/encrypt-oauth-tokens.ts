/**
 * Encrypt OAuth tokens that were stored before `account.encryptOAuthTokens`
 * was switched on (server/utils/auth.ts). Without this, Better Auth would try
 * to decrypt a plaintext token and fail, and the user would have to reconnect.
 *
 * Uses the same primitive Better Auth 1.4 uses (better-auth/crypto
 * symmetricEncrypt: XChaCha20-Poly1305, key = SHA-256 of BETTER_AUTH_SECRET,
 * output = hex of nonce + ciphertext + tag).
 *
 * - Columns: access_token and refresh_token only. Better Auth never encrypts
 *   or decrypts id_token, so it must stay as it is.
 * - Idempotent: a value that already decrypts with this secret is skipped.
 *   A hex value that does NOT decrypt (other secret?) is left alone and
 *   counted as "unreadable": that user reconnects in Settings → Account.
 * - Every new value is decrypted again and compared before it is written.
 * - Prints counts only, never token values.
 *
 * Usage (once per environment, after the deploy that turns encryption on):
 *   npm run db:encrypt-oauth-tokens            (writes)
 *   npm run db:encrypt-oauth-tokens -- --dry-run
 * Requires DATABASE_URL and BETTER_AUTH_SECRET (shell env or .env).
 */
import postgres from 'postgres'
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto'

const processWithLoadEnv = process as NodeJS.Process & { loadEnvFile?: (path?: string) => void }
if ((!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET) && typeof processWithLoadEnv.loadEnvFile === 'function') {
  try {
    processWithLoadEnv.loadEnvFile('.env')
  }
  catch {
    // .env is optional where the container provides the env
  }
}

const DATABASE_URL = process.env.DATABASE_URL
const SECRET = process.env.BETTER_AUTH_SECRET
if (!DATABASE_URL || !SECRET) {
  console.error('DATABASE_URL and BETTER_AUTH_SECRET are required.')
  process.exit(1)
}
const dryRun = process.argv.includes('--dry-run')

// 24-byte nonce + 16-byte tag = at least 80 hex chars
const ENCRYPTED_SHAPE = /^(?:[0-9a-f]{2}){40,}$/

type Kind = 'encrypted' | 'unreadable' | 'plaintext'

async function classify(value: string, key: string): Promise<Kind> {
  if (!ENCRYPTED_SHAPE.test(value)) return 'plaintext'
  try {
    await symmetricDecrypt({ key, data: value })
    return 'encrypted'
  }
  catch {
    return 'unreadable'
  }
}

async function main(key: string, url: string) {
  const sql = postgres(url, { max: 1 })
  const counts = { rows: 0, encrypted: 0, alreadyEncrypted: 0, unreadable: 0, rowsUpdated: 0 }
  try {
    const rows = await sql<{ id: string, provider_id: string, access_token: string | null, refresh_token: string | null }[]>`
      select id, provider_id, access_token, refresh_token
      from account
      where access_token is not null or refresh_token is not null`
    counts.rows = rows.length

    await sql.begin(async (tx) => {
      for (const row of rows) {
        const updates: Record<'access_token' | 'refresh_token', string | undefined> = { access_token: undefined, refresh_token: undefined }
        for (const col of ['access_token', 'refresh_token'] as const) {
          const value = row[col]
          if (!value) continue
          const kind = await classify(value, key)
          if (kind === 'encrypted') { counts.alreadyEncrypted++; continue }
          if (kind === 'unreadable') { counts.unreadable++; continue }
          const enc = await symmetricEncrypt({ key, data: value })
          if (await symmetricDecrypt({ key, data: enc }) !== value) throw new Error('Round-trip check failed; nothing was written')
          updates[col] = enc
          counts.encrypted++
        }
        if (!updates.access_token && !updates.refresh_token) continue
        counts.rowsUpdated++
        if (dryRun) continue
        // tx.unsafe with bound params: postgres.js types drop the tagged-template
        // call signature on TransactionSql
        await tx.unsafe(
          'update account set access_token = coalesce($1, access_token), refresh_token = coalesce($2, refresh_token) where id = $3',
          [updates.access_token ?? null, updates.refresh_token ?? null, row.id],
        )
      }
    })
  }
  finally {
    await sql.end({ timeout: 5 })
  }

  console.log(`[encrypt-oauth-tokens]${dryRun ? ' DRY RUN, nothing written.' : ''}`)
  console.log(`  account rows with tokens: ${counts.rows}`)
  console.log(`  tokens encrypted now:     ${counts.encrypted} (in ${counts.rowsUpdated} rows)`)
  console.log(`  already encrypted:        ${counts.alreadyEncrypted}`)
  console.log(`  unreadable (left alone):  ${counts.unreadable}${counts.unreadable ? '  <- these users must reconnect in Settings > Account' : ''}`)
}

main(SECRET, DATABASE_URL).catch((err) => {
  console.error('[encrypt-oauth-tokens] failed:', err instanceof Error ? err.message : 'unknown error')
  process.exit(1)
})
