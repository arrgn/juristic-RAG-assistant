import { CODE_NAMES, S } from '../strings';
import type { Source } from '../types';

export function DemoBadge() {
  return (
    <span className="badge" title={S.demoBadgeTitle}>
      {S.demoBadge}
    </span>
  );
}

interface Props {
  source: Source;
  maxScore: number;
  onOpen: (source: Source, opener: HTMLElement) => void;
}

export function SourceCard({ source, maxScore, onOpen }: Props) {
  const share = maxScore > 0 ? Math.round((source.score / maxScore) * 100) : 0;
  return (
    <button type="button" className="card" onClick={(e) => onOpen(source, e.currentTarget)}>
      <span className="card-head">
        <span className="card-code">{CODE_NAMES[source.code]}</span>
        <span className="mono card-num">
          {source.article}
          {source.id.startsWith('DEMO-') && <DemoBadge />}
        </span>
      </span>
      <span className="card-title">{source.title}</span>
      <span className="card-score">
        <span className="card-score-label">{S.relevance}</span>
        <span className="bar" aria-hidden="true">
          <span className="bar-fill" style={{ width: `${share}%` }} />
        </span>
        <span className="mono">{source.score.toFixed(2)}</span>
      </span>
    </button>
  );
}
