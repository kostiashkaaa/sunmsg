// settings.jsx — Settings home + a settings detail (Privacy)

function SettingsHomeScreen({ dark = false }) {
  return (
    <SmDevice dark={dark}>
      <div style={{
        height: '100%', width: '100%',
        background: 'var(--sm-bg)',
        display: 'flex', flexDirection: 'column',
        paddingTop: 56, fontFamily: SYS_FONT,
      }} className="paper">

        <NavHeader title="Настройки" trailing={
          <button style={iconHdrBtn}>
            <span style={{ color: 'var(--sm-accent-deep)' }}>{Icon.qr(20)}</span>
          </button>
        } />

        <div style={{ flex: 1, overflow: 'hidden', padding: '12px 12px 0' }}>
          {/* Big profile card */}
          <div style={{
            background: 'var(--sm-paper)',
            border: '0.5px solid var(--sm-rule)',
            borderRadius: 14, padding: '14px 14px 12px',
            boxShadow: 'var(--sm-shadow-xs)',
            marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <Avatar name="Юлия Сун" size={52} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.3, color: 'var(--sm-ink)' }}>
                Юлия Сун
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--sm-accent-deep)', marginTop: 1, fontWeight: 500 }}>
                @yulia
              </div>
              <div style={{ marginTop: 6 }}>
                <SyncChip>СИНХРОНИЗИРОВАНО</SyncChip>
              </div>
            </div>
            <span style={{ color: 'var(--sm-ink-faint)', display: 'flex' }}>{Icon.chevronR(14)}</span>
          </div>

          {/* Settings groups */}
          <SettingsGroup>
            <SettingsRow icon="key" tint="amber" label="Приватность и безопасность" sub="Ключи, устройства, блокировки" badge="2" />
            <SettingsRow icon="bell" tint="amber" label="Уведомления" sub="Звуки, привью, тёплый режим" />
            <SettingsRow icon="palette" tint="amber" label="Внешний вид" sub="Тема, обои, текст" />
            <SettingsRow icon="data" tint="amber" label="Данные и память" sub="78% свободно · 2.4 GB" last />
          </SettingsGroup>

          <SettingsGroup>
            <SettingsRow icon="lang" tint="neutral" label="Язык" trail="Русский" />
            <SettingsRow icon="device" tint="neutral" label="Устройства" trail="3" />
            <SettingsRow icon="export" tint="neutral" label="Экспорт сообщений" last />
          </SettingsGroup>

          <SettingsGroup>
            <SettingsRow icon="help" tint="neutral" label="Помощь" />
            <SettingsRow icon="logout" tint="danger" label="Выйти из аккаунта" last />
          </SettingsGroup>

          <div style={{
            textAlign: 'center', padding: '6px 0 4px',
            fontSize: 10.5, color: 'var(--sm-ink-faint)',
          }}>
            sun · версия 1.4.2 (2026.05)
          </div>
        </div>

        <TabBar active="settings" />
      </div>
    </SmDevice>
  );
}

function SettingsGroup({ children }) {
  return (
    <div style={{
      background: 'var(--sm-paper)',
      border: '0.5px solid var(--sm-rule)',
      borderRadius: 14,
      overflow: 'hidden', marginBottom: 12,
      boxShadow: 'var(--sm-shadow-xs)',
    }}>{children}</div>
  );
}

function SettingsRow({ icon, tint = 'amber', label, sub, trail, badge, last, danger }) {
  const tints = {
    amber:   { bg: 'rgba(196,148,60,0.10)', fg: 'var(--sm-accent-deep)' },
    neutral: { bg: 'rgba(20,16,8,0.06)',    fg: 'var(--sm-ink-soft)' },
    danger:  { bg: 'rgba(193,66,66,0.10)',  fg: '#c14242' },
  };
  const t = tints[tint];
  const glyphs = {
    key:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="8" r="3" stroke="currentColor" strokeWidth="1.4"/><path d="M9 8h5M13 8v2M11 8v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
    bell:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 11c0-3 1.5-5 5-5s5 2 5 5l1 2H2l1-2zM6 13.5a2 2 0 004 0" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>,
    palette:<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2c3.3 0 6 2.5 6 5.5 0 1.5-1.2 2.5-2.5 2.5h-1c-.8 0-1.5.7-1.5 1.5 0 .5.2.8.2 1.2 0 .8-.7 1.3-1.5 1.3-3 0-5.5-2.5-5.5-6S4.7 2 8 2z" stroke="currentColor" strokeWidth="1.4"/><circle cx="5" cy="7" r="0.8" fill="currentColor"/><circle cx="8" cy="5" r="0.8" fill="currentColor"/><circle cx="11" cy="7" r="0.8" fill="currentColor"/></svg>,
    data:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><ellipse cx="8" cy="4" rx="5" ry="2" stroke="currentColor" strokeWidth="1.4"/><path d="M3 4v4c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8v4c0 1.1 2.2 2 5 2s5-.9 5-2V8" stroke="currentColor" strokeWidth="1.4"/></svg>,
    lang:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" stroke="currentColor" strokeWidth="1.4"/></svg>,
    device: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="9" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="11" y="6" width="3" height="7" rx="1" stroke="currentColor" strokeWidth="1.4"/></svg>,
    export: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 10V2M5 5l3-3 3 3M3 11v2c0 .6.4 1 1 1h8c.6 0 1-.4 1-1v-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    help:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/><path d="M6 6c0-1 .9-1.8 2-1.8s2 .8 2 1.8c0 .6-.4 1.2-1 1.4-.6.2-1 .6-1 1.2v.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><circle cx="8" cy="11.5" r="0.7" fill="currentColor"/></svg>,
    logout: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M7 3H3v10h4M10 5l3 3-3 3M5.5 8H13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 12px',
      borderBottom: last ? 'none' : '0.5px solid var(--sm-rule-soft)',
    }}>
      <span style={{
        width: 30, height: 30, borderRadius: 8,
        background: t.bg, color: t.fg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>{glyphs[icon]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14.5, fontWeight: 500, letterSpacing: -0.2,
          color: tint === 'danger' ? '#c14242' : 'var(--sm-ink)',
        }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: 'var(--sm-ink-mute)', marginTop: 1, letterSpacing: -0.05 }}>{sub}</div>}
      </div>
      {badge != null && (
        <span style={{
          minWidth: 18, height: 18, padding: '0 6px', borderRadius: 999,
          background: 'var(--sm-accent)', color: '#fff',
          fontSize: 10.5, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{badge}</span>
      )}
      {trail && (
        <span style={{ fontSize: 13, color: 'var(--sm-ink-mute)' }}>{trail}</span>
      )}
      {!danger && tint !== 'danger' && (
        <span style={{ color: 'var(--sm-ink-faint)', display: 'flex' }}>{Icon.chevronR(12)}</span>
      )}
    </div>
  );
}

// Settings detail: Privacy & security
function SettingsDetailScreen({ dark = false }) {
  return (
    <SmDevice dark={dark}>
      <div style={{
        height: '100%', width: '100%',
        background: 'var(--sm-bg)',
        display: 'flex', flexDirection: 'column',
        paddingTop: 56, fontFamily: SYS_FONT,
      }} className="paper">
        <NavHeader
          title="Приватность"
          leading={
            <button style={iconHdrBtn}>
              <span style={{ color: 'var(--sm-accent-deep)', display: 'flex', alignItems: 'center', gap: 2 }}>
                {Icon.chevronL(20)}
                <span style={{ fontSize: 15, fontWeight: 500 }}>Назад</span>
              </span>
            </button>
          }
        />

        <div style={{ flex: 1, overflow: 'auto', padding: '14px 12px 12px' }}>
          {/* Encryption state */}
          <div style={{
            background: 'var(--sm-paper)',
            border: '0.5px solid var(--sm-rule)',
            borderRadius: 14, padding: 14, marginBottom: 12,
            boxShadow: 'var(--sm-shadow-xs)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'rgba(105,160,110,0.10)',
                color: 'var(--sm-online)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M3 9.5L8 14.5l9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: -0.2 }}>Сквозное шифрование активно</div>
                <div style={{ fontSize: 12, color: 'var(--sm-ink-mute)', marginTop: 1 }}>3 устройства · последняя ротация ключей вчера</div>
              </div>
            </div>
            <div style={{
              display: 'flex', gap: 6, padding: '8px 10px', borderRadius: 10,
              background: 'rgba(217,210,191,0.30)',
              fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--sm-ink-mute)',
              letterSpacing: 0.4,
            }}>
              <span>7f4a · 9c2e · 33a8 · b621 · 5f0d · 9aa1</span>
            </div>
          </div>

          <SettingsGroup>
            <ToggleRow label="Запросы на диалог" sub="Сообщения от неконтактов в отдельной папке" value={true} />
            <ToggleRow label="Скрывать «был в сети»" value={false} />
            <ToggleRow label="Скрывать фото профиля" sub="От тех, кого нет в контактах" value={true} last />
          </SettingsGroup>

          <SettingsGroup>
            <SettingsRow icon="key" tint="amber" label="Секретная фраза (24 слова)" sub="Резервная копия ключа" />
            <SettingsRow icon="device" tint="amber" label="Активные устройства" trail="3" />
            <SettingsRow icon="export" tint="amber" label="Заблокированные" trail="2" last />
          </SettingsGroup>

          <SettingsGroup>
            <SettingsRow icon="logout" tint="danger" label="Удалить все сообщения с устройства" last />
          </SettingsGroup>

          <div style={{
            padding: '4px 14px 8px', fontSize: 11, color: 'var(--sm-ink-faint)', lineHeight: 1.45,
          }}>
            ключи генерируются на устройстве. <strong style={{ color: 'var(--sm-accent-deep)', fontWeight: 700 }}>sun</strong> не имеет доступа к содержимому ваших сообщений.
          </div>
        </div>

        <TabBar active="settings" />
      </div>
    </SmDevice>
  );
}

function ToggleRow({ label, sub, value, last }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 12px',
      borderBottom: last ? 'none' : '0.5px solid var(--sm-rule-soft)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 500, letterSpacing: -0.2, color: 'var(--sm-ink)' }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: 'var(--sm-ink-mute)', marginTop: 1, letterSpacing: -0.05 }}>{sub}</div>}
      </div>
      <Switch value={value} />
    </div>
  );
}

function Switch({ value }) {
  return (
    <div style={{
      width: 44, height: 26, borderRadius: 999, position: 'relative',
      background: value ? 'var(--sm-accent)' : 'rgba(20,16,8,0.16)',
      transition: 'background 200ms',
      flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', top: 2, left: value ? 20 : 2,
        width: 22, height: 22, borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 2px 4px rgba(20,16,8,0.20), 0 0 0 0.5px rgba(20,16,8,0.06)',
        transition: 'left 200ms',
      }} />
    </div>
  );
}

Object.assign(window, { SettingsHomeScreen, SettingsDetailScreen, SettingsGroup, SettingsRow, ToggleRow, Switch });
