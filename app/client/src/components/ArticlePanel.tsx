import { useEffect, useRef } from 'react';
import { CODE_NAMES, S } from '../strings';
import type { Source } from '../types';
import { DemoBadge } from './SourceCard';

interface Props {
  source: Source;
  onClose: () => void;
}

export function ArticlePanel({ source, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const isDemo = source.id.startsWith('DEMO-');
  const isUrl = /^https?:\/\//.test(source.source_url);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="panel" aria-label={S.articlePanel}>
      <div className="panel-head">
        <div>
          <div className="card-code">{CODE_NAMES[source.code]}</div>
          <h2 className="panel-title">
            <span className="mono">{source.article}</span>
            {isDemo && <DemoBadge />} · {source.title}
          </h2>
        </div>
        <button ref={closeRef} type="button" className="btn" onClick={onClose}>
          {S.close}
        </button>
      </div>
      <p className="panel-text">{source.text}</p>
      {isUrl ? (
        <a href={source.source_url} target="_blank" rel="noreferrer">
          {S.officialEdition}
        </a>
      ) : (
        <p className="muted">
          {S.officialEdition}: {source.source_url}
        </p>
      )}
    </aside>
  );
}
