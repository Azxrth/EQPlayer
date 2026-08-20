import {NativeModules} from 'react-native';

// Module natif : lit les gains ReplayGain d'un fichier (FLAC). Voir ReplayGainModule.kt.
const Native = (NativeModules as any).ReplayGain as
  | {read(path: string): Promise<{track?: number; album?: number} | null>}
  | undefined;

export type RgMode = 'off' | 'track' | 'album';

// dB → facteur linéaire de volume (ex. -6 dB → 0.5).
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

// Gains (dB) d'une piste, ou null si le fichier n'en a pas.
export async function readReplayGain(
  path: string | undefined | null,
): Promise<{track?: number; album?: number} | null> {
  if (!Native || !path) return null;
  try {
    return await Native.read(path);
  } catch {
    return null;
  }
}

// Facteur de volume à appliquer pour un mode donné (borné à 1 : on ne peut
// qu'atténuer avec setVolume ≤ 1, jamais amplifier). 1 = pas de changement.
export function replayGainFactor(
  gains: {track?: number; album?: number} | null,
  mode: RgMode,
): number {
  if (!gains || mode === 'off') return 1;
  // En mode album, on préfère le gain d'album (préserve les écarts voulus au sein
  // d'un album) et on retombe sur la piste s'il manque.
  const db = mode === 'album' ? gains.album ?? gains.track : gains.track ?? gains.album;
  if (db == null) return 1;
  return Math.min(1, dbToLinear(db));
}
