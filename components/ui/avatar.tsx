import * as React from "react"
import { cn } from "@/lib/utils"

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string | null
  alt?: string
  fallback?: string
}

export function Avatar({ src, alt, fallback, className, ...props }: AvatarProps) {
  return (
    <div className={cn("inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted", className)} {...props}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt || ""} className="h-full w-full rounded-full object-cover" />
      ) : (
        <span className="text-xs text-muted-foreground font-medium">{fallback?.slice(0,2).toUpperCase()}</span>
      )}
    </div>
  )
}

