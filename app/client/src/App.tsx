import { useCallback, useEffect, useRef, useState } from 'react';
import { HttpError, sendChat } from './api/chat';
import { ArticlePanel } from './components/ArticlePanel';
import { Composer } from './components/Composer';
import { MessageView } from './components/MessageView';
import { Sidebar } from './components/Sidebar';
import { SEED_USER, seedChats } from './mock/seed';
import { EXAMPLES, S } from './strings';
import type { Chat, HistoryItem, Message, Scope, Source } from './types';

const HISTORY_LIMIT = 10;
type Theme = 'dark' | 'light';

let counter = 0;
const uid = () => `n-${Date.now()}-${counter++}`;

function readTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function toHistory(messages: Message[]): HistoryItem[] {
  const items: HistoryItem[] = [];
  for (const m of messages) {
    if (m.role === 'user') items.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') items.push({ role: 'assistant', content: m.content });
  }
  return items.slice(-HISTORY_LIMIT);
}

function newChat(): Chat {
  return { id: uid(), title: S.newDialog, messages: [], scope: 'all', draft: '', pending: false };
}

export function App() {
  const [chats, setChats] = useState<Chat[]>(seedChats);
  const [activeId, setActiveId] = useState(() => seedChats()[0].id);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [opened, setOpened] = useState<{ source: Source; opener: HTMLElement } | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const chat = chats.find((c) => c.id === activeId) ?? chats[0];

  const update = useCallback((id: string, fn: (c: Chat) => Chat) => {
    setChats((all) => all.map((c) => (c.id === id ? fn(c) : c)));
  }, []);

  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [chat.id, chat.messages.length, chat.pending]);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* хранилище недоступно — тема просто не запомнится */
    }
  };

  const closePanel = useCallback(() => {
    setOpened((o) => {
      o?.opener.focus();
      return null;
    });
  }, []);

  const run = useCallback(
    async (id: string, message: string, scope: Scope, history: HistoryItem[]) => {
      update(id, (c) => ({ ...c, pending: true }));
      let reply: Message;
      try {
        const res = await sendChat({ message, scope, history });
        reply = { id: uid(), role: 'assistant', content: res.answer, sources: res.sources, scope };
      } catch (e) {
        const rejected = e instanceof HttpError && e.status === 422;
        reply = { id: uid(), role: 'error', kind: rejected ? 'rejected' : 'unavailable' };
      }
      update(id, (c) => ({ ...c, pending: false, messages: [...c.messages, reply] }));
    },
    [update],
  );

  const send = (text: string) => {
    const history = toHistory(chat.messages);
    const first = chat.messages.length === 0;
    update(chat.id, (c) => ({
      ...c,
      title: first ? text.slice(0, 40) : c.title,
      draft: '',
      messages: [...c.messages, { id: uid(), role: 'user', content: text }],
    }));
    void run(chat.id, text, chat.scope, history);
  };

  // «Повторить»: тот же вопрос с той же историей, вопрос в ленте не дублируется (А5.2).
  const retry = () => {
    const idx = chat.messages.length - 1;
    const question = chat.messages[idx - 1];
    if (chat.messages[idx]?.role !== 'error' || question?.role !== 'user') return;
    const history = toHistory(chat.messages.slice(0, idx - 1));
    update(chat.id, (c) => ({ ...c, messages: c.messages.slice(0, idx) }));
    void run(chat.id, question.content, chat.scope, history);
  };

  const startNewChat = () => {
    const fresh = newChat();
    setChats((all) => [fresh, ...all]);
    setActiveId(fresh.id);
    setOpened(null);
    setSidebarOpen(false);
  };

  const selectChat = (id: string) => {
    setActiveId(id);
    setOpened(null);
    setSidebarOpen(false);
  };

  const hasDemo = chat.messages.some(
    (m) => m.role === 'assistant' && m.sources.some((s) => s.id.startsWith('DEMO-')),
  );

  return (
    <div className="app">
      <header className="header">
        <button
          type="button"
          className="btn menu-btn"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((o) => !o)}
        >
          {sidebarOpen ? S.closeChats : S.openChats}
        </button>
        <h1 className="title">{S.appTitle}</h1>
        <button type="button" className="btn" onClick={startNewChat} disabled={chat.messages.length === 0}>
          {S.newDialog}
        </button>
        <button type="button" className="btn" onClick={toggleTheme}>
          {theme === 'dark' ? S.themeToLight : S.themeToDark}
        </button>
      </header>

      <div className="body">
        <Sidebar chats={chats} activeId={chat.id} user={SEED_USER} open={sidebarOpen} onSelect={selectChat} />

        <main className="main">
          {hasDemo && <div className="demo-banner">{S.demoBanner}</div>}

          <div className="feed" ref={feedRef} role="log" aria-live="polite">
            {chat.messages.length === 0 ? (
              <div className="empty">
                <p className="welcome">{S.welcome}</p>
                <h2 className="examples-title">{S.examplesTitle}</h2>
                <div className="examples">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex.label}
                      type="button"
                      className="btn"
                      onClick={() => update(chat.id, (c) => ({ ...c, draft: ex.text }))}
                    >
                      {ex.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              chat.messages.map((m, i) => (
                <MessageView
                  key={m.id}
                  message={m}
                  onOpen={(source, opener) => setOpened({ source, opener })}
                  onRetry={retry}
                  canRetry={!chat.pending && i === chat.messages.length - 1}
                />
              ))
            )}
            {chat.pending && <div className="msg msg-bot pending">{S.pending}</div>}
          </div>

          <Composer
            key={chat.id}
            draft={chat.draft}
            scope={chat.scope}
            pending={chat.pending}
            onDraft={(draft) => update(chat.id, (c) => ({ ...c, draft }))}
            onScope={(scope) => update(chat.id, (c) => ({ ...c, scope }))}
            onSend={send}
          />
        </main>

        {opened && <ArticlePanel source={opened.source} onClose={closePanel} />}
      </div>

      <footer className="footer">{S.footer}</footer>
    </div>
  );
}
