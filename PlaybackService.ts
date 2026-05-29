import TrackPlayer, {Event, State} from 'react-native-track-player';

// Ce service tourne en arrière-plan même quand l'app est en veille.
// Il reçoit les commandes du système (notification, écouteurs, CarPlay…)
export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePlay,     () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause,    () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop,     () => TrackPlayer.stop());
  TrackPlayer.addEventListener(Event.RemoteNext,     () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => TrackPlayer.skipToPrevious());
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
