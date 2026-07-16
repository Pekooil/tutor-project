// The three fixed radial glows behind the whole dashboard (Design handoff,
// "Atmosphere"). Purely decorative, pointer-events:none, fixed to the viewport.
export function AmbientGlow() {
  return (
    <>
      <div
        style={{
          position: 'fixed',
          left: '50%',
          top: -260,
          transform: 'translateX(-50%)',
          width: 900,
          height: 560,
          borderRadius: 99,
          background: 'radial-gradient(closest-side,rgba(187,247,208,.4),rgba(187,247,208,0))',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'fixed',
          left: -160,
          bottom: -180,
          width: 520,
          height: 520,
          borderRadius: 99,
          background: 'radial-gradient(circle,rgba(134,239,172,.22),rgba(134,239,172,0) 70%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'fixed',
          right: -140,
          top: '34%',
          width: 480,
          height: 480,
          borderRadius: 99,
          background: 'radial-gradient(circle,rgba(123,237,170,.16),rgba(123,237,170,0) 70%)',
          pointerEvents: 'none',
        }}
      />
    </>
  )
}
