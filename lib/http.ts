import { NextRequest, NextResponse } from 'next/server'

export type RequestContext = { requestId: string }
export type ApiOk<T> = { ok: true; data: T; requestId: string }
export type ApiErr = { ok: false; error: { code: string; message: string; details?: unknown }; requestId: string }
export type ApiResult<T> = ApiOk<T> | ApiErr

function requestIdFromHeaders(req?: NextRequest): string | undefined {
  return req?.headers.get('x-request-id') || undefined
}

function generateRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function getRequestContext(req?: NextRequest): RequestContext {
  return { requestId: requestIdFromHeaders(req) || generateRequestId() }
}

export function ok<T>(data: T, reqOrCtx?: NextRequest | Partial<RequestContext>, init?: ResponseInit) {
  const ctx = isNextRequest(reqOrCtx) ? getRequestContext(reqOrCtx) : mergeCtx(reqOrCtx)
  return NextResponse.json<ApiOk<T>>({ ok: true, data, requestId: ctx.requestId }, { status: 200, ...init })
}

export function badRequest(code: string, message: string, details?: unknown, reqOrCtx?: NextRequest | Partial<RequestContext>) {
  const ctx = isNextRequest(reqOrCtx) ? getRequestContext(reqOrCtx) : mergeCtx(reqOrCtx)
  return NextResponse.json<ApiErr>({ ok: false, error: { code, message, details }, requestId: ctx.requestId }, { status: 400 })
}

export function unauthorized(message = 'Unauthorized', details?: unknown, reqOrCtx?: NextRequest | Partial<RequestContext>) {
  const ctx = isNextRequest(reqOrCtx) ? getRequestContext(reqOrCtx) : mergeCtx(reqOrCtx)
  return NextResponse.json<ApiErr>({ ok: false, error: { code: 'unauthorized', message, details }, requestId: ctx.requestId }, { status: 401 })
}

export function forbidden(message = 'Forbidden', details?: unknown, reqOrCtx?: NextRequest | Partial<RequestContext>) {
  const ctx = isNextRequest(reqOrCtx) ? getRequestContext(reqOrCtx) : mergeCtx(reqOrCtx)
  return NextResponse.json<ApiErr>({ ok: false, error: { code: 'forbidden', message, details }, requestId: ctx.requestId }, { status: 403 })
}

export function notFound(message = 'Not Found', details?: unknown, reqOrCtx?: NextRequest | Partial<RequestContext>) {
  const ctx = isNextRequest(reqOrCtx) ? getRequestContext(reqOrCtx) : mergeCtx(reqOrCtx)
  return NextResponse.json<ApiErr>({ ok: false, error: { code: 'not_found', message, details }, requestId: ctx.requestId }, { status: 404 })
}

export function serverError(message = 'Internal server error', details?: unknown, reqOrCtx?: NextRequest | Partial<RequestContext>) {
  const ctx = isNextRequest(reqOrCtx) ? getRequestContext(reqOrCtx) : mergeCtx(reqOrCtx)
  return NextResponse.json<ApiErr>({ ok: false, error: { code: 'server_error', message, details }, requestId: ctx.requestId }, { status: 500 })
}

export function rateLimited(message = 'Too many requests', retryAfterSeconds?: number, details?: unknown, reqOrCtx?: NextRequest | Partial<RequestContext>) {
  const ctx = isNextRequest(reqOrCtx) ? getRequestContext(reqOrCtx) : mergeCtx(reqOrCtx)
  const headers: Record<string, string> = {}
  if (typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0) {
    headers['Retry-After'] = String(Math.ceil(retryAfterSeconds))
  }
  return NextResponse.json<ApiErr>({ ok: false, error: { code: 'RATE_LIMITED', message, details }, requestId: ctx.requestId }, { status: 429, headers })
}

function isNextRequest(input: unknown): input is NextRequest {
  return typeof input === 'object' && input !== null && 'headers' in input &&
    typeof (input as NextRequest).headers?.get === 'function'
}

function mergeCtx(ctx?: Partial<RequestContext>): RequestContext {
  return { requestId: ctx?.requestId || generateRequestId() }
}
