/** Visible text of text blocks, in order, with no extra separator. message.sent stays the source of truth for block structure. */
export function visibleText(blocks: readonly { type: string; text?: string }[]): string {
  return blocks.flatMap((block) => block.type === "text" && typeof block.text === "string" ? [block.text] : []).join("");
}

/**
 * Pulls only the JSON string value of each "text" key from a model stream.
 * Keys, sources, buttons and other structure stay out of the result.
 */
export class TextDeltaExtractor {
  private mode: "scan" | "string" | "after" | "value" | "text" = "scan";
  private escape = false;
  private unicode = "";
  private unicodeLeft = 0;
  private token = "";
  private key = "";

  push(chunk: string): string {
    if (!chunk) return "";
    let visible = "";
    for (let index = 0; index < chunk.length; index++) visible += this.feed(chunk[index]!);
    return visible;
  }

  private feed(ch: string): string {
    if (this.unicodeLeft > 0) {
      this.unicode += ch;
      this.unicodeLeft--;
      if (this.unicodeLeft > 0) return "";
      const code = Number.parseInt(this.unicode, 16);
      this.unicode = "";
      return this.append(Number.isFinite(code) ? String.fromCharCode(code) : "");
    }
    if (this.mode === "string" || this.mode === "text") {
      if (this.escape) {
        this.escape = false;
        if (ch === "u") {
          this.unicodeLeft = 4;
          this.unicode = "";
          return "";
        }
        const decoded = ch === "n" ? "\n" : ch === "r" ? "\r" : ch === "t" ? "\t" : ch === "b" ? "\b" : ch === "f" ? "\f" : ch;
        return this.append(decoded);
      }
      if (ch === "\\") {
        this.escape = true;
        return "";
      }
      if (ch === '"') {
        if (this.mode === "string") {
          this.key = this.token;
          this.token = "";
          this.mode = "after";
        } else this.mode = "scan";
        return "";
      }
      return this.append(ch);
    }
    if (this.mode === "after") {
      if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") return "";
      if (ch === ":") {
        this.mode = "value";
        return "";
      }
      this.mode = "scan";
      return this.feed(ch);
    }
    if (this.mode === "value") {
      if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") return "";
      if (ch === '"') {
        this.escape = false;
        this.token = "";
        this.mode = this.key === "text" ? "text" : "string";
        this.key = "";
        return "";
      }
      this.mode = "scan";
      this.key = "";
      return this.feed(ch);
    }
    if (ch === '"') {
      this.mode = "string";
      this.token = "";
      this.escape = false;
    }
    return "";
  }

  private append(ch: string): string {
    if (this.mode === "text") return ch;
    if (this.mode === "string") this.token += ch;
    return "";
  }
}
