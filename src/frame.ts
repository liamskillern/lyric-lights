// Clickjacking guard. Another site could load this page inside an invisible frame and
// trick people into clicking its buttons. The proper fix is the `frame-ancestors` CSP
// header, but GitHub Pages can't send custom headers, so the page checks for itself.

/** True if this page is running inside a frame (or we can't tell, which counts as yes). */
export function isFramed(win: { self: unknown; top: unknown } = window): boolean {
  try {
    return win.self !== win.top;
  } catch {
    // Reading `top` across origins can throw: that alone means we're framed.
    return true;
  }
}
