// One recovery boundary for obsolete public documents, including route metadata in <Meta>.
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { isPrivatePreview } from "./lib/private-preview";
import { createRenderErrorHandler } from "./lib/render-recovery";

// Capture once before hydration; this belongs to the document, not later navigation responses.
const documentRelease = document.querySelector('meta[name="aihot-release"]')?.getAttribute("content") ?? null;
const onError = createRenderErrorHandler(documentRelease);

if (isPrivatePreview()) {
  window.addEventListener("pageshow", event => { if (event.persisted) window.location.reload(); });
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
    { onCaughtError: onError },
  );
});
