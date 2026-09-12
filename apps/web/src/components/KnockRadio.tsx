import { useEffect, useRef, useState } from 'react';
import './KnockRadio.css';

type Track = { title: string; artist: string; genre: string; src: string; source: string };

const TRACKS: Track[] = [
  { title: 'Trance Adventure', artist: 'MintoDog', genre: 'Electronic / Trance', src: 'https://opengameart.org/sites/default/files/trance_adventure_bpm140.mp3', source: 'https://opengameart.org/content/trance-adventure' },
  { title: 'Iso1nhab1tans', artist: 'Sudocolon', genre: 'Techno / LAN House', src: 'https://opengameart.org/sites/default/files/Iso.mp3', source: 'https://opengameart.org/content/iso1nhab1tans' },
  { title: 'JRPG - End Dungeon', artist: 'HydroGene', genre: 'MMORPG Fantasy', src: 'https://opengameart.org/sites/default/files/end_dungeon_0.mp3', source: 'https://opengameart.org/content/jrpg-end-dungeon' },
  { title: 'The Field Of Dreams', artist: 'pauliuw', genre: 'RPG / Nostalgia', src: 'https://opengameart.org/sites/default/files/the_field_of_dreams.mp3', source: 'https://opengameart.org/content/the-field-of-dreams' },
  { title: 'Liquid Flame', artist: 'Of Far Different Nature', genre: 'Electronic / Trance', src: 'https://opengameart.org/sites/default/files/Of%20Far%20Different%20Nature%20-%20Liquid%20Flame%20%28CC0%29.mp3', source: 'https://opengameart.org/content/liquid-flame' },
  { title: 'AlphaTron', artist: 'DST', genre: 'Techno / Game', src: 'https://opengameart.org/sites/default/files/DST-AlphaTron.mp3', source: 'https://opengameart.org/content/alphatron' },
];

export function KnockRadio() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(() => Number(localStorage.getItem('knock-radio-track') || 0) % TRACKS.length);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('knock-radio-volume') || 0.45));
  const track = TRACKS[index];

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
    localStorage.setItem('knock-radio-volume', String(volume));
  }, [volume]);

  useEffect(() => {
    localStorage.setItem('knock-radio-track', String(index));
    if (playing) void audioRef.current?.play().catch(() => setPlaying(false));
  }, [index]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };
  const change = (step: number) => setIndex((current) => (current + step + TRACKS.length) % TRACKS.length);

  return <section className="knock-radio" aria-label="Knock Radio — LAN House 2000s">
    <audio ref={audioRef} src={track.src} preload="none" onEnded={() => change(1)} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
    <div className="knock-radio-station"><span className="knock-radio-live">● ON AIR</span><strong>📻 KNOCK RADIO</strong><small>LAN HOUSE 2000s</small></div>
    <div className="knock-radio-now"><span className="knock-radio-bars" aria-hidden><i /><i /><i /><i /></span><div><small>TOCANDO AGORA</small><strong>{track.title}</strong><span>{track.artist} · {track.genre} · CC0</span></div></div>
    <div className="knock-radio-controls">
      <button type="button" onClick={() => change(-1)} aria-label="Música anterior">◀◀</button>
      <button type="button" className="knock-radio-play" onClick={toggle} aria-label={playing ? 'Pausar' : 'Tocar'}>{playing ? '❚❚' : '▶'}</button>
      <button type="button" onClick={() => change(1)} aria-label="Próxima música">▶▶</button>
      <label className="knock-radio-volume">🔊<input aria-label="Volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => setVolume(Number(e.target.value))} /></label>
    </div>
    <a className="knock-radio-license" href={track.source} target="_blank" rel="noreferrer" title="Fonte e licença CC0">CC0 ↗</a>
  </section>;
}
