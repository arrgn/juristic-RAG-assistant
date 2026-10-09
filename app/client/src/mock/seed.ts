import type { Chat, User } from '../types';
import { EXAMPLES, S } from '../strings';
import { DEMO_INTRO, DEMO_SOURCES, DEMO_SUMMARY } from './demo';

// Прототип: один пользователь и три диалога для проверки интерфейса.
export const SEED_USER: User = {
  id: 'user-1',
  name: 'Тестовый пользователь',
  email: 'user@example.com',
};

const [d1, d2, d3] = DEMO_SOURCES;

export function seedChats(): Chat[] {
  return [
    {
      id: 'chat-1',
      title: 'Право на тайну переписки',
      scope: 'all',
      draft: '',
      pending: false,
      messages: [
        { id: 'c1-m1', role: 'user', content: EXAMPLES[0].text },
        {
          id: 'c1-m2',
          role: 'assistant',
          scope: 'all',
          sources: [d1],
          content: [DEMO_INTRO, `[${d1.id}] ${DEMO_SUMMARY[d1.id]}`, S.footer].join('\n\n'),
        },
      ],
    },
    {
      id: 'chat-2',
      title: 'Вопрос не по теме',
      scope: 'constitution',
      draft: '',
      pending: false,
      messages: [
        { id: 'c2-m1', role: 'user', content: EXAMPLES[2].text },
        { id: 'c2-m2', role: 'assistant', scope: 'constitution', sources: [], content: S.notFound },
      ],
    },
    {
      id: 'chat-3',
      title: 'Необходимая оборона',
      scope: 'criminal_code',
      draft: '',
      pending: false,
      messages: [
        { id: 'c3-m1', role: 'user', content: EXAMPLES[1].text },
        {
          id: 'c3-m2',
          role: 'assistant',
          scope: 'criminal_code',
          sources: [d2, d3],
          content: [
            DEMO_INTRO,
            `[${d2.id}] ${DEMO_SUMMARY[d2.id]}`,
            `[${d3.id}] ${DEMO_SUMMARY[d3.id]}`,
            S.footer,
          ].join('\n\n'),
        },
        { id: 'c3-m3', role: 'user', content: 'А если нападавший был не один?' },
        {
          id: 'c3-m4',
          role: 'assistant',
          scope: 'criminal_code',
          sources: [d2],
          // [DEMO-009] намеренно нет в источниках: проверка метки-предупреждения (критерий О5).
          content: [
            DEMO_INTRO,
            `[${d2.id}] Вымышленная запись не делает различий по числу нападавших. См. также [DEMO-009].`,
            S.footer,
          ].join('\n\n'),
        },
      ],
    },
  ];
}
