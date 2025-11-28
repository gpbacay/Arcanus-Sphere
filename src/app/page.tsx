"use client";

import SphereScene from './components/SphereScene';
import { useRef, useState, useEffect } from 'react';

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

export default function Home() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  useEffect(() => {
    if (audioFile) {
      const url = URL.createObjectURL(audioFile);
      setAudioUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setAudioUrl(null);
    }
  }, [audioFile]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => {
      if (!isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('durationchange', updateDuration);

    // Set initial duration if already loaded
    if (audio.duration && !isNaN(audio.duration)) {
      setDuration(audio.duration);
    }

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('durationchange', updateDuration);
    };
  }, [audioUrl]);

  const setupAudio = () => {
    if (!audioRef.current) return;

    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const newAudioContext = new AudioContextClass();
      const newAnalyser = newAudioContext.createAnalyser();
      newAnalyser.fftSize = 512;
      newAnalyser.smoothingTimeConstant = 0.8;

      const source = newAudioContext.createMediaElementSource(audioRef.current);
      source.connect(newAnalyser);
      newAnalyser.connect(newAudioContext.destination);

      audioContextRef.current = newAudioContext;
      sourceRef.current = source;
      setAnalyser(newAnalyser);
    } else if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setAudioFile(event.target.files[0]);
      setIsPlaying(false);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setIsCollapsed(false);
    }
  };

  const handlePlayPause = async () => {
    if (audioRef.current) {
      setupAudio();

      if (isPlaying) {
        audioRef.current.pause();
      } else {
        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
        }
        try {
          await audioRef.current.play();
        } catch (err) {
          console.error("Error playing audio:", err);
        }
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <main style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#000' }}>
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        zIndex: 10,
        background: 'rgba(20, 20, 30, 0.85)',
        backdropFilter: 'blur(20px)',
        borderRadius: '20px',
        color: 'white',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5)',
        overflow: 'hidden',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        minWidth: isCollapsed ? '320px' : '360px',
        maxWidth: '360px'
      }}>
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: isCollapsed ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
            cursor: 'pointer'
          }}
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: isPlaying ? 'linear-gradient(135deg, #00ff88, #00d4ff)' : '#555',
              boxShadow: isPlaying ? '0 0 10px rgba(0, 255, 136, 0.5)' : 'none',
              animation: isPlaying ? 'pulse 2s ease-in-out infinite' : 'none'
            }} />
            <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, letterSpacing: '1.2px', color: '#fff' }}>
              ARCANUS PLAYER
            </h1>
          </div>
          <div style={{
            fontSize: '0.8rem',
            color: 'rgba(255, 255, 255, 0.5)',
            transform: isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.3s ease'
          }}>
            ▼
          </div>
        </div>

        {/* Player Content */}
        <div style={{
          maxHeight: isCollapsed ? '0' : '400px',
          opacity: isCollapsed ? 0 : 1,
          transition: 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
          overflow: 'hidden'
        }}>
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* File Upload */}
            <div style={{ position: 'relative' }}>
              <label
                htmlFor="audio-upload"
                style={{
                  display: 'block',
                  padding: '14px 18px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1.5px dashed rgba(255, 255, 255, 0.25)',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  textAlign: 'center',
                  fontSize: '0.85rem',
                  transition: 'all 0.3s ease',
                  color: '#aaa',
                  fontWeight: 500
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(110, 142, 251, 0.8)';
                  e.currentTarget.style.color = '#fff';
                  e.currentTarget.style.background = 'rgba(110, 142, 251, 0.1)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)';
                  e.currentTarget.style.color = '#aaa';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                }}
              >
                {audioFile ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '16px' }}>🎵</span>
                    <span style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '200px'
                    }}>
                      {audioFile.name}
                    </span>
                  </span>
                ) : '📁 Select Audio File'}
              </label>
              <input
                id="audio-upload"
                type="file"
                accept="audio/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
            </div>

            {/* Progress Slider */}
            {audioFile && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <input
                  type="range"
                  min="0"
                  max={duration || 0}
                  value={currentTime}
                  onChange={handleSeek}
                  style={{
                    width: '100%',
                    height: '6px',
                    borderRadius: '3px',
                    background: `linear-gradient(to right, #6e8efb ${(currentTime / duration) * 100}%, rgba(255, 255, 255, 0.1) ${(currentTime / duration) * 100}%)`,
                    outline: 'none',
                    cursor: 'pointer',
                    WebkitAppearance: 'none',
                    appearance: 'none'
                  }}
                  className="audio-slider"
                />
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.75rem',
                  color: 'rgba(255, 255, 255, 0.5)',
                  fontWeight: 500,
                  fontVariantNumeric: 'tabular-nums'
                }}>
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>
            )}

            {/* Play/Pause Button */}
            <button
              onClick={handlePlayPause}
              disabled={!audioFile}
              style={{
                padding: '14px 24px',
                background: audioFile
                  ? (isPlaying
                    ? 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)'
                    : 'linear-gradient(135deg, #6e8efb, #a777e3)')
                  : '#333',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                cursor: audioFile ? 'pointer' : 'not-allowed',
                fontSize: '0.95rem',
                fontWeight: 600,
                letterSpacing: '0.8px',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                opacity: audioFile ? 1 : 0.5,
                boxShadow: audioFile ? '0 4px 20px rgba(110, 142, 251, 0.4)' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
              onMouseDown={(e) => !e.currentTarget.disabled && (e.currentTarget.style.transform = 'scale(0.97)')}
              onMouseUp={(e) => !e.currentTarget.disabled && (e.currentTarget.style.transform = 'scale(1)')}
            >
              <span style={{ fontSize: '18px' }}>{isPlaying ? '⏸' : '▶'}</span>
              {isPlaying ? 'PAUSE' : 'PLAY'}
            </button>

            {/* Status Indicator */}
            {audioFile && (
              <div style={{
                fontSize: '0.75rem',
                color: isPlaying ? 'rgba(0, 255, 136, 0.8)' : 'rgba(255, 255, 255, 0.4)',
                textAlign: 'center',
                fontWeight: 500,
                letterSpacing: '0.5px',
                padding: '8px',
                background: isPlaying ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                borderRadius: '8px',
                transition: 'all 0.3s ease'
              }}>
                {isPlaying ? '● VISUALIZER ACTIVE' : '○ Ready to Play'}
              </div>
            )}
          </div>
        </div>
      </div>

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onEnded={() => setIsPlaying(false)}
          style={{ display: 'none' }}
        />
      )}

      <SphereScene analyser={analyser} />

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.2); }
        }

        .audio-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: linear-gradient(135deg, #6e8efb, #a777e3);
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(110, 142, 251, 0.6);
          transition: transform 0.2s ease;
        }

        .audio-slider::-webkit-slider-thumb:hover {
          transform: scale(1.2);
        }

        .audio-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: linear-gradient(135deg, #6e8efb, #a777e3);
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 8px rgba(110, 142, 251, 0.6);
          transition: transform 0.2s ease;
        }

        .audio-slider::-moz-range-thumb:hover {
          transform: scale(1.2);
        }
      `}</style>
    </main>
  );
}
