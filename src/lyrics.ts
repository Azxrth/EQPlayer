import {NativeModules} from 'react-native';

// Module natif de lecture des .lrc sidecar (Android). Voir LyricsModule.kt.
const Native = (NativeModules as any).Lyrics as
  | {
      isGranted(): Promise<boolean>;
      requestAccess(): Promise<void>;
      read(audioPath: string): Promise<string | null>;
    }
  | undefined;

export type LrcLine = {time: number; text: string};
export type Lyrics = {
  synced: boolean;      // true si au moins une ligne est horodatée
  lines: LrcLine[];     // lignes horodatées (triées), vide si non synchronisé
  plain: string[];      // texte brut (utilisé si non synchronisé)
};

export const EMPTY_LYRICS: Lyrics = {synced: false, lines: [], plain: []};

// Accès « tous les fichiers » accordé ?
export async function lyricsAccessGranted(): Promise<boolean> {
  if (!Native) return false;
  try { return await Native.isGranted(); } catch { return false; }
}

// Ouvre l'écran système pour accorder l'accès.
export async function requestLyricsAccess(): Promise<void> {
  try { await Native?.requestAccess(); } catch { /* ignore */ }
}

// Charge + parse les paroles d'un morceau (via son chemin fichier).
export async function loadLyrics(audioPath: string | undefined | null): Promise<Lyrics> {
  if (!Native || !audioPath) return EMPTY_LYRICS;
  try {
    const raw = await Native.read(audioPath);
    return raw ? parseLrc(raw) : EMPTY_LYRICS;
  } catch {
    return EMPTY_LYRICS;
  }
}

// [mm:ss], [mm:ss.xx] ou [mm:ss.xxx] — refuse les variantes métadonnées type
// [00:00.00-1] (le « -1 » empêche le match, la ligne devient du texte brut filtré).
const TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
// Balises d'entête LRC ([ar:], [ti:], [by:], [offset:]…) et métadonnées NetEase.
const ID_TAG = /^\[[a-z]+:/i;
const META_TAG = /\[\d{1,3}:\d{1,2}[.:]\d{1,3}-\d+\]/;

// Convertit min/sec/fraction en secondes. La fraction est interprétée selon sa
// longueur : « 5 »→0.5s, « 24 »→0.24s, « 241 »→0.241s.
function toSeconds(min: string, sec: string, frac?: string): number {
  const f = frac ? parseInt(frac, 10) / Math.pow(10, frac.length) : 0;
  return parseInt(min, 10) * 60 + parseInt(sec, 10) + f;
}

export function parseLrc(raw: string): Lyrics {
  const lines: LrcLine[] = [];
  const plain: string[] = [];
  for (const rawLine of raw.replace(/\r/g, '').split('\n')) {
    // Répare une accolade ouvrante manquante en tête (certains .lrc sont abîmés :
    // « 00:00.467]texte » au lieu de « [00:00.467]texte »).
    const line = rawLine.trimEnd().replace(/^(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)\]/, '[$1]');
    if (!line.trim()) continue;
    if (META_TAG.test(line)) continue; // crédits 作词/作曲 horodatés à -1

    TAG.lastIndex = 0;
    const times: number[] = [];
    let m: RegExpExecArray | null;
    let end = 0;
    // On ne récolte que les balises situées en tête de ligne (LRC standard).
    while ((m = TAG.exec(line)) && m.index === end) {
      times.push(toSeconds(m[1], m[2], m[3]));
      end = TAG.lastIndex;
    }
    const text = line.slice(end).trim();
    if (times.length === 0) {
      if (!ID_TAG.test(line)) plain.push(line.trim()); // ligne sans timecode
      continue;
    }
    if (!text) continue; // balise seule sans parole
    for (const t of times) lines.push({time: t, text});
  }
  lines.sort((a, b) => a.time - b.time);
  return {synced: lines.length > 0, lines, plain: lines.length > 0 ? [] : plain};
}

// Index de la ligne active pour une position de lecture (dernière ligne dont le
// temps est <= position). Renvoie -1 avant la première ligne. Recherche linéaire
// (les paroles font au plus quelques centaines de lignes).
export function activeLineIndex(lines: LrcLine[], position: number): number {
  let lo = 0, hi = lines.length - 1, res = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= position) { res = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return res;
}
