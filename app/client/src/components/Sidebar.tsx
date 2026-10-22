import { S } from '../strings';
import type { Chat, User } from '../types';

interface Props {
  chats: Chat[];
  activeId: string;
  user: User;
  open: boolean;
  onSelect: (id: string) => void;
}

export function Sidebar({ chats, activeId, user, open, onSelect }: Props) {
  return (
    <nav className={`sidebar${open ? ' sidebar-open' : ''}`} aria-label={S.chats}>
      <h2 className="sidebar-title">{S.chats}</h2>
      <ul className="chat-list">
        {chats.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="chat-item"
              aria-current={c.id === activeId ? 'true' : undefined}
              onClick={() => onSelect(c.id)}
            >
              {c.title}
            </button>
          </li>
        ))}
      </ul>
      <div className="user">
        <span className="avatar" aria-hidden="true">
          {user.name.charAt(0)}
        </span>
        <span className="user-info">
          <span className="user-name">{user.name}</span>
          <span className="muted">{user.email}</span>
        </span>
      </div>
    </nav>
  );
}
