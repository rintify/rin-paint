// Keep this lightweight mark in sync with the pre-JavaScript shell in index.html.
function StartupLogo() {
  return (
    <div className="startup-brand" aria-hidden="true">
          <div className="startup-stage">
            <div className="startup-motion startup-orbit">
              <svg viewBox="0 0 440 300" fill="none" strokeLinecap="round">
                <ellipse cx="220" cy="150" rx="176" ry="95" stroke="#568aff" opacity=".25" />
                <path stroke="#4f8cff" strokeWidth="9" d="M41 195 C-5 96 255 8 363 63 C420 92 399 142 351 181" />
                <path stroke="#ff729e" strokeWidth="5" d="M370 224 C445 128 259 33 129 49" />
                <path stroke="#efc568" strokeWidth="3" d="M72 231 C-10 151 184 12 322 57" />
              </svg>
            </div>
            <div className="startup-motion startup-ripple">
              <svg viewBox="0 0 440 300" fill="none"><circle cx="220" cy="150" r="74" stroke="#89b4ff" /></svg>
            </div>
            <div className="startup-motion startup-sparks">
              <svg viewBox="0 0 440 300" fill="#7cabff" strokeLinecap="round">
                <circle cx="64" cy="112" r="5" /><circle cx="356" cy="78" r="4" />
                <circle cx="332" cy="247" r="6" /><circle cx="102" cy="240" r="3" />
                <path d="M128 47 l-9 -15 M386 161 l17 3 M200 262 l-3 15" stroke="#7cabff" strokeWidth="4" />
                <g fill="#efc568"><circle cx="90" cy="175" r="4" /><circle cx="270" cy="38" r="3" /><circle cx="371" cy="206" r="4" /></g>
                <path d="M158 242 l-7 10 M316 76 l8 -10" stroke="#ff729e" strokeWidth="5" />
              </svg>
            </div>
            <div className="startup-motion startup-glyph">
              <svg viewBox="0 0 440 300" fill="none">
                <g transform="translate(168 98)">
                  <rect x="7" y="7" width="90" height="90" rx="26" fill="#121b2d" stroke="#759dde" strokeOpacity=".35" />
                  <path stroke="#78a8ff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" d="M27 69 C35 53 49 36 65 25 C72 20 80 28 74 35 C64 47 48 58 34 62 C46 53 62 49 66 55 C71 63 50 72 58 77 C63 80 72 75 78 69" />
                  <circle cx="26" cy="76" r="3" fill="#efc568" />
                </g>
              </svg>
            </div>
          </div>
          <div className="startup-wordmark">rin<span>-paint</span></div>
        </div>
  );
}

/** Matches the static HTML shell, so loading the JS bundle causes no visual jump. */
export function StartupScreen({ state }: { state: 'loading' | 'ready' | 'error' }) {
  return (
    <div className="startup-screen" role={state === 'error' ? 'alert' : 'status'} aria-live="polite" aria-hidden={state === 'ready'}>
      {state !== 'error' && <StartupLogo />}
      <span className="startup-caption">{state === 'error' ? '読み込みを完了できませんでした。再読み込みしてください。' : '読み込み中…'}</span>
      {state === 'error' && <button onClick={() => window.location.reload()}>再読み込み</button>}
    </div>
  );
}
