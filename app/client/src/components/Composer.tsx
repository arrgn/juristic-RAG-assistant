import { useState, type KeyboardEvent } from 'react';
import { SCOPES, S } from '../strings';
import type { Scope } from '../types';
import { MAX_LENGTH, validateMessage } from '../validation';

interface Props {
  draft: string;
  scope: Scope;
  pending: boolean;
  onDraft: (text: string) => void;
  onScope: (scope: Scope) => void;
  onSend: (text: string) => void;
}

export function Composer({ draft, scope, pending, onDraft, onScope, onSend }: Props) {
  const [error, setError] = useState<string | null>(null);
  const length = draft.trim().length;

  const submit = () => {
    if (pending) return;
    const err = validateMessage(draft);
    setError(err);
    if (!err) onSend(draft.trim());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const change = (text: string) => {
    onDraft(text);
    if (error && !validateMessage(text)) setError(null);
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="question">{S.inputLabel}</label>
      <textarea
        id="question"
        rows={3}
        value={draft}
        placeholder={S.inputPlaceholder}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
        aria-invalid={error !== null}
        aria-describedby="question-error"
      />
      <div className="composer-row">
        <label htmlFor="scope" className="scope-label">
          {S.scopeLabel}
        </label>
        <select id="scope" value={scope} onChange={(e) => onScope(e.target.value as Scope)}>
          {SCOPES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className={`mono counter${length > MAX_LENGTH ? ' counter-bad' : ''}`}>
          {length} / {MAX_LENGTH}
        </span>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {S.send}
        </button>
      </div>
      <p id="question-error" className="field-error" role="alert">
        {error}
      </p>
    </form>
  );
}
