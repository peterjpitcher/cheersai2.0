import { Skeleton } from "@/components/ui/skeleton";

export function PlannerSkeleton() {
    return (
        <section className="space-y-6">
            {/* Header skeleton */}
            <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                    <Skeleton className="h-3 w-48" style={{ backgroundColor: 'var(--c-paper-2)' }} />
                    <Skeleton className="h-7 w-64" style={{ backgroundColor: 'var(--c-paper-2)' }} />
                    <Skeleton className="h-4 w-40" style={{ backgroundColor: 'var(--c-paper-2)' }} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Skeleton className="h-[30px] w-20 rounded-[5px]" style={{ backgroundColor: 'var(--c-paper-2)' }} />
                    <Skeleton className="h-[26px] w-40 rounded-md" style={{ backgroundColor: 'var(--c-paper-2)' }} />
                    <Skeleton className="h-[26px] w-16 rounded-[5px]" style={{ backgroundColor: 'var(--c-paper-2)' }} />
                    <Skeleton className="h-[26px] w-24 rounded-[5px]" style={{ backgroundColor: 'var(--c-paper-2)' }} />
                </div>
            </header>

            {/* Calendar container skeleton */}
            <div
                className="overflow-hidden"
                style={{
                    backgroundColor: 'var(--c-card)',
                    border: '1px solid var(--c-line)',
                    borderRadius: 18,
                    padding: 16,
                    boxShadow: 'var(--sh-sm)',
                }}
            >
                {/* Weekday headers */}
                <div className="hidden grid-cols-7 gap-2 md:grid mb-2">
                    {Array.from({ length: 7 }).map((_, i) => (
                        <div key={i} className="pl-3">
                            <Skeleton className="h-3 w-8" style={{ backgroundColor: 'var(--c-paper-2)' }} />
                        </div>
                    ))}
                </div>

                {/* Day cells */}
                <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
                    {Array.from({ length: 35 }).map((_, i) => (
                        <div
                            key={i}
                            style={{
                                backgroundColor: 'var(--c-card)',
                                border: '1px solid var(--c-line)',
                                borderRadius: 10,
                                padding: 12,
                                minHeight: 132,
                            }}
                        >
                            <div className="flex items-start justify-between gap-2 mb-4">
                                <div className="space-y-1">
                                    <Skeleton className="h-3 w-6" style={{ backgroundColor: 'var(--c-paper-2)' }} />
                                    <Skeleton className="h-4 w-4" style={{ backgroundColor: 'var(--c-paper-2)' }} />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Skeleton className="h-10 w-full rounded-lg" style={{ backgroundColor: 'var(--c-paper-2)', opacity: 0.5 }} />
                                <Skeleton className="h-10 w-full rounded-lg" style={{ backgroundColor: 'var(--c-paper-2)', opacity: 0.5 }} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
