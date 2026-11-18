// Minimal, safe Markdown for chat replies: headings, **bold**, bullet/numbered lists, paragraphs, rules.
// Builds React elements (no dangerouslySetInnerHTML), so model output can never inject HTML.
import { Fragment } from 'react';

function inline(text, keyPrefix) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={`${keyPrefix}-${i}`}>{p.slice(2, -2)}</strong>;
    if (p.length > 2 && p.startsWith('*') && p.endsWith('*')) return <em key={`${keyPrefix}-${i}`}>{p.slice(1, -1)}</em>;
    return <Fragment key={`${keyPrefix}-${i}`}>{p}</Fragment>;
  });
}

export default function Markdown({ text }) {
  const lines = String(text ?? '').split(/\r?\n/);
  const blocks = [];
  let list = null;

  const flush = () => {
    if (list) blocks.push(list);
    list = null;
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[*\-•]\s+(.*)$/);
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,4}\s+(.*)$/);

    if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol';
      if (!list || list.type !== type) {
        flush();
        list = { type, items: [], key: `l${i}` };
      }
      list.items.push(inline(bullet ? bullet[1] : numbered[2], `li${i}`));
      return;
    }
    flush();
    if (!line.trim()) return;
    if (/^-{3,}$|^\*{3,}$/.test(line.trim())) blocks.push({ type: 'hr', key: `hr${i}` });
    else if (heading) blocks.push({ type: 'h', content: inline(heading[1], `h${i}`), key: `h${i}` });
    else blocks.push({ type: 'p', content: inline(line, `p${i}`), key: `p${i}` });
  });
  flush();

  return (
    <div className="space-y-2 leading-relaxed">
      {blocks.map((b) => {
        if (b.type === 'ul') return <ul key={b.key} className="list-disc space-y-1 pl-5">{b.items.map((it, j) => <li key={j}>{it}</li>)}</ul>;
        if (b.type === 'ol') return <ol key={b.key} className="list-decimal space-y-1 pl-5">{b.items.map((it, j) => <li key={j}>{it}</li>)}</ol>;
        if (b.type === 'hr') return <hr key={b.key} className="border-line" />;
        if (b.type === 'h') return <p key={b.key} className="font-bold text-ink">{b.content}</p>;
        return <p key={b.key}>{b.content}</p>;
      })}
    </div>
  );
}
