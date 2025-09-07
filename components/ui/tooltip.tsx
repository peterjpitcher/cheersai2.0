import * as React from "react"

interface TooltipProps {
  content: string
  children: React.ReactElement
}

export function Tooltip({ content, children }: TooltipProps) {
  // Simple title-based tooltip to avoid extra deps.
  return React.cloneElement(children, { title: content })
}

