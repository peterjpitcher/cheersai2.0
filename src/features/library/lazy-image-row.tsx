'use client';

import { useRef, useState, useEffect } from 'react';

interface LazyImageRowProps {
  children: React.ReactNode;
  /** Height placeholder while not yet visible */
  placeholderClassName?: string;
}

/**
 * Lazy-loads a row of images using IntersectionObserver (PERF-04).
 * Renders a placeholder until the row enters the viewport (with 200px margin).
 * First row should NOT use this wrapper — render immediately for LCP.
 */
export function LazyImageRow({
  children,
  placeholderClassName = 'h-48 animate-pulse rounded-lg bg-muted',
}: LazyImageRowProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }, // load 200px before entering viewport
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref}>
      {visible ? children : <div className={placeholderClassName} />}
    </div>
  );
}
