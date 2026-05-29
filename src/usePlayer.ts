import {useEffect, useState, useCallback} from 'react';
import TrackPlayer, {
  Capability,
  AppKilledPlaybackBehavior,
  State,
  Event,
  RepeatMode,
} from 'react-native-track-player';
// Hooks re-exportés via require pour contourner le bug exports:[] dans package.json
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RNTP = require('react-native-track-player');
const usePlaybackState: () => {state: State | undefined} = RNTP.usePlaybackState;
const useProgress: (interval?: number) => {position: number; duration: number; buffered: number} = RNTP.useProgress;
const useActiveTrack: () => import('react-native-track-player').Track | undefined = RNTP.useActiveTrack;

export type PlayMode = 'order' | 'shuffle' | 'loop' | 'one';

let playerReady = false;

export async function setupPlayer() {
  if (playerReady) return;
  await TrackPlayer.setupPlayer({
    maxCacheSize: 1024 * 5, // 5 MB cache
  });
  await TrackPlayer.updateOptions({
    android: {
      appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
    },
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SeekTo,
      Capability.Stop,
    ],
    compactCapabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
    ],
    progressUpdateEventInterval: 500,
  });
  playerReady = true;
}

// Convertit un Track de l'app en objet TrackPlayer
export function toPlayerTrack(t: any) {
  return {
    id:       t.id,
    url:      t.filePath ? `file://${t.filePath}` : '',
    title:    t.title,
    artist:   t.artist,
    album:    t.album,
    artwork:  t.artUri ?? undefined,
    duration: t.duration ? t.duration / 1000 : undefined, // ms → secondes
    genre:    t.genre,
  };
}

export function usePlayer() {
  const playbackState = usePlaybackState();
  const progress      = useProgress(500);
  const activeTrack   = useActiveTrack();
  const [playMode, setPlayMode] = useState<PlayMode>('order');

  const isPlaying = playbackState.state === State.Playing;
  const isLoading = playbackState.state === State.Loading ||
                    playbackState.state === State.Buffering;

  // Joue un morceau (et charge sa file depuis la bibliothèque)
  const playTrack = useCallback(async (track: any, queue: any[]) => {
    await TrackPlayer.reset();

    // Met le morceau cliqué en premier, suivi du reste de la file
    const clickedIdx = queue.findIndex(t => t.id === track.id);
    const ordered = clickedIdx >= 0
      ? [...queue.slice(clickedIdx), ...queue.slice(0, clickedIdx)]
      : [track, ...queue];

    await TrackPlayer.add(ordered.map(toPlayerTrack));
    await TrackPlayer.play();
  }, []);

  const togglePlay = useCallback(async () => {
    if (isPlaying) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  }, [isPlaying]);

  const skipNext = useCallback(() => TrackPlayer.skipToNext().catch(() => {}), []);
  const skipPrev = useCallback(() => TrackPlayer.skipToPrevious().catch(() => {}), []);
  const seekTo   = useCallback((pos: number) => TrackPlayer.seekTo(pos), []);

  const cyclePlayMode = useCallback(async () => {
    const next: PlayMode = playMode === 'order'   ? 'shuffle'
                         : playMode === 'shuffle' ? 'loop'
                         : playMode === 'loop'    ? 'one'
                         : 'order';
    setPlayMode(next);
    switch (next) {
      case 'order':
        await TrackPlayer.setRepeatMode(RepeatMode.Off);
        break;
      case 'shuffle':
        await TrackPlayer.setRepeatMode(RepeatMode.Off);
        break;
      case 'loop':
        await TrackPlayer.setRepeatMode(RepeatMode.Queue);
        break;
      case 'one':
        await TrackPlayer.setRepeatMode(RepeatMode.Track);
        break;
    }
  }, [playMode]);

  return {
    isPlaying,
    isLoading,
    progress,
    activeTrack,
    playMode,
    playTrack,
    togglePlay,
    skipNext,
    skipPrev,
    seekTo,
    cyclePlayMode,
  };
}
