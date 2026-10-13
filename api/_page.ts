/**
 * Small HTML pages served next to the OS: the sign-in relay's (`api/oauth/*`)
 * and the Computer Club's (`api/club/*`). They open on a phone or in a
 * browser tab, outside the Macintosh, so they are plain HTML.
 */

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * The script that redraws a page in 1-bit (`src/relay/main.tsx`): the
 * built file on a deployment, the source through Vite in development.
 */
const PAGE_SCRIPT = process.env.VERCEL ? "/relay.js" : "/src/relay/main.tsx";

export interface PageOptions {
  title?: string;
  /**
   * Redraw the page in 1-bit (default). The script draws paragraphs and
   * `a.button` links only, so a page with a form turns it off.
   */
  drawn?: boolean;
  /**
   * The page's referrer policy (default `no-referrer`). A page whose forms
   * check `Origin` needs `same-origin`: with `no-referrer` a browser sends
   * `Origin: null`.
   */
  referrer?: "no-referrer" | "same-origin";
}

/**
 * A page for the phone. `body` is trusted HTML; interpolate through `html`.
 * Keep a drawn page to paragraphs and `a.button` links: the page script
 * redraws those in 1-bit, and the HTML stays for screen readers.
 */
export function page(body: string, status = 200, options: PageOptions = {}): Response {
  const script = options.drawn === false ? "" : `<script type="module" src="${PAGE_SCRIPT}"></script>`;
  const doc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="${options.referrer ?? "no-referrer"}">
<title>${escapeHtml(options.title ?? "Mockintosh Sign In")}</title>
<style>
  body { font: 18px/1.45 -apple-system, system-ui, sans-serif; margin: 3em 1.5em; text-align: center; color: #000; background: #fff; }
  a.button, button { display: inline-block; margin: 1em 0; padding: .6em 1.4em; border: 2px solid #000; border-radius: 10px; color: #000; background: #fff; text-decoration: none; font: inherit; font-weight: 600; }
  form { max-width: 20em; margin: 0 auto; text-align: left; }
  label { display: block; margin: 1em 0 .3em; }
  input { box-sizing: border-box; width: 100%; padding: .4em; border: 2px solid #000; font: inherit; }
  form button { width: 100%; }
  .small { font-size: 14px; color: #555; }
  #screen { position: fixed; inset: 0; display: none; }
  .drawn #screen { display: block; }
  /* Drawn in 1-bit over the page; still read aloud. */
  .drawn #content { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
</head>
<body><div id="content">${body}</div><div id="screen" aria-hidden="true"></div>${script}</body>
</html>`;
  return new Response(doc, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Tagged template that escapes every interpolated value. */
export function html(strings: TemplateStringsArray, ...values: Array<string | number>): string {
  return strings.reduce((out, s, i) => out + s + (i < values.length ? escapeHtml(String(values[i])) : ""), "");
}
