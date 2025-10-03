"use client";

import SphereScene from './components/SphereScene';
import { useRef, useState, useEffect } from 'react';

export default function Home() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [frequencyData, setFrequencyData] = useState<Uint8Array<ArrayBuffer> | null>(null);

  useEffect(() => {
    if (audioRef.current) {
      const audioContext = new AudioContext();
      const source = audioContext.createMediaElementSource(audioRef.current);
      const newAnalyser = audioContext.createAnalyser();
      source.connect(newAnalyser);
      newAnalyser.connect(audioContext.destination);
      newAnalyser.fftSize = 256;
      setAnalyser(newAnalyser);
      setFrequencyData(new Uint8Array(new ArrayBuffer(newAnalyser.frequencyBinCount))); // Initialize with correct size here
    }
  }, [audioFile]); // Re-run when a new audio file is selected

  useEffect(() => {
    let animationFrameId: number = 0;

    const getFrequencyData = () => {
       if (analyser && frequencyData) {
         analyser.getByteFrequencyData(frequencyData); // This will update the existing array
         // console.log(frequencyData); // For debugging purposes
         // You can pass this frequencyData to your SphereScene component
       }
       animationFrameId = requestAnimationFrame(getFrequencyData);
     };

    if (isPlaying && analyser && frequencyData) {
      getFrequencyData();
    } else {
      cancelAnimationFrame(animationFrameId);
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying, analyser, frequencyData]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setAudioFile(event.target.files[0]);
      setIsPlaying(false);
    }
  };

  const handlePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  return (
    <main>
      <input type="file" accept="audio/*" onChange={handleFileChange} />
      {audioFile && (
        <button onClick={handlePlayPause}>
          {isPlaying ? 'Pause' : 'Play'}
        </button>
      )}
      {audioFile && <audio ref={audioRef} src={URL.createObjectURL(audioFile)} loop />}
      <SphereScene frequencyData={frequencyData} />
    </main>
  );
}
