import { useEffect, useRef } from "react";
import { PREVIEW_PAGE, type PreviewMsg } from "@/lib/preview";

/**
 * Renders the agent's component in the extension's preview sandbox
 * (entrypoints/preview.sandbox). The code is model-generated, so it runs in that
 * page's opaque origin rather than in the extension's own page. Everything it
 * needs ships with the extension: a new tab never waits on the network.
 */
export function HomepagePreview({ code }: { code: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const loaded = useRef(false);

  const send = () => {
    const msg: PreviewMsg = { kind: "render", code };
    // A sandboxed page's origin is opaque ("null"), so it can't be named as the target.
    frame.current?.contentWindow?.postMessage(msg, "*");
  };

  // The sandbox registers its listener before its load event, so sending on
  // load (and on every later change) can't race it.
  useEffect(() => {
    if (loaded.current) send();
  }, [code]);

  return (
    <iframe
      ref={frame}
      src={PREVIEW_PAGE}
      title="Your homepage"
      onLoad={() => {
        loaded.current = true;
        send();
      }}
      style={{ display: "block", width: "100vw", height: "100vh", border: "none" }}
    />
  );
}
