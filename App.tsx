import React, {useState, useRef} from 'react';
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
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

const {width} = Dimensions.get('window');

// ─── Palettes ─────────────────────────────────────────────────────────────────
const GENRE_PALETTE: Record<string, {dark: string; mid: string; bright: string; cover: string}> = {
  Rap:  {dark:'#0d1a2e', mid:'#1a3a5c', bright:'#4a9eff', cover:'#0f2240'},
  'D&B':{dark:'#1a0a2e', mid:'#4a1a7a', bright:'#c44aff', cover:'#2a0f4a'},
};
const defaultPalette = {dark:'#0a0a0a', mid:'#1a1a1a', bright:'#ffffff', cover:'#1a1a1a'};
const coverColor = (genre?: string) => (GENRE_PALETTE[genre ?? ''] ?? defaultPalette).cover;

// ─── Données ──────────────────────────────────────────────────────────────────
const TRACKS = [
  {id:'1',  title:'WISH YOU WELL',  artist:'Destroy Lonely',  album:'If Looks Could Kill', genre:'Rap',  year:'2023', format:'FLAC', rate:'44.1kHz'},
  {id:'2',  title:'Machina',        artist:'Pendulum',         album:'Immersion',            genre:'D&B',  year:'2010', format:'FLAC', rate:'96kHz'},
  {id:'3',  title:"God's Plan",     artist:'Drake',            album:'Scorpion',             genre:'Rap',  year:'2018', format:'MP3',  rate:'44.1kHz'},
  {id:'4',  title:'Jungle Sound',   artist:'Noisia',           album:'Split the Atom',       genre:'D&B',  year:'2010', format:'FLAC', rate:'48kHz'},
  {id:'5',  title:'HUMBLE.',        artist:'Kendrick Lamar',   album:'DAMN.',                genre:'Rap',  year:'2017', format:'FLAC', rate:'44.1kHz'},
  {id:'6',  title:'The Noose',      artist:'Calyx & Teebee',  album:'Rush Hour',            genre:'D&B',  year:'2012', format:'MP3',  rate:'44.1kHz'},
  {id:'7',  title:'SICKO MODE',     artist:'Travis Scott',     album:'Astroworld',           genre:'Rap',  year:'2018', format:'FLAC', rate:'44.1kHz'},
  {id:'8',  title:'Molly (deco)',   artist:'Bedry',            album:'Single',               genre:'Rap',  year:'2023', format:'MP3',  rate:'44.1kHz'},
  {id:'9',  title:'1 VUE',          artist:'La Feve',          album:'Single',               genre:'Rap',  year:'2023', format:'MP3',  rate:'44.1kHz'},
  {id:'10', title:'Fly',            artist:'Serane',           album:'Single',               genre:'D&B',  year:'2022', format:'FLAC', rate:'48kHz'},
  {id:'11', title:'Vampire Hour',   artist:'Ken Carson',       album:'A Great Chaos',        genre:'Rap',  year:'2023', format:'FLAC', rate:'44.1kHz'},
  {id:'12', title:'Margiela Man',   artist:'UnoTheActivist',   album:'UnoTheActivist',       genre:'Rap',  year:'2018', format:'MP3',  rate:'44.1kHz'},
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

type Track  = typeof TRACKS[0];
type ViewMode = 'list' | 'grid';
type PlayMode = 'shuffle' | 'order' | 'loop' | 'one';

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

// ─── Player ───────────────────────────────────────────────────────────────────
const PlayerScreen = ({track, onClose, queue, onRemoveFromQueue}: {
  track: Track; onClose: () => void; queue: Track[]; onRemoveFromQueue: (id: string) => void;
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFav,     setIsFav]     = useState(false);
  const [playMode,  setPlayMode]  = useState<PlayMode>('order');
  const [sheetOpen, setSheetOpen] = useState(false);
  const palette = GENRE_PALETTE[track.genre] ?? defaultPalette;

  const nextMode  = (): PlayMode => {const m:PlayMode[]=['order','shuffle','loop','one']; return m[(m.indexOf(playMode)+1)%m.length];};
  const modeIcon  = () => ({shuffle:'shuffle-variant', loop:'repeat', one:'repeat-once', order:'arrow-right'}[playMode]);

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
          <View style={[pS.cover, {borderColor:palette.bright+'44', backgroundColor:palette.cover ?? '#ffffff0d'}]}>
            <MaterialCommunityIcons name="music" size={80} color={palette.bright+'88'}/>
          </View>
        </View>

        {/* Titre */}
        <View style={pS.titleRow}>
          <View style={pS.titleBlock}>
            <Text style={pS.trackTitle} numberOfLines={1}>{track.title}</Text>
            <Text style={[pS.trackArtist, {color:palette.bright+'cc'}]} numberOfLines={1}>{track.artist}</Text>
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
          <View style={pS.progressTrack}>
            <View style={[pS.progressFill, {width:'35%', backgroundColor:palette.bright}]}/>
            <View style={[pS.progressThumb, {left:'35%', backgroundColor:palette.bright}]}/>
          </View>
          <View style={pS.progressTimes}>
            <Text style={pS.timeText}>1:24</Text>
            <Text style={pS.timeText}>3:58</Text>
          </View>
        </View>

        {/* Contrôles */}
        <View style={pS.controls}>
          <TouchableOpacity style={[pS.ctrlBtn, pS.ctrlBtnGlass]} onPress={() => setPlayMode(nextMode())}>
            <MaterialCommunityIcons name={modeIcon() as any} size={22} color="#fff"/>
            {playMode !== 'order' && <View style={[pS.modeDot, {backgroundColor:palette.bright}]}/>}
          </TouchableOpacity>
          <TouchableOpacity style={[pS.ctrlBtn, pS.ctrlBtnGlass]}>
            <MaterialCommunityIcons name="skip-previous" size={22} color="#fff"/>
          </TouchableOpacity>
          <TouchableOpacity style={[pS.ctrlBtn, pS.ctrlBtnPlay]} onPress={() => setIsPlaying(p=>!p)}>
            <MaterialCommunityIcons name={isPlaying?'pause':'play'} size={28} color="#111"/>
          </TouchableOpacity>
          <TouchableOpacity style={[pS.ctrlBtn, pS.ctrlBtnGlass]}>
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
              <View style={[pS.queueCover, {backgroundColor:coverColor(t.genre)}]}>
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
  overlay:       {...StyleSheet.absoluteFillObject, backgroundColor:'#000000aa', justifyContent:'flex-end', zIndex:200},
  sheet:         {backgroundColor:'#111', borderTopLeftRadius:16, borderTopRightRadius:16, paddingTop:8, paddingBottom:32},
  sheetRow:      {flexDirection:'row', alignItems:'center', gap:14, paddingHorizontal:20, paddingVertical:16},
  sheetLabel:    {fontSize:15, color:'#fff'},
});

// ─── TrackRow (liste) ─────────────────────────────────────────────────────────
const TrackRow = ({track, onPress}: {track: any; onPress?: () => void}) => (
  <TouchableOpacity style={S.row} activeOpacity={0.7} onPress={onPress}>
    <View style={[S.rowCover, {backgroundColor: coverColor(track.genre)}]}>
      <MaterialCommunityIcons name="music" size={18} color="#ffffff33"/>
    </View>
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
    <View style={[gS.cover, {backgroundColor: coverColor(track.genre)}]}>
      <MaterialCommunityIcons name="music" size={24} color="#ffffff22"/>
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
const LibraryPage = ({onTrackPress}: {onTrackPress: (t: Track) => void}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [view, setView] = useState<ViewMode>('list');

  const renderContent = () => {
    // Titres
    if (activeTab === 0) return (
      <>
        <Toolbar count={TRACKS.length} label="pistes" view={view} onView={setView}/>
        {view === 'grid'
          ? <TrackGrid tracks={TRACKS} onPress={onTrackPress}/>
          : <FlatList data={TRACKS} keyExtractor={i=>i.id} renderItem={({item}) => <TrackRow track={item} onPress={() => onTrackPress(item)}/>}/>
        }
      </>
    );
    // Artistes
    if (activeTab === 1) {
      const items = [...new Set(TRACKS.map(t=>t.artist))].map(a=>({name:a, sub:TRACKS.filter(t=>t.artist===a).length+' pistes'}));
      return (
        <>
          <Toolbar count={items.length} label="artistes" view={view} onView={setView}/>
          {view === 'grid'
            ? <CategoryGrid items={items} icon="account"/>
            : <FlatList data={items} keyExtractor={i=>i.name} renderItem={({item}) => <TrackRow track={{title:item.name, artist:item.sub, format:''}}/>}/>
          }
        </>
      );
    }
    // Albums
    if (activeTab === 2) {
      const items = [...new Set(TRACKS.map(t=>t.album))].map(a=>({name:a, sub:TRACKS.find(t=>t.album===a)!.artist, genre:TRACKS.find(t=>t.album===a)!.genre}));
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
                renderItem={({item}) => (
                  <TouchableOpacity style={gS.item} activeOpacity={0.75}>
                    <View style={[gS.cover, {backgroundColor: coverColor(item.genre)}]}>
                      <MaterialCommunityIcons name="album" size={24} color="#ffffff22"/>
                    </View>
                    <Text style={gS.title} numberOfLines={2}>{item.name}</Text>
                    <Text style={gS.sub}   numberOfLines={1}>{item.sub}</Text>
                  </TouchableOpacity>
                )}
              />
            : <FlatList data={items} keyExtractor={i=>i.name} renderItem={({item}) => <TrackRow track={{title:item.name, artist:item.sub, format:''}}/>}/>
          }
        </>
      );
    }
    // Genres
    if (activeTab === 3) {
      const items = [...new Set(TRACKS.map(t=>t.genre))].map(g=>({name:g, sub:TRACKS.filter(t=>t.genre===g).length+' pistes', id:g}));
      return (
        <>
          <Toolbar count={items.length} label="genres" view={view} onView={setView}/>
          {view === 'grid'
            ? <CategoryGrid items={items} icon="music-circle-outline"/>
            : <FlatList data={items} keyExtractor={i=>i.id} renderItem={({item}) => <TrackRow track={{title:item.name, artist:item.sub, format:''}}/>}/>
          }
        </>
      );
    }
    // Dossiers
    if (activeTab === 4) {
      const items = [{name:'/Musique', sub:'Dossier principal'}];
      return (
        <>
          <Toolbar count={1} label="dossier" view={view} onView={setView}/>
          {view === 'grid'
            ? <CategoryGrid items={items} icon="folder-outline"/>
            : <TrackRow track={{title:'/Musique', artist:'Dossier principal', format:''}}/>
          }
        </>
      );
    }
    // Années
    if (activeTab === 5) {
      const items = [...new Set(TRACKS.map(t=>t.year))].sort((a,b)=>Number(b)-Number(a)).map(y=>({name:y, sub:TRACKS.filter(t=>t.year===y).length+' pistes', id:y}));
      return (
        <>
          <Toolbar count={items.length} label="annees" view={view} onView={setView}/>
          {view === 'grid'
            ? <CategoryGrid items={items} icon="calendar-outline"/>
            : <FlatList data={items} keyExtractor={i=>i.id} renderItem={({item}) => <TrackRow track={{title:item.name, artist:item.sub, format:''}}/>}/>
          }
        </>
      );
    }
    // Sampling
    if (activeTab === 6) {
      const items = [...new Set(TRACKS.map(t=>t.rate))].map(r=>({name:r, sub:TRACKS.filter(t=>t.rate===r).length+' pistes', id:r}));
      return (
        <>
          <Toolbar count={items.length} label="taux" view={view} onView={setView}/>
          {view === 'grid'
            ? <CategoryGrid items={items} icon="sine-wave"/>
            : <FlatList data={items} keyExtractor={i=>i.id} renderItem={({item}) => <TrackRow track={{title:item.name, artist:item.sub, format:''}}/>}/>
          }
        </>
      );
    }
    // Format
    if (activeTab === 7) {
      const items = [...new Set(TRACKS.map(t=>t.format))].map(f=>({name:f, sub:TRACKS.filter(t=>t.format===f).length+' pistes', id:f}));
      return (
        <>
          <Toolbar count={items.length} label="formats" view={view} onView={setView}/>
          {view === 'grid'
            ? <CategoryGrid items={items} icon="file-music-outline"/>
            : <FlatList data={items} keyExtractor={i=>i.id} renderItem={({item}) => <TrackRow track={{title:item.name, artist:item.sub, format:''}}/>}/>
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
const FavoritesPage = ({onTrackPress}: {onTrackPress: (t: Track) => void}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [view, setView] = useState<ViewMode>('list');

  const renderContent = () => {
    if (activeTab === 1) return <EmptyState msg="Aucune playlist" sub="Cree ta premiere playlist depuis un morceau"/>;
    const list = activeTab === 4 ? [...TRACKS].reverse() : TRACKS;
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
  if (!track) return null;
  return (
    <TouchableOpacity style={S.mini} activeOpacity={0.9} onPress={onPress}>
      <View style={[S.miniCover, {backgroundColor: coverColor(track.genre)}]}>
        <MaterialCommunityIcons name="music" size={18} color="#ffffff33"/>
      </View>
      <View style={S.miniInfo}>
        <Text style={S.miniTitle}  numberOfLines={1}>{track.title}</Text>
        <Text style={S.miniArtist} numberOfLines={1}>{track.artist}</Text>
      </View>
      <TouchableOpacity style={S.miniBtn}>
        <MaterialCommunityIcons name="pause" size={22} color="#fff"/>
      </TouchableOpacity>
      <TouchableOpacity style={S.miniBtn}>
        <MaterialCommunityIcons name="skip-next" size={22} color="#fff"/>
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [page,         setPage]         = useState(0);
  const [currentTrack, setCurrentTrack] = useState<Track|null>(null);
  const [playerOpen,   setPlayerOpen]   = useState(false);
  const [queue,        setQueue]        = useState<Track[]>(TRACKS.slice(0, 5));

  const NAV = [
    {label:'Bibliotheque', icon:'disc'},
    {label:'Mes listes',   icon:'format-list-bulleted'},
    {label:'Parametres',   icon:'account-circle-outline'},
  ];

  const openTrack = (t: Track) => {setCurrentTrack(t); setPlayerOpen(true);};

  return (
    <SafeAreaView style={S.root} edges={['bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#000"/>
      {page === 0 && <LibraryPage onTrackPress={openTrack}/>}
      {page === 1 && <FavoritesPage onTrackPress={openTrack}/>}
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
          queue={queue}
          onRemoveFromQueue={(id) => setQueue(q=>q.filter(t=>t.id!==id))}
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
});
