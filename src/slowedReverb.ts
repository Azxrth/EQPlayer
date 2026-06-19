import {NativeModules} from 'react-native';

// ─── Vitesse + pitch (« slowed ») ────────────────────────────────────────────
// On passe par le module natif TrackPlayerModule (méthode ajoutée par le patch
// react-native-track-player) : setRatePitch règle vitesse ET pitch ensemble sur
// l'ExoPlayer, ce que l'API publique de track-player ne permet pas (setRate ne
// touche que la vitesse, pitch préservé → ce n'est PAS le son slowed).
const TP = (NativeModules as any).TrackPlayerModule as
  | {setRatePitch(rate: number, pitch: number): Promise<void>}
  | undefined;

// Module natif de réverbération (PresetReverb sur la session 0). Android only.
const Reverb = (NativeModules as any).SlowedReverb as
  | {
      isAvailable(): Promise<boolean>;
      setPreset(level: number): Promise<void>;
      setEnabled(enabled: boolean): Promise<void>;
      release(): Promise<void>;
    }
  | undefined;

// Bornes de la vitesse (la vitesse pilote aussi le pitch : 0.85 = -15 % des deux).
export const SR_SPEED_MIN = 0.7;
export const SR_SPEED_MAX = 1.3;

// Presets de réverbération (index = valeur PresetReverb : 0=off, 1..6).
export const REVERB_NAMES = [
  'Désactivée', 'Petite pièce', 'Pièce', 'Grande pièce', 'Salle', 'Grande salle', 'Plate',
];

// Préréglages combinés vitesse + réverbération.
export type SrPreset = {name: string; speed: number; reverb: number};
export const SR_PRESETS: SrPreset[] = [
  {name: 'Normal',          speed: 1.0,  reverb: 0},
  {name: 'Slowed + Reverb', speed: 0.85, reverb: 5},
  {name: 'Super slowed',    speed: 0.8,  reverb: 6},
  {name: 'Sped up',         speed: 1.15, reverb: 0},
  {name: 'Nightcore',       speed: 1.25, reverb: 2},
];

// Dernière valeur appliquée — réutilisée pour réappliquer après un changement de
// file (TrackPlayer.reset peut remettre l'ExoPlayer aux paramètres par défaut).
let currentSpeed = 1.0;

export const isReverbAvailable = () => !!Reverb;

export async function reverbCheck(): Promise<boolean> {
  if (!Reverb) return false;
  try {
    return await Reverb.isAvailable();
  } catch {
    return false;
  }
}

// Applique la vitesse (et le pitch, identique → son slowed authentique).
export function setSpeed(speed: number) {
  currentSpeed = speed;
  TP?.setRatePitch(speed, speed).catch(() => {});
}

// Réapplique la dernière vitesse connue (à appeler après un nouveau playTrack).
export function reapplySpeed() {
  if (currentSpeed !== 1.0) TP?.setRatePitch(currentSpeed, currentSpeed).catch(() => {});
}

// Niveau de réverbération : 0 = off, 1..6 = presets.
export function setReverb(level: number) {
  Reverb?.setPreset(level).catch(() => {});
}
