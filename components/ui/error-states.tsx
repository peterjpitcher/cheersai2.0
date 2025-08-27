/**
 * Standardized error handling components
 * Provides consistent error experiences across the application
 */

import React from "react";
import { AlertTriangle, RefreshCw, WifiOff, Lock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  variant?: "error" | "warning" | "info";
  className?: string;
}

export function ErrorState({ 
  title, 
  description, 
  action, 
  variant = "error", 
  className 
}: ErrorStateProps) {
  const variantClasses = {
    error: "text-red-600",
    warning: "text-yellow-600",
    info: "text-blue-600",
  };

  const Icon = variant === "error" ? AlertTriangle : AlertCircle;

  return (
    <div className={cn("text-center py-12", className)}>
      <div className={cn("mx-auto w-12 h-12 mb-4", variantClasses[variant])}>
        <Icon className="w-full h-full" />
      </div>
      <h3 className="text-lg font-medium text-foreground mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">{description}</p>
      )}
      {action}
    </div>
  );
}

// Network error component
interface NetworkErrorProps {
  onRetry?: () => void;
  isRetrying?: boolean;
}

export function NetworkError({ onRetry, isRetrying }: NetworkErrorProps) {
  return (
    <ErrorState
      title="Connection Problem"
      description="Unable to connect to our servers. Please check your internet connection and try again."
      action={
        onRetry && (
          <button
            onClick={onRetry}
            disabled={isRetrying}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-md",
              "bg-blue-600 text-white hover:bg-blue-700",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <RefreshCw className={cn("w-4 h-4", isRetrying && "animate-spin")} />
            {isRetrying ? "Retrying..." : "Try Again"}
          </button>
        )
      }
      variant="info"
    />
  );
}

// Permission error component
export function PermissionError() {
  return (
    <ErrorState
      title="Access Denied"
      description="You don't have permission to access this resource. Contact your administrator if you believe this is an error."
      action={
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-gray-600 text-white hover:bg-gray-700"
        >
          Go Back
        </button>
      }
      variant="warning"
    />
  );
}

// Rate limit error component
interface RateLimitErrorProps {
  retryAfter?: number;
  onRetry?: () => void;
}

export function RateLimitError({ retryAfter, onRetry }: RateLimitErrorProps) {
  return (
    <ErrorState
      title="Rate Limit Exceeded"
      description={
        retryAfter 
          ? `Too many requests. Please wait ${retryAfter} seconds before trying again.`
          : "Too many requests. Please wait a moment before trying again."
      }
      action={
        onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-yellow-600 text-white hover:bg-yellow-700"
          >
            Try Again
          </button>
        )
      }
      variant="warning"
    />
  );
}

// API error component
interface ApiErrorProps {
  error: Error | string;
  onRetry?: () => void;
  isRetrying?: boolean;
}

export function ApiError({ error, onRetry, isRetrying }: ApiErrorProps) {
  const errorMessage = typeof error === 'string' ? error : error.message;
  
  // Determine error type and provide appropriate messaging
  const getErrorInfo = (message: string) => {
    if (message.includes('network') || message.includes('fetch')) {
      return {
        title: "Connection Problem",
        description: "Unable to connect to our servers. Please check your internet connection.",
        variant: "info" as const,
      };
    }
    
    if (message.includes('unauthorized') || message.includes('401')) {
      return {
        title: "Authentication Required",
        description: "Please sign in again to continue.",
        variant: "warning" as const,
      };
    }
    
    if (message.includes('forbidden') || message.includes('403')) {
      return {
        title: "Access Denied",
        description: "You don't have permission to perform this action.",
        variant: "warning" as const,
      };
    }
    
    if (message.includes('rate limit') || message.includes('429')) {
      return {
        title: "Rate Limit Exceeded",
        description: "Too many requests. Please wait before trying again.",
        variant: "warning" as const,
      };
    }
    
    return {
      title: "Something Went Wrong",
      description: "An unexpected error occurred. Please try again.",
      variant: "error" as const,
    };
  };

  const { title, description, variant } = getErrorInfo(errorMessage);

  return (
    <ErrorState
      title={title}
      description={description}
      action={
        onRetry && (
          <button
            onClick={onRetry}
            disabled={isRetrying}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-md",
              "bg-blue-600 text-white hover:bg-blue-700",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <RefreshCw className={cn("w-4 h-4", isRetrying && "animate-spin")} />
            {isRetrying ? "Retrying..." : "Try Again"}
          </button>
        )
      }
      variant={variant}
    />
  );
}

// Validation error list
interface ValidationErrorsProps {
  errors: Array<{ field?: string; message: string }>;
  className?: string;
}

export function ValidationErrors({ errors, className }: ValidationErrorsProps) {
  if (!errors.length) return null;

  return (
    <div className={cn("rounded-md bg-red-50 border border-red-200 p-4", className)}>
      <div className="flex items-start">
        <AlertCircle className="w-5 h-5 text-red-600 mr-3 mt-0.5 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-red-800 mb-2">
            Please correct the following errors:
          </h3>
          <ul className="text-sm text-red-700 space-y-1">
            {errors.map((error, index) => (
              <li key={index} className="flex">
                <span className="font-medium mr-2">
                  {error.field ? `${error.field}:` : "•"}
                </span>
                <span>{error.message}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// Toast-like error notification
interface ErrorNotificationProps {
  message: string;
  onClose: () => void;
  autoClose?: boolean;
  duration?: number;
}

export function ErrorNotification({ 
  message, 
  onClose, 
  autoClose = true, 
  duration = 5000 
}: ErrorNotificationProps) {
  React.useEffect(() => {
    if (autoClose) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [autoClose, duration, onClose]);

  return (
    <div className="fixed top-4 right-4 z-50 max-w-md">
      <div className="bg-red-600 text-white rounded-lg shadow-lg p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{message}</p>
        </div>
        <button
          onClick={onClose}
          className="flex-shrink-0 text-white hover:text-gray-200"
        >
          <span className="sr-only">Close</span>
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

// Error boundary fallback
interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

export function ErrorFallback({ error, resetError }: ErrorFallbackProps) {
  return (
    <div className="min-h-[400px] flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <AlertTriangle className="w-16 h-16 text-red-600 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Something went wrong
        </h2>
        <p className="text-sm text-gray-600 mb-6">
          {process.env.NODE_ENV === 'development' ? error.message : 
           "An unexpected error occurred. Our team has been notified."}
        </p>
        <div className="space-y-3">
          <button
            onClick={resetError}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="block w-full px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Reload Page
          </button>
        </div>
        {process.env.NODE_ENV === 'development' && (
          <details className="mt-6 text-left">
            <summary className="text-sm text-gray-500 cursor-pointer">
              Error Details (Development Only)
            </summary>
            <pre className="mt-2 p-3 bg-gray-100 rounded text-xs overflow-auto">
              {error.stack}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}