export function hoursToMs(hours: number | string): number;
export function cutoffMs(nowMs: number, hours: number | string): number;
export function utcDayStartMs(ms: number): number;
export function partitionNameForDay(ms: number): string;
export function partitionBoundsForDay(ms: number): { fromIso: string; toIso: string; fromMs: number; toMs: number };
export function parsePartitionBound(text: string): { isDefault: boolean; fromMs: number | null; toMs: number | null } | null;
export function isPartitionDroppable(bound: { isDefault?: boolean; toMs: number | null } | null | undefined, cutoff: number): boolean;
export function planAuditPartitions(
  partitions: Array<{ name: string; bound?: { isDefault?: boolean; fromMs: number | null; toMs: number | null } | null }> | null | undefined,
  cutoff: number,
): {
  drop: Array<{ name: string; bound?: unknown }>;
  trim: Array<{ name: string; bound?: unknown }>;
  keep: Array<{ name: string; bound?: unknown }>;
};
