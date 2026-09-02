export type FileSelectionRangeDirection = "above" | "below";

export function rangeDirectionFromActiveMove(
  previousIndex: number,
  currentIndex: number
): FileSelectionRangeDirection | undefined {
  if (previousIndex < 0 || currentIndex < 0 || previousIndex === currentIndex) {
    return undefined;
  }

  return currentIndex < previousIndex ? "above" : "below";
}

export function sliceItemsForRange<T>(
  items: readonly T[],
  activeIndex: number,
  direction: FileSelectionRangeDirection
): T[] {
  if (activeIndex < 0 || activeIndex >= items.length) {
    return [];
  }

  if (direction === "above") {
    return items.slice(0, activeIndex + 1);
  }

  return items.slice(activeIndex);
}

export function toggleSetMembership<T>(picked: Set<T>, keys: readonly T[]): void {
  for (const key of keys) {
    if (!picked.delete(key)) {
      picked.add(key);
    }
  }
}
