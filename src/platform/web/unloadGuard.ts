/** Set by Restart, which leaves the page on purpose. */
let leaving = false;

export function leaveOnPurpose(): void {
  leaving = true;
}

/**
 * Ask before the page goes away while `busy()`. A stray ⌘Q, ⌘W or ⌘R is the
 * browser's (the page never even sees the first two), and would take the
 * running apps and their unsaved documents with it. Restart doesn't ask.
 */
export function guardUnload(busy: () => boolean, target: Pick<EventTarget, "addEventListener"> = window): void {
  target.addEventListener("beforeunload", (e) => {
    if (!leaving && busy()) e.preventDefault();
  });
}
