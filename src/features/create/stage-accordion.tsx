"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";

export interface StageAccordionControls {
  openStage: (id: string, options?: { exclusive?: boolean }) => void;
  closeStage: (id: string) => void;
  toggleStage: (id: string) => void;
  goToNext: () => void;
  goToPrevious: () => void;
  isOpen: boolean;
}

export interface StageAccordionStage {
  id: string;
  title: string;
  description?: ReactNode;
  content: ReactNode | ((controls: StageAccordionControls) => ReactNode);
  defaultOpen?: boolean;
}

interface StageAccordionProps {
  stages: StageAccordionStage[];
  allowMultipleOpen?: boolean;
  defaultOpenIds?: string[];
  className?: string;
}

export function StageAccordion({
  stages,
  allowMultipleOpen = true,
  defaultOpenIds,
  className,
}: StageAccordionProps) {
  const initialOpen = resolveDefaultOpen({ stages, allowMultipleOpen, defaultOpenIds });
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(initialOpen));

  const stageIndexMap = useMemo(() => new Map(stages.map((stage, index) => [stage.id, index])), [stages]);

  const openStage = useCallback((stageId: string, { exclusive = false }: { exclusive?: boolean } = {}) => {
    setOpenIds((current) => {
      if (exclusive || !allowMultipleOpen) {
        return new Set([stageId]);
      }
      const next = new Set(current);
      next.add(stageId);
      return next;
    });
  }, [allowMultipleOpen]);

  const closeStage = useCallback((stageId: string) => {
    setOpenIds((current) => {
      const next = new Set(current);
      next.delete(stageId);
      return next;
    });
  }, []);

  const toggleStageById = useCallback((stageId: string) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (allowMultipleOpen) {
        if (next.has(stageId)) {
          next.delete(stageId);
        } else {
          next.add(stageId);
        }
        return next;
      }

      if (next.has(stageId) && next.size === 1) {
        return next;
      }

      return new Set([stageId]);
    });
  }, [allowMultipleOpen]);

  const goToOffset = useCallback((stageId: string, offset: number) => {
    const currentIndex = stageIndexMap.get(stageId);
    if (currentIndex === undefined) return;
    const target = stages[currentIndex + offset];
    if (!target) return;
    setOpenIds(new Set([target.id]));
  }, [stageIndexMap, stages]);

  return (
    <div className={clsx("space-y-4", className)}>
      {stages.map((stage, index) => {
        const isOpen = openIds.has(stage.id);
        const controls: StageAccordionControls = {
          openStage: (id, options) => openStage(id, options),
          closeStage: (id) => closeStage(id),
          toggleStage: (id) => toggleStageById(id),
          goToNext: () => goToOffset(stage.id, 1),
          goToPrevious: () => goToOffset(stage.id, -1),
          isOpen,
        };
        const content =
          typeof stage.content === "function"
            ? stage.content(controls)
            : stage.content;
        return (
          <section
            key={stage.id}
            className="rounded-2xl border border-slate-200 bg-white/95 text-slate-900 shadow-sm transition hover:border-slate-300"
          >
            <button
              type="button"
              onClick={() => toggleStageById(stage.id)}
              className="flex w-full items-center gap-4 px-4 py-4 text-left sm:px-6"
              aria-expanded={isOpen}
              aria-controls={`${stage.id}-panel`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-teal/90 text-sm font-semibold text-white shadow">
                {index + 1}
              </span>
              <span className="flex flex-1 flex-col gap-1">
                <span className="text-base font-semibold leading-snug text-brand-teal">
                  {stage.title}
                </span>
                {stage.description ? (
                  <span className="text-sm leading-snug text-brand-teal/70">{stage.description}</span>
                ) : null}
              </span>
              <ChevronDown className={clsx("h-5 w-5 shrink-0 transition-transform duration-200", isOpen ? "rotate-180" : "rotate-0")} />
            </button>
            <div
              id={`${stage.id}-panel`}
              className={clsx(
                "grid overflow-hidden transition-[grid-template-rows] duration-300 ease-in-out",
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="overflow-hidden border-t border-slate-200 bg-white/95">
                <div className="space-y-6 px-4 py-5 sm:px-6 sm:py-6">{content}</div>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function resolveDefaultOpen({
  stages,
  allowMultipleOpen,
  defaultOpenIds,
}: {
  stages: StageAccordionStage[];
  allowMultipleOpen: boolean;
  defaultOpenIds?: string[];
}) {
  const defaults = new Set<string>();

  if (defaultOpenIds?.length) {
    defaultOpenIds.forEach((id) => defaults.add(id));
  } else {
    stages.forEach((stage, index) => {
      if (stage.defaultOpen) {
        defaults.add(stage.id);
      } else if (defaults.size === 0 && index === 0) {
        defaults.add(stage.id);
      }
    });
  }

  if (!defaults.size && stages[0]) {
    defaults.add(stages[0].id);
  }

  if (!allowMultipleOpen && defaults.size > 1) {
    const [first] = defaults;
    return first ? [first] : [];
  }

  return Array.from(defaults);
}
