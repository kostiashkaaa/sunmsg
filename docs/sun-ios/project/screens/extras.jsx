// extras.jsx — Contacts + Contact profile sheet + New chat modal + Empty state

function ContactsScreen({ dark = false }) {
  const sections = [
    ['А', ['Аоки Рене', 'Альбрехт Мира']],
    ['В', ['Воронцов Лев']],
    ['Д', ['Дочери · Семья', 'Даниил Резник']],
    ['И', ['Ирис Х.', 'Иван Петров']],
    ['Л', ['Лян Чен', 'Лена С.']],
    ['М', ['Мира А.', 'Маша']],
    ['О', ['Отец', 'Ольга К.']],
    ['П', ['Парк Тёма']],
    ['С', ['Сун · Studio', 'Соня']],
  ];

  return (
    <SmDevice dark={dark}>
      <div style={{
        height: '100%', width: '100%',
        background: 'var(--sm-sidebar-bg)',
        display: 'flex', flexDirection: 'column',
        paddingTop: 56, fontFamily: SYS_FONT,
      }} className="paper">
        <NavHeader title="Контакты" trailing={
          <div style={{ display: 'flex', gap: 2 }}>
            <button style={iconHdrBtn}>
              <span style={{ color: 'var(--sm-accent-deep)' }}>{Icon.search(18)}</span>
            </button>
            <button style={iconHdrBtn}>
              <span style={{ color: 'var(--sm-accent-deep)' }}>{Icon.plus(22)}</span>
            </button>
          </div>
        } />

        {/* Quick actions */}
        <div style={{ padding: '8px 12px 4px', display: 'flex', gap: 8 }}>
          <QuickAction icon="newGroup" label="Новая группа" />
          <QuickAction icon="invite" label="Пригласить" />
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '4px 4px 4px' }}>
          {sections.map(([letter, names]) => (
            <div key={letter}>
              <div style={{
                padding: '8px 12px 4px',
                fontSize: 11, fontWeight: 700, letterSpacing: 0.6,
                color: 'var(--sm-ink-mute)', textTransform: 'uppercase',
              }}>{letter}</div>
              {names.map(n => (
                <div key={n} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '8px 12px',
                  borderBottom: '0.5px solid var(--sm-rule-soft)',
                }}>
                  <Avatar name={n} size={36} online={Math.random() > 0.6} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--sm-ink)', letterSpacing: -0.2 }}>{n}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--sm-ink-mute)', marginTop: 1 }}>
                      {Math.random() > 0.5 ? 'в сети' : 'был в сети недавно'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Side index bar */}
        <div style={{
          position: 'absolute', right: 6, top: '40%', transform: 'translateY(-50%)',
          display: 'flex', flexDirection: 'column', gap: 2,
          fontSize: 9.5, fontWeight: 600, color: 'var(--sm-accent-deep)',
        }}>
          {'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ'.split('').map(c => (
            <span key={c} style={{ padding: '0 2px' }}>{c}</span>
          ))}
        </div>

        <TabBar active="contacts" />
      </div>
    </SmDevice>
  );
}

function QuickAction({ icon, label }) {
  const glyphs = {
    newGroup: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="7" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5"/><circle cx="13" cy="7" r="2" stroke="currentColor" strokeWidth="1.5"/><path d="M2 16c.7-2.5 2.7-4 5-4s4.3 1.5 5 4M11 12c1.8 0 4 1 5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
    newChannel: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 7v6M3 7l11-4v14L3 13M14 6l3-1v10l-3-1" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,
    invite: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="5" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M2 7l8 5 8-5" stroke="currentColor" strokeWidth="1.5"/></svg>,
  };
  return (
    <div style={{
      flex: 1, padding: '10px 8px', borderRadius: 12,
      background: 'var(--sm-paper)',
      border: '0.5px solid var(--sm-rule)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
      boxShadow: 'var(--sm-shadow-xs)',
    }}>
      <span style={{
        width: 32, height: 32, borderRadius: 9,
        background: 'rgba(196,148,60,0.12)',
        color: 'var(--sm-accent-deep)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{glyphs[icon]}</span>
      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--sm-ink)', letterSpacing: -0.1 }}>{label}</span>
    </div>
  );
}

// Contact profile drawer / sheet (mirrors web profile drawer)
function ContactProfileScreen({ dark = false }) {
  return (
    <SmDevice dark={dark}>
      <div style={{
        height: '100%', width: '100%',
        background: 'var(--sm-bg)',
        display: 'flex', flexDirection: 'column',
        paddingTop: 56, fontFamily: SYS_FONT,
        position: 'relative',
      }} className="paper">

        <NavHeader
          title=""
          leading={
            <button style={iconHdrBtn}>
              <span style={{ color: 'var(--sm-accent-deep)' }}>{Icon.chevronL(22)}</span>
            </button>
          }
          trailing={
            <button style={iconHdrBtn}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ color: 'var(--sm-accent-deep)' }}>
                <circle cx="10" cy="4" r="1.5" fill="currentColor"/>
                <circle cx="10" cy="10" r="1.5" fill="currentColor"/>
                <circle cx="10" cy="16" r="1.5" fill="currentColor"/>
              </svg>
            </button>
          }
        />

        <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px 12px' }}>
          {/* Identity */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0 18px' }}>
            <div style={{
              width: 96, height: 96, borderRadius: '50%',
              background: 'linear-gradient(145deg, oklch(78% 0.12 70), oklch(60% 0.15 55))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#15140e', fontSize: 38, fontWeight: 700, letterSpacing: -0.8,
              boxShadow: 'var(--sm-shadow-md)',
            }}>МА</div>
            <h2 style={{
              margin: '14px 0 2px', fontSize: 22, fontWeight: 700, letterSpacing: -0.6,
              color: 'var(--sm-ink)',
            }}>Мира Альбрехт</h2>
            <div style={{ fontSize: 14, color: 'var(--sm-accent-deep)', fontWeight: 500 }}>@mira</div>
            <div style={{
              marginTop: 6, fontSize: 12, color: 'var(--sm-online)',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />
              в сети
            </div>
          </div>

          {/* Actions */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6,
            marginBottom: 14,
          }}>
            <ProfileAction icon="msg" label="Сообщ." />
            <ProfileAction icon="call" label="Звонок" />
            <ProfileAction icon="video" label="Видео" />
            <ProfileAction icon="mute" label="Без звука" />
          </div>

          {/* Meta */}
          <SettingsGroup>
            <MetaRow label="Bio" value="редактор Sun Editorial · кофе и бумага" multiline />
            <MetaRow label="Имя пользователя" value="@mira" copyable last />
          </SettingsGroup>

          <SettingsGroup>
            <SettingsRow icon="key" tint="amber" label="Шифрование" sub="Подтверждено · 7f4a · 9c2e · 33a8" />
            <SettingsRow icon="bell" tint="amber" label="Уведомления" trail="Тёплые" />
            <SettingsRow icon="palette" tint="amber" label="Обои для чата" trail="По умолчанию" last />
          </SettingsGroup>

          {/* Shared */}
          <div style={{ padding: '4px 14px 8px', fontSize: 11, fontWeight: 700, color: 'var(--sm-ink-mute)', letterSpacing: 0.6, textTransform: 'uppercase' }}>
            Общие медиа · 24
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3,
            marginBottom: 12,
          }}>
            {[60, 50, 56, 48, 64, 52].map((tone, i) => (
              <div key={i} style={{
                aspectRatio: '1/1', borderRadius: 10,
                background: `linear-gradient(${135 + i*30}deg, oklch(${tone}% 0.10 ${60 + i*8}), oklch(${tone - 14}% 0.13 ${50 + i*8}))`,
                border: '0.5px solid var(--sm-rule)',
              }} />
            ))}
          </div>

          <SettingsGroup>
            <SettingsRow icon="logout" tint="danger" label="Заблокировать" last />
          </SettingsGroup>
        </div>
      </div>
    </SmDevice>
  );
}

function ProfileAction({ icon, label }) {
  const glyphs = {
    msg: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 5c0-1 .8-2 2-2h10c1 0 2 1 2 2v6c0 1-.8 2-2 2H7l-3 2.5V13H4c-1 0-2-1-2-2V5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,
    call: Icon.phone(18),
    video: Icon.video(20),
    mute: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 7v4h2l4 3V4L5 7H3zM12 6c1 .8 1.5 1.8 1.5 3s-.5 2.2-1.5 3M2 2l14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  };
  return (
    <button style={{
      padding: '10px 4px', borderRadius: 12,
      background: 'var(--sm-paper)',
      border: '0.5px solid var(--sm-rule)',
      color: 'var(--sm-accent-deep)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      cursor: 'pointer',
      boxShadow: 'var(--sm-shadow-xs)',
    }}>
      <span style={{ display: 'flex' }}>{glyphs[icon]}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--sm-ink)', letterSpacing: -0.1 }}>{label}</span>
    </button>
  );
}

function MetaRow({ label, value, multiline, copyable, last }) {
  return (
    <div style={{
      padding: '10px 12px',
      borderBottom: last ? 'none' : '0.5px solid var(--sm-rule-soft)',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--sm-ink-mute)' }}>{label}</div>
        <div style={{
          fontSize: 14, color: 'var(--sm-ink)', marginTop: 2, letterSpacing: -0.15,
          lineHeight: multiline ? 1.4 : 1.2,
        }}>{value}</div>
      </div>
      {copyable && (
        <span style={{
          padding: '4px 8px', borderRadius: 6,
          background: 'rgba(20,16,8,0.05)', border: '0.5px solid var(--sm-rule)',
          fontSize: 10, fontWeight: 700, color: 'var(--sm-ink-mute)', letterSpacing: 0.4,
        }}>СКОПИР.</span>
      )}
    </div>
  );
}

// New chat modal / search overlay
function NewChatScreen({ dark = false }) {
  return (
    <SmDevice dark={dark}>
      <div style={{
        height: '100%', width: '100%',
        background: 'var(--sm-bg)',
        display: 'flex', flexDirection: 'column',
        paddingTop: 56, fontFamily: SYS_FONT,
      }} className="paper">

        {/* Modal header */}
        <div style={{
          padding: '6px 12px 10px',
          borderBottom: '0.5px solid var(--sm-rule)',
          background: 'var(--sm-sidebar-bg)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button style={{
              ...iconHdrBtn, width: 'auto', padding: '0 8px',
              color: 'var(--sm-accent-deep)', fontSize: 15, fontWeight: 500,
            }}>Отмена</button>
            <h1 style={{
              margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: -0.3, color: 'var(--sm-ink)',
            }}>Новый чат</h1>
            <button style={{
              ...iconHdrBtn, width: 'auto', padding: '0 8px',
              color: 'var(--sm-accent-deep)', fontSize: 15, fontWeight: 600,
            }}>Создать</button>
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '7px 12px', borderRadius: 10,
            background: 'rgba(217,210,191,0.30)',
            border: '0.5px solid var(--sm-rule)',
          }}>
            <span style={{ color: 'var(--sm-ink-mute)', display: 'flex' }}>{Icon.search(14)}</span>
            <span style={{ color: 'var(--sm-ink)', fontSize: 14, fontWeight: 400 }}>мира</span>
            <span style={{
              display: 'inline-block', width: 1, height: 14,
              background: 'var(--sm-accent)', animation: 'smCursor 1s steps(2) infinite',
            }} />
            <style>{`@keyframes smCursor { 0%,50%{opacity:1} 51%,100%{opacity:0} }`}</style>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
          {/* Top actions */}
          <SettingsGroup>
            <SettingsRow icon="newGroup" tint="amber" label="Новая группа" sub="до 200 участников" />
            <SettingsRow icon="invite" tint="amber" label="Найти по @username" last />
          </SettingsGroup>

          {/* Section: search results */}
          <div style={{
            padding: '8px 14px 6px', fontSize: 11, fontWeight: 700,
            color: 'var(--sm-ink-mute)', letterSpacing: 0.6, textTransform: 'uppercase',
          }}>Контакты · 2</div>

          <SettingsGroup>
            <ContactSearchRow name="Мира Альбрехт" handle="@mira" highlight={[0, 4]} />
            <ContactSearchRow name="Дамир Аоки" handle="@damira" highlight={[2, 4]} last />
          </SettingsGroup>

          <div style={{
            padding: '8px 14px 6px', fontSize: 11, fontWeight: 700,
            color: 'var(--sm-ink-mute)', letterSpacing: 0.6, textTransform: 'uppercase',
          }}>Сообщения · 12</div>

          <SettingsGroup>
            <SearchHit name="Мира Альбрехт" text="…чтобы про мира́ж не забыть про…" when="вчера" />
            <SearchHit name="Студия · Группа" text="…отправил мира — посмотри…" when="пн" last />
          </SettingsGroup>
        </div>
      </div>
    </SmDevice>
  );
}

function ContactSearchRow({ name, handle, highlight, last }) {
  const renderName = () => {
    if (!highlight) return name;
    const [start, end] = highlight;
    return (
      <>
        {name.slice(0, start)}
        <mark style={{ background: 'rgba(196,148,60,0.30)', color: 'inherit', padding: 0 }}>{name.slice(start, end)}</mark>
        {name.slice(end)}
      </>
    );
  };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '9px 12px',
      borderBottom: last ? 'none' : '0.5px solid var(--sm-rule-soft)',
    }}>
      <Avatar name={name} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--sm-ink)', letterSpacing: -0.2 }}>{renderName()}</div>
        <div style={{ fontSize: 12, color: 'var(--sm-accent-deep)', marginTop: 1 }}>{handle}</div>
      </div>
    </div>
  );
}

function SearchHit({ name, text, when, last }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '9px 12px',
      borderBottom: last ? 'none' : '0.5px solid var(--sm-rule-soft)',
    }}>
      <Avatar name={name} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--sm-ink)', letterSpacing: -0.2 }}>{name}</span>
          <span style={{ fontSize: 11, color: 'var(--sm-ink-mute)' }}>{when}</span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--sm-ink-mute)', marginTop: 1, fontStyle: 'italic' }}>{text}</div>
      </div>
    </div>
  );
}

// Empty state — empty chats with welcome card
function EmptyChatsScreen({ dark = false }) {
  return (
    <SmDevice dark={dark}>
      <div style={{
        height: '100%', width: '100%',
        background: 'var(--sm-sidebar-bg)',
        display: 'flex', flexDirection: 'column',
        paddingTop: 56, fontFamily: SYS_FONT,
      }} className="paper">

        <NavHeader title="Чаты" trailing={
          <button style={iconHdrBtn}>
            <span style={{ color: 'var(--sm-accent-deep)' }}>{Icon.pencil(20)}</span>
          </button>
        } />

        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '20px 28px',
          textAlign: 'center',
        }}>
          <BigSunMark size={72} />
          <h2 style={{
            margin: '20px 0 4px', fontSize: 22, fontWeight: 700, letterSpacing: -0.6,
            color: 'var(--sm-ink)',
          }}>добро пожаловать в sun</h2>
          <p style={{
            margin: 0, fontFamily: 'Instrument Serif, Georgia, serif', fontStyle: 'italic',
            fontSize: 16, color: 'var(--sm-ink-mute)', letterSpacing: 0.1, lineHeight: 1.4,
            maxWidth: 280,
          }}>тихие сообщения, тёплый свет — начните разговор, когда будет настроение</p>

          <button style={{
            marginTop: 24, padding: '12px 22px', borderRadius: 12,
            background: 'var(--sm-ink)', color: 'var(--sm-text-inv)',
            border: 'none', fontSize: 14.5, fontWeight: 600, letterSpacing: -0.2,
            display: 'flex', alignItems: 'center', gap: 8,
            cursor: 'pointer',
            boxShadow: '0 6px 16px -8px rgba(21,20,14,0.4)',
          }}>
            <span style={{ display: 'flex' }}>{Icon.pencil(16)}</span>
            начать диалог
          </button>

          <div style={{
            marginTop: 18, display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 11.5, color: 'var(--sm-online)',
          }}>
            <span style={{ display: 'flex' }}>{Icon.lock(11)}</span>
            сообщения зашифрованы сквозным шифрованием
          </div>
        </div>

        <TabBar active="chats" />
      </div>
    </SmDevice>
  );
}

Object.assign(window, { ContactsScreen, ContactProfileScreen, NewChatScreen, EmptyChatsScreen });
