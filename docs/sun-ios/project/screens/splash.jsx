// splash.jsx — Screen 3: Launch screen
// Quiet, editorial: large sun mark + wordmark + serif tagline.

function SplashScreen({ dark = false }) {
  return (
    <SmDevice dark={dark}>
      <div style={{
        height: '100%', width: '100%',
        background: 'var(--sm-bg)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        position: 'relative', overflow: 'hidden',
        fontFamily: SYS_FONT,
      }} className="paper">
        {/* warm radial wash */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse 500px 500px at 50% 40%, rgba(196,148,60,0.10), transparent 70%)',
        }} />

        {/* concentric dashed circles */}
        <div style={{
          position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 260, height: 260, borderRadius: '50%',
          border: '0.5px dashed rgba(196,148,60,0.30)',
        }} />
        <div style={{
          position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 340, height: 340, borderRadius: '50%',
          border: '0.5px dashed rgba(196,148,60,0.15)',
        }} />

        {/* big sun mark */}
        <div style={{ marginTop: -60, marginBottom: 24 }}>
          <BigSunMark size={120} />
        </div>

        {/* Wordmark */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: SYS_FONT, fontWeight: 700, fontSize: 40,
            color: 'var(--sm-ink)', letterSpacing: -1.4, lineHeight: 1,
          }}>sun</div>
          <div style={{
            marginTop: 10, fontFamily: 'Instrument Serif, Georgia, serif', fontStyle: 'italic',
            fontSize: 16, color: 'var(--sm-ink-mute)', letterSpacing: 0.1,
          }}>тихие сообщения, тёплый свет</div>
        </div>

        {/* Loading dots */}
        <div style={{
          position: 'absolute', bottom: 110, left: 0, right: 0,
          display: 'flex', justifyContent: 'center', gap: 8,
        }}>
          {[0,1,2,3].map(i => (
            <span key={i} style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--sm-accent)',
              animation: `smSplashDot 1.4s ${i * 0.14}s infinite ease-in-out`,
            }} />
          ))}
          <style>{`@keyframes smSplashDot { 0%,60%,100%{opacity:.25;transform:scale(.85)} 30%{opacity:1;transform:scale(1.1)} }`}</style>
        </div>

      </div>
    </SmDevice>
  );
}

function BigSunMark({ size = 120 }) {
  // Replicates safari-pinned-tab: outer amber ring + filled inner amber disk
  const r1 = size * 0.485;
  const r2 = size * 0.36;
  const sw = size * 0.045;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <radialGradient id="orbFill" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="oklch(76% 0.13 70)" />
            <stop offset="60%" stopColor="oklch(64% 0.15 60)" />
            <stop offset="100%" stopColor="oklch(52% 0.14 55)" />
          </radialGradient>
        </defs>
        <circle cx={size/2} cy={size/2} r={r1} fill="none"
          stroke="oklch(74% 0.12 70)" strokeWidth={sw} strokeOpacity="0.9" />
        <circle cx={size/2} cy={size/2} r={r2} fill="url(#orbFill)" />
      </svg>
    </div>
  );
}

window.SplashScreen = SplashScreen;
window.BigSunMark = BigSunMark;
