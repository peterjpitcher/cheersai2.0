/**
 * Consistent loading state components
 * Provides standardised loading experiences across the application
 */

import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  text?: string;
}

export function LoadingSpinner({ size = "md", className, text }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-8 h-8",
    xl: "w-12 h-12",
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Loader2 className={cn("animate-spin", sizeClasses[size])} />
      {text && <span className="text-sm text-muted-foreground animate-pulse">{text}</span>}
    </div>
  );
}

interface SkeletonProps {
  className?: string;
  height?: string;
  width?: string;
}

export function Skeleton({ className, height = "h-4", width = "w-full" }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-gray-200 dark:bg-gray-800",
        height,
        width,
        className
      )}
    />
  );
}

// Card skeleton for campaign/post cards
export function CardSkeleton() {
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton width="w-32" />
        <Skeleton width="w-20" height="h-6" />
      </div>
      <Skeleton height="h-3" width="w-3/4" />
      <Skeleton height="h-3" width="w-1/2" />
      <div className="flex items-center gap-2 pt-2">
        <Skeleton width="w-8" height="h-8" className="rounded-full" />
        <Skeleton width="w-8" height="h-8" className="rounded-full" />
        <Skeleton width="w-8" height="h-8" className="rounded-full" />
      </div>
    </div>
  );
}

// Table skeleton
export function TableSkeleton({ rows = 5, columns = 4 }) {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center space-x-4 pb-2 border-b">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} width="w-24" height="h-4" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center space-x-4">
          {Array.from({ length: columns }).map((_, j) => (
            <Skeleton key={j} width="w-20" height="h-4" />
          ))}
        </div>
      ))}
    </div>
  );
}

// Page loading skeleton
export function PageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton width="w-64" height="h-8" />
          <Skeleton width="w-48" height="h-4" />
        </div>
        <Skeleton width="w-32" height="h-10" />
      </div>
      
      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border rounded-lg p-4 space-y-2">
            <Skeleton width="w-16" height="h-4" />
            <Skeleton width="w-20" height="h-8" />
          </div>
        ))}
      </div>
      
      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <div className="space-y-4">
          <div className="border rounded-lg p-4 space-y-3">
            <Skeleton width="w-32" height="h-6" />
            <Skeleton height="h-32" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Button loading state
interface LoadingButtonProps {
  isLoading: boolean;
  children: React.ReactNode;
  loadingText?: string;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

export function LoadingButton({ 
  isLoading, 
  children, 
  loadingText, 
  className,
  onClick,
  disabled,
  ...props 
}: LoadingButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        "bg-primary text-primary-foreground hover:bg-primary/90",
        "h-10 px-4 py-2",
        className
      )}
      onClick={onClick}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <LoadingSpinner size="sm" className="mr-2" />}
      {isLoading ? (loadingText || "Loading...") : children}
    </button>
  );
}

// Empty state component
interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="text-center py-12">
      {icon && <div className="mx-auto w-12 h-12 text-muted-foreground mb-4">{icon}</div>}
      <h3 className="text-lg font-medium text-foreground mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">{description}</p>
      )}
      {action}
    </div>
  );
}

// Refresh button with loading state
interface RefreshButtonProps {
  onRefresh: () => void;
  isRefreshing: boolean;
  className?: string;
}

export function RefreshButton({ onRefresh, isRefreshing, className }: RefreshButtonProps) {
  return (
    <button
      onClick={onRefresh}
      disabled={isRefreshing}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm",
        "border border-gray-300 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
    >
      <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
      {isRefreshing ? "Refreshing..." : "Refresh"}
    </button>
  );
}

// Progressive loading indicator (for multi-step processes)
interface ProgressiveLoadingProps {
  steps: string[];
  currentStep: number;
  isComplete: boolean;
}

export function ProgressiveLoading({ steps, currentStep, isComplete }: ProgressiveLoadingProps) {
  return (
    <div className="space-y-4">
      {steps.map((step, index) => {
        const isActive = index === currentStep;
        const isCompleted = index < currentStep || isComplete;
        
        return (
          <div key={index} className="flex items-center gap-3">
            <div
              className={cn(
                "w-6 h-6 rounded-full border-2 flex items-center justify-center",
                isCompleted && "bg-green-500 border-green-500 text-white",
                isActive && !isCompleted && "border-blue-500",
                !isActive && !isCompleted && "border-gray-300"
              )}
            >
              {isCompleted ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : isActive ? (
                <LoadingSpinner size="sm" />
              ) : (
                <span className="text-sm">{index + 1}</span>
              )}
            </div>
            <span
              className={cn(
                "text-sm",
                isCompleted && "text-green-700",
                isActive && "text-blue-700 font-medium",
                !isActive && !isCompleted && "text-gray-500"
              )}
            >
              {step}
            </span>
          </div>
        );
      })}
    </div>
  );
}
