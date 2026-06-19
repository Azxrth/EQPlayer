import {useEffect, useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {peqConfigure, type PeqBand} from './peq';

// Un « tag d'égaliseur » : un nom + sa propre courbe EQ. On associe AU PLUS un
// tag par morceau ; à la lecture, le tag du morceau prime sur l'EQ de base, et
// un morceau sans tag retombe sur l'EQ de base.
export type EqTag = {id: string; name: string; bands: PeqBand[]};

const TAGS_KEY = 'eq.tags';
const MAP_KEY  = 'eq.trackTags';

// ── Store partagé (niveau module), même approche que usePlaylists ──
let tags: EqTag[] = [];
let trackTags: Record<string, string> = {}; // trackId -> tagId
let loaded = false;

// État d'application natif
let baseBands: PeqBand[] = [];        // EQ de base (défini par App)
let currentTrackId: string | null = null;
let editing = false;                  // un éditeur EQ est ouvert → on ne ré-applique pas par-dessus
let lastSig = '';                     // signature de la dernière courbe envoyée au natif

const subscribers = new Set<() => void>();
function notify() { subscribers.forEach(fn => fn()); }

function persistTags() { AsyncStorage.setItem(TAGS_KEY, JSON.stringify(tags)).catch(() => {}); }
function persistMap()  { AsyncStorage.setItem(MAP_KEY, JSON.stringify(trackTags)).catch(() => {}); }

export async function loadEqTags() {
  if (loaded) return;
  loaded = true;
  try {
    const [rawT, rawM] = await Promise.all([
      AsyncStorage.getItem(TAGS_KEY),
      AsyncStorage.getItem(MAP_KEY),
    ]);
    if (rawT) tags = JSON.parse(rawT);
    if (rawM) trackTags = JSON.parse(rawM);
    notify();
  } catch {
    // stockage illisible : on garde les valeurs par défaut
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function tagForTrack(trackId?: string | null): EqTag | undefined {
  if (!trackId) return undefined;
  const tid = trackTags[trackId];
  return tid ? tags.find(t => t.id === tid) : undefined;
}
export function getTrackTagId(trackId?: string | null): string | null {
  return (trackId && trackTags[trackId]) || null;
}
export function tracksUsingTag(tagId: string): number {
  let n = 0;
  for (const k in trackTags) if (trackTags[k] === tagId) n++;
  return n;
}

// ── Application native (le tag prime, sinon EQ de base) ──
function resolveBands(trackId: string | null): PeqBand[] {
  const tag = tagForTrack(trackId);
  return tag ? tag.bands : baseBands;
}
// force = ré-applique même si la signature est identique (sortie d'édition, etc.)
function apply(force = false) {
  if (editing) return; // un éditeur possède l'effet → ne pas écraser sa prévisualisation
  const bands = resolveBands(currentTrackId);
  if (!bands.length) return;
  const sig = JSON.stringify(bands);
  if (!force && sig === lastSig) return; // pas de changement → pas de reconfig (anti-glitch)
  lastSig = sig;
  peqConfigure(bands);
}

// Appelé au changement de morceau (depuis le lecteur).
export function applyForTrackId(trackId: string | null) {
  currentTrackId = trackId ?? null;
  apply();
}
// Appelé quand l'EQ de base change (depuis App).
export function setBaseBands(bands: PeqBand[]) {
  baseBands = bands;
  apply();
}
// Ouvre/ferme une session d'édition : à la fermeture on rétablit l'EQ résolu.
export function setEqEditing(on: boolean) {
  editing = on;
  if (!on) apply(true);
}

// ── CRUD ──
export function createTag(name: string, bands: PeqBand[]): EqTag {
  const tag: EqTag = {id: uid(), name: name.trim() || 'Tag', bands: bands.map(b => ({...b}))};
  tags = [tag, ...tags];
  persistTags(); notify();
  return tag;
}
export function renameTag(id: string, name: string) {
  tags = tags.map(t => (t.id === id ? {...t, name: name.trim() || t.name} : t));
  persistTags(); notify();
}
export function updateTagBands(id: string, bands: PeqBand[]) {
  tags = tags.map(t => (t.id === id ? {...t, bands} : t));
  persistTags(); notify();
  if (tagForTrack(currentTrackId)?.id === id) apply(true);
}
export function deleteTag(id: string) {
  tags = tags.filter(t => t.id !== id);
  let changed = false;
  for (const k in trackTags) if (trackTags[k] === id) { delete trackTags[k]; changed = true; }
  persistTags();
  if (changed) persistMap();
  notify();
  apply(true);
}
export function setTrackTag(trackId: string, tagId: string | null) {
  if (tagId) trackTags[trackId] = tagId;
  else delete trackTags[trackId];
  persistMap(); notify();
  if (trackId === currentTrackId) apply(true);
}

// Hook réactif pour l'UI (liste des tags + associations).
export function useEqTags(): {tags: EqTag[]; trackTags: Record<string, string>} {
  const [, setN] = useState(0);
  useEffect(() => {
    const sub = () => setN(n => n + 1);
    subscribers.add(sub);
    loadEqTags();
    return () => { subscribers.delete(sub); };
  }, []);
  return {tags: [...tags], trackTags: {...trackTags}};
}
