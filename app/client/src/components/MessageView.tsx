import { S } from '../strings';
import type { Message, Source } from '../types';
import { AnswerText } from './AnswerText';
import { SourceCard } from './SourceCard';

interface Props {
  message: Message;
  onOpen: (source: Source, opener: HTMLElement) => void;
  onRetry: () => void;
  canRetry: boolean;
}

export function MessageView({ message, onOpen, onRetry, canRetry }: Props) {
  if (message.role === 'user') {
    return (
      <div className="msg msg-user">
        <p>{message.content}</p>
      </div>
    );
  }

  if (message.role === 'error') {
    return (
      <div className="msg msg-error" role="alert">
        <p>{message.kind === 'rejected' ? S.rejected : S.unavailable}</p>
        {message.kind === 'unavailable' && (
          <button type="button" className="btn" onClick={onRetry} disabled={!canRetry}>
            {S.retry}
          </button>
        )}
      </div>
    );
  }

  const { sources } = message;
  const maxScore = sources.reduce((m, s) => Math.max(m, s.score), 0);
  return (
    <div className="msg msg-bot">
      {sources.length === 0 ? (
        <>
          <p>{message.content}</p>
          {message.scope !== 'all' && <p className="muted">{S.notFoundHint}</p>}
        </>
      ) : (
        <>
          <AnswerText text={message.content} sources={sources} onOpen={onOpen} />
          <h3 className="sources-title">{S.sources}</h3>
          <div className="cards">
            {sources.map((s) => (
              <SourceCard key={s.id} source={s} maxScore={maxScore} onOpen={onOpen} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
