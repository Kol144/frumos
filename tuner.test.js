import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_CHOICES,
  TUNINGS,
  centsBetween,
  detectPitchYin,
  frequencyForMidi,
  midiForNote,
  noteForFrequency,
} from './tuner.js';
import { cleanProject } from './project-data.js';

const EXPECTED_TUNINGS = {
  'Standard E': ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
  'Half Step Down': ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'],
  'Full Step Down': ['D2', 'G2', 'C3', 'F3', 'A3', 'D4'],
  'Drop D': ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'],
  'Drop C': ['C2', 'G2', 'C3', 'F3', 'A3', 'D4'],
  'Drop B': ['B1', 'F#2', 'B2', 'E3', 'G#3', 'C#4'],
  'Drop A': ['A1', 'E2', 'A2', 'D3', 'F#3', 'B3'],
  'Open G': ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'],
  'Open D': ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'],
  'Open A': ['E2', 'A2', 'E3', 'A3', 'C#4', 'E4'],
  'Open E': ['E2', 'B2', 'E3', 'G#3', 'B3', 'E4'],
  DADGAD: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'],
};

function makeTone(frequency, { rate = 22050, size = 4096, harmonics = false } = {}) {
  const samples = new Float32Array(size);
  for (let index = 0; index < size; index++) {
    const phase = (2 * Math.PI * frequency * index) / rate;
    samples[index] = harmonics
      ? 0.08 * Math.sin(phase) + 0.75 * Math.sin(2 * phase) + 0.2 * Math.sin(3 * phase)
      : 0.5 * Math.sin(phase);
  }
  return samples;
}

test('incluye las doce afinaciones con seis cuerdas en orden de la sexta a la primera', () => {
  assert.equal(TUNINGS.length, 12);
  for (const tuning of TUNINGS) {
    assert.deepEqual(tuning.strings, EXPECTED_TUNINGS[tuning.name], tuning.name);
    assert.equal(tuning.strings.length, 6);
    assert.ok(tuning.strings.every((note) => Number.isInteger(midiForNote(note))));
  }
});

test('la migración de proyectos conserva canciones, BPM y tema y elimina los campos antiguos', () => {
  const migrated = cleanProject({
    id: 'proyecto-1',
    name: 'Ensayo',
    saved: true,
    bpm: 137,
    key: 'E',
    mode: 'Menor',
    note: 'Afinación de concierto',
    rows: 4,
    cols: 4,
    pads: { 0: { name: 'Audio antiguo', blob: new Blob(['dato']) } },
    theme: { bg: '#121212', pad: '#242424', border: '#393939' },
    repertoire: [{ id: 'cancion-1', title: 'Tema', artist: 'Grupo', lyrics: 'Acordes guardados' }],
    created: 12345,
  });
  assert.equal(migrated.id, 'proyecto-1');
  assert.equal(migrated.name, 'Ensayo');
  assert.equal(migrated.saved, true);
  assert.equal(migrated.bpm, 137);
  assert.equal(migrated.key, 'E');
  assert.equal(migrated.mode, 'Menor');
  assert.equal(migrated.note, 'Afinación de concierto');
  assert.deepEqual(migrated.theme, { bg: '#121212', panel: '#242424', border: '#393939' });
  assert.deepEqual(migrated.repertoire, [{
    id: 'cancion-1',
    title: 'Tema',
    artist: 'Grupo',
    lyrics: 'Acordes guardados',
    key: '',
    bpm: 137,
  }]);
  assert.equal(migrated.created, 12345);
  assert.equal('pads' in migrated, false);
  assert.equal('rows' in migrated, false);
  assert.equal('cols' in migrated, false);
});

test('acepta las 17 grafías cromáticas y mantiene equivalentes las notas enarmónicas', () => {
  assert.deepEqual(NOTE_CHOICES.map((choice) => choice.name), ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B']);
  for (const { name } of NOTE_CHOICES) assert.ok(Number.isInteger(midiForNote(name + '3')));
  assert.equal(midiForNote('C#4'), midiForNote('Db4'));
  assert.equal(midiForNote('D#4'), midiForNote('Eb4'));
  assert.equal(midiForNote('F#4'), midiForNote('Gb4'));
  assert.equal(midiForNote('G#4'), midiForNote('Ab4'));
  assert.equal(midiForNote('A#4'), midiForNote('Bb4'));
});

test('frecuencias de referencia usan temperamento igual con A4 = 440 Hz', () => {
  assert.ok(Math.abs(frequencyForMidi(midiForNote('A4')) - 440) < 1e-10);
  assert.ok(Math.abs(frequencyForMidi(midiForNote('E2')) - 82.4068892282175) < 1e-9);
  assert.equal(noteForFrequency(440).name, 'A4');
  assert.equal(noteForFrequency(frequencyForMidi(60)).name, 'C4');
  assert.ok(Math.abs(centsBetween(440 * 2 ** (5 / 1200), 440) - 5) < 1e-8);
});

test('YIN reconoce las doce notas cromáticas en tiempo real', () => {
  for (let midi = 48; midi < 60; midi++) {
    const expectedFrequency = frequencyForMidi(midi);
    const reading = detectPitchYin(makeTone(expectedFrequency), 22050, { minFrequency: 100, maxFrequency: 300 });
    assert.ok(reading, 'sin lectura para MIDI ' + midi);
    assert.ok(Math.abs(centsBetween(reading.frequency, expectedFrequency)) < 1, 'desviación para MIDI ' + midi);
    assert.equal(noteForFrequency(reading.frequency).midi, midi);
  }
});

test('YIN encuentra la fundamental aunque un armónico sea mucho más intenso', () => {
  const reading = detectPitchYin(makeTone(110, { harmonics: true }), 22050, { minFrequency: 40, maxFrequency: 400 });
  assert.ok(reading);
  assert.ok(Math.abs(reading.frequency - 110) < 0.2);
  assert.ok(reading.clarity >= 0.78);
});

test('YIN conserva la precisión de cuerdas graves con armónicos y ruido de fondo', () => {
  for (const note of ['A1', 'E2', 'A2', 'E4']) {
    const expectedFrequency = frequencyForMidi(midiForNote(note));
    const rate = 24000;
    const samples = new Float32Array(4096);
    let seed = 12345;
    for (let index = 0; index < samples.length; index++) {
      const phase = (2 * Math.PI * expectedFrequency * index) / rate;
      seed = (seed * 16807) % 2147483647;
      const noise = ((seed / 2147483647) * 2 - 1) * 0.015;
      samples[index] = 0.16 * Math.sin(phase) + 0.45 * Math.sin(2 * phase) + 0.08 * Math.sin(3 * phase) + noise;
    }
    const reading = detectPitchYin(samples, rate, {
      minFrequency: expectedFrequency * 0.68,
      maxFrequency: expectedFrequency * 1.65,
      minRms: 0.0015,
      analysisSize: samples.length,
    });
    assert.ok(reading, 'sin lectura para ' + note);
    assert.ok(Math.abs(centsBetween(reading.frequency, expectedFrequency)) < 2, 'desviación para ' + note);
  }
});

test('YIN descarta silencio y ruido sin periodicidad fiable', () => {
  assert.equal(detectPitchYin(new Float32Array(4096), 22050), null);
  let seed = 739391;
  const noise = new Float32Array(4096);
  for (let index = 0; index < noise.length; index++) {
    seed = (seed * 16807) % 2147483647;
    noise[index] = ((seed / 2147483647) * 2 - 1) * 0.2;
  }
  assert.equal(detectPitchYin(noise, 22050), null);
});

