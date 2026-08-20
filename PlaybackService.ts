import TrackPlayer, {Event, State} from 'react-native-track-player';

// Ce service tourne en arrière-plan même quand l'app est en veille.
// Il reçoit les commandes du système (notification, écouteurs, CarPlay…)
export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePlay,     () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause,    () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop,     () => TrackPlayer.stop());
  TrackPlayer.addEventListener(Event.RemoteNext,     () => TrackPlayer.skipToNext());
  // Comme dans l'app : un appui remet le morceau au début, sauf dans les 3
  // premières secondes où l'on saute réellement à la piste précédente.
  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
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
