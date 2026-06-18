import {useEffect, useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Playlist = {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
};

const STORAGE_KEY = 'playlists';

// ---- Store partagé (niveau module) --------------------------------------
// Même approche que usePlayer : un état unique partagé par toutes les vues
// (onglet Playlists, lecteur, lignes de morceaux) avec abonnement + persistance.
let playlists: Playlist[] = [];
let loaded = false;
const subscribers = new Set<(p: Playlist[]) => void>();

function notify() {
  subscribers.forEach(fn => fn(playlists));
}

function persist() {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(playlists)).catch(() => {});
}

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      playlists = JSON.parse(raw);
      notify();
    }
  } catch {
    // stockage illisible : on garde la liste vide
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function createPlaylist(name: string): Playlist {
  const pl: Playlist = {
    id: uid(),
    name: name.trim() || 'Nouvelle playlist',
    trackIds: [],
    createdAt: Date.now(),
  };
  playlists = [pl, ...playlists];
  persist();
  notify();
  return pl;
}

export function renamePlaylist(id: string, name: string) {
  playlists = playlists.map(p => (p.id === id ? {...p, name: name.trim() || p.name} : p));
  persist();
  notify();
}

export function deletePlaylist(id: string) {
  playlists = playlists.filter(p => p.id !== id);
  persist();
  notify();
}

export function addTrack(id: string, trackId: string) {
  playlists = playlists.map(p =>
    p.id === id && !p.trackIds.includes(trackId)
      ? {...p, trackIds: [...p.trackIds, trackId]}
      : p,
  );
  persist();
  notify();
}

export function removeTrack(id: string, trackId: string) {
  playlists = playlists.map(p =>
    p.id === id ? {...p, trackIds: p.trackIds.filter(t => t !== trackId)} : p,
  );
  persist();
  notify();
}

export function toggleTrack(id: string, trackId: string) {
  const pl = playlists.find(p => p.id === id);
  if (!pl) return;
  if (pl.trackIds.includes(trackId)) removeTrack(id, trackId);
  else addTrack(id, trackId);
}

// Renvoie la liste réactive des playlists (déclenche le chargement au 1er montage).
export function usePlaylists(): Playlist[] {
  const [list, setList] = useState<Playlist[]>(playlists);
  useEffect(() => {
    const sub = (p: Playlist[]) => setList([...p]);
    subscribers.add(sub);
    setList([...playlists]);
    load();
    return () => {
      subscribers.delete(sub);
    };
  }, []);
  return list;
}
