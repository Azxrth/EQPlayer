import React, {useState, useRef, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  FlatList,
  StatusBar,
  Dimensions,
  PanResponder,
  Animated,
  Image,
  NativeModules,
  PermissionsAndroid,
  Platform,
  ActivityIndicator,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import TrackPlayer from 'react-native-track-player';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {useActiveTrack} = require('react-native-track-player') as {useActiveTrack: () => import('react-native-track-player').Track | undefined};
import {setupPlayer, usePlayer, toPlayerTrack} from './src/usePlayer';

// ─── Module natif MusicLibrary ────────────────────────────────────────────────
const {MusicLibrary} = NativeModules as {
  MusicLibrary: {getTracks: () => Promise<Track[]>};
};

const {width} = Dimensions.get('window');

// ─── Palettes par genre ───────────────────────────────────────────────────────
type Palette = {dark: string; mid: string; bright: string; cover: string};
const GENRE_PALETTE: Record<string, Palette> = {
  // Rap / Hip-Hop
  'Rap':      {dark:'#0d1a2e', mid:'#1a3a5c', bright:'#4a9eff', cover:'#0f2240'},
  'Hip-Hop':  {dark:'#0d1a2e', mid:'#1a3a5c', bright:'#4a9eff', cover:'#0f2240'},
  'Hip Hop':  {dark:'#0d1a2e', mid:'#1a3a5c', bright:'#4a9eff', cover:'#0f2240'},
  'Trap':     {dark:'#0d1a2e', mid:'#1a3a5c', bright:'#4a9eff', cover:'#0f2240'},
  // D&B / Electronic
  'D&B':           {dark:'#1a0a2e', mid:'#4a1a7a', bright:'#c44aff', cover:'#2a0f4a'},
  'Drum and Bass': {dark:'#1a0a2e', mid:'#4a1a7a', bright:'#c44aff', cover:'#2a0f4a'},
  'Drum & Bass':   {dark:'#1a0a2e', mid:'#4a1a7a', bright:'#c44aff', cover:'#2a0f4a'},
  'Electronic':    {dark:'#0a1a2a', mid:'#0a3a4a', bright:'#00d4ff', cover:'#0a2030'},
  'Techno':        {dark:'#1a0a0a', mid:'#3a0a0a', bright:'#ff4444', cover:'#2a0808'},
  'House':         {dark:'#1a1a0a', mid:'#3a3a0a', bright:'#ffcc00', cover:'#2a2808'},
  'Ambient':       {dark:'#0a1a1a', mid:'#0a3a3a', bright:'#00ffcc', cover:'#082020'},
  // Rock / Metal
  'Rock':     {dark:'#1a0a0a', mid:'#3a1a1a', bright:'#ff6b35', cover:'#2a1010'},
  'Metal':    {dark:'#0a0a0a', mid:'#1a1a1a', bright:'#888888', cover:'#111111'},
  // RnB / Soul
  'R&B':      {dark:'#1a0a1a', mid:'#3a1a3a', bright:'#ff69b4', cover:'#250825'},
  'Soul':     {dark:'#1a0a0a', mid:'#3a1a1a', bright:'#ff9944', cover:'#250808'},
  // Jazz
  'Jazz':     {dark:'#1a1a0a', mid:'#3a3a0a', bright:'#d4aa00', cover:'#252500'},
  // Pop
  'Pop':      {dark:'#0a0a1a', mid:'#1a1a3a', bright:'#ff88cc', cover:'#0f0f25'},
};
const defaultPalette: Palette = {dark:'#0a0a0a', mid:'#1a1a1a', bright:'#ffffff', cover:'#1a1a1a'};

const getPalette = (genre?: string): Palette => {
  if (!genre) return defaultPalette;
  // Correspondance exacte
  if (GENRE_PALETTE[genre]) return GENRE_PALETTE[genre];
  // Correspondance partielle (ex. "Hip-Hop/Rap" → "Hip-Hop")
  const key = Object.keys(GENRE_PALETTE).find(k => genre.toLowerCase().includes(k.toLowerCase()));
  return key ? GENRE_PALETTE[key] : defaultPalette;
};
const coverBg = (genre?: string) => getPalette(genre).cover;

// ─── Type Track ───────────────────────────────────────────────────────────────
// Pendant le scan, on utilise ce type réel.
// Les champs optionnels (artUri etc.) sont absents dans les DEMO_TRACKS.
type Track = {
  id:       string;
  title:    string;
  artist:   string;
  album:    string;
  albumId?: string;
  artUri?:  string;
  duration?: number;   // ms
  filePath?: string;
  year:     string;
  format:   string;
  genre:    string;
  mime?:    string;
};

// ─── Données démo (affichées avant le premier scan) ──────────────────────────
const DEMO_TRACKS: Track[] = [
  {id:'1',  title:'WISH YOU WELL',  artist:'Destroy Lonely',  album:'If Looks Could Kill', genre:'Rap',  year:'2023', format:'FLAC'},
  {id:'2',  title:'Machina',        artist:'Pendulum',         album:'Immersion',            genre:'D&B',  year:'2010', format:'FLAC'},
  {id:'3',  title:"God's Plan",     artist:'Drake',            album:'Scorpion',             genre:'Rap',  year:'2018', format:'MP3'},
  {id:'4',  title:'Jungle Sound',   artist:'Noisia',           album:'Split the Atom',       genre:'D&B',  year:'2010', format:'FLAC'},
  {id:'5',  title:'HUMBLE.',        artist:'Kendrick Lamar',   album:'DAMN.',                genre:'Rap',  year:'2017', format:'FLAC'},
  {id:'6',  title:'The Noose',      artist:'Calyx & Teebee',  album:'Rush Hour',            genre:'D&B',  year:'2012', format:'MP3'},
];

const LIB_TABS = [
  {icon:'music-note',           label:'Titres'},
  {icon:'account',              label:'Artistes'},
  {icon:'album',                label:'Albums'},
  {icon:'music-circle-outline', label:'Genres'},
  {icon:'folder-outline',       label:'Dossiers'},
  {icon:'calendar-outline',     label:'Annees'},
  {icon:'sine-wave',            label:'Sampling'},
  {icon:'file-music-outline',   label:'Format'},
];
const FAV_TABS = [
  {icon:'heart-outline',       iconActive:'heart',        label:'Favoris'},
  {icon:'playlist-music',      iconActive:'playlist-music', label:'Playlists'},
  {icon:'history',             iconActive:'history',        label:'Recents'},
  {icon:'play-circle-outline', iconActive:'play-circle',    label:'+ Joues'},
  {icon:'clock-plus-outline',  iconActive:'clock-plus',     label:'Ajoutes'},
];

type ViewMode = 'list' | 'grid';

// ─── Constantes grille ────────────────────────────────────────────────────────
const GRID_COLS   = 3;
const GRID_PAD    = 12;   // padding extérieur
const GRID_GAP    = 6;    // espace entre items
const GRID_ITEM_W = (width - GRID_PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;

// ─── EQ draggable ─────────────────────────────────────────────────────────────
const EQ_BANDS  = ['60', '150', '400', '1k', '2.5k', '6k', '16k'];
const EQ_HEIGHT = 120;

const EqBar = ({label, bright}: {label: string; bright: string}) => {
  const val    = useRef(new Animated.Value(0.5)).current;
  const panRef = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gs) => {
        val.setValue(Math.max(0, Math.min(1, 0.5 - gs.dy / EQ_HEIGHT)));
      },
    }),
  ).current;
  const filledH = val.interpolate({inputRange:[0,1], outputRange:[0,EQ_HEIGHT]});
  return (
    <View style={eqS.band}>
      <View style={[eqS.track, {height:EQ_HEIGHT}]} {...panRef.panHandlers}>
        <Animated.View style={[eqS.fill, {height:filledH, backgroundColor:bright}]}/>
        <View style={[eqS.thumb, {backgroundColor:bright}]}/>
      </View>
      <Text style={eqS.label}>{label}</Text>
    </View>
  );
};
const eqS = StyleSheet.create({
  band:  {alignItems:'center', gap:4, flex:1},
  track: {width:4, backgroundColor:'#222', borderRadius:2, justifyContent:'flex-end', overflow:'visible', position:'relative'},
  fill:  {width:4, borderRadius:2},
  thumb: {width:14, height:14, borderRadius:7, position:'absolute', left:-5, bottom:0, borderWidth:2, borderColor:'#000'},
  label: {fontSize:9, color:'#555', marginTop:2},
});

// ─── Helpers temps ────────────────────────────────────────────────────────────
function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Player ───────────────────────────────────────────────────────────────────
const PlayerScreen = ({track, onClose, queue, onRemoveFromQueue}: {
  track: Track; onClose: () => void; queue: Track[]; onRemoveFromQueue: (id: string) => void;
}) => {
  const [isFav,     setIsFav]     = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Vrais contrôles depuis usePlayer
  const {isPlaying, isLoading, progress, activeTrack, playMode, togglePlay, skipNext, skipPrev, seekTo, cyclePlayMode} = usePlayer();

  // Utilise le track actif du player si disponible, sinon celui passé en prop
  const displayTrack = activeTrack ?? track;
  const palette = getPalette(displayTrack?.genre ?? track.genre);

  const modeIcon = () => ({
    'shuffle-variant': 'shuffle-variant',
    repeat:            'repeat',
    'repeat-once':     'repeat-once',
    'arrow-right':     'arrow-right',
  }[{order:'arrow-right', shuffle:'shuffle-variant', loop:'repeat', one:'repeat-once'}[playMode]] ?? 'arrow-right');

  return (
    <View style={[pS.root, {backgroundColor:palette.dark}]}>
      <View style={[pS.blob1, {backgroundColor:palette.mid+'99'}]}/>
      <View style={[pS.blob2, {backgroundColor:palette.bright+'22'}]}/>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent/>

      {/* Top bar */}
      <View style={pS.topBar}>
        <TouchableOpacity onPress={onClose} style={pS.topBtn}>
          <MaterialCommunityIcons name="chevron-down" size={28} color="#fff"/>
        </TouchableOpacity>
        <Text style={pS.topTitle}>En lecture</Text>
        <TouchableOpacity style={pS.topBtn} onPress={() => setSheetOpen(true)}>
          <MaterialCommunityIcons name="dots-vertical" size={24} color="#fff"/>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={pS.scroll}>
        {/* Cover */}
        <View style={pS.coverWrap}>
          {track.artUri ? (
            <Image source={{uri: track.artUri}} style={pS.cover} resizeMode="cover"/>
          ) : (
            <View style={[pS.cover, {borderColor:palette.bright+'44', backgroundColor:palette.cover ?? '#ffffff0d'}]}>
              <MaterialCommunityIcons name="music" size={80} color={palette.bright+'88'}/>
            </View>
          )}
        </View>

        {/* Titre */}
        <View style={pS.titleRow}>
          <View style={pS.titleBlock}>
            <Text style={pS.trackTitle} numberOfLines={1}>{displayTrack?.title ?? track.title}</Text>
            <Text style={[pS.trackArtist, {color:palette.bright+'cc'}]} numberOfLines={1}>{displayTrack?.artist ?? track.artist}</Text>
          </View>
          <View style={pS.titleActions}>
            <TouchableOpacity onPress={() => setIsFav(f=>!f)} style={pS.titleBtn}>
              <MaterialCommunityIcons name={isFav?'heart':'heart-outline'} size={22} color={isFav?'#ff4d6d':'#fff'}/>
            </TouchableOpacity>
            <TouchableOpacity style={pS.titleBtn}>
              <MaterialCommunityIcons name="plus" size={22} color="#fff"/>
            </TouchableOpacity>
          </View>
        </View>

        {/* Progression */}
        <View style={pS.progressWrap}>
          <TouchableOpacity
            style={pS.progressTrack}
            activeOpacity={1}
            onPress={e => {
              const ratio = e.nativeEvent.locationX / (width - 48);
              seekTo(ratio * (progress.duration || 1));
            }}>
            <View style={[pS.progressFill, {
              width: progress.duration > 0 ? `${(progress.position / progress.duration) * 100}%` : '0%',
              backgroundColor: palette.bright,
            }]}/>
            <View style={[pS.progressThumb, {
              left: progress.duration > 0 ? `${(progress.position / progress.duration) * 100}%` : '0%',
              backgroundColor: palette.bright,
            }]}/>
          </TouchableOpacity>
          <View style={pS.progressTimes}>
            <Text style={pS.timeText}>{fmtTime(progress.position)}</Text>
            <Text style={pS.timeText}>{fmtTime(progress.duration)}</Text>
          </View>
        </View>

        {/* Contrôles */}
        <View style={pS.controls}>
          <TouchableOpacity style={[pS.ctrlBtn, pS.ctrlBtnGlass]} onPress={cyclePlayMode}>
            <MaterialCommunityIcons name={modeIcon() as any} size={22} color="#fff"/>
            {playMode !== 'order' && <View style={[pS.modeDot, {backgroundColor:palette.bright}]}/>}
          </TouchableOpacity>
          <TouchableOpacity style={[pS.ctrlBtn, pS.ctrlBtnGlass]} onPress={skipPrev}>
            <MaterialCommunityIcons name="skip-previous" size={22} color="#fff"/>
          </TouchableOpacity>
          <TouchableOpacity style={[pS.ctrlBtn, pS.ctrlBtnPlay]} onPress={togglePlay}>
            {isLoading
              ? <ActivityIndicator color="#111" size="small"/>
              : <MaterialCommunityIcons name={isPlaying?'pause':'play'} size={28} color="#111"/>
            }
          </TouchableOpacity>
          <TouchableOpacity style={[pS.ctrlBtn, pS.ctrlBtnGlass]} onPress={skipNext}>
            <MaterialCommunityIcons name="skip-next" size={22} color="#fff"/>
          </TouchableOpacity>
          <TouchableOpacity style={[pS.ctrlBtn, pS.ctrlBtnGlass]}>
            <MaterialCommunityIcons name="volume-high" size={22} color="#fff"/>
          </TouchableOpacity>
        </View>

        {/* EQ */}
        <View style={pS.section}>
          <View style={pS.sectionHeader}>
            <MaterialCommunityIcons name="equalizer-outline" size={14} color="#ffffff66"/>
            <Text style={pS.sectionTitle}>Egaliseur — {track.genre}</Text>
          </View>
          <View style={pS.eqRow}>
            {EQ_BANDS.map(b => <EqBar key={b} label={b} bright={palette.bright}/>)}
          </View>
        </View>

        {/* Queue */}
        <View style={pS.section}>
          <Text style={pS.sectionTitle}>File d'attente</Text>
          {queue.map(t => (
            <View key={t.id} style={pS.queueRow}>
              <View style={[pS.queueCover, {backgroundColor:coverBg(t.genre)}]}>
                <MaterialCommunityIcons name="music" size={14} color="#ffffff44"/>
              </View>
              <View style={pS.queueMeta}>
                <Text style={pS.queueTitle} numberOfLines={1}>{t.title}</Text>
                <Text style={pS.queueArtist} numberOfLines={1}>{t.artist}</Text>
              </View>
              <TouchableOpacity onPress={() => onRemoveFromQueue(t.id)} style={pS.queueRemove}>
                <MaterialCommunityIcons name="close" size={16} color="#555"/>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Bottom sheet */}
      {sheetOpen && (
        <TouchableOpacity style={pS.overlay} onPress={() => setSheetOpen(false)} activeOpacity={1}>
          <View style={pS.sheet}>
            {[
              {icon:'album',              label:"Voir l'album"},
              {icon:'account',            label:"Voir l'artiste"},
              {icon:'share-variant',      label:'Partager'},
              {icon:'equalizer',          label:"Modifier l'EQ"},
              {icon:'download',           label:'Telecharger'},
              {icon:'thumb-down-outline', label:'Ne plus recommander'},
            ].map((item, i) => (
              <TouchableOpacity key={i} style={pS.sheetRow} onPress={() => setSheetOpen(false)}>
                <MaterialCommunityIcons name={item.icon as any} size={20} color="#fff"/>
                <Text style={pS.sheetLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
};

const pS = StyleSheet.create({
  root:          {flex:1, position:'absolute', inset:0, zIndex:100},
  blob1:         {position:'absolute', top:-100, right:-100, width:300, height:300, borderRadius:150},
  blob2:         {position:'absolute', bottom:100, left:-80, width:250, height:250, borderRadius:125},
  topBar:        {flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:52, paddingBottom:8},
  topBtn:        {width:40, height:40, alignItems:'center', justifyContent:'center'},
  topTitle:      {fontSize:13, color:'#ffffff88', fontWeight:'500'},
  scroll:        {paddingBottom:40},
  coverWrap:     {alignItems:'center', paddingVertical:24},
  cover:         {width:width*0.72, height:width*0.72, borderRadius:16, alignItems:'center', justifyContent:'center', borderWidth:1},
  titleRow:      {flexDirection:'row', alignItems:'center', paddingHorizontal:24, marginBottom:20, gap:12},
  titleBlock:    {flex:1},
  trackTitle:    {fontSize:20, fontWeight:'700', color:'#fff'},
  trackArtist:   {fontSize:14, marginTop:2},
  titleActions:  {flexDirection:'row', gap:4},
  titleBtn:      {width:40, height:40, alignItems:'center', justifyContent:'center'},
  progressWrap:  {paddingHorizontal:24, marginBottom:24},
  progressTrack: {height:3, backgroundColor:'#ffffff22', borderRadius:2, marginBottom:8, position:'relative'},
  progressFill:  {height:3, borderRadius:2, position:'absolute', left:0, top:0},
  progressThumb: {width:12, height:12, borderRadius:6, position:'absolute', top:-4.5, marginLeft:-6},
  progressTimes: {flexDirection:'row', justifyContent:'space-between'},
  timeText:      {fontSize:11, color:'#ffffff66'},
  controls:      {flexDirection:'row', alignItems:'center', justifyContent:'center', gap:12, paddingHorizontal:16, marginBottom:32},
  ctrlBtn:       {width:52, height:52, borderRadius:26, alignItems:'center', justifyContent:'center', position:'relative'},
  ctrlBtnGlass:  {backgroundColor:'rgba(255,255,255,0.22)', borderWidth:1, borderColor:'rgba(255,255,255,0.30)'},
  ctrlBtnPlay:   {backgroundColor:'#fff', width:64, height:64, borderRadius:32},
  modeDot:       {width:4, height:4, borderRadius:2, position:'absolute', bottom:6},
  section:       {paddingHorizontal:24, marginBottom:28},
  sectionHeader: {flexDirection:'row', alignItems:'center', gap:6, marginBottom:14},
  sectionTitle:  {fontSize:12, fontWeight:'600', color:'#ffffff66', textTransform:'uppercase', letterSpacing:0.8},
  eqRow:         {flexDirection:'row', alignItems:'flex-end', height:EQ_HEIGHT+24, gap:4},
  queueRow:      {flexDirection:'row', alignItems:'center', gap:10, paddingVertical:10, borderBottomWidth:0.5, borderBottomColor:'#ffffff11'},
  queueCover:    {width:36, height:36, borderRadius:5, alignItems:'center', justifyContent:'center'},
  queueMeta:     {flex:1},
  queueTitle:    {fontSize:13, fontWeight:'500', color:'#fff'},
  queueArtist:   {fontSize:11, color:'#ffffff55', marginTop:1},
  queueRemove:   {padding:8},
  overlay:       {position:'absolute', top:0, left:0, right:0, bottom:0, backgroundColor:'#000000aa', justifyContent:'flex-end', zIndex:200},
  sheet:         {backgroundColor:'#111', borderTopLeftRadius:16, borderTopRightRadius:16, paddingTop:8, paddingBottom:32},
  sheetRow:      {flexDirection:'row', alignItems:'center', gap:14, paddingHorizontal:20, paddingVertical:16},
  sheetLabel:    {fontSize:15, color:'#fff'},
});

// ─── TrackRow (liste) ─────────────────────────────────────────────────────────
const TrackRow = ({track, onPress}: {track: any; onPress?: () => void}) => (
  <TouchableOpacity style={S.row} activeOpacity={0.7} onPress={onPress}>
    {track.artUri ? (
      <Image source={{uri: track.artUri}} style={S.rowCover} resizeMode="cover"/>
    ) : (
      <View style={[S.rowCover, {backgroundColor: coverBg(track.genre)}]}>
        <MaterialCommunityIcons name="music" size={18} color="#ffffff33"/>
      </View>
    )}
    <View style={S.rowMeta}>
      <Text style={S.rowTitle} numberOfLines={1}>{track.title}</Text>
      <Text style={S.rowSub}   numberOfLines={1}>{track.artist}</Text>
    </View>
    {track.format ? <Text style={S.rowFormat}>{track.format}</Text> : null}
    <TouchableOpacity style={S.rowDots}>
      <MaterialCommunityIcons name="dots-vertical" size={18} color="#444"/>
    </TouchableOpacity>
  </TouchableOpacity>
);

// ─── TrackGridItem (grille, 3 par ligne) ──────────────────────────────────────
const TrackGridItem = ({track, onPress}: {track: any; onPress?: () => void}) => (
  <TouchableOpacity style={gS.item} activeOpacity={0.75} onPress={onPress}>
    <View style={[gS.cover, {backgroundColor: coverBg(track.genre)}]}>
      {track.artUri ? (
        <Image source={{uri: track.artUri}} style={StyleSheet.absoluteFill} resizeMode="cover"/>
      ) : (
        <MaterialCommunityIcons name="music" size={24} color="#ffffff22"/>
      )}
      {track.format ? (
        <View style={gS.badge}>
          <Text style={gS.badgeText}>{track.format}</Text>
        </View>
      ) : null}
    </View>
    <Text style={gS.title} numberOfLines={2}>{track.title}</Text>
    <Text style={gS.sub}   numberOfLines={1}>{track.artist ?? track.sub ?? ''}</Text>
  </TouchableOpacity>
);

// ─── CategoryGridItem (genres/années/etc.) ────────────────────────────────────
const CategoryGridItem = ({name, sub, icon}: {name: string; sub: string; icon?: string}) => (
  <TouchableOpacity style={gS.item} activeOpacity={0.75}>
    <View style={gS.catCover}>
      <MaterialCommunityIcons name={(icon ?? 'music') as any} size={28} color="#333"/>
    </View>
    <Text style={gS.title} numberOfLines={2}>{name}</Text>
    <Text style={gS.sub}   numberOfLines={1}>{sub}</Text>
  </TouchableOpacity>
);

// ─── Wrappers grille scrollables ──────────────────────────────────────────────
const TrackGrid = ({tracks, onPress}: {tracks: any[]; onPress?: (t: any) => void}) => (
  <FlatList
    data={tracks}
    keyExtractor={i => i.id ?? i.name ?? i.title}
    numColumns={GRID_COLS}
    contentContainerStyle={gS.list}
    columnWrapperStyle={gS.row}
    renderItem={({item}) => <TrackGridItem track={item} onPress={onPress ? () => onPress(item) : undefined}/>}
  />
);

const CategoryGrid = ({items, icon}: {items: {name: string; sub: string}[]; icon?: string}) => (
  <FlatList
    data={items}
    keyExtractor={i => i.name}
    numColumns={GRID_COLS}
    contentContainerStyle={gS.list}
    columnWrapperStyle={gS.row}
    renderItem={({item}) => <CategoryGridItem name={item.name} sub={item.sub} icon={icon}/>}
  />
);

const gS = StyleSheet.create({
  list:     {padding:GRID_PAD},
  row:      {gap:GRID_GAP, marginBottom:GRID_GAP},
  item:     {width:GRID_ITEM_W},
  cover:    {width:GRID_ITEM_W, height:GRID_ITEM_W, borderRadius:10, alignItems:'center', justifyContent:'center', marginBottom:6, position:'relative'},
  catCover: {width:GRID_ITEM_W, height:GRID_ITEM_W, borderRadius:10, backgroundColor:'#1a1a1a', alignItems:'center', justifyContent:'center', marginBottom:6},
  title:    {fontSize:11, fontWeight:'600', color:'#fff', lineHeight:15},
  sub:      {fontSize:10, color:'#555', marginTop:1},
  badge:    {position:'absolute', bottom:5, right:5, backgroundColor:'#000000aa', borderRadius:3, paddingHorizontal:4, paddingVertical:1},
  badgeText:{fontSize:8, color:'#ffffff88', fontWeight:'600'},
});

// ─── Toolbar ──────────────────────────────────────────────────────────────────
const Toolbar = ({count, label, view, onView}: {
  count: number; label: string; view: ViewMode; onView: (v: ViewMode) => void;
}) => (
  <View style={S.toolbar}>
    <TouchableOpacity style={S.playAll}>
      <MaterialCommunityIcons name="play-circle-outline" size={20} color="#888" style={{marginRight:6}}/>
      <Text style={S.playAllText}>Tout lire  {count} {label}</Text>
    </TouchableOpacity>
    <View style={S.toolbarRight}>
      <TouchableOpacity style={[S.tbBtn, view==='list' && S.tbBtnAct]} onPress={() => onView('list')}>
        <MaterialCommunityIcons name="view-list" size={20} color={view==='list'?'#fff':'#444'}/>
      </TouchableOpacity>
      <TouchableOpacity style={[S.tbBtn, view==='grid' && S.tbBtnAct]} onPress={() => onView('grid')}>
        <MaterialCommunityIcons name="view-grid" size={20} color={view==='grid'?'#fff':'#444'}/>
      </TouchableOpacity>
      <View style={S.tbDivider}/>
      <TouchableOpacity style={S.tbBtn}>
        <MaterialCommunityIcons name="sort" size={20} color="#444"/>
      </TouchableOpacity>
      <TouchableOpacity style={S.tbBtn}>
        <MaterialCommunityIcons name="dots-vertical" size={20} color="#444"/>
      </TouchableOpacity>
    </View>
  </View>
);

const EmptyState = ({msg, sub}: {msg: string; sub: string}) => (
  <View style={S.empty}>
    <Text style={S.emptyTitle}>{msg}</Text>
    <Text style={S.emptySub}>{sub}</Text>
  </View>
);

// ─── Library Page ─────────────────────────────────────────────────────────────
const LibraryPage = ({tracks, onTrackPress}: {tracks: Track[]; onTrackPress: (t: Track) => void}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [view, setView] = useState<ViewMode>('list');

  const renderContent = () => {
    // Titres
    if (activeTab === 0) return (
      <>
        <Toolbar count={tracks.length} label="pistes" view={view} onView={setView}/>
        {view === 'grid'
          ? <TrackGrid tracks={tracks} onPress={onTrackPress}/>
          : <FlatList
              data={tracks}
              keyExtractor={i=>i.id}
              initialNumToRender={20}
              maxToRenderPerBatch={20}
              windowSize={10}
              renderItem={({item}) => <TrackRow track={item} onPress={() => onTrackPress(item)}/>}
            />
        }
      </>
    );
    // Artistes
    if (activeTab === 1) {
      const items = [...new Set(tracks.map(t=>t.artist))].sort().map(a=>({name:a, sub:tracks.filter(t=>t.artist===a).length+' pistes'}));
      return (
        <>
          <Toolbar count={items.length} label="artistes" view={view} onView={setView}/>
          {view === 'grid'
            ? <CategoryGrid items={items} icon="account"/>
            : <FlatList data={items} keyExtractor={i=>i.name} initialNumToRender={20} renderItem={({item}) => <TrackRow track={{title:item.name, artist:item.sub, format:'', genre:'', year:''}}/>}/>
          }
        </>
      );
    }
    // Albums
    if (activeTab === 2) {
      const albumMap = new Map<string, {name:string; sub:string; genre:string; artUri?:string}>();
      tracks.forEach(t => {
        if (!albumMap.has(t.album)) albumMap.set(t.album, {name:t.album, sub:t.artist, genre:t.genre, artUri:t.artUri});
      });
      const items = [...albumMap.values()].sort((a,b) => a.name.localeCompare(b.name));
      return (
        <>
          <Toolbar count={items.length} label="albums" view={view} onView={setView}/>
          {view === 'grid'
            ? <FlatList
                data={items}
                keyExtractor={i=>i.name}
                numColumns={GRID_COLS}
                contentContainerStyle={gS.list}
                columnWrapperStyle={gS.row}
                initialNumToRender={15}
                renderItem={({item}) => (
                  <TouchableOpacity style={gS.item} activeOpacity={0.75}>
                    <View style={[gS.cover, {backgroundColor: coverBg(item.genre)}]}>
                      {item.artUri
                        ? <Image source={{uri: item.artUri}} style={StyleSheet.absoluteFill} resizeMode="cover"/>
                        : <MaterialCommunityIcons name="album" size={24} color="#ffffff22"/>
                      }
                    </View>
                    <Text style={gS.title} numberOfLines={2}>{item.name}</Text>
                    <Text style={gS.sub}   numberOfLines={1}>{item.sub}</Text>
                  </TouchableOpacity>
                )}
              />
            : <FlatList data={items} keyExtractor={i=>i.name} initialNumToRender={20} renderItem={({item}) => <TrackRow track={{title:item.name, artist:item.sub, format:'', genre:item.genre, year:'', artUri:item.artUri}}/>}/>
          }
        </>
      );
    }
    // Genres
    if (activeTab === 3) {
      const items = [...new Set(tracks.map(t=>t.genre).filter(Boolean))].sort().map(g=>({name:g, sub:tracks.filter(t=>t.genre===g).length+' pistes', id:g}));
      return (
        <>
          <Toolbar count={items.length} label="genres" view={view} onView={setView}/>
          {view === 'grid'
            ? <CategoryGrid items={items} icon="music-circle-outline"/>
            : <FlatList data={items} keyExtractor={i=>i.id} renderItem={({item}) => <TrackRow track={{title:item.name, artist:item.sub, format:'', genre:item.name, year:''}}/>}/>
          }
        </>
      );
    }
    // Dossiers
    if (activeTab === 4) {
      const folders = [...new Set(tracks.map(t => t.filePath?.split('/').slice(0,-1).join('/') ?? '').filter(Boolean))];
      const items = folders.map(f => ({name: f.split('/').pop() ?? f, sub: tracks.filter(t=>t.filePath?.startsWith(f)).length + ' pistes', id: f}));
      return (
        <>
          <Toolbar count={items.length} label="dossiers" view={view} onView={setView}/>
          {view === 'grid'
            ? <CategoryGrid items={items.map(i=>({name:i.name, sub:i.sub}))} icon="folder-outline"/>
            : <FlatList data={items} keyExtractor={i=>i.id} initialNumToRender={20} renderItem={({item}) => <TrackRow track={{title:item.name, artist:item.sub, format:'', genre:'', year:''}}/>}/>
          }
        </>
      );
    }
    // Années
    if (activeTab === 5) {
      const items = [...new Set(tracks.map(t=>t.year).filter(Boolean))].sort((a,b)=>Number(b)-Number(a)).map(y=>({name:y, sub:tracks.filter(t=>t.year===y).length+' pistes', id:y}));
      return (
        <>
          <Toolbar count={items.length} label="annees" view={view} onView={setView}/>
          {view === 'grid'
            ? <CategoryGrid items={items} icon="calendar-outline"/>
            : <FlatList data={items} keyExtractor={i=>i.id} renderItem={({item}) => <TrackRow track={{title:item.name, artist:item.sub, format:'', genre:'', year:item.name}}/>}/>
          }
        </>
      );
    }
    // Sampling — non disponible depuis MediaStore pour l'instant
    if (activeTab === 6) {
      return (
        <>
          <Toolbar count={0} label="taux" view={view} onView={setView}/>
          <EmptyState msg="Sampling rate" sub="Non disponible via MediaStore"/>
        </>
      );
    }
    // Format
    if (activeTab === 7) {
      const items = [...new Set(tracks.map(t=>t.format).filter(Boolean))].sort().map(f=>({name:f, sub:tracks.filter(t=>t.format===f).length+' pistes', id:f}));
      return (
        <>
          <Toolbar count={items.length} label="formats" view={view} onView={setView}/>
          {view === 'grid'
            ? <CategoryGrid items={items} icon="file-music-outline"/>
            : <FlatList data={items} keyExtractor={i=>i.id} renderItem={({item}) => <TrackRow track={{title:item.name, artist:item.sub, format:item.name, genre:'', year:''}}/>}/>
          }
        </>
      );
    }
    return null;
  };

  return (
    <View style={S.page}>
      <View style={S.header}>
        <Text style={S.headerTitle}>{LIB_TABS[activeTab].label}</Text>
        <View style={S.headerRight}>
          <TouchableOpacity style={S.headerBtn}><MaterialCommunityIcons name="sort-ascending" size={20} color="#aaa"/></TouchableOpacity>
          <TouchableOpacity style={S.headerBtn}><MaterialCommunityIcons name="magnify"        size={20} color="#aaa"/></TouchableOpacity>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={S.tabsScroll}>
        <View style={S.tabs}>
          {LIB_TABS.map((t,i) => (
            <TouchableOpacity key={i} style={S.tab} onPress={() => setActiveTab(i)}>
              <MaterialCommunityIcons name={t.icon as any} size={18} color={activeTab===i?'#fff':'#555'}/>
              {activeTab===i && <View style={S.tabLine}/>}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={S.content}>{renderContent()}</View>
    </View>
  );
};

// ─── Favorites Page ───────────────────────────────────────────────────────────
const FavoritesPage = ({tracks, onTrackPress}: {tracks: Track[]; onTrackPress: (t: Track) => void}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [view, setView] = useState<ViewMode>('list');

  const renderContent = () => {
    if (activeTab === 1) return <EmptyState msg="Aucune playlist" sub="Cree ta premiere playlist depuis un morceau"/>;
    const list = activeTab === 4 ? [...tracks].reverse() : tracks;
    return (
      <>
        <Toolbar count={list.length} label="pistes" view={view} onView={setView}/>
        {view === 'grid'
          ? <TrackGrid tracks={list} onPress={onTrackPress}/>
          : <FlatList data={list} keyExtractor={i=>i.id} renderItem={({item}) => <TrackRow track={item} onPress={() => onTrackPress(item)}/>}/>
        }
      </>
    );
  };

  return (
    <View style={S.page}>
      <View style={S.header}>
        <Text style={S.headerTitle}>{FAV_TABS[activeTab].label}</Text>
        <View style={S.headerRight}>
          <TouchableOpacity style={S.headerBtn}><MaterialCommunityIcons name="sort-ascending" size={20} color="#aaa"/></TouchableOpacity>
          <TouchableOpacity style={S.headerBtn}><MaterialCommunityIcons name="dots-vertical"  size={20} color="#aaa"/></TouchableOpacity>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={S.tabsScroll}>
        <View style={S.tabs}>
          {FAV_TABS.map((t,i) => (
            <TouchableOpacity key={i} style={[S.tab, {width:58}]} onPress={() => setActiveTab(i)}>
              <MaterialCommunityIcons
                name={(activeTab===i ? t.iconActive : t.icon) as any}
                size={18}
                color={activeTab===i?'#fff':'#555'}
              />
              {activeTab===i && <View style={S.tabLine}/>}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={S.content}>{renderContent()}</View>
    </View>
  );
};

// ─── Settings Page ────────────────────────────────────────────────────────────
const SettingsPage = () => (
  <View style={S.page}>
    <View style={S.header}>
      <Text style={S.headerTitle}>Parametres</Text>
    </View>
    <ScrollView>
      {[
        {label:'Theme',                   value:'Sombre'},
        {label:'Egaliseur par defaut',     value:'Aucun'},
        {label:'Qualite audio',            value:'Haute fidelite'},
        {label:'Scanner la bibliotheque',  value:'>'},
        {label:'Dossiers surveilles',      value:'>'},
        {label:'A propos',                 value:'>'},
      ].map((item,i) => (
        <TouchableOpacity key={i} style={S.settingRow}>
          <Text style={S.settingLabel}>{item.label}</Text>
          <Text style={S.settingValue}>{item.value}</Text>
        </TouchableOpacity>
      ))}
      <Text style={S.version}>EQPlayer v0.1.0</Text>
      <Text style={S.versionSub}>Developpe avec amour</Text>
    </ScrollView>
  </View>
);

// ─── Mini Player ──────────────────────────────────────────────────────────────
const MiniPlayer = ({track, onPress}: {track: Track|null; onPress: () => void}) => {
  const {isPlaying, isLoading, togglePlay, skipNext} = usePlayer();
  const activeTrack = useActiveTrack();

  const display = activeTrack ?? track;
  if (!display) return null;
  // artwork vient de RNTP.Track, artUri de notre Track
  const artUri = (display as any).artwork ?? (display as any).artUri ?? track?.artUri;

  return (
    <TouchableOpacity style={S.mini} activeOpacity={0.9} onPress={onPress}>
      {artUri ? (
        <Image source={{uri: artUri as string}} style={S.miniCover} resizeMode="cover"/>
      ) : (
        <View style={[S.miniCover, {backgroundColor: coverBg(track?.genre)}]}>
          <MaterialCommunityIcons name="music" size={18} color="#ffffff33"/>
        </View>
      )}
      <View style={S.miniInfo}>
        <Text style={S.miniTitle}  numberOfLines={1}>{display.title}</Text>
        <Text style={S.miniArtist} numberOfLines={1}>{display.artist}</Text>
      </View>
      <TouchableOpacity style={S.miniBtn} onPress={e => {e.stopPropagation(); togglePlay();}}>
        {isLoading
          ? <ActivityIndicator color="#fff" size="small"/>
          : <MaterialCommunityIcons name={isPlaying?'pause':'play'} size={22} color="#fff"/>
        }
      </TouchableOpacity>
      <TouchableOpacity style={S.miniBtn} onPress={e => {e.stopPropagation(); skipNext();}}>
        <MaterialCommunityIcons name="skip-next" size={22} color="#fff"/>
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

// ─── App Root ─────────────────────────────────────────────────────────────────
async function requestMusicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const perm = parseInt(String(Platform.Version), 10) >= 33
    ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO
    : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
  const result = await PermissionsAndroid.request(perm, {
    title: 'Accès à la musique',
    message: 'EQPlayer a besoin d\'accéder à vos fichiers audio pour afficher votre bibliothèque.',
    buttonPositive: 'Autoriser',
    buttonNegative: 'Refuser',
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export default function App() {
  const [page,         setPage]         = useState(0);
  const [currentTrack, setCurrentTrack] = useState<Track|null>(null);
  const [playerOpen,   setPlayerOpen]   = useState(false);
  const [tracks,       setTracks]       = useState<Track[]>(DEMO_TRACKS);
  const [scanState,    setScanState]    = useState<'idle'|'scanning'|'done'|'denied'>('idle');
  const [scanCount,    setScanCount]    = useState(0);

  // Init TrackPlayer une seule fois au démarrage
  useEffect(() => { setupPlayer().catch(console.warn); }, []);

  const scan = useCallback(async () => {
    setScanState('scanning');
    const granted = await requestMusicPermission();
    if (!granted) { setScanState('denied'); return; }
    try {
      const result: Track[] = await MusicLibrary.getTracks();
      setTracks(result);
      setScanCount(result.length);
      setScanState('done');
    } catch (e) {
      console.warn('Scan error:', e);
      setScanState('done');
    }
  }, []);

  useEffect(() => { scan(); }, [scan]);

  const NAV = [
    {label:'Bibliotheque', icon:'disc'},
    {label:'Mes listes',   icon:'format-list-bulleted'},
    {label:'Parametres',   icon:'account-circle-outline'},
  ];

  const {playTrack} = usePlayer();

  const openTrack = useCallback(async (t: Track) => {
    setCurrentTrack(t);
    setPlayerOpen(true);
    // Charge la file depuis la bibliothèque et démarre la lecture
    await playTrack(t, tracks);
  }, [tracks, playTrack]);

  return (
    <SafeAreaView style={S.root} edges={['bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#000"/>

      {/* Bannière de scan en haut */}
      {scanState === 'scanning' && (
        <View style={S.scanBanner}>
          <ActivityIndicator size="small" color="#e85d4a" style={{marginRight:8}}/>
          <Text style={S.scanText}>Scan de la bibliothèque...</Text>
        </View>
      )}
      {scanState === 'done' && scanCount > 0 && (
        <View style={[S.scanBanner, {backgroundColor:'#0a1a0a'}]}>
          <MaterialCommunityIcons name="check-circle" size={14} color="#4caf50" style={{marginRight:6}}/>
          <Text style={[S.scanText, {color:'#4caf50'}]}>{scanCount} pistes chargées</Text>
        </View>
      )}
      {scanState === 'denied' && (
        <TouchableOpacity style={[S.scanBanner, {backgroundColor:'#1a0a0a'}]} onPress={scan}>
          <MaterialCommunityIcons name="alert-circle" size={14} color="#e85d4a" style={{marginRight:6}}/>
          <Text style={[S.scanText, {color:'#e85d4a'}]}>Permission refusée — appuyer pour réessayer</Text>
        </TouchableOpacity>
      )}

      {page === 0 && <LibraryPage tracks={tracks} onTrackPress={openTrack}/>}
      {page === 1 && <FavoritesPage tracks={tracks} onTrackPress={openTrack}/>}
      {page === 2 && <SettingsPage/>}
      <MiniPlayer track={currentTrack} onPress={() => setPlayerOpen(true)}/>
      <View style={S.navbar}>
        {NAV.map((item,i) => (
          <TouchableOpacity key={i} style={S.navItem} onPress={() => setPage(i)}>
            <MaterialCommunityIcons name={item.icon as any} size={24} color={page===i?'#e85d4a':'#333'}/>
            {page===i && <View style={S.navDot}/>}
          </TouchableOpacity>
        ))}
      </View>
      {playerOpen && currentTrack && (
        <PlayerScreen
          track={currentTrack}
          onClose={() => setPlayerOpen(false)}
          queue={tracks.slice(0, 30)}
          onRemoveFromQueue={() => {}}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles globaux ───────────────────────────────────────────────────────────
const S = StyleSheet.create({
  root:    {flex:1, backgroundColor:'#000'},
  page:    {flex:1, backgroundColor:'#000'},
  content: {flex:1},

  header:       {flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:52, paddingBottom:10},
  headerTitle:  {fontSize:22, fontWeight:'600', color:'#fff'},
  headerRight:  {flexDirection:'row', gap:4},
  headerBtn:    {paddingHorizontal:8, height:36, alignItems:'center', justifyContent:'center'},
  headerBtnText:{color:'#aaa', fontSize:13},

  tabsScroll:{borderBottomWidth:0.5, borderBottomColor:'#222'},
  tabs:      {flexDirection:'row'},
  tab:       {width:46, alignItems:'center', paddingVertical:12, position:'relative'},
  tabLine:   {position:'absolute', bottom:0, left:'15%', right:'15%', height:2, backgroundColor:'#fff', borderRadius:1},

  toolbar:      {flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingVertical:8, borderBottomWidth:0.5, borderBottomColor:'#111'},
  playAll:      {flexDirection:'row', alignItems:'center'},
  playAllText:  {color:'#888', fontSize:13},
  toolbarRight: {flexDirection:'row', alignItems:'center', gap:2},
  tbBtn:        {width:32, height:32, alignItems:'center', justifyContent:'center', borderRadius:6},
  tbBtnAct:     {backgroundColor:'#1e1e1e'},
  tbDivider:    {width:0.5, height:16, backgroundColor:'#333', marginHorizontal:4},

  row:       {flexDirection:'row', alignItems:'center', gap:10, paddingHorizontal:16, paddingVertical:10, borderBottomWidth:0.5, borderBottomColor:'#0d0d0d'},
  rowCover:  {width:46, height:46, borderRadius:6, alignItems:'center', justifyContent:'center'},
  rowMeta:   {flex:1, minWidth:0},
  rowTitle:  {fontSize:13, fontWeight:'500', color:'#fff'},
  rowSub:    {fontSize:11, color:'#555', marginTop:2},
  rowFormat: {fontSize:10, color:'#333'},
  rowDots:   {padding:8},

  empty:      {flex:1, alignItems:'center', justifyContent:'center', paddingTop:80, gap:8},
  emptyTitle: {fontSize:16, fontWeight:'500', color:'#555'},
  emptySub:   {fontSize:12, color:'#333', textAlign:'center', paddingHorizontal:32},

  settingRow:   {flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:20, paddingVertical:16, borderBottomWidth:0.5, borderBottomColor:'#111'},
  settingLabel: {fontSize:15, color:'#fff'},
  settingValue: {fontSize:13, color:'#555'},
  version:      {textAlign:'center', fontSize:13, color:'#333', marginTop:32},
  versionSub:   {textAlign:'center', fontSize:12, color:'#222', marginTop:4},

  mini:       {flexDirection:'row', alignItems:'center', gap:10, backgroundColor:'#111', paddingHorizontal:16, paddingVertical:10, borderTopWidth:0.5, borderTopColor:'#222'},
  miniCover:  {width:38, height:38, borderRadius:6, alignItems:'center', justifyContent:'center'},
  miniInfo:   {flex:1},
  miniTitle:  {fontSize:13, fontWeight:'500', color:'#fff'},
  miniArtist: {fontSize:11, color:'#555', marginTop:1},
  miniBtn:    {padding:8},

  navbar:  {flexDirection:'row', backgroundColor:'#000', borderTopWidth:0.5, borderTopColor:'#1a1a1a', paddingBottom:4},
  navItem: {flex:1, alignItems:'center', paddingTop:10, gap:4},
  navDot:  {width:4, height:4, borderRadius:2, backgroundColor:'#e85d4a'},

  scanBanner: {flexDirection:'row', alignItems:'center', backgroundColor:'#0d0d0d', paddingHorizontal:16, paddingVertical:7, borderBottomWidth:0.5, borderBottomColor:'#1a1a1a'},
  scanText:   {fontSize:12, color:'#888'},
});
