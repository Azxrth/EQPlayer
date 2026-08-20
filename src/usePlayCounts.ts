import {useEffect, useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'playCounts';

// ---- Store partagé (niveau module) --------------------------------------
// Compteur de lectures par id de piste (pour l'onglet « + Joués »). Même
// approche que useFavorites : map partagée + abonnement + persistance.
let counts: Record<string, number> = {};
let loaded = false;
const subscribers = new Set<(c: Record<string, number>) => void>();

function notify() {
  subscribers.forEach(fn => fn(counts));
}

function persist() {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(counts)).catch(() => {});
}

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      counts = JSON.parse(raw);
      notify();
    }
  } catch {
    // stockage illisible : compteurs vides
  }
}

// Incrémente le compteur d'une piste (appelé à chaque changement de piste active).
// Charge d'abord le stock persistant pour ne pas écraser l'historique existant.
export function bumpPlayCount(id: string) {
  if (!id) return;
  const apply = () => {
    counts = {...counts, [id]: (counts[id] ?? 0) + 1};
    persist();
    notify();
  };
  if (loaded) apply();
  else load().then(apply);
}

// Map réactive id -> nombre de lectures (déclenche le chargement au 1er montage).
export function usePlayCounts(): Record<string, number> {
  const [map, setMap] = useState<Record<string, number>>(counts);
  useEffect(() => {
    const sub = (c: Record<string, number>) => setMap({...c});
    subscribers.add(sub);
    setMap({...counts});
    load();
    return () => {
      subscribers.delete(sub);
    };
  }, []);
  return map;
}
