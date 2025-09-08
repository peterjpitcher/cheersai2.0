"use client";

import { onCLS, onINP, onLCP, Metric } from 'web-vitals'

function report(metric: Metric) {
  try {
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      id: metric.id,
      label: metric.label,
      navigationType: (performance.getEntriesByType('navigation')[0] as any)?.type || 'navigate',
      path: location.pathname,
      ua: navigator.userAgent,
    })
    navigator.sendBeacon?.('/api/vitals', body) || fetch('/api/vitals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  } catch {
    // no-op
  }
}

export default function WebVitals() {
  if (typeof window !== 'undefined') {
    // Queue in idle time so it does not block paint
    setTimeout(() => {
      onLCP(report)
      onCLS(report)
      onINP(report)
    }, 0)
  }
  return null
}

