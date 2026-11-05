import {
  TUNINGS,
  NOTE_CHOICES,
  centsBetween,
  detectPitchYin,
  frequencyForMidi,
  midiForNote,
  noteForFrequency,
} from './tuner.js';
import { cleanProject } from './project-data.js';

const DB_NAME = 'pulso_sampler_v1';
const STORE_NAME = 'projects';
const CUSTOM_TUNINGS_KEY = 'sampler.custom-tunings.v1';
const TUNER_PREFS_KEY = 'sampler.tuner-preferences.v1';
const FAVORITE_TUNINGS_KEY = 'frumos.favorite-tunings.v1';
const $ = (id) => document.getElementById(id);
const makeId = () => Math.random().toString(36).slice(2, 10);

let db;
let projects = [];
let currentId = '';
let selectedSongId = '';
let activeView = 'repertoire';
let selectedString = null;
let customTunings = readCustomTunings();
let favoriteTuningIds = readFavoriteTunings();
let tunerPreferences = readTunerPreferences();
let activeTuningId = tunerPreferences.activeTuningId || 'chromatic';
let tolerance = tunerPreferences.tolerance || 5;
let metroTimer = null;
let metroBeat = 0;
let tapTimes = [];
let outputContext = null;
let referenceOscillator = null;
let referenceGain = null;
let referenceStopTimer = null;
let tunerContext = null;
let tunerStream = null;
let tunerSource = null;
let tunerHighpass = null;
let tunerLowpass = null;
let tunerAnalyser = null;
let tunerRawSamples = null;
let tunerSamples = null;
let tunerFrame = 0;
let tunerSession = 0;
let lastAnalysisAt = 0;
let lastValidAt = 0;
let recentFrequencies = [];
let stableFrequency = 0;
let transitionFrequency = 0;
let transitionCount = 0;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbAll() {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbPut(project) {
  const record = cleanProject(project);
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function newProject(name) {
  return cleanProject({
    id: makeId(),
    name,
    saved: false,
    bpm: 120,
    key: '',
    mode: 'Mayor',
    note: '',
    theme: { bg: '#101010', panel: '#1e1e1e', border: '#333333' },
    repertoire: [],
    created: Date.now(),
  });
}

function saveProject(project = projects.find((item) => item.id === currentId)) {
  if (!project) return Promise.resolve();
  try {
    return dbPut(project).catch(() => toast('No se pudo guardar el proyecto'));
  } catch {
    return Promise.reject(new Error('No se pudo guardar el proyecto'));
  }
}

function applyTheme(project) {
  const theme = project.theme || {};
  document.documentElement.style.setProperty('--user-bg', theme.bg || '#101010');
  document.documentElement.style.setProperty('--user-panel', theme.panel || '#1e1e1e');
  document.documentElement.style.setProperty('--user-border', theme.border || '#333333');
}

function save() {
  const project = projects.find((item) => item.id === currentId);
  if (!project) return;
  project.bpm = Math.max(20, Math.min(300, Number($('bpm').value) || 120));
  $('bpm').value = project.bpm;
  $('metroTempoLabel').textContent = project.bpm + ' BPM';
  project.key = $('key').value;
  project.mode = $('mode').value;
  project.note = $('keyNote').value;
  project.theme = { bg: $('bgColor').value, panel: $('panelColor').value, border: $('borderColor').value };
  applyTheme(project);
  saveProject(project);
}

let toastTimer;
function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2400);
}

function showModal(title, value, callback) {
  $('modalTitle').textContent = title;
  $('modalInput').value = value;
  $('modal').classList.add('show');
  $('modalInput').focus();
  const done = () => {
    $('modal').classList.remove('show');
    $('modalSave').onclick = null;
    $('modalCancel').onclick = null;
    $('modalInput').onkeydown = null;
  };
  $('modalCancel').onclick = done;
  $('modalSave').onclick = () => {
    const name = $('modalInput').value.trim();
    if (!name) return $('modalInput').focus();
    done();
    callback(name);
  };
  $('modalInput').onkeydown = (event) => {
    if (event.key === 'Enter') $('modalSave').click();
    if (event.key === 'Escape') done();
  };
}

function renderProjects() {
  const selector = $('projectSelect');
  selector.innerHTML = '';
  for (const project of projects) {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name + (project.saved ? '' : ' · sin guardar');
    selector.appendChild(option);
  }
  selector.value = currentId;

  const list = $('projectList');
  list.innerHTML = '';
  if (!projects.length) {
    list.innerHTML = '<span class="project-list-empty">Todavía no hay proyectos.</span>';
    return;
  }
  for (const project of projects) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'project-item' + (project.id === currentId ? ' active' : '');
    button.textContent = project.name + (project.saved ? '' : ' · sin guardar');
    button.setAttribute('aria-pressed', String(project.id === currentId));
    button.onclick = () => selectProject(project.id);
    list.appendChild(button);
  }
}

function selectProject(id) {
  const project = projects.find((item) => item.id === id);
  if (!project) return;
  stopMetronome();
  currentId = id;
  project.repertoire = Array.isArray(project.repertoire) ? project.repertoire : [];
  selectedSongId = project.repertoire[0]?.id || '';
  $('projectCaption').textContent = project.name;
  $('bpm').value = project.bpm;
  $('metroTempoLabel').textContent = project.bpm + ' BPM';
  $('key').value = project.key || '';
  $('mode').value = project.mode || 'Mayor';
  $('keyNote').value = project.note || '';
  $('bgColor').value = project.theme.bg;
  $('panelColor').value = project.theme.panel;
  $('borderColor').value = project.theme.border;
  applyTheme(project);
  renderProjects();
  renderRepertoire();
}

function buildProjectSelectors() {
  const options = ['C', 'C♯ / D♭', 'D', 'D♯ / E♭', 'E', 'F', 'F♯ / G♭', 'G', 'G♯ / A♭', 'A', 'A♯ / B♭', 'B'];
  for (const key of options) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key;
    $('key').appendChild(option);
  }
}

function renderRepertoire() {
  const project = projects.find((item) => item.id === currentId);
  if (!project) return;
  const list = $('songList');
  list.innerHTML = '';
  $('newSongForm').classList.add('hidden');
  if (!project.repertoire.length) {
    list.innerHTML = '<div class="song-empty">Añade canciones, letras o apuntes para empezar tu repertorio.</div>';
    $('songEditor').classList.add('hidden');
    selectedSongId = '';
    return;
  }
  let selected = project.repertoire.find((song) => song.id === selectedSongId);
  if (!selected) {
    selected = project.repertoire[0];
    selectedSongId = selected.id;
  }
  const songLabel = (song) => song.artist ? song.title + ' — ' + song.artist : song.title;
  for (const song of project.repertoire) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'song-item' + (song.id === selected.id ? ' active' : '');
    item.dataset.songId = song.id;
    item.textContent = songLabel(song);
    item.setAttribute('aria-pressed', String(song.id === selected.id));
    item.onclick = () => {
      selectedSongId = song.id;
      renderRepertoire();
    };
    list.appendChild(item);
  }
  $('songEditor').classList.remove('hidden');
  $('songTitleInput').value = selected.title;
  $('songArtistInput').value = selected.artist || '';
  $('songLyrics').value = selected.lyrics || '';
  const updateSong = () => {
    selected.title = $('songTitleInput').value || 'Sin título';
    const item = list.querySelector('[data-song-id="' + selected.id + '"]');
    if (item) item.textContent = songLabel(selected);
    saveProject(project);
  };
  $('songTitleInput').oninput = updateSong;
  $('songArtistInput').oninput = () => {
    selected.artist = $('songArtistInput').value;
    updateSong();
  };
  $('songLyrics').oninput = () => {
    selected.lyrics = $('songLyrics').value;
    saveProject(project);
  };
  $('removeSongBtn').onclick = () => {
    if (!confirm('¿Quitar esta canción del repertorio?')) return;
    project.repertoire = project.repertoire.filter((song) => song.id !== selected.id);
    selectedSongId = project.repertoire[0]?.id || '';
    saveProject(project);
    renderRepertoire();
  };
}

function switchView(view) {
  if (view === activeView) return;
  if (activeView === 'tuner') stopTuner('Has salido del afinador. El micrófono está desconectado.');
  if (activeView === 'metronome') stopMetronome();
  activeView = view;
  for (const button of document.querySelectorAll('.nav-tab')) {
    const selected = button.dataset.view === view;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== view + 'View';
  if (view === 'tuner') renderTuner();
}

function getOutputContext() {
  if (!outputContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Este navegador no tiene Web Audio API.');
    outputContext = new AudioContextClass();
  }
  if (outputContext.state === 'suspended') outputContext.resume();
  return outputContext;
}

function metroTick() {
  const context = getOutputContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = metroBeat % 4 === 0 ? 1200 : 800;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.065);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.07);
  metroBeat++;
}

function startMetronome() {
  try {
    getOutputContext().resume();
    metroBeat = 0;
    metroTick();
    metroTimer = setInterval(() => {
      if (activeView === 'metronome') metroTick();
    }, 60000 / (Number($('bpm').value) || 120));
    $('metroBtn').textContent = '■ Detener metrónomo';
    $('metroBtn').setAttribute('aria-pressed', 'true');
  } catch (error) {
    toast(error.message || 'No se pudo iniciar el metrónomo');
  }
}

function stopMetronome() {
  if (metroTimer) clearInterval(metroTimer);
  metroTimer = null;
  if ($('metroBtn')) {
    $('metroBtn').textContent = '▶ Iniciar metrónomo';
    $('metroBtn').setAttribute('aria-pressed', 'false');
  }
}

function updateMetronomeTempo() {
  save();
  if (metroTimer) {
    clearInterval(metroTimer);
    metroTimer = setInterval(() => {
      if (activeView === 'metronome') metroTick();
    }, 60000 / (Number($('bpm').value) || 120));
  }
}

function tapTempo() {
  const now = performance.now();
  tapTimes = tapTimes.filter((time) => now - time < 2500);
  tapTimes.push(now);
  if (tapTimes.length > 1) {
    const gaps = tapTimes.slice(1).map((time, index) => time - tapTimes[index]);
    const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    const bpm = Math.round(60000 / average);
    if (bpm >= 20 && bpm <= 300) {
      $('bpm').value = bpm;
      updateMetronomeTempo();
      $('tapStatus').textContent = 'Tempo detectado: ' + bpm + ' BPM · ' + tapTimes.length + ' pulsos';
    }
  } else {
    $('tapStatus').textContent = 'Sigue tocando al ritmo…';
  }
}

function readLocalStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    toast('El navegador no permite guardar esta preferencia en este dispositivo');
  }
}

function readCustomTunings() {
  const value = readLocalStorage(CUSTOM_TUNINGS_KEY, []);
  if (!Array.isArray(value)) return [];
  return value.filter((tuning) => tuning && typeof tuning.id === 'string' && typeof tuning.name === 'string' && Array.isArray(tuning.strings) && tuning.strings.length === 6 && tuning.strings.every((note) => {
    try { midiForNote(note); return true; } catch { return false; }
  }));
}

function readTunerPreferences() {
  const value = readLocalStorage(TUNER_PREFS_KEY, {});
  const allowed = [3, 5, 10, 15];
  return {
    activeTuningId: typeof value?.activeTuningId === 'string' ? value.activeTuningId : 'chromatic',
    tolerance: allowed.includes(Number(value?.tolerance)) ? Number(value.tolerance) : 5,
  };
}

function persistTunerPreferences() {
  tunerPreferences = { activeTuningId, tolerance };
  writeLocalStorage(TUNER_PREFS_KEY, tunerPreferences);
}

function persistCustomTunings() {
  writeLocalStorage(CUSTOM_TUNINGS_KEY, customTunings);
}

function readFavoriteTunings() {
  const value = readLocalStorage(FAVORITE_TUNINGS_KEY, []);
  return Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === 'string' && id !== 'chromatic'))] : [];
}

function persistFavoriteTunings() {
  writeLocalStorage(FAVORITE_TUNINGS_KEY, favoriteTuningIds);
}

function customTuningValue(id) {
  return 'custom:' + id;
}

function getTuningById(id) {
  if (id === 'chromatic') return null;
  const preset = TUNINGS.find((tuning) => tuning.id === id);
  if (preset) return preset;
  const customId = id.startsWith('custom:') ? id.slice(7) : id;
  return customTunings.find((tuning) => tuning.id === customId) || null;
}

function getActiveTuning() {
  return getTuningById(activeTuningId);
}

function syncTuningSelector() {
  const select = $('tuningSelect');
  select.innerHTML = '';
  const chromatic = document.createElement('option');
  chromatic.value = 'chromatic';
  chromatic.textContent = 'Cromático';
  select.appendChild(chromatic);
  const presets = document.createElement('optgroup');
  presets.label = 'Afinaciones preestablecidas';
  for (const tuning of TUNINGS) {
    const option = document.createElement('option');
    option.value = tuning.id;
    option.textContent = tuning.name;
    presets.appendChild(option);
  }
  select.appendChild(presets);
  if (customTunings.length) {
    const custom = document.createElement('optgroup');
    custom.label = 'Mis afinaciones';
    for (const tuning of customTunings) {
      const option = document.createElement('option');
      option.value = customTuningValue(tuning.id);
      option.textContent = tuning.name;
      custom.appendChild(option);
    }
    select.appendChild(custom);
  }
  const create = document.createElement('option');
  create.value = '__custom_new__';
  create.textContent = '＋ Afinación personalizada…';
  select.appendChild(create);
  if (activeTuningId.startsWith('custom:') && !customTunings.some((item) => customTuningValue(item.id) === activeTuningId)) activeTuningId = 'chromatic';
  select.value = activeTuningId;
}

function renderFavorites() {
  const list = $('favoriteTuningList');
  const empty = $('favoriteTuningEmpty');
  const entries = favoriteTuningIds.map((id) => ({ id, tuning: getTuningById(id) })).filter((item) => item.tuning);
  if (entries.length !== favoriteTuningIds.length) {
    favoriteTuningIds = entries.map((item) => item.id);
    persistFavoriteTunings();
  }
  list.innerHTML = '';
  empty.hidden = entries.length > 0;
  for (const { id, tuning } of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'favorite-item' + (id === activeTuningId ? ' active' : '');
    button.innerHTML = '<span>★ ' + tuning.name + '</span><small>' + tuning.strings.join(' · ') + '</small>';
    button.onclick = () => changeTuning(id);
    list.appendChild(button);
  }
}

function toggleFavoriteTuning() {
  const tuning = getActiveTuning();
  if (!tuning) return;
  const index = favoriteTuningIds.indexOf(activeTuningId);
  if (index >= 0) favoriteTuningIds.splice(index, 1);
  else favoriteTuningIds.push(activeTuningId);
  persistFavoriteTunings();
  renderTuner();
}

function stringMidi(note) {
  return midiForNote(note);
}

function targetStrings() {
  const tuning = getActiveTuning();
  if (!tuning) return [];
  return tuning.strings.map((note, index) => ({
    index,
    stringNumber: 6 - index,
    note,
    midi: stringMidi(note),
    frequency: frequencyForMidi(stringMidi(note)),
  }));
}

function currentTarget(frequency = stableFrequency) {
  const strings = targetStrings();
  if (!strings.length) return null;
  if (selectedString !== null) return strings[selectedString] || null;
  if (!(frequency > 0)) return null;
  return strings.reduce((closest, item) => {
    const distance = Math.abs(centsBetween(frequency, item.frequency));
    return !closest || distance < closest.distance ? { ...item, distance } : closest;
  }, null);
}

function renderStrings(matchedIndex = null) {
  const container = $('stringList');
  const strings = targetStrings();
  container.innerHTML = '';
  container.classList.toggle('hidden', strings.length === 0);
  for (const item of strings) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'string-chip' + (selectedString === item.index ? ' selected' : (selectedString === null && matchedIndex === item.index ? ' nearest' : ''));
    button.dataset.index = String(item.index);
    button.innerHTML = '<span class="string-number">CUERDA ' + item.stringNumber + '</span><strong></strong><small>' + item.frequency.toFixed(2) + ' Hz</small>';
    button.querySelector('strong').textContent = item.note;
    button.setAttribute('aria-pressed', String(selectedString === item.index));
    button.setAttribute('aria-label', 'Seleccionar cuerda ' + item.stringNumber + ', objetivo ' + item.note);
    button.onclick = () => {
      selectedString = item.index;
      renderTuner();
    };
    container.appendChild(button);
  }
  $('autoStringBtn').classList.toggle('active', selectedString === null);
  $('autoStringBtn').setAttribute('aria-pressed', String(selectedString === null));
}

function highlightCurrentString(matchedIndex) {
  for (const button of $('stringList').querySelectorAll('.string-chip')) {
    const index = Number(button.dataset.index);
    button.classList.toggle('selected', selectedString === index);
    button.classList.toggle('nearest', selectedString === null && index === matchedIndex);
  }
}

function renderTuner() {
  syncTuningSelector();
  const favoriteButton = $('favoriteTuningBtn');
  const favorite = Boolean(getActiveTuning()) && favoriteTuningIds.includes(activeTuningId);
  favoriteButton.disabled = !getActiveTuning();
  favoriteButton.textContent = favorite ? '★' : '☆';
  favoriteButton.setAttribute('aria-pressed', String(favorite));
  favoriteButton.setAttribute('aria-label', favorite ? 'Quitar afinación de favoritas' : 'Marcar afinación como favorita');
  favoriteButton.title = favorite ? 'Quitar de favoritas' : 'Marcar como favorita';
  renderFavorites();
  const strings = targetStrings();
  const target = currentTarget();
  renderStrings(target?.index ?? null);
  const tuning = getActiveTuning();
  $('customManage').classList.toggle('hidden', !activeTuningId.startsWith('custom:') || !tuning);
  $('referenceToneBtn').disabled = !tuning;
  $('targetNote').textContent = target ? 'Objetivo · ' + target.note : (tuning ? 'Objetivo automático' : 'Sin objetivo fijo');
  $('targetString').textContent = target ? 'Cuerda ' + target.stringNumber : (tuning ? (selectedString === null ? 'Toca una cuerda' : 'Selecciona una cuerda') : 'Modo cromático');
  if (!strings.length) {
    $('confidenceLabel').textContent = 'Cromático · rango de guitarra';
    $('detectedNote').textContent = '—';
    $('detectedFrequency').textContent = '— Hz';
    $('centsValue').textContent = '— cents';
    $('tuningState').textContent = tunerStream ? 'Escuchando…' : 'Activa el micrófono para empezar';
    $('tuningState').className = 'tuning-status';
    $('meterNeedle').style.left = '50%';
    $('meterNeedle').className = 'meter-needle';
  }
}

function openCustomEditor(tuning = null) {
  const editor = $('customEditor');
  const isEditing = Boolean(tuning?.id);
  const defaults = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
  $('customTuningName').value = tuning?.name || 'Mi afinación';
  $('customTuningId').value = tuning?.id || '';
  $('customEditorTitle').textContent = isEditing ? 'Edita las seis notas de tu guitarra' : 'Crea las seis notas de tu guitarra';
  const fields = $('customStrings');
  fields.innerHTML = '';
  for (let index = 0; index < 6; index++) {
    const note = (tuning?.strings || defaults)[index];
    const parsed = /^([A-G](?:#|b)?)(\d+)$/.exec(note) || ['E2', 'E', '2'];
    const row = document.createElement('label');
    row.className = 'custom-string';
    row.innerHTML = '<span>' + (6 - index) + 'ª cuerda</span><select class="custom-note" aria-label="Nota de la cuerda ' + (6 - index) + '"></select><select class="custom-octave" aria-label="Octava de la cuerda ' + (6 - index) + '"></select>';
    const noteSelect = row.querySelector('.custom-note');
    for (const optionInfo of NOTE_CHOICES) {
      const option = document.createElement('option');
      option.value = optionInfo.name;
      option.textContent = optionInfo.name;
      noteSelect.appendChild(option);
    }
    noteSelect.value = parsed[1];
    const octaveSelect = row.querySelector('.custom-octave');
    for (let octave = 0; octave <= 8; octave++) {
      const option = document.createElement('option');
      option.value = String(octave);
      option.textContent = 'Octava ' + octave;
      octaveSelect.appendChild(option);
    }
    octaveSelect.value = parsed[2];
    fields.appendChild(row);
  }
  editor.classList.remove('hidden');
  $('customTuningName').focus();
}

function closeCustomEditor() {
  $('customEditor').classList.add('hidden');
  renderTuner();
}

function readCustomEditorStrings() {
  return Array.from($('customStrings').querySelectorAll('.custom-string')).map((row) => row.querySelector('.custom-note').value + row.querySelector('.custom-octave').value);
}

function saveCustomTuning() {
  const name = $('customTuningName').value.trim();
  if (!name) {
    toast('Escribe un nombre para la afinación');
    $('customTuningName').focus();
    return;
  }
  const strings = readCustomEditorStrings();
  const id = $('customTuningId').value || makeId();
  const tuning = { id, name, strings };
  const index = customTunings.findIndex((item) => item.id === id);
  if (index >= 0) customTunings[index] = tuning;
  else customTunings.push(tuning);
  activeTuningId = customTuningValue(id);
  selectedString = null;
  persistCustomTunings();
  persistTunerPreferences();
  $('customEditor').classList.add('hidden');
  renderTuner();
  toast('Afinación guardada en este dispositivo');
}

function duplicateCustomTuning() {
  const tuning = getActiveTuning();
  if (!tuning || !activeTuningId.startsWith('custom:')) return;
  const duplicate = { id: makeId(), name: tuning.name + ' (copia)', strings: [...tuning.strings] };
  customTunings.push(duplicate);
  activeTuningId = customTuningValue(duplicate.id);
  persistCustomTunings();
  persistTunerPreferences();
  syncTuningSelector();
  openCustomEditor(duplicate);
}

function deleteCustomTuning() {
  const tuning = getActiveTuning();
  if (!tuning || !activeTuningId.startsWith('custom:')) return;
  if (!confirm('¿Eliminar la afinación «' + tuning.name + '»?')) return;
  customTunings = customTunings.filter((item) => item.id !== tuning.id);
  favoriteTuningIds = favoriteTuningIds.filter((id) => id !== activeTuningId);
  persistFavoriteTunings();
  activeTuningId = 'standard-e';
  selectedString = null;
  persistCustomTunings();
  persistTunerPreferences();
  renderTuner();
  toast('Afinación eliminada');
}

function getAnalysisRange(sampleRate) {
  const nyquist = sampleRate / 2;
  if (activeTuningId === 'chromatic') return { minFrequency: 25, maxFrequency: Math.min(1800, nyquist * 0.95) };
  const strings = targetStrings();
  const selected = selectedString === null ? null : strings[selectedString];
  if (selected) {
    return {
      minFrequency: Math.max(8, selected.frequency * 0.45),
      maxFrequency: Math.min(nyquist * 0.95, selected.frequency * 1.65),
    };
  }
  const minimum = Math.min(...strings.map((item) => item.frequency));
  const maximum = Math.max(...strings.map((item) => item.frequency));
  return {
    minFrequency: Math.max(12, minimum * 0.68),
    maxFrequency: Math.min(nyquist * 0.95, Math.max(500, maximum * 1.5)),
  };
}

function stabilizePitch(reading) {
  const now = performance.now();
  if (!reading) {
    if (now - lastValidAt > 380) {
      stableFrequency = 0;
      recentFrequencies = [];
      transitionFrequency = 0;
      transitionCount = 0;
      renderPitch(null);
    }
    return;
  }
  lastValidAt = now;
  const frequency = reading.frequency;
  if (stableFrequency > 0 && Math.abs(centsBetween(frequency, stableFrequency)) > 160) {
    if (transitionFrequency > 0 && Math.abs(centsBetween(frequency, transitionFrequency)) < 45) transitionCount++;
    else {
      transitionFrequency = frequency;
      transitionCount = 1;
    }
    if (transitionCount < 2) return;
    stableFrequency = 0;
    recentFrequencies = [];
  } else {
    transitionFrequency = 0;
    transitionCount = 0;
  }
  recentFrequencies.push(frequency);
  if (recentFrequencies.length > 5) recentFrequencies.shift();
  const sorted = [...recentFrequencies].sort((a, b) => a - b);
  stableFrequency = sorted[Math.floor(sorted.length / 2)];
  renderPitch({ ...reading, frequency: stableFrequency });
}

function renderPitch(reading) {
  const frequency = reading?.frequency || 0;
  const tuning = getActiveTuning();
  const note = frequency > 0 ? noteForFrequency(frequency) : null;
  const target = currentTarget(frequency);
  let cents = null;
  let state = '';
  if (note) {
    cents = tuning && target ? centsBetween(frequency, target.frequency) : note.cents;
    if (Math.abs(cents) <= tolerance) state = 'tuned';
    else state = cents < 0 ? 'flat' : 'sharp';
    $('detectedNote').textContent = note.name;
    $('detectedFrequency').textContent = frequency.toFixed(2) + ' Hz';
    $('centsValue').textContent = (cents > 0 ? '+' : '') + cents.toFixed(1) + ' cents';
    $('tuningState').textContent = state === 'tuned' ? 'Afinada' : (state === 'flat' ? 'Demasiado grave · sube la tensión' : 'Demasiado aguda · baja la tensión');
    $('tuningState').className = 'tuning-status ' + state;
    $('confidenceLabel').textContent = 'Confianza ' + Math.round((reading.clarity || 0) * 100) + '%';
    $('targetNote').textContent = tuning && target ? 'Objetivo · ' + target.note : 'Nota más cercana · ' + note.name;
    $('targetString').textContent = tuning && target ? 'Cuerda ' + target.stringNumber : 'Cromático · sin cuerda fija';
    const position = Math.max(0, Math.min(100, 50 + cents));
    $('meterNeedle').style.left = position + '%';
    $('meterNeedle').className = 'meter-needle ' + (state === 'tuned' ? 'tuned' : 'off');
    highlightCurrentString(target?.index ?? null);
  } else {
    $('detectedNote').textContent = '—';
    $('detectedFrequency').textContent = '— Hz';
    $('centsValue').textContent = '— cents';
    $('tuningState').textContent = tunerStream ? 'Escuchando · toca una cuerda' : 'Activa el micrófono para empezar';
    $('tuningState').className = 'tuning-status';
    $('confidenceLabel').textContent = tunerStream ? 'Esperando una señal estable' : 'Lectura en espera';
    $('meterNeedle').style.left = '50%';
    $('meterNeedle').className = 'meter-needle';
    $('targetNote').textContent = target ? 'Objetivo · ' + target.note : (tuning ? 'Objetivo automático' : 'Sin objetivo fijo');
    $('targetString').textContent = target ? 'Cuerda ' + target.stringNumber : (tuning ? 'Toca una cuerda' : 'Modo cromático');
    highlightCurrentString(null);
  }
}

function processTunerFrame() {
  if (!tunerAnalyser || !tunerStream) return;
  tunerFrame = requestAnimationFrame(processTunerFrame);
  const now = performance.now();
  if (now - lastAnalysisAt < 85) return;
  lastAnalysisAt = now;
  tunerAnalyser.getFloatTimeDomainData(tunerRawSamples);
  for (let i = 0; i < tunerSamples.length; i++) tunerSamples[i] = (tunerRawSamples[i * 2] + tunerRawSamples[i * 2 + 1]) / 2;
  const sampleRate = tunerContext.sampleRate / 2;
  const range = getAnalysisRange(sampleRate);
  const reading = detectPitchYin(tunerSamples, sampleRate, { ...range, threshold: 0.14, minClarity: 0.78, minRms: 0.0025 });
  stabilizePitch(reading);
}

async function startTuner() {
  if (tunerStream) return;
  const session = ++tunerSession;
  const button = $('micButton');
  button.disabled = true;
  button.textContent = 'Solicitando permiso…';
  $('micMessage').textContent = 'El navegador te pedirá permiso para usar el micrófono.';
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    $('micMessage').textContent = 'El micrófono requiere HTTPS o localhost y un navegador compatible con Web Audio API.';
    button.disabled = false;
    button.textContent = 'Activar micrófono';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    if (session !== tunerSession || activeView !== 'tuner') {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('Este navegador no incluye Web Audio API.');
    }
    tunerStream = stream;
    tunerContext = new AudioContextClass();
    if (tunerContext.state === 'suspended') await tunerContext.resume();
    tunerSource = tunerContext.createMediaStreamSource(stream);
    tunerHighpass = tunerContext.createBiquadFilter();
    tunerHighpass.type = 'highpass';
    tunerHighpass.frequency.value = 20;
    tunerHighpass.Q.value = 0.7;
    tunerLowpass = tunerContext.createBiquadFilter();
    tunerLowpass.type = 'lowpass';
    tunerLowpass.frequency.value = Math.min(9000, tunerContext.sampleRate * 0.4);
    tunerLowpass.Q.value = 0.7;
    tunerAnalyser = tunerContext.createAnalyser();
    tunerAnalyser.fftSize = 8192;
    tunerAnalyser.smoothingTimeConstant = 0;
    tunerRawSamples = new Float32Array(tunerAnalyser.fftSize);
    tunerSamples = new Float32Array(tunerAnalyser.fftSize / 2);
    tunerSource.connect(tunerHighpass).connect(tunerLowpass).connect(tunerAnalyser);
    recentFrequencies = [];
    stableFrequency = 0;
    transitionFrequency = 0;
    transitionCount = 0;
    lastValidAt = performance.now();
    button.disabled = true;
    button.textContent = 'Micrófono activo';
    $('tunerStopButton').disabled = false;
    $('micMessage').textContent = 'Escuchando. Toca una sola cuerda y deja que la nota resuene.';
    processTunerFrame();
  } catch (error) {
    if (session !== tunerSession) return;
    const message = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError'
      ? 'No se concedió el permiso. Permite el micrófono desde los ajustes del sitio para usar el afinador.'
      : error?.name === 'NotFoundError'
        ? 'No se encontró un micrófono disponible en este dispositivo.'
        : error?.message || 'No se pudo acceder al micrófono. Comprueba el permiso del navegador.';
    await stopTuner(message);
    $('micMessage').textContent = message;
    button.disabled = false;
    button.textContent = 'Activar micrófono';
    toast('No se pudo iniciar la escucha');
  }
}

async function stopTuner(message = 'Escucha detenida. El micrófono está desconectado.') {
  const cleanupSession = ++tunerSession;
  if (tunerFrame) cancelAnimationFrame(tunerFrame);
  tunerFrame = 0;
  if (tunerStream) tunerStream.getTracks().forEach((track) => track.stop());
  for (const node of [tunerSource, tunerHighpass, tunerLowpass, tunerAnalyser]) {
    try { node?.disconnect(); } catch { /* ya desconectado */ }
  }
  const context = tunerContext;
  tunerStream = null;
  tunerSource = null;
  tunerHighpass = null;
  tunerLowpass = null;
  tunerAnalyser = null;
  tunerContext = null;
  tunerRawSamples = null;
  tunerSamples = null;
  recentFrequencies = [];
  stableFrequency = 0;
  transitionFrequency = 0;
  transitionCount = 0;
  if (context && context.state !== 'closed') {
    try { await context.close(); } catch { /* el navegador puede haber cerrado el contexto */ }
  }
  if (cleanupSession !== tunerSession) return;
  if ($('micButton')) {
    $('micButton').disabled = false;
    $('micButton').textContent = 'Activar micrófono';
    $('tunerStopButton').disabled = true;
    $('micMessage').textContent = message;
    renderPitch(null);
  }
}

function playReferenceTone() {
  const tuning = getActiveTuning();
  if (!tuning) return;
  const target = currentTarget() || targetStrings()[0];
  if (!target) return;
  try {
    stopReferenceTone();
    const context = getOutputContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.value = target.frequency;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.035);
    gain.gain.setValueAtTime(0.18, now + 1.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 1.32);
    referenceOscillator = oscillator;
    referenceGain = gain;
    referenceStopTimer = setTimeout(stopReferenceTone, 1400);
    $('micMessage').textContent = 'Nota de referencia: cuerda ' + target.stringNumber + ' · ' + target.note + ' · ' + target.frequency.toFixed(2) + ' Hz.';
  } catch (error) {
    toast(error.message || 'No se pudo reproducir la referencia');
  }
}

function stopReferenceTone() {
  clearTimeout(referenceStopTimer);
  referenceStopTimer = null;
  try { referenceOscillator?.stop(); } catch { /* ya detenido */ }
  try { referenceOscillator?.disconnect(); referenceGain?.disconnect(); } catch { /* ya desconectado */ }
  referenceOscillator = null;
  referenceGain = null;
}

function changeTuning(value) {
  if (value === '__custom_new__') {
    openCustomEditor();
    $('tuningSelect').value = activeTuningId;
    return;
  }
  activeTuningId = value;
  selectedString = null;
  persistTunerPreferences();
  renderTuner();
}

function configureSourceSearch() {
  const search = $('sourceMode').value === 'search';
  $('sourceInput').placeholder = search ? 'Artista o título' : 'https://… enlace a audio';
  $('sourceHelp').textContent = search
    ? 'Busca la canción en la web o analiza un archivo para estimar su BPM.'
    : 'Abre un enlace en otra pestaña. Los servicios protegidos pueden pedir que abras su propia página.';
}

async function analyzeReference() {
  const file = $('referenceFile').files[0];
  if (!file) return toast('Elige primero un archivo de audio');
  const button = $('analyzeReference');
  button.disabled = true;
  $('trackInfo').textContent = 'Analizando audio localmente…';
  try {
    const data = await file.arrayBuffer();
    const buffer = await getOutputContext().decodeAudioData(data);
    const channel = buffer.getChannelData(0);
    const rate = buffer.sampleRate;
    const windowSize = Math.max(1, Math.floor(rate * 0.02));
    const frames = Math.min(Math.floor(channel.length / windowSize), 6000);
    const envelope = new Float32Array(frames);
    let previous = 0;
    for (let frame = 0; frame < frames; frame++) {
      let sum = 0;
      const start = frame * windowSize;
      for (let sample = 0; sample < windowSize; sample += 4) {
        const value = channel[start + sample] || 0;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / Math.ceil(windowSize / 4));
      envelope[frame] = Math.max(0, rms - previous);
      previous = rms;
    }
    let bestLag = 0;
    let bestScore = -Infinity;
    for (let lag = 15; lag <= 75; lag++) {
      let score = 0;
      for (let index = lag; index < frames; index++) score += envelope[index] * envelope[index - lag];
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    const bpm = Math.round(3000 / bestLag);
    if (!bestLag || bpm < 40 || bpm > 200) throw new Error('No se ha podido estimar un tempo estable');
    $('bpm').value = bpm;
    updateMetronomeTempo();
    $('trackInfo').textContent = file.name + ' · tempo estimado';
    toast('Tempo estimado: ' + bpm + ' BPM');
  } catch {
    $('trackInfo').textContent = 'No se pudo analizar: formato no compatible o tempo poco claro.';
    toast('No se pudo estimar el BPM');
  } finally {
    button.disabled = false;
  }
}

function exportProject() {
  const project = cleanProject(projects.find((item) => item.id === currentId));
  const payload = { project };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = (project.name.replace(/[^\w\- ]/g, '') || 'proyecto') + '.pulso';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Proyecto exportado');
}

async function importProject(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const source = data.project || data;
    if (!source || typeof source.name !== 'string' || !source.name.trim()) throw new Error('Archivo de proyecto no válido');
    const imported = cleanProject(source);
    imported.id = makeId();
    imported.saved = true;
    projects.push(imported);
    await saveProject(imported);
    selectProject(imported.id);
    toast('Proyecto importado. Los datos del repertorio se conservaron.');
  } catch {
    toast('No se pudo leer el archivo de proyecto');
  } finally {
    $('importFile').value = '';
  }
}

function bindEvents() {
  for (const button of document.querySelectorAll('.nav-tab')) button.onclick = () => switchView(button.dataset.view);
  $('projectSelect').onchange = () => selectProject($('projectSelect').value);
  $('toolsToggle').onclick = () => {
    const open = !$('projectTools').open;
    $('projectTools').open = open;
    $('toolsToggle').setAttribute('aria-expanded', String(open));
  };
  $('projectTools').ontoggle = () => $('toolsToggle').setAttribute('aria-expanded', String($('projectTools').open));
  $('newProjectBtn').onclick = () => showModal('Nuevo proyecto', 'Nuevo proyecto', async (name) => {
    const project = newProject(name);
    projects.push(project);
    await saveProject(project);
    selectProject(project.id);
  });
  $('saveProjectBtn').onclick = () => {
    const project = projects.find((item) => item.id === currentId);
    if (!project.saved) {
      showModal('Guardar proyecto · elegir nombre', project.name, (name) => {
        project.name = name;
        project.saved = true;
        $('projectCaption').textContent = name;
        saveProject(project).then(() => toast('Proyecto guardado'));
        renderProjects();
      });
    } else {
      saveProject(project).then(() => toast('Proyecto guardado'));
    }
  };
  $('renameProjectBtn').onclick = () => {
    const project = projects.find((item) => item.id === currentId);
    showModal('Renombrar proyecto', project.name, (name) => {
      project.name = name;
      project.saved = true;
      $('projectCaption').textContent = name;
      saveProject(project).then(() => toast('Proyecto renombrado'));
      renderProjects();
    });
  };
  $('exportBtn').onclick = exportProject;
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = () => importProject($('importFile').files[0]);

  $('addSongBtn').onclick = () => {
    $('newSongForm').classList.toggle('hidden');
    if (!$('newSongForm').classList.contains('hidden')) $('newSongTitle').focus();
  };
  $('cancelSongBtn').onclick = () => $('newSongForm').classList.add('hidden');
  $('confirmSongBtn').onclick = () => {
    const title = $('newSongTitle').value.trim();
    const artist = $('newSongArtist').value.trim();
    if (!title) return toast('Escribe el nombre de la canción');
    const project = projects.find((item) => item.id === currentId);
    const song = { id: makeId(), title, artist, lyrics: '' };
    project.repertoire.push(song);
    selectedSongId = song.id;
    $('newSongTitle').value = '';
    $('newSongArtist').value = '';
    saveProject(project);
    renderRepertoire();
  };

  $('bpm').onchange = updateMetronomeTempo;
  $('bpm').oninput = () => {
    $('metroTempoLabel').textContent = (Number($('bpm').value) || 120) + ' BPM';
    if (Number($('bpm').value) >= 20 && Number($('bpm').value) <= 300) updateMetronomeTempo();
  };
  $('minus').onclick = () => {
    $('bpm').value = Math.max(20, (Number($('bpm').value) || 120) - 1);
    updateMetronomeTempo();
  };
  $('plus').onclick = () => {
    $('bpm').value = Math.min(300, (Number($('bpm').value) || 120) + 1);
    updateMetronomeTempo();
  };
  $('tap').onclick = tapTempo;
  $('tapBig').onclick = tapTempo;
  $('metroBtn').onclick = () => metroTimer ? stopMetronome() : startMetronome();

  ['key', 'mode', 'keyNote'].forEach((id) => $(id).addEventListener('input', save));
  ['bgColor', 'panelColor', 'borderColor'].forEach((id) => $(id).addEventListener('input', save));
  $('sourceMode').onchange = configureSourceSearch;
  $('sourceGo').onclick = () => {
    const query = $('sourceInput').value.trim();
    if (!query) return toast('Escribe un artista, título o enlace');
    if ($('sourceMode').value === 'search') {
      window.open('https://www.google.com/search?q=' + encodeURIComponent(query + ' song bpm key'), '_blank', 'noopener');
      $('trackInfo').textContent = query;
      return;
    }
    try {
      const url = new URL(query);
      window.open(url.href, '_blank', 'noopener');
      $('trackInfo').textContent = query.slice(0, 80);
    } catch {
      toast('El enlace no es válido');
    }
  };
  $('sourceInput').onkeydown = (event) => { if (event.key === 'Enter') $('sourceGo').click(); };
  $('analyzeReference').onclick = analyzeReference;

  $('tuningSelect').onchange = () => changeTuning($('tuningSelect').value);
  $('favoriteTuningBtn').onclick = toggleFavoriteTuning;
  $('toleranceSelect').value = String(tolerance);
  $('toleranceSelect').onchange = () => {
    tolerance = Number($('toleranceSelect').value) || 5;
    persistTunerPreferences();
    if (stableFrequency) renderPitch({ frequency: stableFrequency, clarity: 1 });
  };
  $('autoStringBtn').onclick = () => {
    selectedString = null;
    renderTuner();
  };
  $('referenceToneBtn').onclick = playReferenceTone;
  $('micButton').onclick = startTuner;
  $('tunerStopButton').onclick = () => stopTuner();
  $('saveCustomBtn').onclick = saveCustomTuning;
  $('cancelCustomBtn').onclick = closeCustomEditor;
  $('editCustomBtn').onclick = () => openCustomEditor(getActiveTuning());
  $('duplicateCustomBtn').onclick = duplicateCustomTuning;
  $('deleteCustomBtn').onclick = deleteCustomTuning;
}

window.addEventListener('pagehide', () => {
  stopReferenceTone();
  stopMetronome();
  stopTuner('Escucha detenida.');
});

if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./sw.js').catch(() => {});

(async function initialize() {
  buildProjectSelectors();
  bindEvents();
  syncTuningSelector();
  db = await openDB();
  const storedProjects = await dbAll();
  projects = storedProjects.map(cleanProject);
  if (!projects.length) projects.push(newProject('Mi primer proyecto'));
  currentId = projects[0].id;
  selectProject(currentId);
  // Drops only legacy sampler fields after retaining all project, repertoire and preference data.
  await Promise.all(projects.map((project) => dbPut(project)));
  if (!TUNINGS.some((tuning) => tuning.id === activeTuningId) && activeTuningId !== 'chromatic' && !activeTuningId.startsWith('custom:')) activeTuningId = 'chromatic';
  renderTuner();
})().catch(() => toast('No se pudo inicializar el almacenamiento local'));


