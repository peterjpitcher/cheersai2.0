import * as React from "react"
import { cn } from "@/lib/utils"

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number
}

export function Progress({ value = 0, className, ...props }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div className={cn("w-full h-2 rounded-full bg-muted", className)} {...props}>
      <div className="h-2 rounded-full bg-primary" style={{ width: `${clamped}%` }} />
    </div>
  )
}

