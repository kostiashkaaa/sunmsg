// chat-view.jsx — Screen 2: Открытый чат
// Mirrors web chat-area: warm parchment header, bubble track, composer.

function ChatViewScreen({ dark = false }) {
  const messages = [
    { type: 'date', text: 'Сегодня' },
    { type: 'in',  text: 'Привет — посмотрел черновик обложки с вчерашнего?', time: '9:14' },
    { type: 'in',  text: 'Кажется, тёплый тон наконец сложился.', time: '9:14' },
    { type: 'out', text: 'Только что открыл. Типографика выглядит спокойнее — соглашусь насчёт теплоты.', time: '9:18' },
    { type: 'out', text: 'Одна мелочь: дата-чип чуть-чуть поменьше.', time: '9:18', read: true },
    { type: 'in',  text: 'Принято. Уменьшу до 12pt и поджму интерлиньяж.', time: '9:24' },
    { type: 'in',  text: 'Скину v3 через пару минут — хочу проверить на кремовой бумаге.', time: '9:24' },
    { type: 'out', text: 'Хорошо. Не торопись — я в студии до 18:00.', time: '9:31', read: true },
    { type: 'in',  text: 'Черновик обложки готов — посмотришь?', time: '9:32', tail: true },
    { type: 'typing' },
  ];

  return (
    <SmDevice dark={dark} bg="var(--sm-chat-bg)">
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        background: 'var(--sm-chat-bg)', position: 'relative',
        fontFamily: SYS_FONT,
      }}>
        <ChatHeader />

        <div style={{
          flex: 1, overflow: 'hidden', padding: '6px 14px 8px',
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          {messages.map((m, i) => {
            if (m.type === 'date') return <DateChip key={i} text={m.text} />;
            if (m.type === 'typing') return <TypingBubble key={i} />;
            return (
              <Bubble
                key={i}
                side={m.type}
                text={m.text}
                time={m.time}
                read={m.read}
                tail={m.tail || (i + 1 < messages.length && messages[i+1].type !== m.type)}
              />
            );
          })}
        </div>

        <Composer />
      </div>
    </SmDevice>
  );
}

function ChatHeader() {
  return (
    <div style={{
      paddingTop: 54, paddingBottom: 9,
      borderBottom: '0.5px solid var(--sm-rule)',
      background: 'var(--sm-chat-hdr)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      paddingLeft: 6, paddingRight: 12, gap: 6,
    }}>
      <button style={{ ...hdrBtn, color: 'var(--sm-accent-deep)' }}>
        {Icon.chevronL(22)}
      </button>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
        <Avatar name="Мира Альбрехт" size={34} online={true} />
        <div style={{ minWidth: 0, lineHeight: 1.15 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--sm-ink)', letterSpacing: -0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Мира Альбрехт
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--sm-online)', marginTop: 1, letterSpacing: -0.05, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
            в сети
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        <button style={{ ...hdrBtn, color: 'var(--sm-accent-deep)' }}>{Icon.phone(20)}</button>
        <button style={{ ...hdrBtn, color: 'var(--sm-accent-deep)' }}>{Icon.video(20)}</button>
      </div>
    </div>
  );
}

const hdrBtn = {
  width: 34, height: 34, borderRadius: 999, border: 'none', background: 'transparent',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer',
};

function DateChip({ text }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0 6px' }}>
      <span style={{
        padding: '4px 10px', borderRadius: 999,
        background: 'rgba(196,148,60,0.10)',
        color: 'var(--sm-accent-deep)',
        border: '0.5px solid rgba(196,148,60,0.18)',
        fontSize: 11, fontWeight: 600, letterSpacing: 0.2,
      }}>{text}</span>
    </div>
  );
}

function Bubble({ side, text, time, read, tail }) {
  const isOut = side === 'out';
  return (
    <div style={{
      display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start',
      marginTop: 1, paddingLeft: isOut ? 44 : 0, paddingRight: isOut ? 0 : 44,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: isOut ? 'flex-end' : 'flex-start', gap: 2 }}>
        <div style={{
          padding: '7px 12px 8px',
          borderRadius: 18,
          borderBottomRightRadius: isOut && tail ? 6 : 18,
          borderBottomLeftRadius: !isOut && tail ? 6 : 18,
          background: isOut ? 'var(--sm-bubble-out)' : 'var(--sm-bubble-in)',
          color: isOut ? 'var(--sm-bubble-out-text)' : 'var(--sm-bubble-in-text)',
          fontSize: 14.5, lineHeight: 1.35, letterSpacing: -0.15,
          maxWidth: '78%',
          border: isOut ? 'none' : '0.5px solid var(--sm-rule-soft)',
          boxShadow: isOut
            ? '0 1px 3px rgba(0,0,0,0.14)'
            : '0 1px 2px rgba(20,16,8,0.06)',
          fontFamily: SYS_FONT,
        }}>{text}</div>
        {tail && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 3,
            padding: '0 4px', fontSize: 10.5, fontWeight: 500,
            color: 'var(--sm-ink-faint)', fontVariantNumeric: 'tabular-nums',
          }}>
            <span>{time}</span>
            {isOut && read && (
              <span style={{ color: 'var(--sm-read-tick)', display: 'flex' }}>{Icon.doubleCheck(13)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div style={{ display: 'flex', marginTop: 4 }}>
      <div style={{
        padding: '10px 14px', borderRadius: 18, borderBottomLeftRadius: 6,
        background: 'var(--sm-bubble-in)',
        border: '0.5px solid var(--sm-rule-soft)',
        display: 'flex', gap: 4, alignItems: 'center',
      }}>
        {[0,1,2].map(i => (
          <span key={i} style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--sm-ink-faint)',
            animation: `smPulse 1.2s ${i * 0.18}s infinite ease-in-out`,
          }} />
        ))}
      </div>
      <style>{`@keyframes smPulse { 0%,80%,100%{opacity:.3;transform:translateY(0)} 40%{opacity:1;transform:translateY(-2px)} }`}</style>
    </div>
  );
}

function Composer() {
  return (
    <div style={{
      padding: '6px 10px 30px',
      background: 'var(--sm-chat-hdr)',
      borderTop: '0.5px solid var(--sm-rule-soft)',
      display: 'flex', alignItems: 'flex-end', gap: 6,
    }}>
      <button style={{
        width: 34, height: 34, borderRadius: '50%',
        background: 'transparent', border: 'none',
        color: 'var(--sm-accent-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, padding: 0, cursor: 'pointer',
      }}>{Icon.plus(22)}</button>

      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 6,
        padding: '7px 8px 7px 12px', borderRadius: 18,
        background: 'var(--sm-input-bg)',
        border: '0.5px solid var(--sm-rule)',
        boxShadow: '0 0 0 3px var(--sm-accent-glow)',
      }}>
        <span style={{
          flex: 1, color: 'var(--sm-ink-faint)', fontSize: 14, fontWeight: 400, letterSpacing: -0.1,
          fontFamily: SYS_FONT,
        }}>Сообщение…</span>
        <button style={{ ...hdrBtn, color: 'var(--sm-ink-mute)', width: 28, height: 28 }}>{Icon.smile(20)}</button>
        <button style={{ ...hdrBtn, color: 'var(--sm-ink-mute)', width: 28, height: 28 }}>{Icon.paperclip(20)}</button>
      </div>

      <button style={{
        width: 34, height: 34, borderRadius: '50%',
        background: 'var(--sm-ink)', border: 'none',
        color: 'var(--sm-text-inv)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, padding: 0, cursor: 'pointer',
        boxShadow: '0 1px 3px rgba(20,16,8,0.18)',
      }}>{Icon.mic(18)}</button>
    </div>
  );
}

window.ChatViewScreen = ChatViewScreen;
window.Bubble = Bubble;
