import React, {useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  StatusBar,
} from 'react-native';

const {width} = Dimensions.get('window');

const tracks = [
  {id: '1', title: "God's Plan", artist: 'Drake', genre: 'Rap', duration: '3:18', color: '#1a3a5c', accent: '#4a9eff'},
  {id: '2', title: 'Machina', artist: 'Pendulum', genre: 'D&B', duration: '4:02', color: '#4a1a7a', accent: '#c44aff'},
  {id: '3', title: 'SICKO MODE', artist: 'Travis Scott', genre: 'Rap', duration: '5:13', color: '#4a3a00', accent: '#ffb800'},
  {id: '4', title: 'Jungle Sound', artist: 'Noisia', genre: 'D&B', duration: '4:47', color: '#004a30', accent: '#00e87a'},
  {id: '5', title: 'Humble.', artist: 'Kendrick Lamar', genre: 'Rap', duration: '2:57', color: '#4a1800', accent: '#ff5722'},
];

const eqBands = ['60', '150', '400', '1k', '2.4k', '6k', '10k', '14k', '16k', '20k'];

export default function App() {
  const [currentIdx, setCurrentIdx] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [fav, setFav] = useState(false);

  const track = tracks[currentIdx];

  return (
    <View style={[styles.container, {backgroundColor: track.color}]}>
      <StatusBar barStyle="light-content" />
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconBtn}>
            <Text style={styles.iconText}>⌄</Text>
          </TouchableOpacity>
          <Text style={styles.topTitle}>En cours de lecture</Text>
          <TouchableOpacity style={styles.iconBtn}>
            <Text style={styles.iconText}>⋮</Text>
          </TouchableOpacity>
        </View>

        {/* Cover */}
        <View style={styles.coverArea}>
          <View style={[styles.cover, {backgroundColor: track.accent + '44'}]}>
            <Text style={styles.coverEmoji}>♪</Text>
          </View>
        </View>

        {/* Track info */}
        <View style={styles.trackInfo}>
          <View style={styles.trackRow}>
            <View>
              <Text style={styles.trackTitle}>{track.title}</Text>
              <Text style={styles.trackArtist}>{track.artist}</Text>
            </View>
            <View style={styles.trackActions}>
              <TouchableOpacity
                style={[styles.iconBtn, fav && {backgroundColor: track.accent}]}
                onPress={() => setFav(!fav)}>
                <Text style={styles.iconText}>{fav ? '♥' : '♡'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn}>
                <Text style={styles.iconText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Progress bar */}
        <View style={styles.progressArea}>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, {backgroundColor: '#fff', width: '35%'}]} />
          </View>
          <View style={styles.timeRow}>
            <Text style={styles.timeText}>1:24</Text>
            <Text style={styles.timeText}>{track.duration}</Text>
          </View>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <TouchableOpacity style={styles.ctrlBtn}>
            <Text style={styles.ctrlText}>⇄</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ctrlBtn}
            onPress={() => setCurrentIdx((currentIdx - 1 + tracks.length) % tracks.length)}>
            <Text style={styles.ctrlText}>⏮</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.playBtn}
            onPress={() => setPlaying(!playing)}>
            <Text style={styles.playText}>{playing ? '⏸' : '▶'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ctrlBtn}
            onPress={() => setCurrentIdx((currentIdx + 1) % tracks.length)}>
            <Text style={styles.ctrlText}>⏭</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ctrlBtn}>
            <Text style={styles.ctrlText}>↺</Text>
          </TouchableOpacity>
        </View>

        {/* EQ Section */}
        <View style={styles.eqSection}>
          <View style={styles.eqHeader}>
            <Text style={styles.eqLabel}>Égaliseur — ce morceau</Text>
            <View style={styles.eqBadge}>
              <Text style={[styles.eqBadgeText, {color: track.accent}]}>{track.genre}</Text>
            </View>
          </View>
          <View style={styles.eqBars}>
            {[4, 6, 3, 5, 2, 4, 3, 5, 4, 3].map((val, i) => (
              <View key={i} style={styles.eqBarWrap}>
                <View style={[styles.eqBar, {height: val * 6, backgroundColor: track.accent}]} />
                <Text style={styles.eqBarLabel}>{eqBands[i]}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Queue */}
        <View style={styles.queueSection}>
          <Text style={styles.queueTitle}>PROCHAINS MORCEAUX</Text>
          {tracks.filter((_, i) => i !== currentIdx).map((t, i) => (
            <TouchableOpacity
              key={t.id}
              style={styles.trackItem}
              onPress={() => setCurrentIdx(tracks.indexOf(t))}>
              <View style={[styles.trackThumb, {backgroundColor: t.accent + '44'}]}>
                <Text style={styles.thumbEmoji}>♪</Text>
              </View>
              <View style={styles.trackMeta}>
                <Text style={styles.trackItemName}>{t.title}</Text>
                <Text style={styles.trackItemSub}>{t.artist} · {t.genre}</Text>
              </View>
              <View style={[styles.eqDot, {backgroundColor: t.accent}]} />
              <Text style={styles.trackDuration}>{t.duration}</Text>
              <TouchableOpacity style={styles.removeBtn}>
                <Text style={styles.removeBtnText}>✕</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
  topBar: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 52, paddingBottom: 8},
  topTitle: {fontSize: 14, fontWeight: '500', color: '#fff'},
  iconBtn: {width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.3)'},
  iconText: {color: '#fff', fontSize: 18},
  coverArea: {paddingHorizontal: 28, paddingVertical: 16},
  cover: {width: '100%', aspectRatio: 1, borderRadius: 20, alignItems: 'center', justifyContent: 'center'},
  coverEmoji: {fontSize: 80},
  trackInfo: {paddingHorizontal: 24, marginTop: 8},
  trackRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  trackTitle: {fontSize: 21, fontWeight: '600', color: '#fff'},
  trackArtist: {fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 3},
  trackActions: {flexDirection: 'row', gap: 6},
  progressArea: {paddingHorizontal: 24, marginTop: 16},
  progressBg: {height: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2},
  progressFill: {height: 4, borderRadius: 2},
  timeRow: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 6},
  timeText: {fontSize: 11, color: 'rgba(255,255,255,0.5)'},
  controls: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 18},
  ctrlBtn: {width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.3)'},
  ctrlText: {color: '#fff', fontSize: 20},
  playBtn: {width: 68, height: 68, borderRadius: 34, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center'},
  playText: {fontSize: 26, color: '#111'},
  eqSection: {margin: 16, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 16, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)'},
  eqHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12},
  eqLabel: {fontSize: 12, fontWeight: '500', color: '#fff'},
  eqBadge: {backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.4)'},
  eqBadgeText: {fontSize: 11, fontWeight: '500'},
  eqBars: {flexDirection: 'row', alignItems: 'flex-end', height: 52, gap: 6},
  eqBarWrap: {flex: 1, alignItems: 'center', gap: 3},
  eqBar: {width: '100%', borderRadius: 3},
  eqBarLabel: {fontSize: 9, color: 'rgba(255,255,255,0.5)'},
  queueSection: {marginHorizontal: 14, marginBottom: 30},
  queueTitle: {fontSize: 12, fontWeight: '500', color: 'rgba(255,255,255,0.6)', letterSpacing: 1, marginBottom: 8, paddingHorizontal: 4},
  trackItem: {flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14},
  trackThumb: {width: 40, height: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center'},
  thumbEmoji: {fontSize: 20},
  trackMeta: {flex: 1},
  trackItemName: {fontSize: 13, fontWeight: '500', color: '#fff'},
  trackItemSub: {fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 1},
  eqDot: {width: 6, height: 6, borderRadius: 3},
  trackDuration: {fontSize: 11, color: 'rgba(255,255,255,0.4)'},
  removeBtn: {width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center'},
  removeBtnText: {color: '#fff', fontSize: 12},
});