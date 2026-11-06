import type { ReactNode } from "react";
import { type Block, type Inline, parseMarkdown } from "./markdown";

function nodes(list: Inline[], key: string): ReactNode[] {
  return list.map((node, index) => {
    const id = `${key}-${index}`;
    if (typeof node === "string") return node;
    if ("br" in node) return <br key={id} />;
    if ("c" in node) return <code key={id}>{node.c}</code>;
    if ("b" in node) return <strong key={id}>{nodes(node.b, id)}</strong>;
    if ("i" in node) return <em key={id}>{nodes(node.i, id)}</em>;
    return (
      <a key={id} href={node.a} target="_blank" rel="noopener noreferrer">
        {nodes(node.v, id)}
      </a>
    );
  });
}

function block(item: Block, index: number, caret: boolean) {
  const last = caret ? <span className="caret" aria-hidden /> : null;
  if ("pre" in item) {
    return (
      <pre key={index}>
        <code>{item.pre}</code>
        {last}
      </pre>
    );
  }
  if ("h" in item) {
    const Tag = `h${item.h}` as "h1" | "h2" | "h3";
    return (
      <Tag key={index}>
        {nodes(item.v, String(index))}
        {last}
      </Tag>
    );
  }
  if ("ul" in item) {
    return (
      <ul key={index}>
        {item.ul.map((line, i) => (
          <li key={i}>
            {nodes(line, `${index}-${i}`)}
            {last && i === item.ul.length - 1 ? last : null}
          </li>
        ))}
      </ul>
    );
  }
  if ("ol" in item) {
    return (
      <ol key={index}>
        {item.ol.map((line, i) => (
          <li key={i}>
            {nodes(line, `${index}-${i}`)}
            {last && i === item.ol.length - 1 ? last : null}
          </li>
        ))}
      </ol>
    );
  }
  if ("q" in item) {
    return (
      <blockquote key={index}>
        {nodes(item.q, String(index))}
        {last}
      </blockquote>
    );
  }
  return (
    <p key={index}>
      {nodes(item.p, String(index))}
      {last}
    </p>
  );
}

/** An assistant reply. `caret` is the streaming cursor, kept on the last line. */
export function Markdown({ text, caret = false }: { text: string; caret?: boolean }) {
  const blocks = parseMarkdown(text);
  if (!blocks.length) return caret ? <span className="caret" aria-hidden /> : null;
  return blocks.map((item, index) => block(item, index, caret && index === blocks.length - 1));
}
