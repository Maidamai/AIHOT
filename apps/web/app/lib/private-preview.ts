/** Web cache policy only; this flag never grants access to a page or API. */
export function isPrivatePreview(): boolean {
  if (typeof document !== "undefined") return document.documentElement?.dataset.privatePreview === "true";
  return typeof process !== "undefined" && process.env.PRIVATE_PREVIEW === "true";
}

/** Reader requests must reach the current gate in a private preview, even after a public-mode visit. */
export function readerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, isPrivatePreview() ? { ...init, cache: "no-store" } : init);
}
