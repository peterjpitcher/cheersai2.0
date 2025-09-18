import * as React from "react"
import { cn } from "@/lib/utils"
import Image from 'next/image'

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string | null
  alt?: string
  fallback?: string
}

export function Avatar({ src, alt, fallback, className, ...props }: AvatarProps) {
  return (
    <div className={cn("inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted overflow-hidden", className)} {...props}>
      {src ? (
        <Image src={src} alt={alt || ""} fill sizes="32px" className="object-cover" />
      ) : (
        <span className="text-xs font-medium text-muted-foreground">{fallback?.slice(0,2).toUpperCase()}</span>
      )}
    </div>
  )
}
