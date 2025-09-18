import * as React from "react"
import { cn } from "@/lib/utils"

export interface SwitchProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(({ className, ...props }, ref) => {
  return (
    <label className="inline-flex cursor-pointer items-center">
      <input type="checkbox" className="peer sr-only" ref={ref} {...props} />
      <div
        className={cn(
          "w-10 h-6 bg-input rounded-full relative transition-colors",
          "peer-checked:bg-primary",
          className
        )}
      >
        <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-background transition-transform peer-checked:translate-x-4" />
      </div>
    </label>
  )
})
Switch.displayName = "Switch"

export { Switch }

