"use client";

import { useEffect } from 'react'
import { onCLS, onINP, onLCP, type Metric } from 'web-vitals'

const getNavigationType = (): PerformanceNavigationTiming['type'] | 'navigate' => {
  const entry = performance.getEntriesByType('navigation')[0]
  if (entry && 'type' in entry) {
    return (entry as PerformanceNavigationTiming).type ?? 'navigate'
  }
  return 'navigate'
}

function report(metric: Metric) {
  try {
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      id: metric.id,
      // web-vitals v4 no longer exposes 'label'
      navigationType: typeof performance !== 'undefined' ? getNavigationType() : 'navigate',
      path: typeof location !== 'undefined' ? location.pathname : '',
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    })
    const sent = typeof navigator !== 'undefined' ? navigator.sendBeacon?.('/api/vitals', body) : undefined
    if (!sent) {
      void fetch('/api/vitals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    }
  } catch {
    // no-op
  }
}

export default function WebVitals() {
  useEffect(() => {
    const queueMetrics = () => {
      onLCP(report)
      onCLS(report)
      onINP(report)
    }
    const id = window.setTimeout(queueMetrics, 0)
    return () => window.clearTimeout(id)
  }, [])

  return null
}
