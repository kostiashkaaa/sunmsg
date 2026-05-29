// main.jsx — Sunmsg iOS canvas. 4 screens · matches web sun palette.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "darkMode": false,
  "bubbleRadius": 18,
  "accentBoost": 0
}/*EDITMODE-END*/;

function App() {
  const t = useTweaks(TWEAK_DEFAULTS);

  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', !!t.darkMode);
    // Slight lightness boost for accent if user wants warmer
    const l = 68 + (t.accentBoost || 0);
    document.documentElement.style.setProperty('--sm-accent', `oklch(${l}% 0.14 65)`);
  }, [t.darkMode, t.accentBoost]);

  const dark = !!t.darkMode;

  return (
    <>
      <DesignCanvas>
        <DCSection
          id="core"
          title="sun · iOS · ключевые экраны"
          subtitle="iPhone 16 Pro · 393 × 852 pt · SF Pro · палитра tokens.css"
        >
          <DCArtboard id="splash" label="01 · Splash" width={SCREEN_W} height={SCREEN_H}>
            <SplashScreen dark={dark} />
          </DCArtboard>
          <DCArtboard id="login" label="02 · Авторизация" width={SCREEN_W} height={SCREEN_H}>
            <LoginScreen dark={dark} />
          </DCArtboard>
          <DCArtboard id="chats" label="03 · Чаты" width={SCREEN_W} height={SCREEN_H}>
            <ChatListScreen dark={dark} />
          </DCArtboard>
          <DCArtboard id="thread" label="04 · Открытый чат" width={SCREEN_W} height={SCREEN_H}>
            <ChatViewScreen dark={dark} />
          </DCArtboard>
          <DCArtboard id="empty" label="05 · Пустое состояние" width={SCREEN_W} height={SCREEN_H}>
            <EmptyChatsScreen dark={dark} />
          </DCArtboard>
          <DCArtboard id="new-chat" label="06 · Новый чат" width={SCREEN_W} height={SCREEN_H}>
            <NewChatScreen dark={dark} />
          </DCArtboard>
        </DCSection>

        <DCSection
          id="locked"
          title="Заблокировано · 24 слова"
          subtitle="Состояние когда ключ не введён — история зашифрована"
        >
          <DCArtboard id="locked-chats" label="07 · Чаты заблокированы" width={SCREEN_W} height={SCREEN_H}>
            <LockedChatsScreen dark={dark} />
          </DCArtboard>
          <DCArtboard id="unlock" label="08 · Ввод 24 слов" width={SCREEN_W} height={SCREEN_H}>
            <MnemonicUnlockScreen dark={dark} />
          </DCArtboard>
        </DCSection>

        <DCSection
          id="calls"
          title="Звонки"
          subtitle="Журнал и активный звонок"
        >
          <DCArtboard id="calls-list" label="09 · Звонки · журнал" width={SCREEN_W} height={SCREEN_H}>
            <CallsListScreen dark={dark} />
          </DCArtboard>
          <DCArtboard id="incall" label="10 · Активный звонок" width={SCREEN_W} height={SCREEN_H}>
            <InCallScreen dark={dark} />
          </DCArtboard>
        </DCSection>

        <DCSection
          id="settings"
          title="Настройки и профили"
          subtitle="Дом, детальный экран, профиль контакта, контакты"
        >
          <DCArtboard id="settings-home" label="11 · Настройки" width={SCREEN_W} height={SCREEN_H}>
            <SettingsHomeScreen dark={dark} />
          </DCArtboard>
          <DCArtboard id="settings-privacy" label="12 · Приватность" width={SCREEN_W} height={SCREEN_H}>
            <SettingsDetailScreen dark={dark} />
          </DCArtboard>
          <DCArtboard id="contact-profile" label="13 · Профиль контакта" width={SCREEN_W} height={SCREEN_H}>
            <ContactProfileScreen dark={dark} />
          </DCArtboard>
          <DCArtboard id="contacts" label="14 · Контакты" width={SCREEN_W} height={SCREEN_H}>
            <ContactsScreen dark={dark} />
          </DCArtboard>
        </DCSection>

        <DCSection
          id="system"
          title="Дизайн-система"
          subtitle="Токены, типографика, компоненты — для handoff"
        >
          <DCArtboard id="swatches" label="Токены · радиусы · шрифт" width={460} height={SCREEN_H}>
            <PaletteCard dark={dark} />
          </DCArtboard>
          <DCArtboard id="catalog" label="Компоненты" width={460} height={1200}>
            <ComponentsCatalog dark={dark} />
          </DCArtboard>
        </DCSection>
      </DesignCanvas>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Тема">
          <TweakToggle
            label="Тёмная тема"
            value={t.darkMode}
            onChange={v => t.setTweak('darkMode', v)}
          />
        </TweakSection>
        <TweakSection label="Акцент">
          <TweakSlider
            label="Светлота акцента"
            value={t.accentBoost}
            min={-8} max={8} step={1}
            onChange={v => t.setTweak('accentBoost', v)}
            hint={`oklch(${68 + t.accentBoost}% 0.14 65)`}
          />
        </TweakSection>
        <TweakSection label="Пузыри">
          <TweakSlider
            label="Скругление"
            value={t.bubbleRadius}
            min={10} max={22} step={1}
            onChange={v => t.setTweak('bubbleRadius', v)}
          />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

function PaletteCard({ dark }) {
  const swatches = [
    ['Фон',         'var(--sm-bg)',          dark ? '#1c1a14' : '#f3f0e8'],
    ['Бумага',      'var(--sm-paper)',       dark ? '#221f17' : '#fbf8f1'],
    ['Чат-фон',     'var(--sm-chat-bg)',     dark ? '#100e09' : '#f2ede2'],
    ['Текст',       'var(--sm-ink)',         dark ? '#ece6d5' : '#15140e'],
    ['Серый',       'var(--sm-ink-mute)',    dark ? '#9b9586' : '#7a7363'],
    ['Акцент',      'var(--sm-accent)',      'oklch(68% 0.14 65)'],
    ['Акцент deep', 'var(--sm-accent-deep)', dark ? 'oklch(74% .12 70)' : 'oklch(58% .16 55)'],
    ['Рамка',       'var(--sm-rule)',        dark ? '#332f24' : '#d9d2bf'],
    ['В сети',      'var(--sm-online)',      'oklch(68% .17 155)'],
    ['Bubble out',  'var(--sm-bubble-out)',  dark ? '#ece6d5' : '#15140e'],
    ['Bubble in',   'var(--sm-bubble-in)',   dark ? '#2a261c' : '#fbf8f1'],
    ['Запросы',     'var(--sm-req-bg)',      dark ? '#1c1500' : '#fefce8'],
  ];
  return (
    <div style={{
      width: '100%', height: '100%', background: 'var(--sm-bg)',
      padding: '28px 24px', boxSizing: 'border-box',
      fontFamily: SYS_FONT, color: 'var(--sm-ink)',
      borderRadius: 24, border: '0.5px solid var(--sm-rule)',
      overflow: 'auto',
    }} className="paper">
      <div style={{
        fontFamily: 'Instrument Serif, Georgia, serif', fontStyle: 'italic',
        fontSize: 13, color: 'var(--sm-ink-mute)',
      }}>сверка системы</div>
      <h2 style={{
        margin: '4px 0 18px', fontSize: 28, fontWeight: 700, letterSpacing: -0.8,
      }}>токены</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {swatches.map(([name, varName, hex]) => (
          <div key={name} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: 10,
            background: 'var(--sm-paper)', border: '0.5px solid var(--sm-rule)',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: varName, border: '0.5px solid var(--sm-rule)',
              flexShrink: 0,
            }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: -0.1 }}>{name}</div>
              <div style={{
                fontSize: 10, color: 'var(--sm-ink-mute)',
                fontFamily: 'ui-monospace, monospace',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{hex}</div>
            </div>
          </div>
        ))}
      </div>

      <h3 style={{
        margin: '20px 0 8px', fontSize: 11, fontWeight: 700,
        letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--sm-ink-mute)',
      }}>типографика</h3>
      <div style={{
        padding: 14, borderRadius: 12,
        background: 'var(--sm-paper)', border: '0.5px solid var(--sm-rule)',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{
          fontSize: 32, fontWeight: 700, letterSpacing: -1, lineHeight: 1,
          fontFamily: SYS_FONT,
        }}>Aa Ая</div>
        <div style={{
          fontFamily: 'ui-monospace, monospace', fontSize: 10, color: 'var(--sm-ink-mute)',
        }}>SF Pro · system · 400 / 500 / 600 / 700</div>
        <div style={{ height: 1, background: 'var(--sm-rule-soft)', margin: '4px 0' }} />
        <Row name="Заголовок" size="28 / -1" weight={700} />
        <Row name="Имя контакта" size="15 / -0.2" weight={600} />
        <Row name="Текст" size="14.5 / -0.15" weight={400} />
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 13,
        }}>
          <span style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontStyle: 'italic', fontSize: 15 }}>
            акцент — Instrument Serif
          </span>
          <span style={{ color: 'var(--sm-ink-mute)', fontSize: 10 }}>serif italic</span>
        </div>
      </div>

      <h3 style={{
        margin: '20px 0 8px', fontSize: 11, fontWeight: 700,
        letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--sm-ink-mute)',
      }}>радиусы</h3>
      <div style={{ display: 'flex', gap: 6 }}>
        {[
          ['xs', 4], ['sm', 8], ['md', 12], ['lg', 18], ['xl', 24],
        ].map(([k, r]) => (
          <div key={k} style={{
            flex: 1, height: 56, borderRadius: r,
            background: 'var(--sm-paper)', border: '0.5px solid var(--sm-rule)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 1,
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--sm-ink)' }}>{r}</span>
            <span style={{ fontSize: 9, color: 'var(--sm-ink-mute)', letterSpacing: 0.4, textTransform: 'uppercase' }}>{k}</span>
          </div>
        ))}
      </div>

      <h3 style={{
        margin: '20px 0 8px', fontSize: 11, fontWeight: 700,
        letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--sm-ink-mute)',
      }}>аватары</h3>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        {[28, 32, 40, 44, 56].map(s => (
          <div key={s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <Avatar name="Юлия" size={s} />
            <span style={{ fontSize: 9, color: 'var(--sm-ink-mute)', fontFamily: 'ui-monospace, monospace' }}>{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ name, size, weight }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
      <span style={{ fontWeight: weight }}>{name} · {size}</span>
      <span style={{ color: 'var(--sm-ink-mute)' }}>{weight}</span>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
