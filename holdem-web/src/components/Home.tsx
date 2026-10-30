interface Props {
  onStart: () => void;
  error?: string | null;
}

export function Home({ onStart, error }: Props) {
  return (
    <div className="screen home">
      <div className="home-card">
        <div className="logo">♠♥♦♣</div>
        <h1>Hold'em Club</h1>
        <p className="tagline">No-Limit Texas Hold'em · 与 AI 同桌</p>
        {error && <p className="error">{error}</p>}
        <button className="btn primary big" onClick={onStart}>
          快速开局
        </button>
        <p className="hint">点击后立即开局</p>
      </div>
    </div>
  );
}
