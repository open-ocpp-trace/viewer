/**
 * Reports an error thrown by a host callback the viewer calls outside an
 * event handler, like an error thrown from an event handler is reported:
 * globally, without unmounting the viewer.
 */
export function reportHostError(error: unknown): void {
  if (typeof reportError === "function") reportError(error);
  else console.error(error);
}
