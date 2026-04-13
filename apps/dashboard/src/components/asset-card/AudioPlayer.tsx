import { useState, useRef, useEffect } from 'react';
import { Pause, Play, SpeakerHigh } from '@phosphor-icons/react';
import { motion } from 'framer-motion';

export function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setCurrentTime(audio.currentTime);
      setDuration(audio.duration || 0);
      setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
    };
    const onEnded = () => setPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onTime);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onTime);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); } else { void audio.play(); }
    setPlaying(!playing);
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m)}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <div className="mb-4 rounded-xl border border-surface-700 bg-surface-900/60 p-4">
      <audio ref={audioRef} src={src} preload="metadata" />
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent-500 text-white shadow-md transition-transform hover:scale-105 active:scale-95"
        >
          {playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" className="ml-0.5" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <SpeakerHigh size={12} weight="fill" className="text-accent-400" />
            <span className="text-body-xs text-surface-400 font-mono">
              {fmt(currentTime)} / {duration > 0 ? fmt(duration) : '--:--'}
            </span>
          </div>
          <div
            className="h-1.5 w-full cursor-pointer rounded-full bg-surface-700"
            onClick={seek}
          >
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-accent-500 to-accent-400"
              style={{ width: `${String(progress)}%` }}
              layout
              transition={{ duration: 0.1 }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
