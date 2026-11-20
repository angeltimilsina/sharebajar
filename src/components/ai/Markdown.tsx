import { Fragment, type ReactNode } from "react";

/** Minimal, safe markdown → React (no HTML injection). Covers what the assistant emits. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const label = t.slice(1, t.indexOf("]"));
      out.push(<a key={k} href={m[2]} target="_blank" rel="noopener noreferrer">{label}</a>);
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows: string[][] = [];
      const cells = (s: string) => s.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(l);
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={`t${i}`} className="overflow-x-auto"><table><thead><tr>{head.map((h, j) => <th key={j}>{inline(h, `th${i}${j}`)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `td${i}${ri}${j}`)}</td>)}</tr>)}</tbody></table></div>,
      );
      continue;
    }
    if (/^\s*[-*•]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ""));
      blocks.push(<ul key={`u${i}`}>{items.map((it, j) => <li key={j}>{inline(it, `u${i}${j}`)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push(<ol key={`o${i}`}>{items.map((it, j) => <li key={j}>{inline(it, `o${i}${j}`)}</li>)}</ol>);
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { blocks.push(h[1].length <= 2 ? <h3 key={`h${i}`}>{inline(h[2], `h${i}`)}</h3> : <h4 key={`h${i}`}>{inline(h[2], `h${i}`)}</h4>); i++; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) { blocks.push(<hr key={`r${i}`} className="my-2 border-line" />); i++; continue; }
    if (!l.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*([-*•]|\d+[.)]|#{1,4})\s+/.test(lines[i]) && !/^\s*\|/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={`p${i}`}>{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, `p${i}${j}`)}</Fragment>)}</p>);
  }
  return <div className="prose-ai text-[13.5px] leading-relaxed">{blocks}</div>;
}
