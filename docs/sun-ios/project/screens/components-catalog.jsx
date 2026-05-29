// components.jsx — component catalog card for handoff reference

function ComponentsCatalog({ dark = false }) {
  return (
    <div style={{
      width: '100%', height: '100%', background: 'var(--sm-bg)',
      padding: '24px 22px', boxSizing: 'border-box',
      fontFamily: SYS_FONT, color: 'var(--sm-ink)',
      borderRadius: 24, border: '0.5px solid var(--sm-rule)',
      overflow: 'auto',
    }} className="paper">
      <div style={{
        fontFamily: 'Instrument Serif, Georgia, serif', fontStyle: 'italic',
        fontSize: 13, color: 'var(--sm-ink-mute)',
      }}>каталог</div>
      <h2 style={{ margin: '4px 0 18px', fontSize: 26, fontWeight: 700, letterSpacing: -0.8 }}>
        компоненты
      </h2>

      {/* Buttons */}
      <H3>Кнопки</H3>
      <Frame>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Btn variant="primary">Войти</Btn>
          <Btn variant="secondary">Отмена</Btn>
          <Btn variant="ghost">Подробнее</Btn>
          <Btn variant="danger">Заблокировать</Btn>
          <Btn variant="accent">Сохранить</Btn>
        </div>
        <Note>radius 12 · padding 13×20 · weight 600 · letter-spacing -0.2</Note>
      </Frame>

      {/* Inputs */}
      <H3>Поля ввода</H3>
      <Frame>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <InputField label="Имя пользователя" value="@mira" />
          <InputField label="Поиск" value="" placeholder="Поиск…" leadingIcon={Icon.search(14)} />
          <InputField label="Пароль" value="••••••••" trailing="ПОКАЗАТЬ" />
          <InputField label="С ошибкой" value="me" error="минимум 3 символа" />
        </div>
      </Frame>

      {/* Badges & chips */}
      <H3>Бейджи и чипы</H3>
      <Frame>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <Badge>2</Badge>
          <Badge>99+</Badge>
          <Badge variant="muted">арх.</Badge>
          <Chip>Все</Chip>
          <Chip active>Активный</Chip>
          <Chip count={4}>Запросы</Chip>
          <SyncChip />
          <Chip tone="success">в сети</Chip>
          <Chip tone="danger">офлайн</Chip>
        </div>
      </Frame>

      {/* Toggle / switch */}
      <H3>Переключатели</H3>
      <Frame>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <Switch value={true} />
          <Switch value={false} />
          <div style={{
            display: 'flex', padding: 3, borderRadius: 10,
            background: 'rgba(217,210,191,0.30)', flex: 1,
          }}>
            <SegTabSmall label="Войти" active />
            <SegTabSmall label="Регистрация" />
          </div>
        </div>
      </Frame>

      {/* Avatars */}
      <H3>Аватары</H3>
      <Frame>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          {[28, 32, 40, 44, 52, 72].map(s => (
            <div key={s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <Avatar name="Юлия" size={s} online={s >= 40} />
              <span style={{ fontSize: 9, color: 'var(--sm-ink-mute)', fontFamily: 'ui-monospace, monospace' }}>{s}</span>
            </div>
          ))}
        </div>
      </Frame>

      {/* Bubbles */}
      <H3>Пузыри сообщений</H3>
      <Frame>
        <div style={{
          padding: 14, borderRadius: 12, background: 'var(--sm-chat-bg)',
          border: '0.5px solid var(--sm-rule-soft)',
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          <Bubble side="in" text="Привет — как обложка?" time="9:14" tail />
          <Bubble side="out" text="Идеально. Сейчас вышлю v3." time="9:18" read tail />
        </div>
        <Note>radius 18 · tail-corner 6 · padding 7×12 · maxWidth 78%</Note>
      </Frame>

      {/* Toast */}
      <H3>Тосты</H3>
      <Frame>
        <Toast tone="success" text="Сообщение отправлено" />
        <Toast tone="amber" text="История заблокирована — введите 24 слова" />
        <Toast tone="danger" text="Ошибка сети — повторяем…" />
      </Frame>

      {/* Modal */}
      <H3>Модальные окна</H3>
      <Frame>
        <div style={{
          padding: 14, borderRadius: 14,
          background: 'var(--sm-paper)', border: '0.5px solid var(--sm-rule)',
          boxShadow: 'var(--sm-shadow-md)',
        }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: -0.2 }}>Удалить чат?</div>
          <div style={{ fontSize: 12.5, color: 'var(--sm-ink-mute)', marginTop: 4, lineHeight: 1.4 }}>
            Это действие нельзя отменить. Все сообщения с устройства будут удалены.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={smallBtn('secondary')}>Отмена</button>
            <button style={smallBtn('danger')}>Удалить</button>
          </div>
        </div>
      </Frame>
    </div>
  );
}

function H3({ children }) {
  return (
    <h3 style={{
      margin: '14px 0 6px', fontSize: 11, fontWeight: 700,
      letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--sm-ink-mute)',
    }}>{children}</h3>
  );
}

function Frame({ children }) {
  return (
    <div style={{
      background: 'var(--sm-paper)',
      border: '0.5px solid var(--sm-rule)',
      borderRadius: 14, padding: 14,
      marginBottom: 4,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>{children}</div>
  );
}

function Note({ children }) {
  return (
    <div style={{
      fontSize: 10.5, color: 'var(--sm-ink-faint)',
      fontFamily: 'ui-monospace, monospace', marginTop: 2,
    }}>{children}</div>
  );
}

function Btn({ variant, children }) {
  const styles = {
    primary: { bg: 'var(--sm-ink)', fg: 'var(--sm-text-inv)', border: 'none' },
    secondary: { bg: 'var(--sm-paper)', fg: 'var(--sm-ink)', border: '0.5px solid var(--sm-rule)' },
    ghost: { bg: 'transparent', fg: 'var(--sm-accent-deep)', border: 'none' },
    danger: { bg: '#c14242', fg: '#fff', border: 'none' },
    accent: { bg: 'var(--sm-accent)', fg: '#fff', border: 'none' },
  };
  const s = styles[variant] || styles.primary;
  return (
    <button style={{
      padding: '11px 18px', borderRadius: 12,
      background: s.bg, color: s.fg, border: s.border,
      fontFamily: SYS_FONT, fontWeight: 600, fontSize: 14, letterSpacing: -0.2,
      cursor: 'pointer',
    }}>{children}</button>
  );
}

function smallBtn(variant) {
  if (variant === 'danger') return {
    flex: 1, padding: '9px 14px', borderRadius: 10,
    background: '#c14242', color: '#fff', border: 'none',
    fontFamily: SYS_FONT, fontWeight: 600, fontSize: 13, cursor: 'pointer',
  };
  return {
    flex: 1, padding: '9px 14px', borderRadius: 10,
    background: 'transparent', color: 'var(--sm-ink)',
    border: '0.5px solid var(--sm-rule)',
    fontFamily: SYS_FONT, fontWeight: 600, fontSize: 13, cursor: 'pointer',
  };
}

function InputField({ label, value, placeholder, trailing, leadingIcon, error }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
        color: error ? '#c14242' : 'var(--sm-ink-faint)',
        marginBottom: 4,
      }}>{label}</div>
      <div style={{
        padding: '8px 12px', borderRadius: 10,
        background: 'rgba(217,210,191,0.20)',
        border: `0.5px solid ${error ? '#c14242' : 'var(--sm-rule)'}`,
        display: 'flex', alignItems: 'center', gap: 7,
        boxShadow: error ? '0 0 0 3px rgba(193,66,66,0.10)' : '0 0 0 3px transparent',
      }}>
        {leadingIcon && <span style={{ color: 'var(--sm-ink-mute)', display: 'flex' }}>{leadingIcon}</span>}
        <span style={{
          flex: 1, fontSize: 14, fontWeight: 500,
          color: value ? 'var(--sm-ink)' : 'var(--sm-ink-faint)',
          letterSpacing: -0.2,
        }}>{value || placeholder}</span>
        {trailing && (
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--sm-accent-deep)', letterSpacing: 0.4 }}>{trailing}</span>
        )}
      </div>
      {error && <div style={{ fontSize: 11, color: '#c14242', marginTop: 3 }}>{error}</div>}
    </div>
  );
}

function Badge({ children, variant = 'accent' }) {
  const v = variant === 'muted'
    ? { bg: 'rgba(20,16,8,0.06)', fg: 'var(--sm-ink-mute)' }
    : { bg: 'var(--sm-accent)', fg: '#fff' };
  return (
    <span style={{
      minWidth: 18, height: 18, padding: '0 6px', borderRadius: 999,
      background: v.bg, color: v.fg,
      fontSize: 10.5, fontWeight: 700,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: SYS_FONT,
    }}>{children}</span>
  );
}

function Chip({ children, active, count, tone }) {
  const tones = {
    success: { bg: 'rgba(105,160,110,0.10)', border: 'rgba(105,160,110,0.22)', fg: 'var(--sm-online)' },
    danger: { bg: 'rgba(193,66,66,0.10)', border: 'rgba(193,66,66,0.22)', fg: '#c14242' },
  };
  const t = tones[tone];
  if (active) {
    return (
      <span style={{
        padding: '4px 10px', borderRadius: 8,
        background: 'var(--sm-ink)', color: 'var(--sm-text-inv)',
        fontSize: 12, fontWeight: 600, letterSpacing: -0.1,
        display: 'inline-flex', alignItems: 'center', gap: 5,
      }}>{children}</span>
    );
  }
  return (
    <span style={{
      padding: '4px 10px', borderRadius: 8,
      background: t ? t.bg : 'transparent',
      border: `0.5px solid ${t ? t.border : 'var(--sm-rule)'}`,
      color: t ? t.fg : 'var(--sm-ink-mute)',
      fontSize: 12, fontWeight: 500, letterSpacing: -0.1,
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }}>
      {children}
      {count != null && (
        <span style={{
          fontSize: 10, fontWeight: 700, color: 'var(--sm-accent-deep)',
        }}>{count}</span>
      )}
    </span>
  );
}

function Toast({ tone, text }) {
  const tones = {
    success: { bg: 'rgba(105,160,110,0.12)', border: 'rgba(105,160,110,0.24)', fg: 'var(--sm-online)', icon: '✓' },
    amber: { bg: 'var(--sm-req-bg)', border: 'var(--sm-req-border)', fg: 'var(--sm-accent-deep)', icon: '!' },
    danger: { bg: 'rgba(193,66,66,0.10)', border: 'rgba(193,66,66,0.24)', fg: '#c14242', icon: '⚠' },
  };
  const t = tones[tone];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px', borderRadius: 10,
      background: t.bg, border: `0.5px solid ${t.border}`,
      color: t.fg, fontSize: 13, fontWeight: 500, letterSpacing: -0.1,
    }}>
      <span style={{
        width: 20, height: 20, borderRadius: '50%',
        background: 'rgba(255,255,255,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700,
      }}>{t.icon}</span>
      <span>{text}</span>
    </div>
  );
}

window.ComponentsCatalog = ComponentsCatalog;
