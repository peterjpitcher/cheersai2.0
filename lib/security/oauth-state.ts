import { cookies } from 'next/headers'
import { decryptObject, encryptObject, generateSecureToken } from '@/lib/security/encryption'

const COOKIE_NAME = 'cheers_oauth_state'
const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

export interface OAuthStateMeta {
  tenantId: string
  userId: string
  redirectPath?: string | null
  platform?: string | null
}

interface StoredState extends OAuthStateMeta {
  nonce: string
  createdAt: string
  expiresAt: string
}

type StateStore = Record<string, StoredState>

type CookieStore = {
  get(name: string): { value: string } | undefined
  set(name: string, value: string, options?: { httpOnly?: boolean; sameSite?: 'lax' | 'strict' | 'none'; secure?: boolean; path?: string; maxAge?: number }): void
  delete(name: string): void
}

const now = () => Date.now()

function makeCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.ceil(STATE_TTL_MS / 1000),
  }
}

function pruneExpired(store: StateStore, timestamp: number): StateStore {
  const result: StateStore = {}
  for (const [key, value] of Object.entries(store)) {
    if (new Date(value.expiresAt).getTime() > timestamp) {
      result[key] = value
    }
  }
  return result
}

function readStateStore(store: CookieStore): StateStore {
  const raw = store.get(COOKIE_NAME)?.value
  if (!raw) return {}
  try {
    const parsed = decryptObject<StateStore>(raw)
    return parsed ?? {}
  } catch {
    store.delete(COOKIE_NAME)
    return {}
  }
}

function writeStateStore(store: CookieStore, next: StateStore) {
  const sanitized = pruneExpired(next, now())
  const keys = Object.keys(sanitized)
  if (keys.length === 0) {
    store.delete(COOKIE_NAME)
    return
  }
  const encrypted = encryptObject(sanitized)
  store.set(COOKIE_NAME, encrypted, makeCookieOptions())
}

export function persistOAuthStateWithStore(store: CookieStore, meta: OAuthStateMeta, timestamp: number = now()): string {
  const current = readStateStore(store)
  const nonce = generateSecureToken(16)
  current[nonce] = {
    nonce,
    tenantId: meta.tenantId,
    userId: meta.userId,
    redirectPath: meta.redirectPath,
    platform: meta.platform,
    createdAt: new Date(timestamp).toISOString(),
    expiresAt: new Date(timestamp + STATE_TTL_MS).toISOString(),
  }
  writeStateStore(store, current)
  return nonce
}

export function consumeOAuthStateWithStore(store: CookieStore, nonce: string, timestamp: number = now()): OAuthStateMeta | null {
  if (!nonce) return null
  const current = readStateStore(store)
  const entry = current[nonce]
  if (!entry) {
    writeStateStore(store, current)
    return null
  }
  delete current[nonce]
  writeStateStore(store, current)
  if (new Date(entry.expiresAt).getTime() <= timestamp) {
    return null
  }
  return {
    tenantId: entry.tenantId,
    userId: entry.userId,
    redirectPath: entry.redirectPath,
    platform: entry.platform,
  }
}

export async function persistOAuthState(meta: OAuthStateMeta): Promise<string> {
  const store = await cookies()
  return persistOAuthStateWithStore(store, meta)
}

export async function consumeOAuthState(nonce: string): Promise<OAuthStateMeta | null> {
  const store = await cookies()
  return consumeOAuthStateWithStore(store, nonce)
}
