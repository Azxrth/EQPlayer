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

// Modes de lecture (mutuellement exclusifs, sur le même bouton) :
//  - 'one'       : répète le morceau courant à l'infini
//  - 'loop-once' : joue la playlist puis la répète une seule fois, puis s'arrête
//  - 'loop'      : répète la playlist à l'infini
//  - 'shuffle'   : lecture aléatoire
export type PlayMode = 'one' | 'loop-once' | 'loop' | 'shuffle';

// Ordre de défilement du bouton
const MODE_CYCLE: PlayMode[] = ['loop-once', 'loop', 'one', 'shuffle'];

// ---- État partagé (niveau module) ---------------------------------------
// Le lecteur TrackPlayer est global : le mode l'est donc aussi. On le garde au
// niveau module pour que toutes les instances du hook (PlayerScreen, MiniPlayer…)
// restent synchronisées, et pour que le handler de fin de file puisse le lire.
let currentMode: PlayMode = 'loop-once';
let sourceQueue: any[] = [];        // ordre canonique de la file (objets app)
let loopOncePlayed = false;         // a-t-on déjà fait la répétition unique en 'loop-once' ?
const modeSubscribers = new Set<(m: PlayMode) => void>();
function notifyMode() {
  modeSubscribers.forEach(fn => fn(currentMode));
}

function repeatModeFor(mode: PlayMode): RepeatMode {
  switch (mode) {
    case 'one':  return RepeatMode.Track;
    case 'loop': return RepeatMode.Queue;
    default:     return RepeatMode.Off; // 'loop-once' et 'shuffle' gérés à la main
  }
}

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

  // En mode 'loop-once', RepeatMode.Off laisse la file s'arrêter à la fin :
  // on la rejoue alors une seule fois depuis le début, puis on la laisse s'arrêter.
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, async () => {
    if (currentMode === 'loop-once' && !loopOncePlayed) {
      loopOncePlayed = true;
      await TrackPlayer.skip(0).catch(() => {});
      await TrackPlayer.play();
    }
  });

  playerReady = true;
}

// Mélange Fisher–Yates (copie, ne modifie pas l'original)
function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Indices des morceaux à venir (après le morceau actif) dans la file du player
async function upcomingIndices(): Promise<number[]> {
  const len = (await TrackPlayer.getQueue()).length;
  const idx = (await TrackPlayer.getActiveTrackIndex()) ?? 0;
  const indices: number[] = [];
  for (let i = idx + 1; i < len; i++) indices.push(i);
  return indices;
}

// Mélange les morceaux à venir (garde le morceau courant en place).
async function reshuffleUpcoming() {
  const indices = await upcomingIndices();
  if (indices.length < 2) return;
  const queue = await TrackPlayer.getQueue();
  const upcoming = indices.map(i => queue[i]);
  await TrackPlayer.remove(indices);
  await TrackPlayer.add(shuffled(upcoming)); // ré-ajouté après le morceau courant
}

// Restaure l'ordre canonique des morceaux à venir à partir du morceau courant.
async function restoreOrder() {
  if (!sourceQueue.length) return;
  const active = await TrackPlayer.getActiveTrack();
  const pos = sourceQueue.findIndex(t => t.id === active?.id);
  if (pos < 0) return;
  const indices = await upcomingIndices();
  if (indices.length) await TrackPlayer.remove(indices);
  await TrackPlayer.add(sourceQueue.slice(pos + 1).map(toPlayerTrack));
}

// Applique un mode : RepeatMode + réordonnancement éventuel de la file.
async function applyMode(mode: PlayMode, prev: PlayMode) {
  // On quitte shuffle pour un mode ordonné : on remet la file dans l'ordre.
  if (prev === 'shuffle' && mode !== 'shuffle') await restoreOrder();
  if (mode === 'loop-once') loopOncePlayed = false; // ré-arme la répétition unique
  await TrackPlayer.setRepeatMode(repeatModeFor(mode));
  if (mode === 'shuffle') await reshuffleUpcoming();
}

// Convertit un Track de l'app en objet TrackPlayer.
// On joue via l'URI MediaStore content:// (id = _ID MediaStore) plutôt que le
// chemin file:// : sous Android scoped storage, l'accès file:// aux fichiers sur
// carte SD amovible est refusé, alors que content:// fonctionne (READ_MEDIA_AUDIO).
export function toPlayerTrack(t: any) {
  return {
    id:       t.id,
    url:      t.id ? `content://media/external/audio/media/${t.id}`
            : t.filePath ? `file://${t.filePath}` : '',
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
  const [playMode, setPlayMode] = useState<PlayMode>(currentMode);

  // Abonnement au mode partagé pour rester synchro entre instances du hook.
  useEffect(() => {
    const sub = (m: PlayMode) => setPlayMode(m);
    modeSubscribers.add(sub);
    setPlayMode(currentMode);
    return () => { modeSubscribers.delete(sub); };
  }, []);

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

    // Ordre canonique conservé pour pouvoir y revenir depuis le mode shuffle.
    sourceQueue = ordered;
    loopOncePlayed = false; // nouvelle file : la répétition unique est ré-armée

    // En shuffle, on garde le morceau cliqué en tête et on mélange le reste.
    const toAdd = currentMode === 'shuffle'
      ? [ordered[0], ...shuffled(ordered.slice(1))]
      : ordered;

    await TrackPlayer.add(toAdd.map(toPlayerTrack));
    await TrackPlayer.setRepeatMode(repeatModeFor(currentMode));
    await TrackPlayer.play();
  }, []);

  // Insère un morceau juste après le morceau courant (« Lire ensuite »).
  // Si rien n'est chargé, démarre la lecture avec ce morceau seul.
  const addNext = useCallback(async (track: any) => {
    const queue = await TrackPlayer.getQueue();
    if (queue.length === 0) {
      await TrackPlayer.add([toPlayerTrack(track)]);
      await TrackPlayer.play();
      return;
    }
    const idx = (await TrackPlayer.getActiveTrackIndex()) ?? 0;
    await TrackPlayer.add([toPlayerTrack(track)], idx + 1);
    sourceQueue.splice(idx + 1, 0, track);
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
    const prev = currentMode;
    const next = MODE_CYCLE[(MODE_CYCLE.indexOf(prev) + 1) % MODE_CYCLE.length];
    currentMode = next;
    notifyMode();
    await applyMode(next, prev);
  }, []);

  return {
    isPlaying,
    isLoading,
    progress,
    activeTrack,
    playMode,
    playTrack,
    addNext,
    togglePlay,
    skipNext,
    skipPrev,
    seekTo,
    cyclePlayMode,
  };
}
