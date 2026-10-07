import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { simplifyHtml } from "./simplify";
import { applySiteRule, siteRuleFor } from "./sites";
import { blockedReason } from "./fetch";

const BASE = "https://example.com/dir/page.html";

function simplify(body: string, title = "") {
  const { document } = parseHTML(`<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`);
  return simplifyHtml(document, { baseUrl: BASE });
}

describe("simplifyHtml", () => {
  it("keeps paragraphs, styles and resolved links, and drops scripts and hidden things", () => {
    const page = simplify(
      `<script>alert(1)</script><style>p{}</style>
       <p>Hello <b>bold</b> and <a href="../other.html">a  link</a>.</p>
       <div hidden>secret</div><p style="display: none">gone</p>`,
      "Example",
    );
    expect(page.title).toBe("Example");
    expect(page.nodes).toEqual([
      {
        type: "paragraph",
        align: "left",
        segments: [
          { kind: "text", text: "Hello " },
          { kind: "bold", text: "bold" },
          { kind: "text", text: " and " },
          { kind: "link", text: "a link", href: "https://example.com/other.html" },
          { kind: "text", text: "." },
        ],
      },
    ]);
  });

  it("numbers ordered lists and indents nested ones", () => {
    const page = simplify(`<ol start="3"><li>three<ul><li>inner</li></ul></li><li>four</li></ol>`);
    expect(page.nodes.map((node) => node.type === "listItem" && [node.marker, node.indent, node.segments[0]!.text])).toEqual([
      ["3.", 0, "three"],
      ["•", 1, "inner"],
      ["4.", 0, "four"],
    ]);
  });

  it("keeps data tables and flattens layout tables", () => {
    const data = simplify(`<table><tr><th>Name</th><th>Age</th></tr><tr><td>Ada</td><td>36</td></tr></table>`);
    expect(data.nodes[0]).toMatchObject({ type: "table", rows: [{ header: true }, { header: false }] });

    const layout = simplify(`<table><tr><td><div>Sidebar</div></td><td><p>Main text</p></td></tr></table>`);
    expect(layout.nodes.map((node) => node.type)).toEqual(["paragraph", "paragraph"]);
  });

  it("places a form at its first visible control with hidden fields kept", () => {
    const page = simplify(
      `<p>Search the web</p>
       <form action="/lite/" method="post"><input type="hidden" name="kl" value="us-en">
       <input type="text" name="q" placeholder="Search"><input type="submit" value="Go"></form>`,
    );
    expect(page.nodes[1]).toEqual({
      type: "form",
      form: {
        action: "https://example.com/lite/",
        method: "post",
        controls: [
          { kind: "hidden", name: "kl", value: "us-en" },
          { kind: "text", name: "q", value: "", placeholder: "Search" },
          { kind: "submit", name: "", value: "Go", label: "Go" },
        ],
      },
    });
  });

  it("keeps a textarea as several lines, at the rows it asks for within reason", () => {
    const page = simplify(`<form method="post"><textarea name="text" rows="40">Hi</textarea><textarea name="note"></textarea></form>`);
    expect(page.nodes[0]).toMatchObject({
      type: "form",
      form: { controls: [{ kind: "textarea", name: "text", value: "Hi", rows: 12 }, { kind: "textarea", name: "note", value: "", rows: 4 }] },
    });
  });

  it("links headings that wrap one link, and turns linked images into their alt text", () => {
    const page = simplify(
      `<h2><a href="/post">A post</a></h2><p><a href="/home"><img src="logo.png" alt="Home"></a></p>
       <img src="pixel.gif" width="1" height="1"><img src="/photo.jpg" alt="Photo">`,
    );
    expect(page.nodes).toEqual([
      { type: "heading", level: 2, text: "A post", align: "left", href: "https://example.com/post" },
      { type: "paragraph", align: "left", segments: [{ kind: "link", text: "Home", href: "https://example.com/home" }] },
      { type: "image", src: "https://example.com/photo.jpg", alt: "Photo", align: "left" },
    ]);
  });

  it("keeps preformatted text and line breaks", () => {
    const page = simplify(`<pre>a  b\n  c\n</pre><p>one<br>two</p>`);
    expect(page.nodes[0]).toEqual({ type: "code", text: "a  b\n  c" });
    expect(page.nodes[1]).toMatchObject({ segments: [{ kind: "text", text: "one\ntwo" }] });
  });
});

describe("site rules", () => {
  it("reads only Wikipedia's article, without edit links", () => {
    const { document } = parseHTML(
      `<html><body><div id="mw-navigation">Menu</div><div id="mw-content-text"><div class="mw-parser-output">
       <h2>History<span class="mw-editsection">[edit]</span></h2><p>Text.</p></div></div></body></html>`,
    );
    const rule = siteRuleFor(new URL("https://en.wikipedia.org/wiki/Mac"))!;
    const root = applySiteRule(document, rule);
    const page = simplifyHtml(document, { baseUrl: "https://en.wikipedia.org/wiki/Mac", root });
    expect(page.nodes).toEqual([
      { type: "heading", level: 2, text: "History", align: "left" },
      { type: "paragraph", align: "left", segments: [{ kind: "text", text: "Text." }] },
    ]);
  });
});

describe("blockedReason", () => {
  it("refuses private networks and non-web schemes", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1", "http://10.1.2.3", "http://192.168.0.1", "http://[::1]/", "file:///etc/passwd", "http://printer.local"]) {
      expect(blockedReason(new URL(url)), url).not.toBeNull();
    }
    expect(blockedReason(new URL("https://example.com"))).toBeNull();
    expect(blockedReason(new URL("http://8.8.8.8"))).toBeNull();
  });
});
