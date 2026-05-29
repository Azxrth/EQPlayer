/**
 * @format
 */

import {AppRegistry} from 'react-native';
import React from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import TrackPlayer from 'react-native-track-player';
import App from './App';
import {PlaybackService} from './PlaybackService';
import {name as appName} from './app.json';

const Root = () => (
  <SafeAreaProvider>
    <App />
  </SafeAreaProvider>
);

AppRegistry.registerComponent(appName, () => Root);
TrackPlayer.registerPlaybackService(() => PlaybackService);
