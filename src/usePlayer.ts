import {useEffect, useReducer, useState} from 'react';
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
export const useProgress: (interval?: number) => {position: number; duration: number; buffered: number} = RNTP.useProgress;
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
// sourceQueue = ordre de lecture COMPLET (objets app), figé au lancement. C'est
// notre source de vérité ; on ne donne au moteur audio qu'une FENÊTRE de cette
// liste (le morceau courant + quelques suivants), qu'on rallonge au fil de la
// lecture. Ainsi l'ajout au player reste minuscule quelle que soit la taille de
// la biblio (1867 titres) → démarrage et pause/play instantanés sur le JM21.
let sourceQueue: any[] = [];
let windowLoaded = 0;               // nb de pistes de sourceQueue déjà dans le player
let extending = false;              // anti-réentrance de l'extension de fenêtre
const WINDOW_INITIAL = 50;          // pistes chargées d'avance au lancement
const WINDOW_AHEAD = 20;            // on rallonge quand il reste moins que ça devant
const WINDOW_BATCH = 50;            // taille d'un rallongement
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

// Dernier état de lecture connu (mis à jour par l'écouteur Event.PlaybackState).
// Évite à togglePlay un aller-retour getPlaybackState() avant d'agir.
let lastPlaybackState: State | undefined;

// Retour visuel OPTIMISTE de pause/play : on bascule l'icône affichée dès le
// toucher, sans attendre l'événement natif (qui peut tarder quand le thread de
// track-player est chargé). Réconcilié dès que le natif rejoint l'état visé.
let optimisticPlaying: boolean | null = null;
const optimisticSubs = new Set<() => void>();
function setOptimistic(v: boolean | null) {
  if (optimisticPlaying === v) return;
  optimisticPlaying = v;
  optimisticSubs.forEach(fn => fn());
}

export async function setupPlayer() {
  if (playerReady) return;
  // Pas de cache : on lit des fichiers 100% locaux (content://media/...).
  // maxCacheSize active un CacheDataSource pensé pour le streaming réseau ;
  // sur des fichiers locaux il ajoute une couche de lecture/copie qui peut
  // bloquer le lecteur en « Buffering » plusieurs secondes avant de démarrer.
  await TrackPlayer.setupPlayer();
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
  TrackPlayer.addEventListener(Event.PlaybackState, (e: {state: State}) => {
    lastPlaybackState = e.state;
  });

  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, async () => {
    if (currentMode === 'loop-once' && !loopOncePlayed) {
      loopOncePlayed = true;
      await TrackPlayer.skip(0).catch(() => {});
      await TrackPlayer.play();
    }
  });

  // À chaque changement de piste, on rallonge la fenêtre si on approche du bord
  // de ce qui est chargé. Petits ajouts (≤ WINDOW_BATCH), jamais de gros bloc.
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, () => {
    void maybeExtendWindow();
  });

  playerReady = true;
}

// Rallonge la file du player depuis sourceQueue quand il reste peu de pistes
// devant la piste courante. Ne retire jamais l'arrière (précédent reste dispo).
async function maybeExtendWindow() {
  if (extending || windowLoaded >= sourceQueue.length) return;
  const idx = (await TrackPlayer.getActiveTrackIndex()) ?? 0;
  if (windowLoaded - idx > WINDOW_AHEAD) return; // assez d'avance chargée
  extending = true;
  try {
    const next = sourceQueue.slice(windowLoaded, windowLoaded + WINDOW_BATCH);
    if (next.length) {
      await TrackPlayer.add(next.map(toPlayerTrack));
      windowLoaded += next.length;
    }
  } catch {
    // ignore : on réessaiera au prochain changement de piste
  } finally {
    extending = false;
  }
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

// Applique un mode. Avec la file fenêtrée, on ne réordonne PAS la file déjà
// chargée (ça impliquerait de gros remove/add bloquants) : on se contente du
// RepeatMode. Le changement d'ordre (aléatoire ↔ ordonné) prend effet au
// prochain morceau lancé, qui refige sourceQueue. [TODO: réordonner la fenêtre]
async function applyMode(mode: PlayMode, _prev: PlayMode) {
  if (mode === 'loop-once') loopOncePlayed = false; // ré-arme la répétition unique
  await TrackPlayer.setRepeatMode(repeatModeFor(mode));
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
    artwork:  t.artUri || undefined, // "" (pas de pochette) → undefined
    duration: t.duration ? t.duration / 1000 : undefined, // ms → secondes
    genre:    t.genre,
  };
}

// ─── Contrôles (fonctions module, sans état React) ───────────────────────────
// Sorties du hook pour qu'un composant puisse les appeler SANS s'abonner à la
// progression/à l'état (donc sans re-render 2×/s). usePlayer() ne fait plus que
// exposer l'état réactif nécessaire à l'affichage.

// Joue un morceau. On fige l'ordre de lecture complet dans sourceQueue, mais on
// ne charge dans le moteur audio qu'une FENÊTRE initiale (WINDOW_INITIAL pistes).
// Le reste est ajouté au fil de l'eau par maybeExtendWindow() → démarrage
// instantané même avec des milliers de titres (track-player tourne sur le thread
// UI, donc un gros add bloquerait tout : voir maybeExtendWindow).
export async function playTrack(track: any, queue: any[]) {
  setOptimistic(null); // nouveau morceau : on repart sur l'état réel
  await TrackPlayer.reset();
  const clickedIdx = queue.findIndex(t => t.id === track.id);
  const ordered = clickedIdx >= 0
    ? [...queue.slice(clickedIdx), ...queue.slice(0, clickedIdx)]
    : [track, ...queue];
  // Ordre de lecture figé (mélangé d'emblée en mode aléatoire, sauf le 1er).
  sourceQueue = currentMode === 'shuffle'
    ? [ordered[0], ...shuffled(ordered.slice(1))]
    : ordered;
  loopOncePlayed = false;
  windowLoaded = Math.min(WINDOW_INITIAL, sourceQueue.length);
  await TrackPlayer.add(sourceQueue.slice(0, windowLoaded).map(toPlayerTrack));
  await TrackPlayer.setRepeatMode(repeatModeFor(currentMode));
  await TrackPlayer.play();
}

// Insère un morceau juste après le morceau courant (« Lire ensuite »).
export async function addNext(track: any) {
  const queue = await TrackPlayer.getQueue();
  if (queue.length === 0) {
    sourceQueue = [track];
    windowLoaded = 1;
    await TrackPlayer.add([toPlayerTrack(track)]);
    await TrackPlayer.play();
    return;
  }
  // La fenêtre du player est contiguë depuis sourceQueue[0], donc l'index player
  // == l'index sourceQueue. On insère au même endroit dans les deux, et la
  // fenêtre chargée gagne une piste.
  const idx = (await TrackPlayer.getActiveTrackIndex()) ?? 0;
  await TrackPlayer.add([toPlayerTrack(track)], idx + 1);
  sourceQueue.splice(idx + 1, 0, track);
  if (idx + 1 <= windowLoaded) windowLoaded += 1;
}

export async function togglePlay() {
  // Décision immédiate sur l'état mis en cache (pas d'aller-retour natif avant
  // d'agir) ; on bascule aussi l'icône tout de suite (optimiste).
  const willPlay = lastPlaybackState !== State.Playing;
  setOptimistic(willPlay);
  if (willPlay) await TrackPlayer.play();
  else await TrackPlayer.pause();
}

export const skipNext = () => { setOptimistic(null); TrackPlayer.skipToNext().catch(() => {}); };
export const skipPrev = () => { setOptimistic(null); TrackPlayer.skipToPrevious().catch(() => {}); };
export const seekTo   = (pos: number) => { TrackPlayer.seekTo(pos); };

export async function cyclePlayMode() {
  const prev = currentMode;
  const next = MODE_CYCLE[(MODE_CYCLE.indexOf(prev) + 1) % MODE_CYCLE.length];
  currentMode = next;
  notifyMode();
  await applyMode(next, prev);
}

// Hook réactif léger : état d'affichage seulement (PAS la progression, qui
// changerait 2×/s ; voir useProgress, à utiliser dans un sous-composant dédié).
export function usePlayer() {
  const playbackState = usePlaybackState();
  const activeTrack   = useActiveTrack();
  const [playMode, setPlayMode] = useState<PlayMode>(currentMode);
  const [, rerender] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    const sub = (m: PlayMode) => setPlayMode(m);
    modeSubscribers.add(sub);
    setPlayMode(currentMode);
    const optSub = () => rerender();
    optimisticSubs.add(optSub);
    return () => { modeSubscribers.delete(sub); optimisticSubs.delete(optSub); };
  }, []);

  const realPlaying = playbackState.state === State.Playing;

  // Dès que le natif rejoint l'état optimiste visé, on efface l'optimiste pour
  // repasser sur l'état réel (gère aussi les changements via la notification).
  useEffect(() => {
    if (optimisticPlaying !== null && optimisticPlaying === realPlaying) {
      setOptimistic(null);
    }
  }, [realPlaying]);

  const isPlaying = optimisticPlaying ?? realPlaying;
  // Pas de spinner tant qu'un état optimiste est affiché (on montre pause/play).
  const isLoading = optimisticPlaying === null &&
                    (playbackState.state === State.Loading ||
                     playbackState.state === State.Buffering);

  return {
    isPlaying,
    isLoading,
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
