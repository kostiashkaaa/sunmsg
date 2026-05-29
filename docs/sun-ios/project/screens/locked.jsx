// locked.jsx — E2E locked state + 24-word mnemonic unlock
// Matches web flow: e2eLockAlert from _sidebar.html + 24-word recovery.

function LockedChatsScreen({ dark = false }) {
  const conversations = [
    { name: 'Мира Альбрехт', time: '9:32', unread: 2, online: true },
    { name: 'Студия · Группа', time: '9:14', unread: 4, group: true },
    { name: 'Тёма Парк', time: '8:47', online: true },
    { name: 'Рене Аоки', time: '8:21', online: true },
    { name: 'Отец', time: 'Вчера' },
    { name: 'Лян Чен', time: 'Вчера', unread: 1 },
    { name: 'Sun Editorial', time: 'Вт', group: true },
    { name: 'Ирис Х.', time: 'Пн' },
    { name: 'Бронь · Casa Lume', time: 'Вс' },
  ];
  return (
    <SmDevice dark={dark}>
      <div style={{
        height: '100%', width: '100%',
        background: 'var(--sm-sidebar-bg)',
        display: 'flex', flexDirection: 'column',
        paddingTop: 56, fontFamily: SYS_FONT,
        position: 'relative',
      }} className="paper">

        {/* Sidebar top card — disabled-ish */}
        <div style={{ padding: '6px 12px 8px' }}>
          <div style={{
            background: 'var(--sm-paper)',
            border: '0.5px solid var(--sm-rule)',
            borderRadius: 14,
            padding: '8px 8px 8px 12px',
            opacity: 0.7,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingRight: 4 }}>
                <SunMark size={18} />
                <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: -0.4, color: 'var(--sm-ink)' }}>sun</span>
              </div>
              <div style={{ width: 1, height: 18, background: 'var(--sm-rule)' }} />
              <div style={{
                flex: 1, display: 'flex', alignItems: 'center', gap: 7,
                padding: '6px 10px', borderRadius: 10,
                background: 'rgba(217,210,191,0.30)',
              }}>
                <span style={{ color: 'var(--sm-ink-faint)', display: 'flex' }}>{Icon.search(14)}</span>
                <span style={{ color: 'var(--sm-ink-faint)', fontSize: 14, fontWeight: 400 }}>Поиск недоступен</span>
              </div>
            </div>
          </div>
        </div>

        {/* Prominent lock banner */}
        <div style={{ padding: '0 12px 10px' }}>
          <button style={{
            display: 'flex', width: '100%', alignItems: 'center', gap: 12,
            padding: '12px 12px', borderRadius: 14,
            background: 'var(--sm-req-bg)',
            border: '0.5px solid var(--sm-req-border)',
            color: 'var(--sm-ink)',
            textAlign: 'left', cursor: 'pointer',
            boxShadow: '0 4px 14px -8px rgba(196,148,60,0.40), inset 0 0 0 1px rgba(196,148,60,0.06)',
          }}>
            <span style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'rgba(196,148,60,0.18)',
              color: 'var(--sm-accent-deep)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M4 9V6.5C4 4 6 2 8.5 2h3C14 2 16 4 16 6.5V9M5 9h10c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H5c-.6 0-1-.4-1-1v-6c0-.6.4-1 1-1zM3 3l14 14"
                  stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: -0.15, lineHeight: 1.25 }}>
                История заблокирована
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--sm-ink-mute)', marginTop: 2, lineHeight: 1.35 }}>
                Введите 24 слова, чтобы расшифровать сообщения на этом устройстве
              </div>
            </div>
            <span style={{ color: 'var(--sm-accent-deep)', display: 'flex' }}>{Icon.chevronR(14)}</span>
          </button>
        </div>

        {/* Blurred / locked list */}
        <div style={{
          flex: 1, overflow: 'hidden', padding: '0 4px',
          position: 'relative',
        }}>
          <div style={{ filter: 'blur(0.4px)' }}>
            {conversations.map((c, i) => (
              <LockedRow key={i} c={c} />
            ))}
          </div>
          {/* Fade-out at bottom */}
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: 80,
            background: 'linear-gradient(to bottom, transparent, var(--sm-sidebar-bg))',
            pointerEvents: 'none',
          }} />
        </div>

        {/* Bottom profile card — shows desync */}
        <DesyncedProfileCard />

        <TabBar active="chats" />
      </div>
    </SmDevice>
  );
}

function LockedRow({ c }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '9px 12px',
    }}>
      <Avatar name={c.name} size={40} online={c.online} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{
            fontWeight: 600, fontSize: 15,
            color: 'var(--sm-ink)', letterSpacing: -0.2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{c.name}</span>
          <span style={{
            fontSize: 11.5, fontWeight: 400,
            color: 'var(--sm-ink-faint)',
            flexShrink: 0, fontVariantNumeric: 'tabular-nums',
          }}>{c.time}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
          <span style={{ color: 'var(--sm-ink-faint)', display: 'flex', flexShrink: 0 }}>
            {Icon.lock(11)}
          </span>
          <span style={{
            fontSize: 13, fontWeight: 400,
            color: 'var(--sm-ink-faint)',
            fontStyle: 'italic', letterSpacing: -0.1,
            flex: 1,
          }}>Зашифрованное сообщение</span>
          {c.unread > 0 && (
            <span style={{
              minWidth: 20, height: 20, padding: '0 7px', borderRadius: 999,
              background: 'rgba(20,16,8,0.10)', color: 'var(--sm-ink-faint)',
              fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>{c.unread}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function DesyncedProfileCard() {
  return (
    <div style={{ padding: '8px 12px 6px' }}>
      <div style={{
        background: 'var(--sm-paper)',
        border: '0.5px solid var(--sm-rule)',
        borderRadius: 14, overflow: 'hidden',
        boxShadow: 'var(--sm-shadow-xs)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px',
        }}>
          <Avatar name="Юлия Сун" size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 14, fontWeight: 600, letterSpacing: -0.2, color: 'var(--sm-ink)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>Юлия Сун</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
              <span style={{ fontSize: 12, color: 'var(--sm-accent-deep)', fontWeight: 500 }}>@yulia</span>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '2px 7px', borderRadius: 999,
                background: 'rgba(193,66,66,0.10)',
                border: '0.5px solid rgba(193,66,66,0.22)',
                color: '#c14242',
                fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
                НЕ СИНХ
              </span>
            </div>
          </div>
          <span style={{ color: 'var(--sm-ink-faint)', display: 'flex' }}>{Icon.chevronR(12)}</span>
        </div>
      </div>
    </div>
  );
}

// 24-word mnemonic unlock — full screen
function MnemonicUnlockScreen({ dark = false }) {
  // 24 words slot state — some filled (typed by user), rest empty.
  const filledWords = [
    'crystal','paper','warm','garden','silent','river',
    'amber','linen','silk','candle','willow','folio',
    // 6 remaining empty (current focus = slot 13)
  ];
  const totalSlots = 24;
  const currentSlot = filledWords.length; // 0-indexed
  const suggestions = ['quill', 'quilt', 'quiet', 'quote'];

  return (
    <SmDevice dark={dark}>
      <div style={{
        height: '100%', width: '100%',
        background: 'var(--sm-bg)',
        display: 'flex', flexDirection: 'column',
        paddingTop: 56, fontFamily: SYS_FONT,
        position: 'relative', overflow: 'hidden',
      }} className="paper">

        {/* Warm wash */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 240,
          background: 'radial-gradient(ellipse 400px 240px at 50% 0%, rgba(196,148,60,0.16), transparent 70%)',
          pointerEvents: 'none',
        }} />

        {/* Modal header */}
        <div style={{
          padding: '6px 12px 4px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <button style={{
            ...iconHdrBtn, width: 'auto', padding: '0 8px',
            color: 'var(--sm-ink-mute)', fontSize: 15, fontWeight: 500,
          }}>Отмена</button>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
            color: 'var(--sm-ink-mute)',
          }}>{currentSlot} / {totalSlots}</span>
          <button style={{
            ...iconHdrBtn, width: 'auto', padding: '0 8px',
            color: 'var(--sm-ink-faint)', fontSize: 15, fontWeight: 500,
          }}>?</button>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', padding: '8px 18px 0', position: 'relative', zIndex: 1 }}>
          {/* Hero */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 14 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: 'rgba(196,148,60,0.14)',
              border: '0.5px solid rgba(196,148,60,0.30)',
              color: 'var(--sm-accent-deep)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path d="M6 13V9.5C6 5.9 9.6 3 14 3s8 2.9 8 6.5V13M7 13h14c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5H7c-.8 0-1.5-.7-1.5-1.5v-9C5.5 13.7 6.2 13 7 13z"
                  stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                <circle cx="14" cy="18.5" r="1.5" fill="currentColor" />
                <path d="M14 20v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </div>
            <h1 style={{
              margin: '14px 0 4px', fontSize: 22, fontWeight: 700, letterSpacing: -0.6,
              color: 'var(--sm-ink)',
            }}>Введите 24 слова</h1>
            <p style={{
              margin: 0, fontFamily: 'Instrument Serif, Georgia, serif', fontStyle: 'italic',
              fontSize: 15, color: 'var(--sm-ink-mute)', letterSpacing: 0.1, lineHeight: 1.35,
              maxWidth: 280,
            }}>восстановите доступ к зашифрованным сообщениям на этом устройстве</p>
          </div>

          {/* Word grid */}
          <div style={{
            background: 'var(--sm-paper)',
            border: '0.5px solid var(--sm-rule)',
            borderRadius: 14, padding: 10,
            boxShadow: 'var(--sm-shadow-xs)',
            display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 6,
          }}>
            {Array.from({ length: totalSlots }, (_, i) => {
              const word = filledWords[i];
              const isCurrent = i === currentSlot;
              return (
                <WordSlot
                  key={i}
                  index={i + 1}
                  word={word}
                  current={isCurrent}
                />
              );
            })}
          </div>

          {/* Helper */}
          <div style={{
            marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            fontSize: 11.5, color: 'var(--sm-ink-mute)',
          }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--sm-accent-deep)' }}>
              <rect x="2.5" y="2.5" width="4" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              <rect x="4.5" y="4" width="5" height="5.5" rx="1" fill="var(--sm-paper)" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
            <span>Вставить все слова из буфера</span>
          </div>
        </div>

        {/* Suggestions + CTA on top of "keyboard" stub */}
        <div style={{
          padding: '8px 12px 0', position: 'relative', zIndex: 1,
        }}>
          <div style={{
            display: 'flex', gap: 6, marginBottom: 8, overflow: 'hidden',
          }}>
            {suggestions.map((s, i) => (
              <button key={s} style={{
                flex: 1, padding: '8px 6px', borderRadius: 10,
                background: i === 0 ? 'var(--sm-paper)' : 'transparent',
                border: '0.5px solid var(--sm-rule)',
                fontFamily: 'ui-monospace, monospace',
                fontSize: 13.5, fontWeight: i === 0 ? 700 : 500,
                color: i === 0 ? 'var(--sm-ink)' : 'var(--sm-ink-mute)',
                letterSpacing: 0.4,
                cursor: 'pointer',
                boxShadow: i === 0 ? '0 1px 2px rgba(20,16,8,0.06)' : 'none',
              }}>{s}</button>
            ))}
          </div>

          <button style={{
            width: '100%', padding: '13px 20px', borderRadius: 12,
            background: 'var(--sm-ink)', color: 'var(--sm-text-inv)',
            border: 'none', fontFamily: SYS_FONT, fontWeight: 600, fontSize: 15,
            letterSpacing: -0.2, cursor: 'pointer',
            opacity: 0.55,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <span style={{ display: 'flex' }}>{Icon.lock(13)}</span>
            Разблокировать · нужно ещё {totalSlots - currentSlot}
          </button>

          <div style={{
            margin: '8px 0 6px', textAlign: 'center',
            fontSize: 11, color: 'var(--sm-ink-faint)', lineHeight: 1.45,
          }}>
            ключи никогда не покидают устройство · <strong style={{ color: 'var(--sm-accent-deep)', fontWeight: 700 }}>sun</strong> не имеет доступа к вашей фразе
          </div>
        </div>

        {/* Faux keyboard sliver */}
        <div style={{
          height: 38,
          background: 'linear-gradient(to bottom, var(--sm-paper-alt), transparent)',
          borderTop: '0.5px solid var(--sm-rule-soft)',
        }} />
      </div>
    </SmDevice>
  );
}

function WordSlot({ index, word, current }) {
  const empty = !word;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '8px 10px', borderRadius: 10,
      background: current
        ? 'var(--sm-bg)'
        : (empty ? 'transparent' : 'rgba(217,210,191,0.18)'),
      border: current
        ? '0.5px solid var(--sm-accent)'
        : (empty ? '0.5px dashed var(--sm-rule)' : '0.5px solid var(--sm-rule-soft)'),
      boxShadow: current ? '0 0 0 3px var(--sm-accent-glow)' : 'none',
      minHeight: 32,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700,
        color: current ? 'var(--sm-accent-deep)' : 'var(--sm-ink-faint)',
        fontVariantNumeric: 'tabular-nums',
        minWidth: 14,
        fontFamily: 'ui-monospace, monospace',
      }}>{String(index).padStart(2, '0')}</span>
      {empty && !current && <span style={{ flex: 1 }} />}
      {empty && current && (
        <>
          <span style={{
            fontFamily: 'ui-monospace, monospace', fontSize: 13, color: 'var(--sm-ink)',
          }}>qui</span>
          <span style={{
            width: 1, height: 12, background: 'var(--sm-accent)',
            animation: 'smCursor 1s steps(2) infinite',
          }} />
          <style>{`@keyframes smCursor { 0%,50%{opacity:1} 51%,100%{opacity:0} }`}</style>
          <span style={{ flex: 1 }} />
        </>
      )}
      {!empty && (
        <span style={{
          fontFamily: 'ui-monospace, monospace', fontSize: 13, color: 'var(--sm-ink)',
          fontWeight: 500, flex: 1, letterSpacing: 0.1,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{word}</span>
      )}
      {!empty && (
        <span style={{ color: 'var(--sm-online)', display: 'flex' }}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M2 5.5l2.5 2.5L9 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      )}
    </div>
  );
}

Object.assign(window, { LockedChatsScreen, MnemonicUnlockScreen });
