/**
 * Pure helpers for deciding when a Reading view section is still waiting on MathJax
 * to render its top-level display equations.
 */

/**
 * How many top-level display equations are expected in a section before MathJax finishes rendering.
 * Returns 0 when the section does not appear to contain top-level display math.
 */
export function expectedDisplayMathCount(sourceBlockCount: number | null, placeholderCount: number): number {
	if (sourceBlockCount !== null && sourceBlockCount > 0) return sourceBlockCount;
	return Math.max(0, placeholderCount);
}

/**
 * Whether a pending section has enough rendered display math elements to attach equation numbers.
 */
export function shouldAttachPendingMath(renderedCount: number, expectedCount: number, allowPartial: boolean): boolean {
	if (renderedCount <= 0) return false;
	return allowPartial || renderedCount >= Math.max(1, expectedCount);
}
