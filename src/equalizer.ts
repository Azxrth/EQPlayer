import {NativeModules} from 'react-native';

// Module natif (présent uniquement sur Android avec un égaliseur matériel dispo)
const Native = (NativeModules as any).EqualizerModule as
  | {
      getInfo(): Promise<RawInfo>;
      setEnabled(enabled: boolean): Promise<void>;
      setBandLevel(band: number, millibels: number): Promise<void>;
      usePreset(preset: number): Promise<void>;
      release(): Promise<void>;
    }
  | undefined;

type RawBand = {index: number; centerFreq: number; level: number};
type RawInfo = {
  numberOfBands: number;
  minLevel: number;
  maxLevel: number;
  bands: RawBand[];
  presets: string[];
  enabled: boolean;
};

export type EqBand = {index: number; centerFreq: number; level: number};
export type EqInfo = {
  numberOfBands: number;
  minLevel: number;   // millibels
  maxLevel: number;   // millibels
  bands: EqBand[];
  presets: string[];
  enabled: boolean;
};

export const PRESET_NAMES = ['Aucun', 'Rock', 'Pop', 'Jazz', 'Électronique', 'Classique', 'Personnalisé'];

// Courbes de gain (dB) par fréquence, indépendantes du matériel.
// On interpole sur les fréquences réelles des bandes de l'appareil.
type Curve = {hz: number; db: number}[];
const PRESETS: Record<string, Curve> = {
  'Rock':         [{hz:60,db:5},  {hz:230,db:3}, {hz:910,db:-1}, {hz:3600,db:3}, {hz:14000,db:5}],
  'Pop':          [{hz:60,db:-1}, {hz:230,db:2}, {hz:910,db:4},  {hz:3600,db:2}, {hz:14000,db:-1}],
  'Jazz':         [{hz:60,db:3},  {hz:230,db:2}, {hz:910,db:-1}, {hz:3600,db:2}, {hz:14000,db:3}],
  'Électronique': [{hz:60,db:6},  {hz:230,db:1}, {hz:910,db:0},  {hz:3600,db:1}, {hz:14000,db:4}],
  'Classique':    [{hz:60,db:4},  {hz:230,db:2}, {hz:910,db:-1}, {hz:3600,db:2}, {hz:14000,db:4}],
};

export const isEqAvailable = () => !!Native;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Interpolation linéaire en échelle log-fréquence
function interpDb(curve: Curve, hz: number): number {
  if (hz <= curve[0].hz) return curve[0].db;
  const last = curve[curve.length - 1];
  if (hz >= last.hz) return last.db;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i], b = curve[i + 1];
    if (hz >= a.hz && hz <= b.hz) {
      const t = (Math.log(hz) - Math.log(a.hz)) / (Math.log(b.hz) - Math.log(a.hz));
      return a.db + t * (b.db - a.db);
    }
  }
  return 0;
}

export async function getEqInfo(): Promise<EqInfo | null> {
  if (!Native) return null;
  try {
    return await Native.getInfo();
  } catch {
    return null;
  }
}

export function setBandLevel(band: number, millibels: number) {
  Native?.setBandLevel(band, Math.round(millibels)).catch(() => {});
}

export function setEnabled(enabled: boolean) {
  Native?.setEnabled(enabled).catch(() => {});
}

// Applique un préréglage et renvoie les niveaux (millibels) par bande pour l'UI.
export async function applyPreset(name: string, info: EqInfo): Promise<number[]> {
  if (!Native) return info.bands.map(() => 0);

  if (name === 'Aucun') {
    await Promise.all(info.bands.map(b => Native!.setBandLevel(b.index, 0).catch(() => {})));
    await Native.setEnabled(false).catch(() => {});
    return info.bands.map(() => 0);
  }

  await Native.setEnabled(true).catch(() => {});
  const curve = PRESETS[name];
  if (!curve) {
    // 'Personnalisé' : on garde les niveaux courants
    return info.bands.map(b => b.level);
  }
  const levels = info.bands.map(b => {
    const hz = b.centerFreq / 1000; // milliHz -> Hz
    return clamp(Math.round(interpDb(curve, hz) * 100), info.minLevel, info.maxLevel);
  });
  await Promise.all(info.bands.map((b, i) => Native!.setBandLevel(b.index, levels[i]).catch(() => {})));
  return levels;
}

// Applique une liste explicite de niveaux (préréglage Personnalisé restauré)
export async function applyLevels(info: EqInfo, levels: number[]) {
  if (!Native) return;
  await Native.setEnabled(true).catch(() => {});
  await Promise.all(
    info.bands.map((b, i) => Native!.setBandLevel(b.index, levels[i] ?? 0).catch(() => {})),
  );
}

// Étiquette courte pour une fréquence (en milliHz)
export function freqLabel(centerFreqMilliHz: number): string {
  const hz = centerFreqMilliHz / 1000;
  if (hz >= 1000) {
    const k = hz / 1000;
    return (k >= 10 ? Math.round(k) : Math.round(k * 10) / 10) + 'k';
  }
  return String(Math.round(hz));
}
