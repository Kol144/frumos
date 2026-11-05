export const NOTE_CHOICES = [
  { name: 'C', pitchClass: 0 },
  { name: 'C#', pitchClass: 1 },
  { name: 'Db', pitchClass: 1 },
  { name: 'D', pitchClass: 2 },
  { name: 'D#', pitchClass: 3 },
  { name: 'Eb', pitchClass: 3 },
  { name: 'E', pitchClass: 4 },
  { name: 'F', pitchClass: 5 },
  { name: 'F#', pitchClass: 6 },
  { name: 'Gb', pitchClass: 6 },
  { name: 'G', pitchClass: 7 },
  { name: 'G#', pitchClass: 8 },
  { name: 'Ab', pitchClass: 8 },
  { name: 'A', pitchClass: 9 },
  { name: 'A#', pitchClass: 10 },
  { name: 'Bb', pitchClass: 10 },
  { name: 'B', pitchClass: 11 },
];

export const TUNINGS = [
  { id: 'standard-e', name: 'Standard E', strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'half-step-down', name: 'Half Step Down', strings: ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'] },
  { id: 'full-step-down', name: 'Full Step Down', strings: ['D2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
  { id: 'drop-d', name: 'Drop D', strings: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'drop-c', name: 'Drop C', strings: ['C2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
  { id: 'drop-b', name: 'Drop B', strings: ['B1', 'F#2', 'B2', 'E3', 'G#3', 'C#4'] },
  { id: 'drop-a', name: 'Drop A', strings: ['A1', 'E2', 'A2', 'D3', 'F#3', 'B3'] },
  { id: 'open-g', name: 'Open G', strings: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'] },
  { id: 'open-d', name: 'Open D', strings: ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'] },
  { id: 'open-a', name: 'Open A', strings: ['E2', 'A2', 'E3', 'A3', 'C#4', 'E4'] },
  { id: 'open-e', name: 'Open E', strings: ['E2', 'B2', 'E3', 'G#3', 'B3', 'E4'] },
  { id: 'dadgad', name: 'DADGAD', strings: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'] },
];

const PITCH_CLASSES = Object.fromEntries(NOTE_CHOICES.map(({ name, pitchClass }) => [name, pitchClass]));
const CHROMATIC_LABELS = ['C', 'C♯ / D♭', 'D', 'D♯ / E♭', 'E', 'F', 'F♯ / G♭', 'G', 'G♯ / A♭', 'A', 'A♯ / B♭', 'B'];

export function midiForNote(note, octave) {
  const match = /^([A-G](?:#|b)?)\s*(-?\d+)$/.exec(String(note).trim());
  if (!match) throw new RangeError('Nota no válida: ' + note);
  const pitchClass = PITCH_CLASSES[match[1]];
  if (pitchClass === undefined) throw new RangeError('Nota no válida: ' + note);
  return (Number(match[2]) + 1) * 12 + pitchClass;
}

export function frequencyForMidi(midi, concertA = 440) {
  return concertA * (2 ** ((midi - 69) / 12));
}

export function midiForFrequency(frequency, concertA = 440) {
  if (!Number.isFinite(frequency) || frequency <= 0) return null;
  return 69 + 12 * Math.log2(frequency / concertA);
}

export function noteForFrequency(frequency, concertA = 440) {
  const exactMidi = midiForFrequency(frequency, concertA);
  if (exactMidi === null) return null;
  const midi = Math.round(exactMidi);
  const pitchClass = ((midi % 12) + 12) % 12;
  return {
    midi,
    name: CHROMATIC_LABELS[pitchClass] + (Math.floor(midi / 12) - 1),
    cents: (exactMidi - midi) * 100,
    targetFrequency: frequencyForMidi(midi, concertA),
  };
}

export function detectPitchYin(samples, sampleRate, options = {}) {
  const minFrequency = Math.max(8, Number(options.minFrequency) || 30);
  const maxFrequency = Math.min(sampleRate / 2, Number(options.maxFrequency) || 1800);
  const threshold = Number(options.threshold) || 0.14;
  const minClarity = Number(options.minClarity) || 0.78;
  const minRms = Number(options.minRms) || 0.003;
  const analysisSize = Math.min(samples?.length || 0, Number(options.analysisSize) || 4096);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || analysisSize < 1024 || maxFrequency <= minFrequency) return null;

  let mean = 0;
  for (let i = 0; i < analysisSize; i++) mean += samples[i];
  mean /= analysisSize;

  let squareSum = 0;
  for (let i = 0; i < analysisSize; i++) {
    const centered = samples[i] - mean;
    squareSum += centered * centered;
  }
  const rms = Math.sqrt(squareSum / analysisSize);
  if (!Number.isFinite(rms) || rms < minRms) return null;

  const minTau = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const maxTau = Math.min(analysisSize - 2, Math.ceil(sampleRate / minFrequency));
  const compareSize = analysisSize - maxTau;
  if (maxTau <= minTau || compareSize < 512) return null;

  const difference = new Float64Array(maxTau + 1);
  const normalized = new Float64Array(maxTau + 1);
  let runningSum = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < compareSize; i++) {
      const delta = samples[i] - samples[i + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
    runningSum += sum;
    normalized[tau] = runningSum > 0 ? (sum * tau) / runningSum : 1;
  }

  let tauEstimate = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (normalized[tau] < threshold) {
      while (tau < maxTau && normalized[tau + 1] < normalized[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate < 0 || tauEstimate <= minTau + 1 || tauEstimate >= maxTau - 1) return null;

  const left = normalized[tauEstimate - 1];
  const middle = normalized[tauEstimate];
  const right = normalized[tauEstimate + 1];
  const denominator = 2 * (2 * middle - left - right);
  const offset = denominator === 0 ? 0 : (right - left) / denominator;
  const refinedTau = tauEstimate + Math.max(-1, Math.min(1, offset));
  const clarity = 1 - middle;
  const frequency = sampleRate / refinedTau;
  if (!Number.isFinite(frequency) || frequency < minFrequency || frequency > maxFrequency || clarity < minClarity) return null;
  return { frequency, clarity, rms };
}

export function centsBetween(frequency, targetFrequency) {
  if (!(frequency > 0) || !(targetFrequency > 0)) return NaN;
  return 1200 * Math.log2(frequency / targetFrequency);
}

