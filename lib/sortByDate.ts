export type HasScheduled = { scheduled_for?: string | Date | null | undefined };

export const sortByDate = <T extends HasScheduled>(a: T, b: T) => {
  const at = a?.scheduled_for ? new Date(a.scheduled_for).getTime() : 0;
  const bt = b?.scheduled_for ? new Date(b.scheduled_for).getTime() : 0;
  return at - bt;
};
