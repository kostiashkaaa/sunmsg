// primitives.jsx — shared building blocks for Sunmsg iOS
// System fonts (SF Pro), warm parchment palette per tokens.css.

const SCREEN_W = 393;
const SCREEN_H = 852;

const SYS_FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif";

// Bootstrap-icons-style glyphs in stroke; tinted via currentColor
const Icon = {
  search: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 11l3.2 3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  pencil: (s = 22) => (
    <svg width={s} height={s} viewBox="0 0 22 22" fill="none">
      <path d="M14.2 3.6l4.2 4.2L8 18.2 3.8 19l.8-4.2L14.2 3.6z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M13 4.8l4.2 4.2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  chevronL: (s = 18) => (
    <svg width={s} height={s} viewBox="0 0 18 18" fill="none">
      <path d="M11.5 3.5L5 9l6.5 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chevronR: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none">
      <path d="M5 2.5L10 7l-5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  video: (s = 22) => (
    <svg width={s} height={s} viewBox="0 0 22 16" fill="none">
      <rect x="1" y="2" width="14" height="12" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M15 6l6-3v10l-6-3V6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  phone: (s = 20) => (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
      <path d="M3.5 4.5c0-1 .8-1.8 1.8-1.8h1.3c.7 0 1.3.5 1.5 1.2l.7 2.5c.2.6 0 1.3-.5 1.7l-.9.7c1 2 2.6 3.6 4.6 4.6l.7-.9c.4-.5 1.1-.7 1.7-.5l2.5.7c.7.2 1.2.8 1.2 1.5v1.3c0 1-.8 1.8-1.8 1.8C8 17.3 2.7 12 2.5 5.3v-.8z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  plus: (s = 22) => (
    <svg width={s} height={s} viewBox="0 0 22 22" fill="none">
      <path d="M11 4.5v13M4.5 11h13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  mic: (s = 22) => (
    <svg width={s} height={s} viewBox="0 0 22 22" fill="none">
      <rect x="8" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.5 11c0 3.6 2.9 6.5 6.5 6.5s6.5-2.9 6.5-6.5M11 17.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  arrowUp: (s = 18) => (
    <svg width={s} height={s} viewBox="0 0 18 18" fill="none">
      <path d="M9 14.5V3.5M3.5 9L9 3.5l5.5 5.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  paperclip: (s = 22) => (
    <svg width={s} height={s} viewBox="0 0 22 22" fill="none">
      <path d="M15.5 9.5l-6 6c-1.7 1.7-4.3 1.7-6 0s-1.7-4.3 0-6L10 4c1.1-1.1 3-1.1 4.2 0s1.1 3 0 4.2L8 14.4c-.6.6-1.5.6-2.1 0s-.6-1.5 0-2.1L11 7"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  smile: (s = 22) => (
    <svg width={s} height={s} viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="9" r="0.9" fill="currentColor" />
      <circle cx="14" cy="9" r="0.9" fill="currentColor" />
      <path d="M7.5 13c.8 1.4 2 2.1 3.5 2.1s2.7-.7 3.5-2.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  lock: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
      <rect x="2.5" y="5.5" width="7" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 5.5V4a2 2 0 014 0v1.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  check: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
      <path d="M2 6.5l2.5 2.5L10 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  doubleCheck: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 12" fill="none">
      <path d="M1 6l3 3 5.5-6M6 9l3 0M14 3l-4.5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  qr: (s = 22) => (
    <svg width={s} height={s} viewBox="0 0 22 22" fill="none">
      <rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="2.5" width="6.5" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2.5" y="13" width="6.5" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5" y="5" width="1.5" height="1.5" fill="currentColor" />
      <rect x="15.5" y="5" width="1.5" height="1.5" fill="currentColor" />
      <rect x="5" y="15.5" width="1.5" height="1.5" fill="currentColor" />
      <path d="M13 13h2v2M19 13v2M13 17v2.5M16 16.5h.5M19 18v1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  moon: (s = 18) => (
    <svg width={s} height={s} viewBox="0 0 18 18" fill="none">
      <path d="M14.5 11C13 13.5 10.3 15 7.5 14.5 4.2 13.9 2 11 2 7.5 2 4.5 4 1.9 6.7 1c-.6 1-.9 2.2-.9 3.5 0 3.8 3 6.8 6.8 6.8.7 0 1.4-.1 1.9-.3z"
        stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M13 3.5l.5 1.5L15 5.5l-1.5.5L13 7.5l-.5-1.5L11 5.5l1.5-.5z" fill="currentColor"/>
    </svg>
  ),
};

// Sunmsg-tinted status bar (replaces default which uses SF Pro)
function SmStatusBar({ dark = false, time = '9:41' }) {
  const c = dark ? 'var(--sm-ink)' : '#15140e';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '21px 28px 17px', boxSizing: 'border-box',
      position: 'relative', zIndex: 20, width: '100%', gap: 154,
    }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{
          fontFamily: SYS_FONT, fontWeight: 600,
          fontSize: 17, lineHeight: '22px', color: c, letterSpacing: -0.2,
          fontVariantNumeric: 'tabular-nums',
        }}>{time}</span>
      </div>
      <div style={{ flex: 1, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, paddingRight: 1, color: c }}>
        <svg width="19" height="12" viewBox="0 0 19 12">
          <rect x="0" y="7.5" width="3.2" height="4.5" rx="0.7" fill="currentColor"/>
          <rect x="4.8" y="5" width="3.2" height="7" rx="0.7" fill="currentColor"/>
          <rect x="9.6" y="2.5" width="3.2" height="9.5" rx="0.7" fill="currentColor"/>
          <rect x="14.4" y="0" width="3.2" height="12" rx="0.7" fill="currentColor"/>
        </svg>
        <svg width="17" height="12" viewBox="0 0 17 12">
          <path d="M8.5 3.2C10.8 3.2 12.9 4.1 14.4 5.6L15.5 4.5C13.7 2.7 11.2 1.5 8.5 1.5C5.8 1.5 3.3 2.7 1.5 4.5L2.6 5.6C4.1 4.1 6.2 3.2 8.5 3.2Z" fill="currentColor"/>
          <path d="M8.5 6.8C9.9 6.8 11.1 7.3 12 8.2L13.1 7.1C11.8 5.9 10.2 5.1 8.5 5.1C6.8 5.1 5.2 5.9 3.9 7.1L5 8.2C5.9 7.3 7.1 6.8 8.5 6.8Z" fill="currentColor"/>
          <circle cx="8.5" cy="10.5" r="1.5" fill="currentColor"/>
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.5" stroke="currentColor" strokeOpacity="0.4" fill="none"/>
          <rect x="2" y="2" width="18" height="9" rx="2" fill="currentColor"/>
          <path d="M25 4.5V8.5C25.8 8.2 26.5 7.2 26.5 6.5C26.5 5.8 25.8 4.8 25 4.5Z" fill="currentColor" fillOpacity="0.4"/>
        </svg>
      </div>
    </div>
  );
}

// Sunmsg device shell — replaces IOSDevice with palette-aware chrome.
function SmDevice({ children, dark = false, bg }) {
  return (
    <div className="sm-frame" style={{
      width: SCREEN_W, height: SCREEN_H, borderRadius: 54, overflow: 'hidden',
      position: 'relative',
      background: bg || (dark ? '#1c1a14' : '#f3f0e8'),
      boxShadow: '0 40px 80px rgba(40,30,15,0.20), 0 0 0 1px rgba(40,30,15,0.10)',
      fontFamily: SYS_FONT,
      WebkitFontSmoothing: 'antialiased',
      color: dark ? '#ece6d5' : '#15140e',
    }}>
      {/* dynamic island */}
      <div style={{
        position: 'absolute', top: 11, left: '50%', transform: 'translateX(-50%)',
        width: 124, height: 36, borderRadius: 24, background: '#000', zIndex: 50,
      }} />
      {/* status bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
        <SmStatusBar dark={dark} />
      </div>
      <div style={{ height: '100%', position: 'relative' }}>{children}</div>
      {/* home indicator */}
      <div style={{
        position: 'absolute', bottom: 7, left: '50%', transform: 'translateX(-50%)',
        width: 134, height: 5, borderRadius: 100, zIndex: 60,
        background: dark ? 'rgba(236,230,213,0.65)' : 'rgba(21,20,14,0.32)',
      }} />
    </div>
  );
}

// Sun brand mark — outer amber ring + filled amber disk.
function SunMark({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r="8.5" fill="none" stroke="var(--sm-accent)" strokeWidth="1" strokeOpacity="0.55" />
      <circle cx="11" cy="11" r="6.4" fill="var(--sm-accent)" />
    </svg>
  );
}

// Avatar: deterministic warm gradient + initials (matches web --profile-avatar-bg)
function Avatar({ name = 'A', size = 40, online = false, src }) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = 50 + (h % 30); // narrow warm: amber → wheat
  const hue2 = (hue + 14) % 360;
  const initials = name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: src ? `center / cover no-repeat url(${src})` :
          `linear-gradient(145deg, oklch(74% 0.13 ${hue}) 0%, oklch(64% 0.14 ${hue2}) 100%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#15140e', fontWeight: 600, fontSize: size * 0.38,
        letterSpacing: -0.3, fontFamily: SYS_FONT,
      }}>{src ? '' : initials}</div>
      {online && (
        <div style={{
          position: 'absolute', right: -1, bottom: -1,
          width: Math.max(8, size * 0.28), height: Math.max(8, size * 0.28),
          borderRadius: '50%', background: 'var(--sm-online)',
          border: `${Math.max(2, size * 0.06)}px solid var(--sm-sidebar-bg)`,
        }} />
      )}
    </div>
  );
}

// "СИНХ" / status chip — green pulse dot + label
function SyncChip({ children = 'СИНХ' }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 7px', borderRadius: 999,
      background: 'rgba(105,160,110,0.10)',
      border: '0.5px solid rgba(105,160,110,0.22)',
      color: 'var(--sm-online)',
      fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: 'var(--sm-online)',
        boxShadow: '0 0 0 0 currentColor',
        animation: 'smSyncPulse 2s infinite',
      }} />
      {children}
      <style>{`@keyframes smSyncPulse { 0%{box-shadow:0 0 0 0 currentColor} 70%{box-shadow:0 0 0 5px transparent} 100%{box-shadow:0 0 0 0 transparent} }`}</style>
    </span>
  );
}

Object.assign(window, {
  SCREEN_W, SCREEN_H, SYS_FONT, Icon, SmStatusBar, SmDevice, Avatar, SunMark, SyncChip,
});
