import {useEffect, useReducer, useState} from 'react';
import {Alert} from 'react-native';
import TrackPlayer, {
  Capability,
  AppKilledPlaybackBehavior,
  State,
  Event,
  RepeatMode,
} from 'react-native-track-player';
import {reapplySpeed} from './slowedReverb';
import {applyForTrackId} from './eqTags';
import {bumpPlayCount} from './usePlayCounts';
import {readReplayGain, replayGainFactor, type RgMode} from './replayGain';
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
let canonicalQueue: any[] = [];     // même contenu, ordre NON mélangé (pour restaurer)
let windowLoaded = 0;               // nb de pistes de sourceQueue déjà dans le player
let extending = false;              // anti-réentrance de l'extension de fenêtre
const WINDOW_INITIAL = 50;          // pistes chargées d'avance au lancement
const WINDOW_AHEAD  = 20;           // on rallonge quand il reste moins que ça devant
const WINDOW_BATCH  = 50;           // taille d'un rallongement
const WINDOW_BACK   = 10;           // pistes avant le morceau cliqué pré-chargées (accès « précédent »)
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

// ─── Fondu enchaîné (fade-out fin de piste / fade-in début) ──────────────────
// ExoPlayer (un seul moteur) joue la file en gapless mais ne superpose pas deux
// morceaux : on ne peut pas faire un vrai crossfade. On fait donc un FONDU piloté
// par le volume — le sortant descend, l'entrant remonte — ce qui adoucit le
// passage entre morceaux de styles très différents. 0 s = gapless pur.
let crossfadeSec = 0;
let currentVol = 1;                 // facteur de FONDU courant (0..1), suivi pour les rampes
let volRamp: ReturnType<typeof setInterval> | null = null;
let fadingOut = false;              // on est dans le fondu de fin de la piste courante

// ReplayGain : facteur d'atténuation propre à la piste (≤ 1). Le volume envoyé au
// moteur est le PRODUIT fondu × ReplayGain, pour que les deux coexistent.
let rgMode: RgMode = 'off';
let rgFactor = 1;

function applyVolume() {
  TrackPlayer.setVolume(Math.max(0, Math.min(1, currentVol * rgFactor))).catch(() => {});
}

function stopRamp() {
  if (volRamp) { clearInterval(volRamp); volRamp = null; }
}

// Rampe le facteur de fondu vers `to` en `ms`, par petits pas (fondu lisse).
function rampVolume(to: number, ms: number) {
  stopRamp();
  const steps = Math.max(1, Math.round(ms / 40));
  const from = currentVol;
  let i = 0;
  volRamp = setInterval(() => {
    i++;
    currentVol = Math.max(0, Math.min(1, from + (to - from) * (i / steps)));
    applyVolume();
    if (i >= steps) { stopRamp(); currentVol = to; }
  }, 40);
}

// Règle la durée du fondu (secondes). 0 → gapless pur (facteur fondu = 1).
export function setCrossfadeSec(sec: number) {
  crossfadeSec = Math.max(0, sec);
  if (crossfadeSec === 0) {
    stopRamp();
    fadingOut = false;
    currentVol = 1;
    applyVolume();
  }
}

// Mode de normalisation ReplayGain + relecture immédiate pour la piste courante.
export function setReplayGainMode(mode: RgMode) {
  rgMode = mode;
  if (mode === 'off') { rgFactor = 1; applyVolume(); return; }
  void updateRgForActiveTrack();
}

// Lit le ReplayGain de la piste active et met à jour le facteur (puis applique).
async function updateRgForActiveTrack() {
  if (rgMode === 'off') { rgFactor = 1; applyVolume(); return; }
  try {
    const t: any = await TrackPlayer.getActiveTrack();
    const gains = await readReplayGain(t?.filePath);
    rgFactor = replayGainFactor(gains, rgMode);
  } catch {
    rgFactor = 1;
  }
  applyVolume();
}

// Fondu d'entrée au démarrage d'une nouvelle piste (+ relecture du ReplayGain).
function fadeInNewTrack() {
  fadingOut = false;
  void updateRgForActiveTrack();
  if (crossfadeSec <= 0) { currentVol = 1; applyVolume(); return; }
  currentVol = 0;
  applyVolume();
  rampVolume(1, crossfadeSec * 1000);
}

// Piloté par la position (donc naturellement correct en pause/seek) : déclenche le
// fondu de sortie quand il reste moins de `crossfadeSec` avant la fin ; restaure
// le plein volume si on ressort de la zone (seek arrière).
function onProgressForFade(position: number, duration: number) {
  if (crossfadeSec <= 0 || !duration) return;
  const remaining = duration - position;
  if (!fadingOut && remaining <= crossfadeSec && remaining > 0.25) {
    fadingOut = true;
    rampVolume(0, remaining * 1000);
  } else if (fadingOut && remaining > crossfadeSec + 0.5) {
    fadingOut = false;
    rampVolume(1, 200);
  }
}

// Dernière piste comptée : PlaybackActiveTrackChanged peut se déclencher 2× de
// suite pour la même piste → on ne compte qu'au changement réel de piste.
let lastCountedTrackId: string | null = null;

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
  await TrackPlayer.setupPlayer({
    minBuffer: 15000,   // s'assure qu'ExoPlayer buffere assez pour éviter les micro-coupures
    maxBuffer: 50000,   // plafond haut : fichiers locaux, la RAM du JM21 le supporte
    playBuffer: 200,    // reprend dès 200 ms de buffer prêt (défaut 2500 = pensé réseau)
    backBuffer: 30000,  // garde 30 s derrière → seeks backward sans rebuffering
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
  TrackPlayer.addEventListener(Event.PlaybackState, (e: {state: State}) => {
    lastPlaybackState = e.state;
  });

  // DIAGNOSTIC : ExoPlayer avale ses erreurs de lecture. Sans ce listener, une
  // piste qui échoue (ex. FLAC haute-résolution que le codec matériel ne sait pas
  // décoder) reste bloquée à 00:00/00:00 sans aucun message. On remonte le code +
  // message natifs à l'écran pour pouvoir diagnostiquer.
  TrackPlayer.addEventListener(Event.PlaybackError, (e: any) => {
    console.warn('[TrackPlayer] PlaybackError', e);
    Alert.alert(
      'Lecture impossible',
      `code: ${e?.code ?? '?'}\n${e?.message ?? 'erreur inconnue'}`,
    );
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
  // Fondu de sortie (piloté par la position via l'événement de progression).
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (e: {position: number; duration: number}) => {
    onProgressForFade(e.position, e.duration);
  });

  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, () => {
    fadeInNewTrack(); // fondu d'entrée de la nouvelle piste (no-op si crossfade = 0)
    void maybeExtendWindow();
    // Applique l'EQ du morceau (tag sinon EQ de base) + incrémente le compteur
    // de lectures (utilisé par l'onglet « + Joués »).
    void TrackPlayer.getActiveTrack().then(t => {
      const id = (t as any)?.id ?? null;
      applyForTrackId(id);
      if (id && String(id) !== lastCountedTrackId) {
        lastCountedTrackId = String(id);
        bumpPlayCount(String(id));
      }
    }).catch(() => {});
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

// Réordonne les pistes À VENIR de sourceQueue (après l'index courant) selon le
// mode : aléatoire = mélange la suite ; ordonné = restaure l'ordre canonique
// (canonicalQueue) en retirant les pistes déjà passées.
function reorderUpcomingSource(idx: number, mode: PlayMode) {
  const head = sourceQueue.slice(0, idx + 1);
  if (mode === 'shuffle') {
    sourceQueue = [...head, ...shuffled(sourceQueue.slice(idx + 1))];
  } else {
    const passed = new Set(head.map(t => t.id));
    const tail = canonicalQueue.filter(t => !passed.has(t.id));
    sourceQueue = [...head, ...tail];
  }
}

// Recharge la portion « à venir » de la fenêtre du player pour coller à
// sourceQueue (après un réordonnancement). Borné à WINDOW_INITIAL → jamais de
// gros bloc bloquant. Le reste sera rallongé par maybeExtendWindow.
async function rebuildUpcoming() {
  const idx = (await TrackPlayer.getActiveTrackIndex()) ?? 0;
  const len = (await TrackPlayer.getQueue()).length;
  const toRemove: number[] = [];
  for (let i = idx + 1; i < len; i++) toRemove.push(i);
  if (toRemove.length) await TrackPlayer.remove(toRemove);
  const next = sourceQueue.slice(idx + 1, idx + 1 + WINDOW_INITIAL);
  if (next.length) await TrackPlayer.add(next.map(toPlayerTrack));
  windowLoaded = idx + 1 + next.length;
}

// Applique un mode : RepeatMode + réordonnancement de la file (fenêtré).
async function applyMode(mode: PlayMode, prev: PlayMode) {
  if (mode === 'loop-once') loopOncePlayed = false; // ré-arme la répétition unique
  await TrackPlayer.setRepeatMode(repeatModeFor(mode));
  // Entrée/sortie du mode aléatoire → on réordonne les pistes à venir.
  if ((mode === 'shuffle') !== (prev === 'shuffle') && sourceQueue.length) {
    const idx = (await TrackPlayer.getActiveTrackIndex()) ?? 0;
    reorderUpcomingSource(idx, mode);
    await rebuildUpcoming();
  }
}

// Convertit un Track de l'app en objet TrackPlayer.
// On joue via l'URI MediaStore content:// (id = _ID MediaStore) plutôt que le
// chemin file:// : sous Android scoped storage, l'accès file:// aux fichiers sur
// carte SD amovible est refusé, alors que content:// fonctionne (READ_MEDIA_AUDIO).
export function toPlayerTrack(t: any) {
  return {
    id:       t.id,
    // AIFF : ExoPlayer ne le décode pas → on passe par notre ContentProvider qui
    // le sert comme du WAV (content://com.eqplayer.aiff/<id>).
    url:      t.format === 'AIFF' && t.id ? `content://com.eqplayer.aiff/${t.id}`
            : t.id ? `content://media/external/audio/media/${t.id}`
            : t.filePath ? `file://${t.filePath}` : '',
    title:    t.title,
    artist:   t.artist,
    album:    t.album,
    artwork:  t.artUri || undefined, // "" (pas de pochette) → undefined
    duration: t.duration ? t.duration / 1000 : undefined, // ms → secondes
    genre:    t.genre,
    filePath: t.filePath, // conservé pour retrouver le .lrc voisin (paroles)
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

  let startOffset = 0; // index du morceau cliqué dans sourceQueue

  if (currentMode === 'shuffle') {
    // Shuffle : morceau cliqué en tête, reste mélangé (comportement inchangé).
    const ordered = clickedIdx >= 0
      ? [...queue.slice(clickedIdx), ...queue.slice(0, clickedIdx)]
      : [track, ...queue];
    canonicalQueue = ordered;
    sourceQueue = [ordered[0], ...shuffled(ordered.slice(1))];
  } else {
    // Normal : on inclut jusqu'à WINDOW_BACK pistes avant le morceau cliqué
    // pour que « précédent » fonctionne dès le premier appui.
    const backCount  = clickedIdx > 0 ? Math.min(clickedIdx, WINDOW_BACK) : 0;
    const queueStart = clickedIdx - backCount;
    const ordered = clickedIdx >= 0
      ? [...queue.slice(queueStart), ...queue.slice(0, queueStart)]
      : [track, ...queue];
    canonicalQueue = ordered;
    sourceQueue    = ordered;
    startOffset    = backCount; // le morceau cliqué est à cet index dans sourceQueue
  }

  loopOncePlayed = false;
  windowLoaded = Math.min(WINDOW_INITIAL, sourceQueue.length);
  await TrackPlayer.add(sourceQueue.slice(0, windowLoaded).map(toPlayerTrack));
  await TrackPlayer.setRepeatMode(repeatModeFor(currentMode));
  if (startOffset > 0) await TrackPlayer.skip(startOffset);
  await TrackPlayer.play();
  // reset() a pu remettre l'ExoPlayer à la vitesse normale → on réapplique.
  reapplySpeed();
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
  // garde la file canonique cohérente (sinon perdue à une restauration d'ordre)
  const cpos = canonicalQueue.findIndex(t => t.id === sourceQueue[idx]?.id);
  if (cpos >= 0) canonicalQueue.splice(cpos + 1, 0, track);
  else canonicalQueue.push(track);
}

export async function togglePlay() {
  // Décision immédiate sur l'état mis en cache (pas d'aller-retour natif avant
  // d'agir) ; on bascule aussi l'icône tout de suite (optimiste).
  const willPlay = lastPlaybackState !== State.Playing;
  setOptimistic(willPlay);
  if (willPlay) await TrackPlayer.play();
  else await TrackPlayer.pause();
}

export const skipNext     = () => { setOptimistic(null); TrackPlayer.skipToNext().catch(() => {}); };
export const skipPrevAlways = () => { setOptimistic(null); TrackPlayer.skipToPrevious().catch(() => {}); };
// « Précédent » à la manière des lecteurs classiques : un appui remet le morceau
// au début ; ce n'est que dans les 3 premières secondes qu'on saute réellement
// à la piste précédente.
export const skipPrev = async () => {
  try {
    const { position } = await TrackPlayer.getProgress();
    if (position > 3) {
      await TrackPlayer.seekTo(0);
      return;
    }
    setOptimistic(null);
    await TrackPlayer.skipToPrevious();
  } catch {
    TrackPlayer.seekTo(0).catch(() => {});
  }
};
export const seekTo   = (pos: number) => { TrackPlayer.seekTo(pos); };

// Avance (delta > 0) ou recule (delta < 0) de `delta` secondes dans le morceau,
// borné à [0, durée]. Utilisé par le maintien des boutons physiques suiv./préc.
export const seekBy = async (delta: number) => {
  try {
    const {position, duration} = await TrackPlayer.getProgress();
    let t = position + delta;
    if (t < 0) t = 0;
    if (duration && t > duration) t = Math.max(0, duration - 0.5);
    await TrackPlayer.seekTo(t);
  } catch { /* lecteur pas prêt */ }
};

// ─── File « à suivre » (sur sourceQueue, donc TOUTE la file, pas la fenêtre) ──

// Morceaux à venir : on lit sourceQueue après l'index courant (index player ==
// index sourceQueue car la fenêtre est contiguë depuis 0). Chaque item porte
// son index sourceQueue (_sIndex) pour le saut/suppression.
// limit borne l'affichage : la liste « à suivre » est rendue dans une ScrollView
// NON virtualisée (.map), donc rendre 1800+ lignes saccaderait. 100 suffit en
// pratique ; afficher toute la file demanderait de passer le lecteur en FlatList.
export async function getUpNext(limit = 100): Promise<any[]> {
  if (!sourceQueue.length) return [];
  const idx = (await TrackPlayer.getActiveTrackIndex()) ?? 0;
  return sourceQueue.slice(idx + 1, idx + 1 + limit).map((t, i) => ({...t, _sIndex: idx + 1 + i}));
}

// Saute à une piste de la file (index sourceQueue). Si elle n'est pas encore
// dans la fenêtre chargée, on étend jusqu'à elle puis on skip.
export async function jumpToIndex(sourceIndex: number) {
  setOptimistic(null);
  while (windowLoaded <= sourceIndex && windowLoaded < sourceQueue.length) {
    const next = sourceQueue.slice(windowLoaded, windowLoaded + WINDOW_BATCH);
    if (!next.length) break;
    await TrackPlayer.add(next.map(toPlayerTrack));
    windowLoaded += next.length;
  }
  await TrackPlayer.skip(sourceIndex).catch(() => {});
  await TrackPlayer.play();
}

// Déplace une piste À VENIR dans la file (indices sourceQueue). On ne touche
// jamais au morceau courant ni à ce qui est déjà passé (indices ≤ courant). On
// réordonne sourceQueue puis on reconstruit la fenêtre « à venir » du player.
export async function moveInQueue(fromSourceIndex: number, toSourceIndex: number) {
  const idx = (await TrackPlayer.getActiveTrackIndex()) ?? 0;
  if (fromSourceIndex <= idx || toSourceIndex <= idx) return;
  if (fromSourceIndex < 0 || fromSourceIndex >= sourceQueue.length) return;
  if (toSourceIndex < 0 || toSourceIndex >= sourceQueue.length) return;
  if (fromSourceIndex === toSourceIndex) return;
  const [moved] = sourceQueue.splice(fromSourceIndex, 1);
  sourceQueue.splice(toSourceIndex, 0, moved);
  // Hors aléatoire, l'ordre manuel devient le nouvel ordre de référence (sinon
  // une sortie de shuffle le remplacerait par l'ordre canonique d'origine).
  if (currentMode !== 'shuffle') canonicalQueue = [...sourceQueue];
  await rebuildUpcoming();
}

// Retire une piste à venir (index sourceQueue) de la file.
export async function removeFromQueue(sourceIndex: number) {
  if (sourceIndex < 0 || sourceIndex >= sourceQueue.length) return;
  if (sourceIndex < windowLoaded) {
    await TrackPlayer.remove([sourceIndex]).catch(() => {});
    windowLoaded -= 1;
  }
  sourceQueue.splice(sourceIndex, 1);
}

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
  const rawLoading = optimisticPlaying === null &&
                     (playbackState.state === State.Loading ||
                      playbackState.state === State.Buffering);
  // Délai d'1 s avant d'afficher le spinner : les seeks rapides (fichiers locaux)
  // se résolvent en < 200 ms avec le nouveau playBuffer, donc le spinner n'apparaît
  // jamais pour eux. Seuls les vrais chargements longs le déclenchent.
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => {
    if (!rawLoading) { setIsLoading(false); return; }
    const t = setTimeout(() => setIsLoading(true), 1000);
    return () => clearTimeout(t);
  }, [rawLoading]);

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
