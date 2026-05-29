// login.jsx — Screen 4: Auth (matches auth.css card aesthetic)
// Native iOS shell. Card on warm parchment, sun mark, Russian copy.

function LoginScreen({ dark = false }) {
  return (
    <SmDevice dark={dark}>
      <div style={{
        height: '100%', width: '100%',
        background: 'var(--sm-bg)',
        display: 'flex', flexDirection: 'column',
        position: 'relative', overflow: 'hidden',
        fontFamily: SYS_FONT,
      }} className="paper">

        {/* warm radial glow behind card */}
        <div style={{
          position: 'absolute', top: '-10%', left: '-20%', right: '-20%', height: '70%',
          background: 'radial-gradient(ellipse 500px 400px at 50% 30%, rgba(196,148,60,0.18), transparent 70%)',
          pointerEvents: 'none',
        }} />

        {/* spacer under status bar */}
        <div style={{ height: 56, flexShrink: 0 }} />

        {/* Centered brand */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 24, position: 'relative' }}>
          <BigSunMark size={56} />
          <h1 style={{
            margin: '14px 0 4px', fontFamily: SYS_FONT, fontWeight: 700, fontSize: 28,
            letterSpacing: -1, color: 'var(--sm-ink)',
          }}>sun</h1>
          <p style={{
            margin: 0, fontFamily: 'Instrument Serif, Georgia, serif', fontStyle: 'italic',
            fontSize: 15, color: 'var(--sm-ink-mute)', letterSpacing: 0.1,
          }}>добро пожаловать в мессенджер</p>
        </div>

        {/* Auth card */}
        <div style={{
          margin: '22px 20px 0', flex: 1,
          background: 'var(--sm-paper)',
          border: '0.5px solid var(--sm-rule)',
          borderRadius: 18,
          boxShadow: 'var(--sm-shadow-md)',
          padding: '18px 18px 16px',
          display: 'flex', flexDirection: 'column',
          position: 'relative',
        }}>
          {/* Header copy */}
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
              color: 'var(--sm-ink-mute)',
            }}>вход в аккаунт</div>
            <div style={{
              marginTop: 4, fontSize: 12.5, color: 'var(--sm-ink-mute)', lineHeight: 1.45,
            }}>аккаунт — это ваша 24-словная фраза. она хранится только на устройстве.</div>
          </div>

          {/* Primary: create new account */}
          <button style={{
            padding: '13px 16px', borderRadius: 12,
            background: 'var(--sm-ink)', color: 'var(--sm-text-inv)',
            border: 'none', fontFamily: SYS_FONT, fontWeight: 600, fontSize: 15,
            letterSpacing: -0.2, cursor: 'pointer',
            boxShadow: '0 1px 0 rgba(255,255,255,0.05) inset, 0 6px 16px -8px rgba(21,20,14,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5l1.6 4.4 4.4 1.6-4.4 1.6L8 13.5 6.4 9.1 2 7.5l4.4-1.6L8 1.5z"
                fill="currentColor" />
            </svg>
            Создать новый аккаунт
          </button>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 12px' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--sm-rule)' }} />
            <span style={{ fontSize: 10.5, color: 'var(--sm-ink-faint)', fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase' }}>или</span>
            <div style={{ flex: 1, height: 1, background: 'var(--sm-rule)' }} />
          </div>

          {/* Restore from mnemonic */}
          <button style={{
            padding: '11px 14px', borderRadius: 12,
            background: 'transparent', color: 'var(--sm-ink)',
            border: '0.5px solid var(--sm-rule)',
            display: 'flex', alignItems: 'center', gap: 10,
            fontFamily: SYS_FONT, fontWeight: 500, fontSize: 13.5, cursor: 'pointer',
            textAlign: 'left', marginBottom: 8,
          }}>
            <span style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'rgba(196,148,60,0.10)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--sm-accent-deep)', flexShrink: 0,
            }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8c0-2.8 2.2-5 5-5s5 2.2 5 5-2.2 5-5 5c-1.4 0-2.7-.6-3.5-1.5M3 5v3h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, letterSpacing: -0.1 }}>Восстановить по фразе</div>
              <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--sm-ink-mute)', marginTop: 1 }}>введите 24 слова</div>
            </div>
            <span style={{ color: 'var(--sm-ink-faint)', display: 'flex' }}>{Icon.chevronR(12)}</span>
          </button>

          {/* QR */}
          <button style={{
            padding: '11px 14px', borderRadius: 12,
            background: 'transparent', color: 'var(--sm-ink)',
            border: '0.5px solid var(--sm-rule)',
            display: 'flex', alignItems: 'center', gap: 10,
            fontFamily: SYS_FONT, fontWeight: 500, fontSize: 13.5, cursor: 'pointer',
            textAlign: 'left',
          }}>
            <span style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'rgba(196,148,60,0.10)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--sm-accent-deep)', flexShrink: 0,
            }}>{Icon.qr(16)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, letterSpacing: -0.1 }}>Войти по QR-коду</div>
              <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--sm-ink-mute)', marginTop: 1 }}>откройте sun в браузере и отсканируйте</div>
            </div>
            <span style={{ color: 'var(--sm-ink-faint)', display: 'flex' }}>{Icon.chevronR(12)}</span>
          </button>

          {/* Footer note */}
          <div style={{ marginTop: 'auto', textAlign: 'center', paddingTop: 14 }}>
            <p style={{
              fontSize: 10.5, color: 'var(--sm-ink-faint)', margin: 0, lineHeight: 1.5,
              letterSpacing: 0.05,
            }}>
              продолжая, вы принимаете
              <br /><span style={{ color: 'var(--sm-accent-deep)', fontWeight: 600 }}>условия использования</span> и <span style={{ color: 'var(--sm-accent-deep)', fontWeight: 600 }}>политику</span>
            </p>
          </div>
        </div>

      </div>
    </SmDevice>
  );
}

function SegTab({ label, active }) {
  return (
    <button style={{
      flex: 1, padding: '7px 10px', borderRadius: 8,
      background: active ? 'var(--sm-paper)' : 'transparent',
      border: 'none',
      boxShadow: active ? '0 1px 2px rgba(20,16,8,0.08)' : 'none',
      color: active ? 'var(--sm-ink)' : 'var(--sm-ink-mute)',
      fontFamily: SYS_FONT, fontWeight: active ? 600 : 500, fontSize: 13,
      letterSpacing: -0.1, cursor: 'pointer',
    }}>{label}</button>
  );
}

function Field({ label, value, trailing }) {
  return (
    <div style={{
      padding: '7px 12px', borderRadius: 10,
      background: 'rgba(217,210,191,0.20)',
      border: '0.5px solid var(--sm-rule)',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
        color: 'var(--sm-ink-faint)', marginBottom: 1,
      }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: 'var(--sm-ink)', letterSpacing: -0.2 }}>{value}</span>
        {trailing && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--sm-accent-deep)', letterSpacing: 0.4 }}>{trailing}</span>
        )}
      </div>
    </div>
  );
}

window.LoginScreen = LoginScreen;
