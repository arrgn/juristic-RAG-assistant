// Типы контракта API: spec/tech/architecture.md, раздел 5.
export type Scope = 'all' | 'constitution' | 'criminal_code';
export type CodeId = 'constitution' | 'criminal_code';

export interface HistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  message: string;
  scope: Scope;
  history: HistoryItem[];
}

export interface Source {
  id: string;
  code: CodeId;
  article: string;
  title: string;
  text: string;
  source_url: string;
  score: number;
}

export interface ChatResponse {
  answer: string;
  sources: Source[];
}

// Состояния интерфейса (не часть контракта).
export type ErrorKind = 'unavailable' | 'rejected';

export type Message =
  | { id: string; role: 'user'; content: string }
  | { id: string; role: 'assistant'; content: string; sources: Source[]; scope: Scope }
  | { id: string; role: 'error'; kind: ErrorKind };

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  scope: Scope;
  draft: string;
  pending: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
}
