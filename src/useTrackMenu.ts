import {useEffect, useState} from 'react';

// Petit store partagé : quelle piste a son menu 3-points ouvert.
// Permet d'ouvrir le menu depuis n'importe quelle ligne sans threader des props.
let current: any = null;
const subs = new Set<(t: any) => void>();

function notify() {
  subs.forEach(fn => fn(current));
}

export function openTrackMenu(track: any) {
  current = track;
  notify();
}

export function closeTrackMenu() {
  current = null;
  notify();
}

export function useTrackMenu(): any {
  const [t, setT] = useState(current);
  useEffect(() => {
    const sub = (v: any) => setT(v);
    subs.add(sub);
    setT(current);
    return () => {
      subs.delete(sub);
    };
  }, []);
  return t;
}
