import { CODE_SHORT, S } from '../strings';
import type { Source } from '../types';

// Метка ссылки: «[DEMO-001]» или «[УК РФ ст. <номер>]» / «[Конституция РФ ст. <номер>]».
const LABEL = /\[((?:DEMO-\d+)|(?:(?:УК РФ|Конституция РФ) ст\. [^\]]+))\]/g;

function findSource(label: string, sources: Source[]): Source | undefined {
  return sources.find(
    (s) => s.id === label || `${CODE_SHORT[s.code]} ст. ${s.article}` === label,
  );
}

interface Props {
  text: string;
  sources: Source[];
  onOpen: (source: Source, opener: HTMLElement) => void;
}

export function AnswerText({ text, sources, onOpen }: Props) {
  return (
    <>
      {text.split('\n\n').map((para, i) => {
        const parts: React.ReactNode[] = [];
        let last = 0;
        for (const m of para.matchAll(LABEL)) {
          const start = m.index ?? 0;
          if (start > last) parts.push(para.slice(last, start));
          const source = findSource(m[1], sources);
          parts.push(
            source ? (
              <button
                key={start}
                type="button"
                className="ref"
                onClick={(e) => onOpen(source, e.currentTarget)}
              >
                {m[0]}
              </button>
            ) : (
              <span key={start} className="ref ref-missing" title={S.missingSource}>
                {m[0]}
              </span>
            ),
          );
          last = start + m[0].length;
        }
        if (last < para.length) parts.push(para.slice(last));
        return <p key={i}>{parts}</p>;
      })}
    </>
  );
}
