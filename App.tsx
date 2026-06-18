import React, {useState, useRef, useEffect, useCallback, useContext} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  FlatList,
  StatusBar,
  Dimensions,
  PanResponder,
  Image,
  Modal,
  Alert,
  NativeModules,
  PermissionsAndroid,
  Platform,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import TrackPlayer from 'react-native-track-player';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {useActiveTrack} = require('react-native-track-player') as {useActiveTrack: () => import('react-native-track-player').Track | undefined};
import {setupPlayer, usePlayer, toPlayerTrack} from './src/usePlayer';
import {usePlaylists, createPlaylist, renamePlaylist, deletePlaylist, toggleTrack, removeTrack, type Playlist} from './src/usePlaylists';
import {useFavorites, toggleFavorite} from './src/useFavorites';
import {useTrackMenu, openTrackMenu, closeTrackMenu} from './src/useTrackMenu';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {peqGetInfo, peqConfigure, peqSetGain, peqSetEnabled, presetGainsFor, hzLabel, type PeqBand} from './src/peq';

// ─── Thème clair / sombre ───────────────────────────────────────────────────────
// Tokens sémantiques : seul le « chrome » de l'app est thématisé.
// Le lecteur plein écran reste coloré par genre dans les deux thèmes.
type Colors = {
  bg: string;        // fond principal
  surface: string;   // cartes, mini-lecteur, feuilles, onglet actif
  surface2: string;  // couvertures de catégorie sans pochette
  text: string;      // texte principal
  textDim: string;   // texte secondaire
  textFaint: string; // texte tertiaire
  textGhost: string; // texte très estompé / version
  icon: string;      // icône active
  iconDim: string;   // icône inactive
  border: string;    // séparateurs
  accent: string;    // orange de marque
  scanBg: string;    // bandeau de scan neutre
  barStyle: 'light-content' | 'dark-content';
  statusBg: string;
};

const DARK: Colors = {
  bg:'#000', surface:'#141414', surface2:'#1a1a1a',
  text:'#fff', textDim:'#aaa', textFaint:'#777', textGhost:'#444',
  icon:'#fff', iconDim:'#555', border:'#1c1c1c',
  accent:'#e85d4a', scanBg:'#0d0d0d', barStyle:'light-content', statusBg:'#000',
};
const LIGHT: Colors = {
  bg:'#f7f7f7', surface:'#ffffff', surface2:'#ececec',
  text:'#141414', textDim:'#555', textFaint:'#888', textGhost:'#bbb',
  icon:'#222', iconDim:'#aaa', border:'#e3e3e3',
  accent:'#e85d4a', scanBg:'#ededed', barStyle:'dark-content', statusBg:'#f7f7f7',
};

const ThemeCtx = React.createContext<Colors>(DARK);
const useColors = () => useContext(ThemeCtx);

// Styles dépendants du thème, mémoïsés par palette (DARK/LIGHT étant des singletons)
const styleCache = new WeakMap<Colors, {S: any; gS: any; setS: any}>();
const stylesFor = (c: Colors) => {
  let cached = styleCache.get(c);
  if (!cached) {
    cached = {S: makeS(c), gS: makeGS(c), setS: makeSetS(c)};
    styleCache.set(c, cached);
  }
  return cached;
};
const useStyles = () => stylesFor(useColors());

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
  sampleRate?: number;  // Hz (0 si inconnu)
  bitDepth?:   number;  // bits (0 si inconnu)
};

// Regroupe un morceau par qualité audio (taux d'échantillonnage, ou DSDxxx).
// `rate` sert au tri : PCM par fréquence croissante, DSD après, inconnu en dernier.
function qualityGroup(t: Track): {key: string; label: string; rate: number} {
  const isDsd = t.format === 'DSD' || (t.mime?.includes('dsd') ?? false);
  if (isDsd) {
    const mult = t.sampleRate && t.sampleRate > 0 ? Math.round(t.sampleRate / 44100) : 0;
    const label = mult >= 32 ? `DSD${mult}` : 'DSD';
    return {key: label, label, rate: 10_000_000 + (t.sampleRate ?? 0)};
  }
  const sr = t.sampleRate ?? 0;
  if (sr <= 0) return {key: 'unknown', label: 'Inconnu', rate: Number.MAX_SAFE_INTEGER};
  const khz = sr / 1000;
  const label = (Number.isInteger(khz) ? khz.toString() : khz.toFixed(1)) + 'kHz';
  return {key: label, label, rate: sr};
}

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
  {icon:'calendar-outline',     label:'Années'},
  {icon:'sine-wave',            label:'Sampling'},
  {icon:'file-music-outline',   label:'Format'},
];
const FAV_TABS = [
  {icon:'heart-outline',       iconActive:'heart',        label:'Favoris'},
  {icon:'playlist-music',      iconActive:'playlist-music', label:'Playlists'},
  {icon:'history',             iconActive:'history',        label:'Récents'},
  {icon:'play-circle-outline', iconActive:'play-circle',    label:'+ Joués'},
  {icon:'clock-plus-outline',  iconActive:'clock-plus',     label:'Ajoutés'},
];

type ViewMode = 'list' | 'grid';

// ─── Constantes grille ────────────────────────────────────────────────────────
const GRID_COLS   = 3;
const GRID_PAD    = 12;   // padding extérieur
const GRID_GAP    = 6;    // espace entre items
const GRID_ITEM_W = (width - GRID_PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;

// ─── Égaliseur tactile ────────────────────────────────────────────────────────
const EQ_HEIGHT = 130;     // hauteur des sliders
const EQ_CURVE_H = 86;     // hauteur de la courbe de réponse
const CURVE_BARS = 64;     // résolution de la courbe (barres fines, pas de SVG)

// Interpolation dB linéaire en échelle log-fréquence (entre les centres de bande)
function eqInterp(pts: {hz: number; db: number}[], hz: number): number {
  if (pts.length === 0) return 0;
  if (hz <= pts[0].hz) return pts[0].db;
  const last = pts[pts.length - 1];
  if (hz >= last.hz) return last.db;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (hz >= a.hz && hz <= b.hz) {
      const t = (Math.log(hz) - Math.log(a.hz)) / (Math.log(b.hz) - Math.log(a.hz));
      return a.db + t * (b.db - a.db);
    }
  }
  return 0;
}

const EQ_MAX_BANDS = 15;

// Courbe de réponse : aire remplie approximée par des barres fines (sans SVG).
const EqCurve = ({bands, minDb, maxDb, bright}: {bands: PeqBand[]; minDb: number; maxDb: number; bright: string}) => {
  const span = (maxDb - minDb) || 1;
  const pts = bands.map(b => ({hz: b.freq, db: b.gain})).sort((a, b) => a.hz - b.hz);
  const lnMin = Math.log(20), lnMax = Math.log(20000);
  const zeroH = ((0 - minDb) / span) * EQ_CURVE_H;
  return (
    <View style={[eqS.curveWrap, {height: EQ_CURVE_H}]}>
      <View style={[eqS.zeroLine, {bottom: zeroH}]}/>
      <View style={eqS.curveRow}>
        {Array.from({length: CURVE_BARS}, (_, k) => {
          const hz = Math.exp(lnMin + (k / (CURVE_BARS - 1)) * (lnMax - lnMin));
          const db = eqInterp(pts, hz);
          const h = Math.max(2, ((db - minDb) / span) * EQ_CURVE_H);
          return <View key={k} style={{flex: 1, height: h, backgroundColor: bright}}/>;
        })}
      </View>
    </View>
  );
};

// Slider de bande : gain draggable (audio live) + fréquence éditable au tap.
const EqBand = ({freq, gain, bright, minDb, maxDb, onLive, onCommit, onEditFreq, onDragStart, onDragEnd}: {
  freq: number; gain: number; bright: string; minDb: number; maxDb: number;
  onLive: (db: number) => void; onCommit: (db: number) => void; onEditFreq: () => void;
  onDragStart: () => void; onDragEnd: () => void;
}) => {
  const span = (maxDb - minDb) || 1;
  const [db, setDb] = useState(gain);
  const dbRef = useRef(db); dbRef.current = db;
  const startRef = useRef(db);
  // Synchronise quand la valeur change de l'extérieur (préréglage / reconfig)
  useEffect(() => { setDb(gain); }, [gain]);

  // Le slider revendique le toucher dès le départ (phases start + capture) et
  // refuse de céder le geste : la page ne défile pas pendant le réglage. En plus,
  // onDragStart/End fige le défilement de la ScrollView parente par sécurité.
  const cb = useRef({onLive, onCommit, onDragStart, onDragEnd, minDb, span});
  cb.current = {onLive, onCommit, onDragStart, onDragEnd, minDb, span};
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => { startRef.current = dbRef.current; cb.current.onDragStart(); },
      onPanResponderMove: (_, gs) => {
        const startRatio = (startRef.current - cb.current.minDb) / cb.current.span;
        const r = Math.max(0, Math.min(1, startRatio - gs.dy / EQ_HEIGHT));
        const v = Math.round((cb.current.minDb + r * cb.current.span) * 10) / 10;
        setDb(v);
        cb.current.onLive(v); // audio en temps réel pendant le glissement
      },
      onPanResponderRelease: () => { cb.current.onCommit(dbRef.current); cb.current.onDragEnd(); },
      onPanResponderTerminate: () => { cb.current.onDragEnd(); },
    }),
  ).current;

  const ratio = Math.max(0, Math.min(1, (db - minDb) / span));
  const zeroRatio = Math.max(0, Math.min(1, (0 - minDb) / span));
  const knobBottom = ratio * EQ_HEIGHT;
  const segBottom = Math.min(ratio, zeroRatio) * EQ_HEIGHT;
  const segHeight = Math.abs(ratio - zeroRatio) * EQ_HEIGHT;

  return (
    <View style={eqS.bandCol}>
      <Text style={[eqS.gain, {color: bright}]}>{db > 0 ? '+' : ''}{db.toFixed(1)}</Text>
      <View style={[eqS.slider, {height: EQ_HEIGHT}]} {...pan.panHandlers}>
        <View style={eqS.sliderTrack}/>
        <View style={[eqS.seg, {bottom: segBottom, height: segHeight, backgroundColor: bright}]}/>
        <View style={[eqS.knob, {bottom: knobBottom - 9, backgroundColor: bright}]}/>
      </View>
      <TouchableOpacity onPress={onEditFreq} hitSlop={{top:8, bottom:8, left:6, right:6}}>
        <Text style={[eqS.freq, {color: bright}]}>{hzLabel(freq)}</Text>
      </TouchableOpacity>
    </View>
  );
};

// Modale : éditer la fréquence (Hz) d'une bande ou la supprimer.
const FreqEditModal = ({visible, freq, onClose, onSubmit, onRemove}: {
  visible: boolean; freq: number; onClose: () => void; onSubmit: (hz: number) => void; onRemove: () => void;
}) => {
  const {setS} = useStyles();
  const c = useColors();
  const [val, setVal] = useState(String(Math.round(freq)));
  useEffect(() => { if (visible) setVal(String(Math.round(freq))); }, [visible, freq]);
  const submit = () => {
    const hz = parseInt(val, 10);
    if (hz >= 20 && hz <= 20000) onSubmit(hz);
    onClose();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={setS.centerBackdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={setS.dialog} activeOpacity={1}>
          <Text style={setS.dialogTitle}>Fréquence (Hz)</Text>
          <TextInput
            style={setS.input}
            value={val}
            onChangeText={setVal}
            keyboardType="number-pad"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
            placeholder="20 – 20000"
            placeholderTextColor={c.iconDim}/>
          <View style={setS.dialogActions}>
            <TouchableOpacity style={setS.dialogBtn} onPress={() => { onRemove(); onClose(); }}>
              <Text style={[setS.dialogBtnText, {color:'#ff4d6d'}]}>Supprimer</Text>
            </TouchableOpacity>
            <View style={{flex:1}}/>
            <TouchableOpacity style={setS.dialogBtn} onPress={onClose}>
              <Text style={setS.dialogBtnText}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity style={setS.dialogBtn} onPress={submit}>
              <Text style={setS.dialogBtnPrimary}>OK</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

// Panneau égaliseur paramétrique : courbe + sliders + fréquences éditables.
const ParametricEq = ({bands, minDb, maxDb, bright, onGainLive, onGainCommit, onSetFreq, onRemoveBand, onDragStart, onDragEnd}: {
  bands: PeqBand[]; minDb: number; maxDb: number; bright: string;
  onGainLive: (i: number, db: number) => void; onGainCommit: (i: number, db: number) => void;
  onSetFreq: (i: number, hz: number) => void; onRemoveBand: (i: number) => void;
  onDragStart: () => void; onDragEnd: () => void;
}) => {
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <View style={eqS.panel}>
      <EqCurve bands={bands} minDb={minDb} maxDb={maxDb} bright={bright}/>
      {/* Rangée flex (toutes les bandes tiennent à l'écran) : pas de scroll
          horizontal, donc aucun conflit de geste avec le réglage du gain. */}
      <View style={eqS.bandsRow}>
        <View style={eqS.scale}>
          <Text style={eqS.scaleTxt}>+{maxDb}</Text>
          <Text style={eqS.scaleTxt}>0</Text>
          <Text style={eqS.scaleTxt}>-{Math.abs(minDb)}</Text>
        </View>
        {bands.map((b, i) => (
          <EqBand
            key={i}
            freq={b.freq}
            gain={b.gain}
            bright={bright}
            minDb={minDb}
            maxDb={maxDb}
            onLive={db => onGainLive(i, db)}
            onCommit={db => onGainCommit(i, db)}
            onEditFreq={() => setEditing(i)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
      </View>
      <FreqEditModal
        visible={editing !== null}
        freq={editing !== null ? (bands[editing]?.freq ?? 1000) : 1000}
        onClose={() => setEditing(null)}
        onSubmit={hz => { if (editing !== null) onSetFreq(editing, hz); }}
        onRemove={() => { if (editing !== null) onRemoveBand(editing); }}
      />
    </View>
  );
};

const eqS = StyleSheet.create({
  panel:     {backgroundColor:'#0c0c0fcc', borderRadius:12, padding:12, marginTop:6},
  curveWrap: {position:'relative', overflow:'hidden', borderRadius:6, backgroundColor:'#ffffff08'},
  curveRow:  {flexDirection:'row', alignItems:'flex-end', height:'100%', opacity:0.55},
  zeroLine:  {position:'absolute', left:0, right:0, height:1, backgroundColor:'#ffffff22'},
  bandsRow:  {flexDirection:'row', alignItems:'flex-end', marginTop:12},
  scale:     {height:EQ_HEIGHT, justifyContent:'space-between', alignItems:'flex-end', marginBottom:20, marginRight:6, width:22},
  scaleTxt:  {fontSize:9, color:'#ffffff44'},
  bandCol:   {flex:1, alignItems:'center'},
  gain:      {fontSize:11, fontWeight:'600', marginBottom:6},
  slider:    {width:'100%', alignItems:'center', position:'relative'},
  sliderTrack:{position:'absolute', top:0, bottom:0, width:2, marginLeft:-1, left:'50%', backgroundColor:'#ffffff1f', borderRadius:1},
  seg:       {position:'absolute', width:3, marginLeft:-1.5, left:'50%', borderRadius:2},
  knob:      {position:'absolute', left:'50%', marginLeft:-9, width:18, height:18, borderRadius:9, borderWidth:2, borderColor:'#000'},
  freq:      {fontSize:10, fontWeight:'600', marginTop:8},
});

// API de l'égaliseur passée au lecteur et à la page EQ dédiée.
type EqApi = {
  range: {minDb: number; maxDb: number} | null;
  bands: PeqBand[];
  onGainLive: (i: number, db: number) => void;
  onGainCommit: (i: number, db: number) => void;
  onSetFreq: (i: number, hz: number) => void;
  onAddBand: () => void;
  onRemoveBand: (i: number) => void;
  onReset: () => void;
};

// Page égaliseur plein écran : aucune ScrollView parente → les sliders ne
// rentrent jamais en conflit avec le défilement de la page.
const EqualizerScreen = ({visible, onClose, eq, bright}: {
  visible: boolean; onClose: () => void; eq: EqApi; bright: string;
}) => {
  if (!visible || !eq.range) return null;
  return (
    <View style={eqScrS.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0d"/>
      <View style={eqScrS.header}>
        <TouchableOpacity onPress={onClose} style={eqScrS.hBtn}>
          <MaterialCommunityIcons name="chevron-down" size={28} color="#fff"/>
        </TouchableOpacity>
        <Text style={eqScrS.title}>Égaliseur</Text>
        <TouchableOpacity onPress={eq.onReset} style={eqScrS.resetBtn}>
          <Text style={eqScrS.resetTxt}>Réinitialiser</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={eq.onAddBand} style={eqScrS.hBtn}>
          <MaterialCommunityIcons name="plus-circle-outline" size={24} color={bright}/>
        </TouchableOpacity>
      </View>
      <View style={eqScrS.body}>
        <ParametricEq
          bands={eq.bands}
          minDb={eq.range.minDb}
          maxDb={eq.range.maxDb}
          bright={bright}
          onGainLive={eq.onGainLive}
          onGainCommit={eq.onGainCommit}
          onSetFreq={eq.onSetFreq}
          onRemoveBand={eq.onRemoveBand}
          onDragStart={() => {}}
          onDragEnd={() => {}}
        />
        <Text style={eqScrS.hint}>Glisse une bande pour le gain · touche une fréquence pour la modifier · + pour ajouter une bande</Text>
      </View>
    </View>
  );
};

const eqScrS = StyleSheet.create({
  root:     {position:'absolute', top:0, left:0, right:0, bottom:0, backgroundColor:'#0a0a0d', zIndex:110},
  header:   {flexDirection:'row', alignItems:'center', paddingTop:52, paddingHorizontal:12, paddingBottom:12},
  hBtn:     {padding:6},
  title:    {flex:1, color:'#fff', fontSize:20, fontWeight:'700', marginLeft:4},
  resetBtn: {paddingHorizontal:10, paddingVertical:6},
  resetTxt: {color:'#ffffff99', fontSize:13},
  body:     {flex:1, justifyContent:'center', paddingHorizontal:8, paddingBottom:40},
  hint:     {color:'#ffffff55', fontSize:11, textAlign:'center', marginTop:18, paddingHorizontal:24, lineHeight:16},
});

// ─── Helpers temps ────────────────────────────────────────────────────────────
function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Player ───────────────────────────────────────────────────────────────────
const PlayerScreen = ({track, onClose, queue, onRemoveFromQueue, eq, onOpenEq}: {
  track: Track; onClose: () => void; queue: Track[]; onRemoveFromQueue: (id: string) => void;
  eq: EqApi; onOpenEq: () => void;
}) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addOpen,   setAddOpen]   = useState(false);
  const favorites = useFavorites();
  // Position en cours de glissement (ratio 0..1), null quand on ne touche pas la barre.
  const [seekRatio, setSeekRatio] = useState<number | null>(null);

  // Vrais contrôles depuis usePlayer
  const {isPlaying, isLoading, progress, activeTrack, playMode, togglePlay, skipNext, skipPrev, seekTo, cyclePlayMode} = usePlayer();

  // Largeur de la barre = largeur écran - paddings (24 de chaque côté).
  const TRACK_W = width - 48;
  // Le PanResponder est créé une fois : il lit la durée courante via un ref.
  const durationRef = useRef(0);
  durationRef.current = progress.duration;
  const ratioFromX = (x: number) => Math.max(0, Math.min(1, x / TRACK_W));
  const seekPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: e => setSeekRatio(ratioFromX(e.nativeEvent.locationX)),
      onPanResponderMove:  e => setSeekRatio(ratioFromX(e.nativeEvent.locationX)),
      onPanResponderRelease: e => {
        const r = ratioFromX(e.nativeEvent.locationX);
        seekTo(r * (durationRef.current || 0));
        setSeekRatio(null);
      },
      onPanResponderTerminate: () => setSeekRatio(null),
    }),
  ).current;

  // Pendant le glissement, on suit le doigt (seekRatio) ; sinon la position du player.
  const livePct = progress.duration > 0 ? progress.position / progress.duration : 0;
  const pct      = seekRatio !== null ? seekRatio : livePct;
  const shownPos = seekRatio !== null ? seekRatio * progress.duration : progress.position;

  // Utilise le track actif du player si disponible, sinon celui passé en prop
  const displayTrack = activeTrack ?? track;
  const palette = getPalette(displayTrack?.genre ?? track.genre);
  // L'objet track-player expose la pochette via `artwork` ; l'objet app via `artUri`.
  const coverUri = (displayTrack as any)?.artwork ?? (displayTrack as any)?.artUri ?? track.artUri;
  const favId = (displayTrack as any)?.id ?? track.id;
  const isFav = favId ? favorites.includes(favId) : false;

  // 'one' = répète le titre (boucle + « 1 ») ; 'loop-once'/'loop' = boucle simple
  // (le point sous l'icône distingue la répétition infinie) ; 'shuffle' = flèches croisées.
  const modeIcon = () => ({
    one:          'repeat-once',
    'loop-once':  'repeat',
    loop:         'repeat',
    shuffle:      'shuffle-variant',
  }[playMode] ?? 'repeat');

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
          {coverUri ? (
            <Image source={{uri: coverUri}} style={pS.cover} resizeMode="cover"/>
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
            <TouchableOpacity onPress={() => favId && toggleFavorite(favId)} style={pS.titleBtn}>
              <MaterialCommunityIcons name={isFav?'heart':'heart-outline'} size={22} color={isFav?'#ff4d6d':'#fff'}/>
            </TouchableOpacity>
            <TouchableOpacity style={pS.titleBtn} onPress={() => setAddOpen(true)}>
              <MaterialCommunityIcons name="plus" size={22} color="#fff"/>
            </TouchableOpacity>
          </View>
        </View>

        {/* Progression */}
        <View style={pS.progressWrap}>
          {/* Zone tactile élargie (le track visuel ne fait que 3px) */}
          <View style={pS.progressHit} {...seekPan.panHandlers}>
            <View style={pS.progressTrack}>
              <View style={[pS.progressFill, {
                width: `${pct * 100}%`,
                backgroundColor: palette.bright,
              }]}/>
              <View style={[pS.progressThumb, {
                left: `${pct * 100}%`,
                backgroundColor: palette.bright,
                transform: seekRatio !== null ? [{scale: 1.6}] : [{scale: 1}],
              }]}/>
            </View>
          </View>
          <View style={pS.progressTimes}>
            <Text style={pS.timeText}>{fmtTime(shownPos)}</Text>
            <Text style={pS.timeText}>{fmtTime(progress.duration)}</Text>
          </View>
        </View>

        {/* Contrôles */}
        <View style={pS.controls}>
          <TouchableOpacity style={[pS.ctrlBtn, pS.ctrlBtnGlass]} onPress={cyclePlayMode}>
            <MaterialCommunityIcons name={modeIcon() as any} size={22} color="#fff"/>
            {playMode === 'loop' && <View style={[pS.modeDot, {backgroundColor:palette.bright}]}/>}
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

        {/* EQ — aperçu cliquable qui ouvre la page dédiée (sliders sans conflit de scroll) */}
        {eq.range ? (
          <TouchableOpacity style={pS.section} activeOpacity={0.8} onPress={onOpenEq}>
            <View style={pS.sectionHeader}>
              <MaterialCommunityIcons name="equalizer-outline" size={14} color="#ffffff66"/>
              <Text style={pS.sectionTitle}>Égaliseur</Text>
              <View style={{flex:1}}/>
              <Text style={pS.eqOpenHint}>Régler</Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#ffffff88"/>
            </View>
            <View style={eqS.panel}>
              <EqCurve bands={eq.bands} minDb={eq.range.minDb} maxDb={eq.range.maxDb} bright={palette.bright}/>
            </View>
          </TouchableOpacity>
        ) : (
          <View style={pS.section}>
            <Text style={pS.sectionTitle}>Égaliseur</Text>
            <Text style={[pS.timeText, {paddingVertical:12}]}>Non disponible sur cet appareil.</Text>
          </View>
        )}

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
              {icon:'download',           label:'Télécharger'},
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

      <AddToPlaylistSheet
        trackId={(displayTrack as any)?.id ?? null}
        visible={addOpen}
        onClose={() => setAddOpen(false)}/>
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
  progressHit:   {paddingVertical:14, justifyContent:'center'},
  progressTrack: {height:3, backgroundColor:'#ffffff22', borderRadius:2, position:'relative'},
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
  eqOpenHint:    {fontSize:12, color:'#ffffff88', marginRight:2},
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
const TrackRow = ({track, onPress, onDots, dotsIcon, dotsColor}: {track: any; onPress?: () => void; onDots?: () => void; dotsIcon?: string; dotsColor?: string}) => {
  const {S} = useStyles();
  const c = useColors();
  return (
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
    <TouchableOpacity style={S.rowDots} onPress={onDots ?? (() => openTrackMenu(track))}>
      <MaterialCommunityIcons name={(dotsIcon ?? 'dots-vertical') as any} size={18} color={dotsColor ?? c.iconDim}/>
    </TouchableOpacity>
  </TouchableOpacity>
  );
};

// ─── TrackGridItem (grille, 3 par ligne) ──────────────────────────────────────
const TrackGridItem = ({track, onPress}: {track: any; onPress?: () => void}) => {
  const {gS} = useStyles();
  return (
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
};

// ─── CategoryGridItem (genres/années/etc.) ────────────────────────────────────
const CategoryGridItem = ({name, sub, icon, artUri, onPress}: {name: string; sub: string; icon?: string; artUri?: string; onPress?: () => void}) => {
  const {gS} = useStyles();
  const c = useColors();
  return (
  <TouchableOpacity style={gS.item} activeOpacity={0.75} onPress={onPress}>
    <View style={gS.catCover}>
      {artUri
        ? <Image source={{uri: artUri}} style={StyleSheet.absoluteFill} resizeMode="cover"/>
        : <MaterialCommunityIcons name={(icon ?? 'music') as any} size={28} color={c.iconDim}/>
      }
    </View>
    <Text style={gS.title} numberOfLines={2}>{name}</Text>
    <Text style={gS.sub}   numberOfLines={1}>{sub}</Text>
  </TouchableOpacity>
  );
};

// ─── Wrappers grille scrollables ──────────────────────────────────────────────
const TrackGrid = ({tracks, onPress}: {tracks: any[]; onPress?: (t: any) => void}) => {
  const {gS} = useStyles();
  return (
  <FlatList
    data={tracks}
    keyExtractor={i => i.id ?? i.name ?? i.title}
    numColumns={GRID_COLS}
    contentContainerStyle={gS.list}
    columnWrapperStyle={gS.row}
    renderItem={({item}) => <TrackGridItem track={item} onPress={onPress ? () => onPress(item) : undefined}/>}
  />
  );
};

const CategoryGrid = ({items, icon, onOpen}: {items: {name: string; sub: string; artUri?: string}[]; icon?: string; onOpen?: (item: {name: string; sub: string; artUri?: string}) => void}) => {
  const {gS} = useStyles();
  return (
  <FlatList
    data={items}
    keyExtractor={i => i.name}
    numColumns={GRID_COLS}
    contentContainerStyle={gS.list}
    columnWrapperStyle={gS.row}
    renderItem={({item}) => <CategoryGridItem name={item.name} sub={item.sub} icon={icon} artUri={item.artUri} onPress={onOpen ? () => onOpen(item) : undefined}/>}
  />
  );
};

const makeGS = (c: Colors) => StyleSheet.create({
  list:     {padding:GRID_PAD},
  row:      {gap:GRID_GAP, marginBottom:GRID_GAP},
  item:     {width:GRID_ITEM_W},
  cover:    {width:GRID_ITEM_W, height:GRID_ITEM_W, borderRadius:10, alignItems:'center', justifyContent:'center', marginBottom:6, position:'relative'},
  catCover: {width:GRID_ITEM_W, height:GRID_ITEM_W, borderRadius:10, backgroundColor:c.surface2, alignItems:'center', justifyContent:'center', marginBottom:6},
  title:    {fontSize:11, fontWeight:'600', color:c.text, lineHeight:15},
  sub:      {fontSize:10, color:c.textFaint, marginTop:1},
  badge:    {position:'absolute', bottom:5, right:5, backgroundColor:'#000000aa', borderRadius:3, paddingHorizontal:4, paddingVertical:1},
  badgeText:{fontSize:8, color:'#ffffff88', fontWeight:'600'},
});

// ─── Toolbar ──────────────────────────────────────────────────────────────────
const Toolbar = ({count, label, view, onView, onPlayAll}: {
  count: number; label: string; view: ViewMode; onView: (v: ViewMode) => void; onPlayAll?: () => void;
}) => {
  const {S} = useStyles();
  const c = useColors();
  return (
  <View style={S.toolbar}>
    <TouchableOpacity style={S.playAll} onPress={onPlayAll}>
      <MaterialCommunityIcons name="play-circle-outline" size={20} color={c.textDim} style={{marginRight:6}}/>
      <Text style={S.playAllText}>Tout lire  {count} {label}</Text>
    </TouchableOpacity>
    <View style={S.toolbarRight}>
      <TouchableOpacity style={[S.tbBtn, view==='list' && S.tbBtnAct]} onPress={() => onView('list')}>
        <MaterialCommunityIcons name="view-list" size={20} color={view==='list'?c.icon:c.iconDim}/>
      </TouchableOpacity>
      <TouchableOpacity style={[S.tbBtn, view==='grid' && S.tbBtnAct]} onPress={() => onView('grid')}>
        <MaterialCommunityIcons name="view-grid" size={20} color={view==='grid'?c.icon:c.iconDim}/>
      </TouchableOpacity>
      <View style={S.tbDivider}/>
      <TouchableOpacity style={S.tbBtn}>
        <MaterialCommunityIcons name="sort" size={20} color={c.iconDim}/>
      </TouchableOpacity>
      <TouchableOpacity style={S.tbBtn}>
        <MaterialCommunityIcons name="dots-vertical" size={20} color={c.iconDim}/>
      </TouchableOpacity>
    </View>
  </View>
  );
};

const EmptyState = ({msg, sub}: {msg: string; sub: string}) => {
  const {S} = useStyles();
  return (
  <View style={S.empty}>
    <Text style={S.emptyTitle}>{msg}</Text>
    <Text style={S.emptySub}>{sub}</Text>
  </View>
  );
};

// ─── Library Page ─────────────────────────────────────────────────────────────
type CatItem = {name: string; sub: string; id: string; artUri?: string; filter: (t: Track) => boolean};

const LibraryPage = ({tracks, onTrackPress, navIntent, onNavConsumed}: {
  tracks: Track[]; onTrackPress: (t: Track, queue?: Track[]) => void;
  navIntent?: {type: 'album' | 'artist'; value: string} | null; onNavConsumed?: () => void;
}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [view, setView] = useState<ViewMode>('list');
  // Catégorie ouverte (drill-in) : la liste des morceaux qu'elle contient.
  const [drill, setDrill] = useState<{label: string; items: Track[]} | null>(null);
  const {S} = useStyles();
  const c = useColors();

  const selectTab = (i: number) => { setActiveTab(i); setDrill(null); };
  const openCategory = (item: CatItem) => setDrill({label: item.name, items: tracks.filter(item.filter)});

  // Navigation venue du menu 3-points : ouvre l'album / l'artiste demandé.
  useEffect(() => {
    if (!navIntent) return;
    const isAlbum = navIntent.type === 'album';
    setActiveTab(isAlbum ? 2 : 1);
    setDrill({
      label: navIntent.value,
      items: tracks.filter(t => (isAlbum ? t.album : t.artist) === navIntent.value),
    });
    onNavConsumed?.();
  }, [navIntent, tracks, onNavConsumed]);

  // Rendu générique d'une catégorie (liste ou grille), entièrement cliquable.
  const renderCategory = (items: CatItem[], label: string, icon: string) => (
    <>
      <Toolbar count={items.length} label={label} view={view} onView={setView}/>
      {view === 'grid'
        ? <CategoryGrid items={items} icon={icon} onOpen={it => openCategory(it as CatItem)}/>
        : <FlatList data={items} keyExtractor={i=>i.id} initialNumToRender={20}
            renderItem={({item}) => (
              <TrackRow
                track={{title:item.name, artist:item.sub, artUri:item.artUri, format:'', genre:'', year:''}}
                onPress={() => openCategory(item)}/>
            )}/>
      }
    </>
  );

  const renderContent = () => {
    // Vue détail d'une catégorie : ses morceaux, jouables (file = la catégorie).
    if (drill) {
      return (
        <View style={S.content}>
          <View style={S.plDetailHeader}>
            <TouchableOpacity onPress={() => setDrill(null)} style={S.headerBtn}>
              <MaterialCommunityIcons name="chevron-left" size={26} color={c.text}/>
            </TouchableOpacity>
            <Text style={S.plDetailTitle} numberOfLines={1}>{drill.label}</Text>
          </View>
          <Toolbar count={drill.items.length} label="pistes" view={view} onView={setView}
            onPlayAll={() => drill.items.length && onTrackPress(drill.items[0], drill.items)}/>
          {view === 'grid'
            ? <TrackGrid tracks={drill.items} onPress={t => onTrackPress(t, drill.items)}/>
            : <FlatList data={drill.items} keyExtractor={i=>i.id} initialNumToRender={20}
                renderItem={({item}) => <TrackRow track={item} onPress={() => onTrackPress(item, drill.items)}/>}/>
          }
        </View>
      );
    }

    // Titres
    if (activeTab === 0) return (
      <>
        <Toolbar count={tracks.length} label="pistes" view={view} onView={setView}
          onPlayAll={() => tracks.length && onTrackPress(tracks[0], tracks)}/>
        {view === 'grid'
          ? <TrackGrid tracks={tracks} onPress={t => onTrackPress(t, tracks)}/>
          : <FlatList
              data={tracks}
              keyExtractor={i=>i.id}
              initialNumToRender={20}
              maxToRenderPerBatch={20}
              windowSize={10}
              renderItem={({item}) => <TrackRow track={item} onPress={() => onTrackPress(item, tracks)}/>}
            />
        }
      </>
    );
    // Artistes
    if (activeTab === 1) {
      const items: CatItem[] = [...new Set(tracks.map(t=>t.artist))].sort()
        .map(a => ({name:a, id:'artist:'+a, sub:tracks.filter(t=>t.artist===a).length+' pistes', filter:(t:Track)=>t.artist===a}));
      return renderCategory(items, 'artistes', 'account');
    }
    // Albums
    if (activeTab === 2) {
      const albumMap = new Map<string, CatItem>();
      tracks.forEach(t => {
        if (!albumMap.has(t.album)) albumMap.set(t.album, {name:t.album, id:'album:'+t.album, sub:t.artist, artUri:t.artUri, filter:(x:Track)=>x.album===t.album});
      });
      const items = [...albumMap.values()].sort((a,b) => a.name.localeCompare(b.name));
      return renderCategory(items, 'albums', 'album');
    }
    // Genres
    if (activeTab === 3) {
      const items: CatItem[] = [...new Set(tracks.map(t=>t.genre).filter(Boolean))].sort()
        .map(g => ({name:g, id:'genre:'+g, sub:tracks.filter(t=>t.genre===g).length+' pistes', filter:(t:Track)=>t.genre===g}));
      return renderCategory(items, 'genres', 'music-circle-outline');
    }
    // Dossiers
    if (activeTab === 4) {
      const folders = [...new Set(tracks.map(t => t.filePath?.split('/').slice(0,-1).join('/') ?? '').filter(Boolean))];
      const items: CatItem[] = folders.map(f => ({name: f.split('/').pop() ?? f, id:'folder:'+f, sub: tracks.filter(t=>t.filePath?.startsWith(f)).length + ' pistes', filter:(t:Track)=>!!t.filePath?.startsWith(f)}));
      return renderCategory(items, 'dossiers', 'folder-outline');
    }
    // Années
    if (activeTab === 5) {
      const items: CatItem[] = [...new Set(tracks.map(t=>t.year).filter(Boolean))].sort((a,b)=>Number(b)-Number(a))
        .map(y => ({name:y, id:'year:'+y, sub:tracks.filter(t=>t.year===y).length+' pistes', filter:(t:Track)=>t.year===y}));
      return renderCategory(items, 'annees', 'calendar-outline');
    }
    // Sampling — regroupement par qualité audio (taux d'échantillonnage / DSD)
    if (activeTab === 6) {
      const groups = new Map<string, {label: string; rate: number; count: number}>();
      tracks.forEach(t => {
        const g = qualityGroup(t);
        const ex = groups.get(g.key);
        if (ex) ex.count++;
        else groups.set(g.key, {label: g.label, rate: g.rate, count: 1});
      });
      const items: CatItem[] = [...groups.entries()]
        .sort((a, b) => a[1].rate - b[1].rate)
        .map(([key, g]) => ({name: g.label, id:'q:'+key, sub: g.count + ' pistes', filter:(t:Track)=>qualityGroup(t).key===key}));
      if (items.length === 0) return <EmptyState msg="Qualité audio" sub="Aucune info de taux d'échantillonnage"/>;
      return renderCategory(items, 'qualites', 'sine-wave');
    }
    // Format
    if (activeTab === 7) {
      const items: CatItem[] = [...new Set(tracks.map(t=>t.format).filter(Boolean))].sort()
        .map(f => ({name:f, id:'fmt:'+f, sub:tracks.filter(t=>t.format===f).length+' pistes', filter:(t:Track)=>t.format===f}));
      return renderCategory(items, 'formats', 'file-music-outline');
    }
    return null;
  };

  return (
    <View style={S.page}>
      <View style={S.header}>
        <Text style={S.headerTitle}>{LIB_TABS[activeTab].label}</Text>
        <View style={S.headerRight}>
          <TouchableOpacity style={S.headerBtn}><MaterialCommunityIcons name="sort-ascending" size={20} color={c.textDim}/></TouchableOpacity>
          <TouchableOpacity style={S.headerBtn}><MaterialCommunityIcons name="magnify"        size={20} color={c.textDim}/></TouchableOpacity>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={S.tabsScroll}>
        <View style={S.tabs}>
          {LIB_TABS.map((t,i) => (
            <TouchableOpacity key={i} style={S.tab} onPress={() => selectTab(i)}>
              <MaterialCommunityIcons name={t.icon as any} size={18} color={activeTab===i?c.icon:c.iconDim}/>
              {activeTab===i && <View style={S.tabLine}/>}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={S.content}>{renderContent()}</View>
    </View>
  );
};

// ─── Playlists ────────────────────────────────────────────────────────────────
// Modale centrée pour saisir/éditer un nom (Alert.prompt est iOS-only).
const NameModal = ({visible, title, initial, onSubmit, onClose}: {
  visible: boolean; title: string; initial?: string;
  onSubmit: (name: string) => void; onClose: () => void;
}) => {
  const {setS} = useStyles();
  const c = useColors();
  const [name, setName] = useState(initial ?? '');
  useEffect(() => { if (visible) setName(initial ?? ''); }, [visible, initial]);
  const submit = () => { const n = name.trim(); if (n) onSubmit(n); onClose(); };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={setS.centerBackdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={setS.dialog} activeOpacity={1}>
          <Text style={setS.dialogTitle}>{title}</Text>
          <TextInput
            style={setS.input}
            value={name}
            onChangeText={setName}
            placeholder="Nom de la playlist"
            placeholderTextColor={c.iconDim}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          <View style={setS.dialogActions}>
            <TouchableOpacity style={setS.dialogBtn} onPress={onClose}>
              <Text style={setS.dialogBtnText}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity style={setS.dialogBtn} onPress={submit}>
              <Text style={setS.dialogBtnPrimary}>OK</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

// Bottom sheet « Ajouter à une playlist » (depuis le lecteur).
const AddToPlaylistSheet = ({trackId, visible, onClose}: {trackId: string | null; visible: boolean; onClose: () => void}) => {
  const {setS} = useStyles();
  const c = useColors();
  const playlists = usePlaylists();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const createAndAdd = () => {
    const n = name.trim();
    if (!n) return;
    const pl = createPlaylist(n);
    if (trackId) toggleTrack(pl.id, trackId);
    setName(''); setNaming(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={setS.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={setS.sheet} activeOpacity={1}>
          <Text style={setS.sheetTitle}>Ajouter à une playlist</Text>
          <ScrollView style={setS.sheetList}>
            {playlists.length === 0 && (
              <Text style={setS.emptyHint}>Aucune playlist pour l'instant.</Text>
            )}
            {playlists.map(pl => {
              const inIt = trackId ? pl.trackIds.includes(trackId) : false;
              return (
                <TouchableOpacity key={pl.id} style={setS.option}
                  onPress={() => { if (trackId) toggleTrack(pl.id, trackId); }}>
                  <View style={setS.optionMeta}>
                    <Text style={setS.optionText}>{pl.name}</Text>
                    <Text style={setS.optionSub}>{pl.trackIds.length} morceaux</Text>
                  </View>
                  <MaterialCommunityIcons
                    name={inIt ? 'check-circle' : 'plus-circle-outline'}
                    size={22} color={inIt ? c.accent : c.iconDim}/>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {naming ? (
            <View style={setS.newRow}>
              <TextInput
                style={setS.inputInline}
                value={name}
                onChangeText={setName}
                placeholder="Nom de la playlist"
                placeholderTextColor={c.iconDim}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={createAndAdd}/>
              <TouchableOpacity onPress={createAndAdd}>
                <Text style={setS.dialogBtnPrimary}>Créer</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={setS.newRow} onPress={() => setNaming(true)}>
              <MaterialCommunityIcons name="playlist-plus" size={22} color={c.accent}/>
              <Text style={[setS.optionText, setS.newText]}>Nouvelle playlist</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

// Onglet Playlists : liste des playlists + vue détail d'une playlist.
const PlaylistsTab = ({tracks, onTrackPress}: {tracks: Track[]; onTrackPress: (t: Track) => void}) => {
  const {S} = useStyles();
  const c = useColors();
  const playlists = usePlaylists();
  const [openId, setOpenId] = useState<string | null>(null);
  const [naming, setNaming] = useState<{mode: 'create'} | {mode: 'rename'; id: string; current: string} | null>(null);

  const opened = playlists.find(p => p.id === openId) ?? null;

  const confirmDelete = (pl: Playlist) =>
    Alert.alert('Supprimer la playlist', `Supprimer « ${pl.name} » ?`, [
      {text: 'Annuler', style: 'cancel'},
      {text: 'Supprimer', style: 'destructive', onPress: () => deletePlaylist(pl.id)},
    ]);

  // Vue détail d'une playlist
  if (opened) {
    const items = opened.trackIds
      .map(id => tracks.find(t => t.id === id))
      .filter(Boolean) as Track[];
    return (
      <View style={S.content}>
        <View style={S.plDetailHeader}>
          <TouchableOpacity onPress={() => setOpenId(null)} style={S.headerBtn}>
            <MaterialCommunityIcons name="chevron-left" size={26} color={c.text}/>
          </TouchableOpacity>
          <Text style={S.plDetailTitle} numberOfLines={1}>{opened.name}</Text>
          <TouchableOpacity onPress={() => setNaming({mode: 'rename', id: opened.id, current: opened.name})} style={S.headerBtn}>
            <MaterialCommunityIcons name="pencil-outline" size={20} color={c.textDim}/>
          </TouchableOpacity>
        </View>
        {items.length === 0
          ? <EmptyState msg="Playlist vide" sub="Ajoute des morceaux depuis le lecteur (bouton +)"/>
          : <FlatList
              data={items}
              keyExtractor={i => i.id}
              renderItem={({item}) => (
                <TrackRow track={item} onPress={() => onTrackPress(item)}
                  onDots={() => removeTrack(opened.id, item.id)} dotsIcon="minus-circle-outline"/>
              )}/>
        }
        <NameModal
          visible={naming?.mode === 'rename'}
          title="Renommer la playlist"
          initial={naming?.mode === 'rename' ? naming.current : ''}
          onClose={() => setNaming(null)}
          onSubmit={n => { if (naming?.mode === 'rename') renamePlaylist(naming.id, n); }}/>
      </View>
    );
  }

  // Liste des playlists
  return (
    <View style={S.content}>
      <TouchableOpacity style={S.plNewBtn} onPress={() => setNaming({mode: 'create'})}>
        <MaterialCommunityIcons name="playlist-plus" size={22} color={c.accent}/>
        <Text style={S.plNewText}>Nouvelle playlist</Text>
      </TouchableOpacity>
      {playlists.length === 0
        ? <EmptyState msg="Aucune playlist" sub="Crée ta première playlist ci-dessus"/>
        : <FlatList
            data={playlists}
            keyExtractor={i => i.id}
            renderItem={({item}) => (
              <TouchableOpacity style={S.plRow} activeOpacity={0.7} onPress={() => setOpenId(item.id)}>
                <View style={S.plIcon}><MaterialCommunityIcons name="playlist-music" size={22} color={c.icon}/></View>
                <View style={S.rowMeta}>
                  <Text style={S.rowTitle} numberOfLines={1}>{item.name}</Text>
                  <Text style={S.rowSub}>{item.trackIds.length} morceaux</Text>
                </View>
                <TouchableOpacity style={S.rowDots} onPress={() => confirmDelete(item)}>
                  <MaterialCommunityIcons name="trash-can-outline" size={18} color={c.iconDim}/>
                </TouchableOpacity>
              </TouchableOpacity>
            )}/>
      }
      <NameModal
        visible={naming?.mode === 'create'}
        title="Nouvelle playlist"
        onClose={() => setNaming(null)}
        onSubmit={n => createPlaylist(n)}/>
    </View>
  );
};

// ─── Favorites Page ───────────────────────────────────────────────────────────
const FavoritesPage = ({tracks, onTrackPress}: {tracks: Track[]; onTrackPress: (t: Track) => void}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [view, setView] = useState<ViewMode>('list');
  const {S} = useStyles();
  const c = useColors();
  const favorites = useFavorites();

  const renderContent = () => {
    if (activeTab === 1) return <PlaylistsTab tracks={tracks} onTrackPress={onTrackPress}/>;

    // Onglet Favoris : on filtre la bibliothèque sur les ids favoris (ordre de favori).
    if (activeTab === 0) {
      const favTracks = favorites
        .map(id => tracks.find(t => t.id === id))
        .filter(Boolean) as Track[];
      if (favTracks.length === 0) {
        return <EmptyState msg="Aucun favori" sub="Touche le ♥ dans le lecteur pour ajouter un morceau"/>;
      }
      return (
        <>
          <Toolbar count={favTracks.length} label="pistes" view={view} onView={setView}/>
          {view === 'grid'
            ? <TrackGrid tracks={favTracks} onPress={onTrackPress}/>
            : <FlatList data={favTracks} keyExtractor={i=>i.id}
                renderItem={({item}) => (
                  <TrackRow track={item} onPress={() => onTrackPress(item)}
                    onDots={() => toggleFavorite(item.id)} dotsIcon="heart" dotsColor="#ff4d6d"/>
                )}/>
          }
        </>
      );
    }

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
          <TouchableOpacity style={S.headerBtn}><MaterialCommunityIcons name="sort-ascending" size={20} color={c.textDim}/></TouchableOpacity>
          <TouchableOpacity style={S.headerBtn}><MaterialCommunityIcons name="dots-vertical"  size={20} color={c.textDim}/></TouchableOpacity>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={S.tabsScroll}>
        <View style={S.tabs}>
          {FAV_TABS.map((t,i) => (
            <TouchableOpacity key={i} style={[S.tab, {width:58}]} onPress={() => setActiveTab(i)}>
              <MaterialCommunityIcons
                name={(activeTab===i ? t.iconActive : t.icon) as any}
                size={18}
                color={activeTab===i?c.icon:c.iconDim}
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
const THEME_OPTS   = ['Sombre', 'Clair', 'Automatique'];
const EQ_OPTS      = ['Aucun', 'Rock', 'Pop', 'Jazz', 'Électronique', 'Classique', 'Personnalisé'];
const QUALITY_OPTS = ['Haute fidélité', 'Standard', 'Économie de données'];

type SettingsProps = {
  theme: string;        setTheme: (v: string) => void;
  eq: string;           setEq: (v: string) => void;
  quality: string;      setQuality: (v: string) => void;
  onScan: () => void;   scanState: 'idle'|'scanning'|'done'|'denied';
};

type PickerState = {title: string; options: string[]; current: string; onSelect: (v: string) => void} | null;

const SettingsPage = ({theme, setTheme, eq, setEq, quality, setQuality, onScan, scanState}: SettingsProps) => {
  const [picker, setPicker] = useState<PickerState>(null);
  const {S, setS} = useStyles();
  const c = useColors();

  const open = (title: string, options: string[], current: string, onSelect: (v: string) => void) =>
    setPicker({title, options, current, onSelect});

  const rows: {label: string; value: string; onPress: () => void}[] = [
    {label:'Thème',                  value: theme,   onPress: () => open('Thème', THEME_OPTS, theme, setTheme)},
    {label:'Égaliseur par défaut',   value: eq,      onPress: () => open('Égaliseur par défaut', EQ_OPTS, eq, setEq)},
    {label:'Qualité audio',          value: quality, onPress: () => open('Qualité audio', QUALITY_OPTS, quality, setQuality)},
    {label:'Scanner la bibliothèque', value: scanState === 'scanning' ? '…' : '↻', onPress: onScan},
    {label:'Dossiers surveillés',    value:'›', onPress: () => Alert.alert('Dossiers surveillés', 'Fonctionnalité à venir.')},
    {label:'À propos',               value:'›', onPress: () => Alert.alert('EQPlayer', 'Version 0.1.0\nLecteur de musique audiophile.\nDéveloppé avec amour.')},
  ];

  return (
    <View style={S.page}>
      <View style={S.header}>
        <Text style={S.headerTitle}>Paramètres</Text>
      </View>
      <ScrollView>
        {rows.map((item, i) => (
          <TouchableOpacity key={i} style={S.settingRow} onPress={item.onPress}>
            <Text style={S.settingLabel}>{item.label}</Text>
            <Text style={S.settingValue}>{item.value}</Text>
          </TouchableOpacity>
        ))}
        <Text style={S.version}>EQPlayer v0.1.0</Text>
        <Text style={S.versionSub}>Développé avec amour</Text>
      </ScrollView>

      <Modal visible={!!picker} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
        <TouchableOpacity style={setS.backdrop} activeOpacity={1} onPress={() => setPicker(null)}>
          <View style={setS.sheet}>
            <Text style={setS.sheetTitle}>{picker?.title}</Text>
            {picker?.options.map(opt => (
              <TouchableOpacity
                key={opt}
                style={setS.option}
                onPress={() => { picker.onSelect(opt); setPicker(null); }}>
                <Text style={[setS.optionText, opt === picker.current && setS.optionTextActive]}>{opt}</Text>
                {opt === picker.current && <MaterialCommunityIcons name="check" size={18} color={c.accent}/>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const makeSetS = (c: Colors) => StyleSheet.create({
  backdrop:   {flex:1, backgroundColor:'#000000aa', justifyContent:'flex-end'},
  sheet:      {backgroundColor:c.surface, borderTopLeftRadius:16, borderTopRightRadius:16, paddingVertical:8, paddingBottom:24},
  sheetTitle: {color:c.textDim, fontSize:13, fontWeight:'600', paddingHorizontal:20, paddingTop:12, paddingBottom:8, textTransform:'uppercase', letterSpacing:0.5},
  option:     {flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingVertical:16, paddingHorizontal:20},
  optionText: {color:c.text, fontSize:16},
  optionTextActive: {color:c.accent, fontWeight:'600'},

  // Playlists — sheet « Ajouter à une playlist »
  sheetList:  {maxHeight:320},
  optionMeta: {flex:1},
  optionSub:  {color:c.iconDim, fontSize:12, marginTop:2},
  emptyHint:  {color:c.iconDim, fontSize:14, textAlign:'center', paddingVertical:20},
  newRow:     {flexDirection:'row', alignItems:'center', gap:12, paddingVertical:16, paddingHorizontal:20, borderTopWidth:0.5, borderTopColor:c.border},
  newText:    {color:c.accent},
  inputInline:{flex:1, color:c.text, fontSize:16, paddingVertical:4},

  // Playlists — modale centrée de nommage
  centerBackdrop: {flex:1, backgroundColor:'#000000aa', justifyContent:'center', alignItems:'center', padding:32},
  dialog:         {width:'100%', backgroundColor:c.surface, borderRadius:14, padding:18},
  dialogTitle:    {color:c.text, fontSize:16, fontWeight:'600', marginBottom:14},
  input:          {color:c.text, fontSize:16, borderBottomWidth:1, borderBottomColor:c.border, paddingVertical:8},
  dialogActions:  {flexDirection:'row', justifyContent:'flex-end', gap:8, marginTop:18},
  dialogBtn:      {paddingVertical:8, paddingHorizontal:16},
  dialogBtnText:  {color:c.textDim, fontSize:15},
  dialogBtnPrimary: {color:c.accent, fontSize:15, fontWeight:'600'},
});

// ─── Mini Player ──────────────────────────────────────────────────────────────
const MiniPlayer = ({track, onPress}: {track: Track|null; onPress: () => void}) => {
  const {isPlaying, isLoading, togglePlay, skipNext} = usePlayer();
  const activeTrack = useActiveTrack();
  const {S} = useStyles();
  const c = useColors();

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
          ? <ActivityIndicator color={c.icon} size="small"/>
          : <MaterialCommunityIcons name={isPlaying?'pause':'play'} size={22} color={c.icon}/>
        }
      </TouchableOpacity>
      <TouchableOpacity style={S.miniBtn} onPress={e => {e.stopPropagation(); skipNext();}}>
        <MaterialCommunityIcons name="skip-next" size={22} color={c.icon}/>
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

// ─── Menu 3-points d'une piste ────────────────────────────────────────────────
const TrackInfoModal = ({track, onClose}: {track: any | null; onClose: () => void}) => {
  const {setS} = useStyles();
  if (!track) return null;
  const quality = track.sampleRate
    ? `${track.sampleRate / 1000} kHz${track.bitDepth ? ` / ${track.bitDepth} bits` : ''}`
    : '—';
  const rows: [string, string][] = [
    ['Titre', track.title],
    ['Artiste', track.artist],
    ['Album', track.album],
    ['Genre', track.genre || '—'],
    ['Année', track.year || '—'],
    ['Format', track.format || '—'],
    ['Qualité', quality],
    ['Durée', track.duration ? fmtTime(track.duration / 1000) : '—'],
    ['Fichier', track.filePath || '—'],
  ];
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={setS.centerBackdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={setS.dialog} activeOpacity={1}>
          <Text style={setS.dialogTitle}>Infos de la piste</Text>
          {rows.map(([k, v]) => (
            <View key={k} style={tmS.infoRow}>
              <Text style={tmS.infoKey}>{k}</Text>
              <Text style={tmS.infoVal} numberOfLines={2}>{String(v)}</Text>
            </View>
          ))}
          <View style={setS.dialogActions}>
            <TouchableOpacity style={setS.dialogBtn} onPress={onClose}>
              <Text style={setS.dialogBtnPrimary}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const SLEEP_OPTS = [
  {label: 'Désactivée', min: 0},
  {label: '15 minutes', min: 15},
  {label: '30 minutes', min: 30},
  {label: '45 minutes', min: 45},
  {label: '1 heure', min: 60},
];
const SleepTimerModal = ({visible, current, onSelect, onClose}: {
  visible: boolean; current: number; onSelect: (min: number) => void; onClose: () => void;
}) => {
  const {setS} = useStyles();
  const c = useColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={setS.backdrop} activeOpacity={1} onPress={onClose}>
        <View style={setS.sheet}>
          <Text style={setS.sheetTitle}>Minuterie de veille</Text>
          {SLEEP_OPTS.map(o => (
            <TouchableOpacity key={o.min} style={setS.option} onPress={() => { onSelect(o.min); onClose(); }}>
              <Text style={[setS.optionText, o.min === current && setS.optionTextActive]}>{o.label}</Text>
              {o.min === current && <MaterialCommunityIcons name="check" size={18} color={c.accent}/>}
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

type TrackMenuHandlers = {
  onClose: () => void;
  onPlay: () => void; onPlayNext: () => void; onToggleFav: () => void; onAddPlaylist: () => void;
  onOpenEq: () => void; onInfo: () => void; onGoAlbum: () => void; onGoArtist: () => void;
  onSleep: () => void; onTheme: () => void; onDelete: () => void;
};
const TrackMenuSheet = ({track, isFav, h}: {track: any | null; isFav: boolean; h: TrackMenuHandlers}) => {
  const {setS} = useStyles();
  const c = useColors();
  if (!track) return null;
  const run = (fn: () => void) => { h.onClose(); fn(); };
  const quick = [
    {icon: 'play', label: 'Lire', color: c.text, onPress: h.onPlay},
    {icon: isFav ? 'heart' : 'heart-outline', label: 'Favori', color: isFav ? '#ff4d6d' : c.text, onPress: h.onToggleFav},
    {icon: 'playlist-plus', label: 'Playlist', color: c.text, onPress: h.onAddPlaylist},
    {icon: 'tune-vertical', label: 'Égaliseur', color: c.text, onPress: h.onOpenEq},
  ];
  const items = [
    {icon: 'playlist-play', label: 'Lire ensuite', onPress: h.onPlayNext},
    {icon: 'information-outline', label: 'Infos de la piste', onPress: h.onInfo},
    {icon: 'album', label: "Aller à l'album", onPress: h.onGoAlbum},
    {icon: 'account', label: "Aller à l'artiste", onPress: h.onGoArtist},
    {icon: 'timer-outline', label: 'Minuterie de veille', onPress: h.onSleep},
    {icon: 'palette-outline', label: 'Thème', onPress: h.onTheme},
    {icon: 'trash-can-outline', label: 'Supprimer la piste', onPress: h.onDelete, danger: true},
  ];
  return (
    <Modal visible transparent animationType="slide" onRequestClose={h.onClose}>
      <TouchableOpacity style={setS.backdrop} activeOpacity={1} onPress={h.onClose}>
        <TouchableOpacity style={setS.sheet} activeOpacity={1}>
          <View style={tmS.head}>
            {track.artUri ? (
              <Image source={{uri: track.artUri}} style={tmS.headCover} resizeMode="cover"/>
            ) : (
              <View style={[tmS.headCover, {backgroundColor: coverBg(track.genre)}]}>
                <MaterialCommunityIcons name="music" size={20} color="#ffffff44"/>
              </View>
            )}
            <View style={tmS.headMeta}>
              <Text style={tmS.headTitle} numberOfLines={1}>{track.title}</Text>
              <Text style={tmS.headSub} numberOfLines={1}>{track.artist}</Text>
            </View>
          </View>
          <View style={tmS.quickRow}>
            {quick.map((q, i) => (
              <TouchableOpacity key={i} style={tmS.quick} onPress={() => run(q.onPress)}>
                <View style={tmS.quickIcon}><MaterialCommunityIcons name={q.icon as any} size={22} color={q.color}/></View>
                <Text style={tmS.quickLabel}>{q.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={tmS.sep}/>
          {items.map((it, i) => (
            <TouchableOpacity key={i} style={tmS.row} onPress={() => run(it.onPress)}>
              <MaterialCommunityIcons name={it.icon as any} size={20} color={it.danger ? '#ff4d6d' : c.textDim}/>
              <Text style={[tmS.rowLabel, it.danger ? {color: '#ff4d6d'} : {color: c.text}]}>{it.label}</Text>
            </TouchableOpacity>
          ))}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const tmS = StyleSheet.create({
  head:      {flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12},
  headCover: {width: 44, height: 44, borderRadius: 6, alignItems: 'center', justifyContent: 'center'},
  headMeta:  {flex: 1},
  headTitle: {color: '#fff', fontSize: 15, fontWeight: '600'},
  headSub:   {color: '#ffffff88', fontSize: 12, marginTop: 2},
  quickRow:  {flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 8},
  quick:     {flex: 1, alignItems: 'center', paddingVertical: 8},
  quickIcon: {width: 48, height: 48, borderRadius: 24, backgroundColor: '#ffffff14', alignItems: 'center', justifyContent: 'center', marginBottom: 6},
  quickLabel:{color: '#ffffffcc', fontSize: 11},
  sep:       {height: 0.5, backgroundColor: '#ffffff1a', marginVertical: 4, marginHorizontal: 16},
  row:       {flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14, paddingHorizontal: 20},
  rowLabel:  {fontSize: 15},
  infoRow:   {flexDirection: 'row', paddingVertical: 5},
  infoKey:   {width: 78, color: '#ffffff77', fontSize: 13},
  infoVal:   {flex: 1, color: '#fff', fontSize: 13},
});

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
  const [eqOpen,       setEqOpen]       = useState(false);
  // Menu 3-points : modales et navigation
  const menuTrack = useTrackMenu();
  const favoritesIds = useFavorites();
  const [infoTrack,    setInfoTrack]    = useState<Track | null>(null);
  const [sleepOpen,    setSleepOpen]    = useState(false);
  const [sleepMin,     setSleepMin]     = useState(0);
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [addPlTrackId, setAddPlTrackId] = useState<string | null>(null);
  const [libNav,       setLibNav]       = useState<{type: 'album' | 'artist'; value: string} | null>(null);
  const [tracks,       setTracks]       = useState<Track[]>(DEMO_TRACKS);
  const [scanState,    setScanState]    = useState<'idle'|'scanning'|'done'|'denied'>('idle');
  const [scanCount,    setScanCount]    = useState(0);
  // Préférences (persistées sur disque via AsyncStorage)
  const [theme,   setTheme]   = useState('Sombre');
  const [eq,      setEq]      = useState('Aucun');
  const [quality, setQuality] = useState('Haute fidélité');
  // Égaliseur paramétrique (DynamicsProcessing) : fréquences + gains éditables
  const [peqRange, setPeqRange] = useState<{minDb: number; maxDb: number} | null>(null);
  const [eqBands,  setEqBands]  = useState<PeqBand[]>([]);

  // setter qui met à jour l'état ET enregistre sur disque
  const persist = useCallback(
    (key: string, setter: (v: string) => void) => (v: string) => {
      setter(v);
      AsyncStorage.setItem(key, v).catch(() => {});
    },
    [],
  );
  const setThemePref   = useCallback(persist('pref.theme', setTheme),     [persist]);
  const setEqPref      = useCallback(persist('pref.eq', setEq),           [persist]);
  const setQualityPref = useCallback(persist('pref.quality', setQuality), [persist]);

  // Init TrackPlayer une seule fois au démarrage
  useEffect(() => { setupPlayer().catch(console.warn); }, []);

  // Charge les préférences + initialise l'égaliseur au démarrage
  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getMany([
        'pref.theme', 'pref.eq', 'pref.quality', 'pref.peqBands',
      ]);
      if (stored['pref.theme'])   setTheme(stored['pref.theme']!);
      if (stored['pref.eq'])      setEq(stored['pref.eq']!);
      if (stored['pref.quality']) setQuality(stored['pref.quality']!);

      const info = await peqGetInfo();
      if (!info) return;             // EQ paramétrique indisponible
      setPeqRange({minDb: info.minDb, maxDb: info.maxDb});

      // Bandes : config persistée, sinon préréglage appliqué sur les fréquences par défaut.
      let bands: PeqBand[] = info.bands.map(b => ({freq: b.freq, gain: b.gain}));
      const savedEq = stored['pref.eq'] ?? 'Aucun';
      if (stored['pref.peqBands']) {
        try {
          const parsed = JSON.parse(stored['pref.peqBands']) as PeqBand[];
          if (parsed.length) bands = parsed;
        } catch { /* config illisible → défaut */ }
      } else if (savedEq !== 'Aucun' && savedEq !== 'Personnalisé') {
        const gains = presetGainsFor(savedEq, bands.map(b => b.freq));
        bands = bands.map((b, i) => ({freq: b.freq, gain: gains[i]}));
      }
      peqConfigure(bands);
      peqSetEnabled(true);
      setEqBands(bands);
    })().catch(() => {});
  }, []);

  const persistBands = (bands: PeqBand[]) =>
    AsyncStorage.setItem('pref.peqBands', JSON.stringify(bands)).catch(() => {});

  // Sélection d'un préréglage depuis les Paramètres (applique les gains aux freqs courantes)
  const applyEqPreset = useCallback((name: string) => {
    setEqPref(name);
    if (name === 'Personnalisé') return;
    setEqBands(prev => {
      const gains = presetGainsFor(name, prev.map(b => b.freq));
      const bands = prev.map((b, i) => ({freq: b.freq, gain: gains[i]}));
      peqConfigure(bands);
      persistBands(bands);
      return bands;
    });
  }, [setEqPref]);

  // Gain en temps réel pendant le glissement (audio uniquement, pas de state)
  const onGainLive = useCallback((i: number, db: number) => { peqSetGain(i, db); }, []);

  // Gain validé au relâcher → state + persistance + passe en « Personnalisé »
  const onGainCommit = useCallback((i: number, db: number) => {
    setEqBands(prev => {
      const next = prev.map((b, idx) => (idx === i ? {...b, gain: db} : b));
      persistBands(next);
      return next;
    });
    setEqPref('Personnalisé');
  }, [setEqPref]);

  // Édition d'une fréquence → reconfigure (le natif exige l'ordre croissant)
  const onSetFreq = useCallback((i: number, hz: number) => {
    setEqBands(prev => {
      const next = prev.map((b, idx) => (idx === i ? {...b, freq: hz} : b)).sort((a, b) => a.freq - b.freq);
      peqConfigure(next);
      persistBands(next);
      return next;
    });
    setEqPref('Personnalisé');
  }, [setEqPref]);

  // Ajoute une bande au plus grand écart (en log-fréquence), gain 0
  const onAddBand = useCallback(() => {
    setEqBands(prev => {
      if (prev.length >= EQ_MAX_BANDS) return prev;
      const sorted = [...prev].sort((a, b) => a.freq - b.freq);
      let freq = 1000;
      if (sorted.length >= 2) {
        let bestGap = 0;
        for (let k = 0; k < sorted.length - 1; k++) {
          const gap = Math.log(sorted[k + 1].freq) - Math.log(sorted[k].freq);
          if (gap > bestGap) {
            bestGap = gap;
            freq = Math.round(Math.exp((Math.log(sorted[k].freq) + Math.log(sorted[k + 1].freq)) / 2));
          }
        }
      }
      const next = [...sorted, {freq, gain: 0}].sort((a, b) => a.freq - b.freq);
      peqConfigure(next);
      persistBands(next);
      return next;
    });
    setEqPref('Personnalisé');
  }, [setEqPref]);

  // Remet toutes les bandes à plat (gain 0), garde les fréquences
  const onResetBands = useCallback(() => {
    setEqBands(prev => {
      const next = prev.map(b => ({...b, gain: 0}));
      peqConfigure(next);
      persistBands(next);
      return next;
    });
    setEqPref('Aucun');
  }, [setEqPref]);

  // Supprime une bande (garde au moins une)
  const onRemoveBand = useCallback((i: number) => {
    setEqBands(prev => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, idx) => idx !== i);
      peqConfigure(next);
      persistBands(next);
      return next;
    });
    setEqPref('Personnalisé');
  }, [setEqPref]);

  const scan = useCallback(async () => {
    setScanState('scanning');
    const granted = await requestMusicPermission();
    if (!granted) { setScanState('denied'); return; }
    try {
      const result: Track[] = await MusicLibrary.getTracks();
      setTracks(result);
      setScanCount(result.length);
      setScanState('done');
      // Cache la bibliothèque pour un démarrage instantané au prochain lancement.
      AsyncStorage.setItem('cache.tracks', JSON.stringify(result)).catch(() => {});
    } catch (e) {
      console.warn('Scan error:', e);
      setScanState('done');
    }
  }, []);

  // Au démarrage : on charge la dernière bibliothèque connue (instantané, sans
  // flash des démos) et on ne (re)scanne QUE si aucun cache. Le re-scan reste
  // accessible à la demande via les Paramètres (bouton « Scanner »).
  useEffect(() => {
    (async () => {
      try {
        const cached = await AsyncStorage.getItem('cache.tracks');
        if (cached) {
          const list = JSON.parse(cached) as Track[];
          if (list.length) {
            setTracks(list);
            setScanCount(list.length);
            setScanState('done');
            return;
          }
        }
      } catch {
        // cache illisible → on retombe sur un scan
      }
      scan();
    })();
  }, [scan]);

  const NAV = [
    {label:'Bibliothèque', icon:'disc'},
    {label:'Mes listes',   icon:'format-list-bulleted'},
    {label:'Paramètres',   icon:'account-circle-outline'},
  ];

  const {playTrack, addNext} = usePlayer();

  // Minuterie de veille : (re)programme une pause après N minutes (0 = off).
  const applySleep = useCallback((min: number) => {
    setSleepMin(min);
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    sleepTimerRef.current = null;
    if (min > 0) {
      sleepTimerRef.current = setTimeout(() => {
        TrackPlayer.pause().catch(() => {});
        setSleepMin(0);
      }, min * 60 * 1000);
    }
  }, []);

  // Bascule le thème (Sombre → Clair → Automatique → …)
  const cycleTheme = useCallback(() => {
    setTheme(prev => {
      const next = THEME_OPTS[(THEME_OPTS.indexOf(prev) + 1) % THEME_OPTS.length];
      AsyncStorage.setItem('pref.theme', next).catch(() => {});
      return next;
    });
  }, []);

  // Va à l'album / l'artiste de la piste (ferme le lecteur, ouvre la bibliothèque)
  const navToCategory = useCallback((type: 'album' | 'artist', value: string) => {
    setPlayerOpen(false);
    setEqOpen(false);
    setPage(0);
    setLibNav({type, value});
  }, []);

  // Supprime définitivement le fichier de la piste (avec confirmation système)
  const confirmDeleteTrack = useCallback((t: Track) => {
    Alert.alert('Supprimer la piste', `Supprimer définitivement « ${t.title} » ?`, [
      {text: 'Annuler', style: 'cancel'},
      {text: 'Supprimer', style: 'destructive', onPress: async () => {
        try {
          const ok = await (MusicLibrary as any).deleteTrack?.(t.id);
          if (ok) {
            setTracks(prev => {
              const next = prev.filter(x => x.id !== t.id);
              AsyncStorage.setItem('cache.tracks', JSON.stringify(next)).catch(() => {});
              return next;
            });
          }
        } catch (e) {
          Alert.alert('Suppression impossible', String((e as any)?.message ?? e));
        }
      }},
    ]);
  }, []);

  // Palette active selon la préférence de thème
  const scheme = useColorScheme();
  const colors = theme === 'Clair'        ? LIGHT
               : theme === 'Automatique'  ? (scheme === 'light' ? LIGHT : DARK)
               : DARK;
  const {S} = stylesFor(colors);

  const openTrack = useCallback(async (t: Track, queue?: Track[]) => {
    setCurrentTrack(t);
    setPlayerOpen(true);
    // File = la liste fournie (catégorie/playlist) ou toute la bibliothèque.
    await playTrack(t, queue ?? tracks);
  }, [tracks, playTrack]);

  return (
    <ThemeCtx.Provider value={colors}>
    <SafeAreaView style={S.root} edges={['bottom']}>
      <StatusBar barStyle={colors.barStyle} backgroundColor={colors.statusBg}/>

      {/* Bannière de scan en haut */}
      {scanState === 'scanning' && (
        <View style={S.scanBanner}>
          <ActivityIndicator size="small" color={colors.accent} style={{marginRight:8}}/>
          <Text style={S.scanText}>Scan de la bibliothèque...</Text>
        </View>
      )}
      {scanState === 'done' && scanCount > 0 && (
        <View style={S.scanBanner}>
          <MaterialCommunityIcons name="check-circle" size={14} color="#4caf50" style={{marginRight:6}}/>
          <Text style={[S.scanText, {color:'#4caf50'}]}>{scanCount} pistes chargées</Text>
        </View>
      )}
      {scanState === 'denied' && (
        <TouchableOpacity style={S.scanBanner} onPress={scan}>
          <MaterialCommunityIcons name="alert-circle" size={14} color={colors.accent} style={{marginRight:6}}/>
          <Text style={[S.scanText, {color:colors.accent}]}>Permission refusée — appuyer pour réessayer</Text>
        </TouchableOpacity>
      )}

      {page === 0 && <LibraryPage tracks={tracks} onTrackPress={openTrack} navIntent={libNav} onNavConsumed={() => setLibNav(null)}/>}
      {page === 1 && <FavoritesPage tracks={tracks} onTrackPress={openTrack}/>}
      {page === 2 && (
        <SettingsPage
          theme={theme}     setTheme={setThemePref}
          eq={eq}           setEq={applyEqPreset}
          quality={quality} setQuality={setQualityPref}
          onScan={scan}     scanState={scanState}
        />
      )}
      <MiniPlayer track={currentTrack} onPress={() => setPlayerOpen(true)}/>
      <View style={S.navbar}>
        {NAV.map((item,i) => (
          <TouchableOpacity key={i} style={S.navItem} onPress={() => setPage(i)}>
            <MaterialCommunityIcons name={item.icon as any} size={24} color={page===i?colors.accent:colors.iconDim}/>
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
          eq={{range: peqRange, bands: eqBands, onGainLive, onGainCommit, onSetFreq, onAddBand, onRemoveBand, onReset: onResetBands}}
          onOpenEq={() => setEqOpen(true)}
        />
      )}
      <EqualizerScreen
        visible={eqOpen}
        onClose={() => setEqOpen(false)}
        eq={{range: peqRange, bands: eqBands, onGainLive, onGainCommit, onSetFreq, onAddBand, onRemoveBand, onReset: onResetBands}}
        bright={getPalette(currentTrack?.genre).bright}
      />

      {/* Menu 3-points d'une piste + ses modales */}
      <TrackMenuSheet
        track={menuTrack}
        isFav={menuTrack ? favoritesIds.includes(menuTrack.id) : false}
        h={{
          onClose: closeTrackMenu,
          onPlay:        () => menuTrack && openTrack(menuTrack, tracks),
          onPlayNext:    () => menuTrack && addNext(menuTrack),
          onToggleFav:   () => menuTrack && toggleFavorite(menuTrack.id),
          onAddPlaylist: () => menuTrack && setAddPlTrackId(menuTrack.id),
          onOpenEq:      () => setEqOpen(true),
          onInfo:        () => setInfoTrack(menuTrack),
          onGoAlbum:     () => menuTrack && navToCategory('album', menuTrack.album),
          onGoArtist:    () => menuTrack && navToCategory('artist', menuTrack.artist),
          onSleep:       () => setSleepOpen(true),
          onTheme:       cycleTheme,
          onDelete:      () => menuTrack && confirmDeleteTrack(menuTrack),
        }}
      />
      <TrackInfoModal track={infoTrack} onClose={() => setInfoTrack(null)}/>
      <SleepTimerModal visible={sleepOpen} current={sleepMin} onSelect={applySleep} onClose={() => setSleepOpen(false)}/>
      <AddToPlaylistSheet trackId={addPlTrackId} visible={!!addPlTrackId} onClose={() => setAddPlTrackId(null)}/>
    </SafeAreaView>
    </ThemeCtx.Provider>
  );
}

// ─── Styles globaux ───────────────────────────────────────────────────────────
const makeS = (c: Colors) => StyleSheet.create({
  root:    {flex:1, backgroundColor:c.bg},
  page:    {flex:1, backgroundColor:c.bg},
  content: {flex:1},

  header:       {flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:52, paddingBottom:10},
  headerTitle:  {fontSize:22, fontWeight:'600', color:c.text},
  headerRight:  {flexDirection:'row', gap:4},
  headerBtn:    {paddingHorizontal:8, height:36, alignItems:'center', justifyContent:'center'},
  headerBtnText:{color:c.textDim, fontSize:13},

  tabsScroll:{flexGrow:0, borderBottomWidth:0.5, borderBottomColor:c.border},
  tabs:      {flexDirection:'row'},

  // Playlists
  plNewBtn:    {flexDirection:'row', alignItems:'center', gap:10, paddingVertical:14, paddingHorizontal:16, borderBottomWidth:0.5, borderBottomColor:c.border},
  plNewText:   {color:c.accent, fontSize:15, fontWeight:'600'},
  plRow:       {flexDirection:'row', alignItems:'center', gap:12, paddingVertical:12, paddingHorizontal:16},
  plIcon:      {width:44, height:44, borderRadius:8, backgroundColor:c.surface, alignItems:'center', justifyContent:'center'},
  plDetailHeader: {flexDirection:'row', alignItems:'center', gap:4, paddingHorizontal:8, paddingVertical:8},
  plDetailTitle:  {flex:1, color:c.text, fontSize:18, fontWeight:'600'},
  tab:       {width:46, alignItems:'center', paddingVertical:12, position:'relative'},
  tabLine:   {position:'absolute', bottom:0, left:'15%', right:'15%', height:2, backgroundColor:c.text, borderRadius:1},

  toolbar:      {flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingVertical:8, borderBottomWidth:0.5, borderBottomColor:c.border},
  playAll:      {flexDirection:'row', alignItems:'center'},
  playAllText:  {color:c.textDim, fontSize:13},
  toolbarRight: {flexDirection:'row', alignItems:'center', gap:2},
  tbBtn:        {width:32, height:32, alignItems:'center', justifyContent:'center', borderRadius:6},
  tbBtnAct:     {backgroundColor:c.surface2},
  tbDivider:    {width:0.5, height:16, backgroundColor:c.border, marginHorizontal:4},

  row:       {flexDirection:'row', alignItems:'center', gap:10, paddingHorizontal:16, paddingVertical:10, borderBottomWidth:0.5, borderBottomColor:c.border},
  rowCover:  {width:46, height:46, borderRadius:6, alignItems:'center', justifyContent:'center'},
  rowMeta:   {flex:1, minWidth:0},
  rowTitle:  {fontSize:13, fontWeight:'500', color:c.text},
  rowSub:    {fontSize:11, color:c.textFaint, marginTop:2},
  rowFormat: {fontSize:10, color:c.textFaint},
  rowDots:   {padding:8},

  empty:      {flex:1, alignItems:'center', justifyContent:'center', paddingTop:80, gap:8},
  emptyTitle: {fontSize:16, fontWeight:'500', color:c.textFaint},
  emptySub:   {fontSize:12, color:c.textGhost, textAlign:'center', paddingHorizontal:32},

  settingRow:   {flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:20, paddingVertical:16, borderBottomWidth:0.5, borderBottomColor:c.border},
  settingLabel: {fontSize:15, color:c.text},
  settingValue: {fontSize:13, color:c.textFaint},
  version:      {textAlign:'center', fontSize:13, color:c.textGhost, marginTop:32},
  versionSub:   {textAlign:'center', fontSize:12, color:c.textGhost, marginTop:4},

  mini:       {flexDirection:'row', alignItems:'center', gap:10, backgroundColor:c.surface, paddingHorizontal:16, paddingVertical:10, borderTopWidth:0.5, borderTopColor:c.border},
  miniCover:  {width:38, height:38, borderRadius:6, alignItems:'center', justifyContent:'center'},
  miniInfo:   {flex:1},
  miniTitle:  {fontSize:13, fontWeight:'500', color:c.text},
  miniArtist: {fontSize:11, color:c.textFaint, marginTop:1},
  miniBtn:    {padding:8},

  navbar:  {flexDirection:'row', backgroundColor:c.bg, borderTopWidth:0.5, borderTopColor:c.border, paddingBottom:4},
  navItem: {flex:1, alignItems:'center', paddingTop:10, gap:4},
  navDot:  {width:4, height:4, borderRadius:2, backgroundColor:c.accent},

  scanBanner: {flexDirection:'row', alignItems:'center', backgroundColor:c.scanBg, paddingHorizontal:16, paddingVertical:7, borderBottomWidth:0.5, borderBottomColor:c.border},
  scanText:   {fontSize:12, color:c.textDim},
});
