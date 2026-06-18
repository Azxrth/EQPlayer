import {NativeModules} from 'react-native';

// Module natif parametric EQ (DynamicsProcessing) — Android uniquement.
const Native = (NativeModules as any).ParametricEq as
  | {
      configure(freqs: number[], gains: number[] | null): Promise<void>;
      getInfo(): Promise<RawInfo>;
      setGain(index: number, db: number): Promise<void>;
      setFreq(index: number, hz: number): Promise<void>;
      setEnabled(enabled: boolean): Promise<void>;
      release(): Promise<void>;
    }
  | undefined;

type RawBand = {index: number; freq: number; gain: number};
type RawInfo = {minDb: number; maxDb: number; bands: RawBand[]; enabled: boolean};

export type PeqBand = {freq: number; gain: number};
export type PeqInfo = {minDb: number; maxDb: number; bands: RawBand[]; enabled: boolean};

export const isPeqAvailable = () => !!Native;

export async function peqGetInfo(): Promise<PeqInfo | null> {
  if (!Native) return null;
  try {
    return await Native.getInfo();
  } catch {
    return null;
  }
}

// Reconfigure entièrement l'EQ (nombre de bandes + fréquences + gains).
export function peqConfigure(bands: PeqBand[]) {
  Native?.configure(bands.map(b => b.freq), bands.map(b => b.gain)).catch(() => {});
}

export function peqSetGain(index: number, db: number) {
  Native?.setGain(index, db).catch(() => {});
}

export function peqSetFreq(index: number, hz: number) {
  Native?.setFreq(index, hz).catch(() => {});
}

export function peqSetEnabled(enabled: boolean) {
  Native?.setEnabled(enabled).catch(() => {});
}

// Préréglages : courbes de gain (dB) par fréquence, interpolées en log-fréquence
// sur les fréquences courantes des bandes (indépendant du nombre de bandes).
type Curve = {hz: number; db: number}[];
const PRESETS: Record<string, Curve> = {
  Rock:           [{hz:60,db:5},  {hz:230,db:3}, {hz:910,db:-1}, {hz:3600,db:3}, {hz:14000,db:5}],
  Pop:            [{hz:60,db:-1}, {hz:230,db:2}, {hz:910,db:4},  {hz:3600,db:2}, {hz:14000,db:-1}],
  Jazz:           [{hz:60,db:3},  {hz:230,db:2}, {hz:910,db:-1}, {hz:3600,db:2}, {hz:14000,db:3}],
  'Électronique': [{hz:60,db:6},  {hz:230,db:1}, {hz:910,db:0},  {hz:3600,db:1}, {hz:14000,db:4}],
  Classique:      [{hz:60,db:4},  {hz:230,db:2}, {hz:910,db:-1}, {hz:3600,db:2}, {hz:14000,db:4}],
};

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

// Gains (dB) à appliquer à chaque fréquence pour un préréglage donné.
export function presetGainsFor(name: string, freqs: number[]): number[] {
  const curve = PRESETS[name];
  if (!curve) return freqs.map(() => 0); // 'Aucun' / 'Personnalisé'
  return freqs.map(hz => Math.round(interpDb(curve, hz) * 10) / 10);
}

// Étiquette courte pour une fréquence en Hz (45, 90, 1.5k, 16k…)
export function hzLabel(hz: number): string {
  if (hz >= 1000) {
    const k = hz / 1000;
    return (k >= 10 ? Math.round(k) : Math.round(k * 10) / 10) + 'k';
  }
  return String(Math.round(hz));
}
