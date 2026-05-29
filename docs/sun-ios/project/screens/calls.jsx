// calls.jsx — Calls list (Recents) + Active call

function CallsListScreen({ dark = false }) {
  const calls = [
    { name: 'Мира Альбрехт',   type: 'video', dir: 'in',  missed: false, when: 'сегодня, 09:14', dur: '12:03', online: true },
    { name: 'Тёма Парк',       type: 'audio', dir: 'out', missed: false, when: 'сегодня, 08:40', dur: '04:21', online: true },
    { name: 'Рене Аоки',       type: 'audio', dir: 'in',  missed: true,  when: 'вчера, 22:08',   dur: null },
    { name: 'Студия · Группа', type: 'video', dir: 'in',  missed: false, when: 'вчера, 17:55',   dur: '38:12', group: true },
    { name: 'Лян Чен',         type: 'audio', dir: 'out', missed: false, when: 'вчера, 12:30',   dur: '01:47' },
    { name: 'Отец',            type: 'audio', dir: 'in',  missed: true,  when: 'пн, 19:11',      dur: null },
    { name: 'Ирис Х.',         type: 'video', dir: 'out', missed: false, when: 'пн, 15:02',      dur: '22:40' },
    { name: 'Бронь · Casa Lume', type: 'audio', dir: 'in', missed: false, when: 'вс, 11:05',     dur: '00:38' },
  ];

  return (
    <SmDevice dark={dark}>
      <div style={{
        height: '100%', width: '100%',
        background: 'var(--sm-sidebar-bg)',
        display: 'flex', flexDirection: 'column',
        paddingTop: 56, fontFamily: SYS_FONT,
      }} className="paper">

        {/* Nav header */}
        <NavHeader title="Звонки" trailing={
          <button style={iconHdrBtn}><span style={{ color: 'var(--sm-accent-deep)' }}>{Icon.plus(22)}</span></button>
        } />

        {/* Segmented control: Все / Пропущенные */}
        <div style={{ padding: '6px 16px 10px' }}>
          <div style={{
            display: 'flex', padding: 3, borderRadius: 10,
            background: 'rgba(217,210,191,0.30)',
          }}>
            <SegTabSmall label="Все" active />
            <SegTabSmall label="Пропущенные" count={2} />
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflow: 'hidden', padding: '0 4px' }}>
          {calls.map((c, i) => <CallRow key={i} c={c} />)}
        </div>

        <TabBar active="calls" />
      </div>
    </SmDevice>
  );
}

function NavHeader({ title, leading, trailing, sub }) {
  return (
    <div style={{
      padding: '4px 12px 10px',
      borderBottom: '0.5px solid var(--sm-rule-soft)',
      background: 'var(--sm-sidebar-bg)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        minHeight: 36,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
          {leading}
          <h1 style={{
            margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: -0.6,
            color: 'var(--sm-ink)', fontFamily: SYS_FONT,
          }}>{title}</h1>
        </div>
        {trailing}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: 'var(--sm-ink-mute)', marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

const iconHdrBtn = {
  width: 36, height: 36, borderRadius: 999, border: 'none', background: 'transparent',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer',
};

function SegTabSmall({ label, active, count }) {
  return (
    <button style={{
      flex: 1, padding: '6px 10px', borderRadius: 8,
      background: active ? 'var(--sm-paper)' : 'transparent',
      border: 'none',
      boxShadow: active ? '0 1px 2px rgba(20,16,8,0.08)' : 'none',
      color: active ? 'var(--sm-ink)' : 'var(--sm-ink-mute)',
      fontFamily: SYS_FONT, fontWeight: active ? 600 : 500, fontSize: 13,
      letterSpacing: -0.1, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    }}>
      {label}
      {count != null && count > 0 && (
        <span style={{
          minWidth: 16, height: 16, padding: '0 5px', borderRadius: 999,
          fontSize: 10, fontWeight: 700,
          background: 'var(--sm-accent)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{count}</span>
      )}
    </button>
  );
}

function CallRow({ c }) {
  const isVideo = c.type === 'video';
  const isMissed = c.missed;
  const isOut = c.dir === 'out';
  const labelColor = isMissed ? 'var(--sm-danger, #dc2626)' : 'var(--sm-ink-mute)';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 12px',
    }}>
      <Avatar name={c.name} size={40} online={c.online} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 15, fontWeight: 600, color: isMissed ? '#c14242' : 'var(--sm-ink)',
          letterSpacing: -0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{c.name}</div>
        <div style={{
          fontSize: 12, color: labelColor, marginTop: 1,
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          {/* call arrow */}
          <CallArrow dir={c.dir} missed={isMissed} />
          <span>{isMissed ? 'Пропущенный' : (isOut ? 'Исходящий' : 'Входящий')} · {c.when}</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <button style={{
          width: 32, height: 32, borderRadius: 999, border: 'none',
          background: 'rgba(196,148,60,0.10)',
          color: 'var(--sm-accent-deep)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, cursor: 'pointer',
        }}>{isVideo ? Icon.video(18) : Icon.phone(16)}</button>
        {c.dur && (
          <span style={{
            fontSize: 10.5, color: 'var(--sm-ink-faint)', fontVariantNumeric: 'tabular-nums',
          }}>{c.dur}</span>
        )}
      </div>
    </div>
  );
}

function CallArrow({ dir, missed }) {
  const color = missed ? '#c14242' : (dir === 'out' ? 'var(--sm-online)' : 'var(--sm-ink-faint)');
  // Up-right for out, down-left for in
  const path = dir === 'out'
    ? 'M3 9L9 3M9 3H4M9 3V8'
    : 'M9 3L3 9M3 9H8M3 9V4';
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color }}>
      <path d={path} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// In-call screen: warm amber gradient backdrop, contact avatar, controls.
function InCallScreen({ dark = false }) {
  return (
    <SmDevice dark={dark}>
      <div style={{
        height: '100%', width: '100%',
        background: dark
          ? 'radial-gradient(ellipse 600px 800px at 50% 35%, #4a361a 0%, #1c1a14 70%)'
          : 'radial-gradient(ellipse 600px 800px at 50% 35%, #e6c481 0%, #c4943c 50%, #8a6225 100%)',
        display: 'flex', flexDirection: 'column',
        paddingTop: 60, color: '#fbf8f1', position: 'relative',
        fontFamily: SYS_FONT,
      }}>
        {/* Top meta */}
        <div style={{ padding: '6px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 999,
            background: 'rgba(20,16,8,0.20)',
            backdropFilter: 'blur(12px)',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: 'oklch(72% 0.14 155)',
              boxShadow: '0 0 6px currentColor',
            }} />
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase' }}>зашифровано</span>
          </div>
          <span style={{
            fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
            background: 'rgba(20,16,8,0.20)', padding: '4px 10px', borderRadius: 999,
            backdropFilter: 'blur(12px)',
          }}>12:03</span>
        </div>

        {/* Identity */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          paddingBottom: 80,
        }}>
          <div style={{
            width: 132, height: 132, borderRadius: '50%',
            background: 'linear-gradient(145deg, oklch(82% 0.10 70), oklch(60% 0.14 50))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#15140e', fontSize: 48, fontWeight: 700, letterSpacing: -1,
            boxShadow: '0 18px 40px rgba(0,0,0,0.30), 0 0 0 6px rgba(251,248,241,0.10)',
            marginBottom: 22,
          }}>МА</div>
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.6 }}>Мира Альбрехт</div>
          <div style={{
            fontSize: 13.5, marginTop: 4, opacity: 0.85,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ display: 'flex' }}>{Icon.video(15)}</span>
            видеозвонок · WiFi
          </div>
          <div style={{
            marginTop: 16, fontFamily: 'Instrument Serif, Georgia, serif', fontStyle: 'italic',
            fontSize: 14, opacity: 0.75,
          }}>«сейчас покажу обложку»</div>
        </div>

        {/* Controls */}
        <div style={{
          padding: '14px 28px 36px',
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, justifyItems: 'center',
        }}>
          <CallBtn icon="mute" label="Микрофон" />
          <CallBtn icon="speaker" label="Динамик" active />
          <CallBtn icon="camOff" label="Камера" />
          <CallBtn icon="flip" label="Перевернуть" />
        </div>

        <div style={{ padding: '0 28px 38px', display: 'flex', justifyContent: 'center' }}>
          <button style={{
            width: 64, height: 64, borderRadius: '50%',
            background: '#c14242', border: 'none',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 10px 24px rgba(193,66,66,0.40)',
            cursor: 'pointer',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M22 16v2.5c0 1.4-1.1 2.5-2.5 2.5h-2c-1.2 0-2.2-.8-2.5-2L14 16c-.3-1.3-1.4-2.2-2.7-2.2h-2.6c-1.3 0-2.4.9-2.7 2.2l-.6 3c-.3 1.2-1.3 2-2.5 2h-2C-.4 21-1 19.9-1 18.5V16C-1 9.4 4.4 4 11 4s11 5.4 11 12z"
                transform="rotate(135 11 12)" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>
    </SmDevice>
  );
}

function CallBtn({ icon, label, active }) {
  const glyphs = {
    mute: <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="8" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.6"/><path d="M4.5 11c0 3.6 2.9 6.5 6.5 6.5s6.5-2.9 6.5-6.5M11 17.5v3M3 3l16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
    speaker: <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M3 8v6h3l4 4V4L6 8H3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M14 8c1 .8 1.5 1.8 1.5 3s-.5 2.2-1.5 3M17 5.5c2 1.4 3 3.4 3 5.5s-1 4.1-3 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
    camOff: <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="6" width="13" height="10" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M15 9l5-3v10l-5-3M3 3l16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    flip: <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M4 9V7c0-1.7 1.3-3 3-3h8c1.7 0 3 1.3 3 3v2M18 13v2c0 1.7-1.3 3-3 3H7c-1.7 0-3-1.3-3-3v-2M2 9l2 2 2-2M16 13l2 2 2-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <button style={{
        width: 56, height: 56, borderRadius: '50%',
        background: active ? '#fbf8f1' : 'rgba(20,16,8,0.30)',
        backdropFilter: 'blur(12px)',
        border: '0.5px solid rgba(251,248,241,0.20)',
        color: active ? '#15140e' : '#fbf8f1',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
      }}>{glyphs[icon]}</button>
      <span style={{ fontSize: 11, fontWeight: 500, color: '#fbf8f1', opacity: 0.85, letterSpacing: -0.05 }}>{label}</span>
    </div>
  );
}

Object.assign(window, { CallsListScreen, InCallScreen, NavHeader, iconHdrBtn });
