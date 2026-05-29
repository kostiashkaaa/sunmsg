// chat-list.jsx — Screen 1: Чаты
// Mirrors web sidebar: brand+search top, tabs, contact list, profile card bottom.
// Tab bar (iOS pattern) stays as a native nav layer.

function ChatListScreen({ dark = false }) {
  const conversations = [
    { name: 'Мира Альбрехт', last: 'Черновик обложки готов — посмотришь?', time: '9:32', unread: 2, online: true },
    { name: 'Студия · Группа', last: 'Даниил: Финальный мок выглядит отлично', time: '9:14', unread: 4, group: true },
    { name: 'Тёма Парк', last: 'Вы: Отправляю файл', time: '8:47', mine: true, read: true, online: true },
    { name: 'Рене Аоки', last: 'печатает…', time: '8:21', typing: true, online: true },
    { name: 'Отец', last: 'Фото', time: 'Вчера', photo: true },
    { name: 'Лян Чен', last: 'Давай встретимся за кофе на следующей неделе — в среду?', time: 'Вчера', unread: 1 },
    { name: 'Sun Editorial', last: 'Новый выпуск. Тема: бумага, свет, время.', time: 'Вт', group: true },
    { name: 'Ирис Х.', last: 'Вы: ок, договорились', time: 'Пн', mine: true, read: true },
    { name: 'Бронь · Casa Lume', last: 'Подтверждение брони на пятницу 20:00.', time: 'Вс' },
  ];

  return (
    <SmDevice dark={dark}>
      <div style={{
        height: '100%', width: '100%',
        background: 'var(--sm-sidebar-bg)',
        display: 'flex', flexDirection: 'column',
        paddingTop: 56,
        fontFamily: SYS_FONT,
      }} className="paper">

        {/* Sidebar top card: brand + search */}
        <div style={{ padding: '6px 12px 8px' }}>
          <div style={{
            background: 'var(--sm-paper)',
            border: '0.5px solid var(--sm-rule)',
            borderRadius: 14,
            padding: '8px 8px 8px 12px',
            boxShadow: 'var(--sm-shadow-xs)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Brand */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingRight: 4 }}>
                <SunMark size={18} />
                <span style={{
                  fontWeight: 700, fontSize: 17, letterSpacing: -0.4,
                  color: 'var(--sm-ink)', fontFeatureSettings: '"ss01"',
                }}>sun</span>
              </div>
              <div style={{ width: 1, height: 18, background: 'var(--sm-rule)' }} />
              {/* Search */}
              <div style={{
                flex: 1, display: 'flex', alignItems: 'center', gap: 7,
                padding: '6px 10px', borderRadius: 10,
                background: 'rgba(217,210,191,0.30)',
              }}>
                <span style={{ color: 'var(--sm-ink-mute)', display: 'flex' }}>{Icon.search(14)}</span>
                <span style={{ color: 'var(--sm-ink-mute)', fontSize: 14, fontWeight: 400 }}>Поиск</span>
              </div>
              <button style={iconBtnBare}>
                <span style={{ color: 'var(--sm-accent)' }}>{Icon.pencil(20)}</span>
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
              <Tab label="Все" active count={null} />
              <Tab label="Запросы" count={2} />
              <Tab label="Группы" />
              <Tab label="Архив" />
            </div>
          </div>
        </div>

        {/* E2E lock alert — amber banner from the web */}
        <div style={{ padding: '0 12px 8px' }}>
          <button style={{
            display: 'flex', width: '100%', alignItems: 'center', gap: 10,
            padding: '10px 12px', borderRadius: 12,
            background: 'var(--sm-req-bg)',
            border: '0.5px solid var(--sm-req-border)',
            color: 'var(--sm-ink)',
            textAlign: 'left', cursor: 'pointer',
          }}>
            <span style={{ color: 'var(--sm-accent-deep)', display: 'flex', flexShrink: 0 }}>{Icon.lock(14)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: -0.1, lineHeight: 1.25 }}>
                История заблокирована — нажмите для восстановления
              </div>
              <div style={{ fontSize: 11, color: 'var(--sm-ink-mute)', marginTop: 1, lineHeight: 1.3 }}>
                Введите 24 слова, чтобы расшифровать сообщения
              </div>
            </div>
            <span style={{ color: 'var(--sm-ink-faint)', display: 'flex', flexShrink: 0 }}>{Icon.chevronR(12)}</span>
          </button>
        </div>

        {/* Contact list — flat, with rules between */}
        <div style={{ flex: 1, overflow: 'hidden', padding: '0 4px' }}>
          {conversations.map((c, i) => (
            <ContactItem key={i} c={c} isLast={i === conversations.length - 1} />
          ))}
        </div>

        {/* Bottom profile card (sidebar-bottom-user from web) */}
        <BottomProfileCard />

        {/* iOS tab bar (kept — native pattern) */}
        <TabBar />
      </div>
    </SmDevice>
  );
}

const iconBtnBare = {
  width: 32, height: 32, borderRadius: 8, border: 'none', background: 'transparent',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer',
};

function Tab({ label, count, active }) {
  return (
    <button style={{
      padding: '5px 10px', borderRadius: 8,
      background: active ? 'var(--sm-ink)' : 'transparent',
      border: 'none',
      color: active ? 'var(--sm-text-inv)' : 'var(--sm-ink-mute)',
      fontSize: 13, fontWeight: active ? 600 : 500, letterSpacing: -0.1,
      display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
      fontFamily: SYS_FONT,
    }}>
      {label}
      {count != null && count > 0 && (
        <span style={{
          minWidth: 16, height: 16, padding: '0 5px', borderRadius: 999,
          fontSize: 10, fontWeight: 700,
          background: active ? 'rgba(243,240,232,0.18)' : 'var(--sm-accent)',
          color: active ? 'var(--sm-text-inv)' : '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{count}</span>
      )}
    </button>
  );
}

function ContactItem({ c, isLast }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '9px 12px',
      borderRadius: 10,
      position: 'relative',
    }}>
      <Avatar name={c.name} size={40} online={c.online} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{
            fontWeight: 600, fontSize: 15,
            color: 'var(--sm-ink)', letterSpacing: -0.2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            fontFamily: SYS_FONT,
          }}>{c.name}</span>
          <span style={{
            fontSize: 11.5,
            fontWeight: c.unread > 0 ? 600 : 400,
            color: c.unread > 0 ? 'var(--sm-accent-deep)' : 'var(--sm-ink-mute)',
            flexShrink: 0,
            fontVariantNumeric: 'tabular-nums',
          }}>{c.time}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
          {c.mine && c.read && (
            <span style={{ color: 'var(--sm-read-tick)', display: 'flex', flexShrink: 0 }}>{Icon.doubleCheck(14)}</span>
          )}
          <span style={{
            fontSize: 13, fontWeight: 400,
            color: c.typing ? 'var(--sm-accent-deep)' : 'var(--sm-ink-mute)',
            fontStyle: c.typing ? 'italic' : 'normal',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            flex: 1, letterSpacing: -0.1,
            fontFamily: SYS_FONT,
          }}>{c.last}</span>
          {c.unread > 0 && (
            <span style={{
              minWidth: 20, height: 20, padding: '0 7px', borderRadius: 999,
              background: 'var(--sm-accent)', color: '#fbf8f1',
              fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>{c.unread}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function BottomProfileCard() {
  return (
    <div style={{ padding: '8px 12px 6px' }}>
      <div style={{
        background: 'var(--sm-paper)',
        border: '0.5px solid var(--sm-rule)',
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: 'var(--sm-shadow-xs)',
      }}>
        {/* Identity row */}
        <button style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px', background: 'transparent', border: 'none',
          textAlign: 'left', cursor: 'pointer',
        }}>
          <Avatar name="Юлия Сун" size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 14, fontWeight: 600, letterSpacing: -0.2, color: 'var(--sm-ink)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>Юлия Сун</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
              <span style={{ fontSize: 12, color: 'var(--sm-accent-deep)', fontWeight: 500 }}>@yulia</span>
              <SyncChip />
            </div>
          </div>
          <span style={{ color: 'var(--sm-ink-faint)', display: 'flex' }}>{Icon.chevronR(12)}</span>
        </button>

        {/* Divider */}
        <div style={{ height: 0.5, background: 'var(--sm-rule-soft)', margin: '0 12px' }} />

        {/* Status QR row */}
        <button style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px', background: 'transparent', border: 'none',
          textAlign: 'left', cursor: 'pointer',
        }}>
          <span style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'rgba(196,148,60,0.10)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--sm-accent-deep)', flexShrink: 0,
          }}>{Icon.qr(18)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.1, color: 'var(--sm-ink)' }}>Статус</div>
            <div style={{ fontSize: 11, color: 'var(--sm-ink-mute)', marginTop: 1 }}>Нажмите, чтобы открыть QR</div>
          </div>
          <span style={{ color: 'var(--sm-ink-faint)', display: 'flex' }}>{Icon.chevronR(12)}</span>
        </button>
      </div>
    </div>
  );
}

function TabBar({ active = 'chats' }) {
  const items = [
    { id: 'chats',    label: 'Чаты',     icon: tbIcon.chats },
    { id: 'calls',    label: 'Звонки',   icon: tbIcon.calls },
    { id: 'contacts', label: 'Контакты', icon: tbIcon.contacts },
    { id: 'settings', label: 'Настройки',icon: tbIcon.settings },
  ];
  return (
    <div style={{
      paddingTop: 6, paddingBottom: 28, paddingLeft: 6, paddingRight: 6,
      display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start',
      borderTop: '0.5px solid var(--sm-rule-soft)',
      background: 'var(--sm-sidebar-hdr)',
      backdropFilter: 'blur(20px)',
    }}>
      {items.map(it => {
        const on = it.id === active;
        const color = on ? 'var(--sm-accent-deep)' : 'var(--sm-ink-faint)';
        return (
          <div key={it.id} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            padding: '3px 10px',
          }}>
            <div style={{ color, display: 'flex' }}>{it.icon(color, on)}</div>
            <span style={{
              fontSize: 10, fontWeight: on ? 600 : 500, color,
              letterSpacing: -0.05, fontFamily: SYS_FONT,
            }}>{it.label}</span>
          </div>
        );
      })}
    </div>
  );
}

const tbIcon = {
  chats: (color, active) => (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <path d="M3 7.5C3 5.6 4.6 4 6.5 4h13C21.4 4 23 5.6 23 7.5v8c0 1.9-1.6 3.5-3.5 3.5H11l-5 4v-4h-.5C3.6 19 3 17.4 3 15.5v-8z"
        stroke={color} strokeWidth={active ? 2 : 1.6} strokeLinejoin="round" fill={active ? 'rgba(196,148,60,0.14)' : 'none'} />
    </svg>
  ),
  calls: (color) => (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <path d="M5 6.5C5 5.4 5.9 4.5 7 4.5h1.6c.9 0 1.6.6 1.8 1.4l.9 3.2c.2.8-.1 1.6-.7 2.1l-1.2 1c1.4 2.5 3.4 4.6 6 6l1-1.2c.6-.6 1.4-.9 2.2-.7l3.2.9c.9.2 1.5 1 1.5 1.8V21c0 1.1-.9 2-2 2C11 23 3 15 3 7v-.5z"
        stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  ),
  contacts: (color) => (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <circle cx="13" cy="10" r="4" stroke={color} strokeWidth={1.6} />
      <path d="M5 22c1.2-4 4.5-6 8-6s6.8 2 8 6" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  ),
  settings: (color) => (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <circle cx="13" cy="13" r="3.5" stroke={color} strokeWidth={1.6} />
      <path d="M13 2.5v2.5M13 21v2.5M22.5 13H20M6 13H3.5M20 6l-1.8 1.8M7.8 18.2L6 20M20 20l-1.8-1.8M7.8 7.8L6 6"
        stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  ),
};

window.ChatListScreen = ChatListScreen;
