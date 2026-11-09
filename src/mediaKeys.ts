import {DeviceEventEmitter} from 'react-native';
import {skipNext, skipPrevAlways, seekBy} from './usePlayer';

// Reçoit les événements des boutons physiques (émis par MainActivity) :
//  - EqKeyDown              : première pression d'un bouton seek (prev/next)
//  - EqMediaKeyTap  {dir}   : appui court → piste suivante/précédente
//  - EqMediaKeySeek {delta} : maintien → avance/recul de `delta` s
//
// Sur certaines ROMs (JM21), la MediaSession reçoit AUSSI les touches en
// parallèle de l'Activity. On timestamp la dernière pression physique pour
// bloquer RemotePrevious/RemoteNext dans PlaybackService pendant que l'Activity
// gère elle-même le bouton.

let hwKeyDownAt = 0;
export function isHwKeyActive(): boolean {
  return Date.now() - hwKeyDownAt < 1500;
}

let installed = false;

export function setupMediaKeys() {
  if (installed) return;
  installed = true;

  DeviceEventEmitter.addListener('EqKeyDown', () => {
    hwKeyDownAt = Date.now();
  });

  DeviceEventEmitter.addListener('EqMediaKeyTap', (e: {dir?: string}) => {
    // Bouton physique : toujours sauter à la piste préc./suiv. sans la logique
    // « restart si > 3 s » (réservée au bouton UI et à la notification).
    if (e?.dir === 'prev') skipPrevAlways();
    else skipNext();
  });

  DeviceEventEmitter.addListener('EqMediaKeySeek', (e: {delta?: number}) => {
    if (typeof e?.delta === 'number') void seekBy(e.delta);
  });
}
