/** Native provider WebViews are painted above HTML. Never use empty,
 * non-finite or offscreen rectangles for the login child WebView.
 */
export function usableLoginStageBounds(rect: DOMRectReadOnly | null | undefined): DOMRectReadOnly | undefined {
  if (!rect) return undefined;
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width < 1 || height < 1) {
    return undefined;
  }
  return rect;
}
