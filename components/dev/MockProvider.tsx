"use client";

import { useEffect } from 'react'

export default function MockProvider() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_USE_MOCKS === '1') {
      import('../../msw/browser').then(({ worker }) => {
        worker.start({ quiet: true })
      })
    }
  }, [])
  return null
}

