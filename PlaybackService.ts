import TrackPlayer, {Event, State} from 'react-native-track-player';
import {isHwKeyActive} from './src/mediaKeys';

// Ce service tourne en arrière-plan même quand l'app est en veille.
// Il reçoit les commandes du système (notification, écouteurs, CarPlay…)
export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePlay,     () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause,    () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop,     () => TrackPlayer.stop());
  // isHwKeyActive() est vrai pendant ~1,5 s après une pression physique.
  // Sur le JM21 la ROM route les touches vers l'Activity ET la MediaSession ;
  // on laisse l'Activity gérer (via EqMediaKeyTap/EqMediaKeySeek) et on
  // ignore ici pour éviter le double-déclenchement.
  TrackPlayer.addEventListener(Event.RemoteNext,     () => {
    if (isHwKeyActive()) return;
    TrackPlayer.skipToNext();
  });
  // Bouton précédent de la notification : remet au début si > 3 s, sinon piste préc.
  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    if (isHwKeyActive()) return;
    try {
      const {position} = await TrackPlayer.getProgress();
      if (position > 3) { await TrackPlayer.seekTo(0); return; }
      await TrackPlayer.skipToPrevious();
    } catch {
      TrackPlayer.seekTo(0).catch(() => {});
    }
  });
  TrackPlayer.addEventListener(Event.RemoteSeek,     ({position}) => TrackPlayer.seekTo(position));

  TrackPlayer.addEventListener(Event.RemoteDuck, async ({permanent, paused}) => {
    if (permanent) {
      await TrackPlayer.stop();
    } else if (paused) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  });
}
