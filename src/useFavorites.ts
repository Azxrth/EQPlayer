import {useEffect, useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'favorites';

// ---- Store partagé (niveau module) --------------------------------------
// Même approche que usePlayer/usePlaylists : liste d'ids favoris partagée par
// toutes les vues (lecteur, onglet Favoris, lignes) avec abonnement + persistance.
let favorites: string[] = [];
let loaded = false;
const subscribers = new Set<(f: string[]) => void>();

function notify() {
  subscribers.forEach(fn => fn(favorites));
}

function persist() {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(favorites)).catch(() => {});
}

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      favorites = JSON.parse(raw);
      notify();
    }
  } catch {
    // stockage illisible : on garde la liste vide
  }
}

export function toggleFavorite(id: string) {
  favorites = favorites.includes(id)
    ? favorites.filter(x => x !== id)
    : [id, ...favorites];
  persist();
  notify();
}

// Liste réactive des ids favoris (déclenche le chargement au 1er montage).
export function useFavorites(): string[] {
  const [list, setList] = useState<string[]>(favorites);
  useEffect(() => {
    const sub = (f: string[]) => setList([...f]);
    subscribers.add(sub);
    setList([...favorites]);
    load();
    return () => {
      subscribers.delete(sub);
    };
  }, []);
  return list;
}
