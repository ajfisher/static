// Frequencies are centre/turnover points for a per-layer five-band equaliser.
// These adjust relative gain in dB; they are not an absolute sound-pressure reading.
export const EQ_BANDS = [
  { label: '120 Hz', short: 'Low', frequency: 120, type: 'lowshelf' },
  { label: '500 Hz', short: 'Warmth', frequency: 500, type: 'peaking', q: 0.85 },
  { label: '1.5 kHz', short: 'Presence', frequency: 1500, type: 'peaking', q: 0.85 },
  { label: '4 kHz', short: 'Detail', frequency: 4000, type: 'peaking', q: 0.85 },
  { label: '9 kHz', short: 'Air', frequency: 9000, type: 'highshelf' }
];

export const STORM_DEFAULTS = { distance: 72, activity: 45 };

export const LAYERS = [
  {
    id: 'white', name: 'White', subtitle: 'Full-spectrum static', source: 'white',
    loudness: 0.85,
    filters: [{ type: 'highpass', frequency: 60 }, { type: 'lowpass', frequency: 15000 }]
  },
  {
    id: 'pink', name: 'Pink', subtitle: 'Softer, balanced texture', source: 'pink',
    loudness: 2.0,
    filters: [{ type: 'highpass', frequency: 38 }]
  },
  {
    id: 'brown', name: 'Brown', subtitle: 'Deep, low-frequency wash', source: 'brown',
    loudness: 1.65,
    filters: [{ type: 'highpass', frequency: 32 }]
  },
  {
    id: 'air', name: 'Air', subtitle: 'Soft ventilation-like hiss', source: 'white',
    loudness: 1.45,
    filters: [{ type: 'highpass', frequency: 430 }, { type: 'lowpass', frequency: 5400 }],
    motion: { base: 0.90, components: [{ rate: 0.058, depth: 0.045 }] }
  },
  {
    id: 'rainBody', name: 'Rain body', subtitle: 'Variable, low rainfall texture', source: 'pink',
    loudness: 1.65,
    filters: [{ type: 'highpass', frequency: 85 }, { type: 'lowpass', frequency: 1700, motionSweep: 220 }],
    motion: { type: 'prime', style: 'rain', periods: [7, 13, 31], base: 0.76, depth: 0.18 }
  },
  {
    id: 'rain', name: 'Rain patter', subtitle: 'Irregular, fine-grain rainfall', source: 'white',
    loudness: 1.45,
    filters: [{ type: 'highpass', frequency: 850 }, { type: 'lowpass', frequency: 11000, motionSweep: 1200 }],
    motion: { type: 'prime', style: 'rain', periods: [5, 11, 23], base: 0.82, depth: 0.14 }
  },
  {
    id: 'thunder', name: 'Thunder', subtitle: 'Irregular cracks and rolling low rumble', source: 'thunder',
    loudness: 1.6,
    filters: [{ type: 'highpass', frequency: 28 }, { type: 'lowpass', frequency: 2500 }]
  },
  {
    id: 'waves', name: 'Waves', subtitle: 'Overlapping, irregular swells', source: 'pink',
    loudness: 2.2,
    filters: [
      { type: 'highpass', frequency: 55 },
      { type: 'lowpass', frequency: 850, motionSweep: 420 }
    ],
    motion: { type: 'prime', style: 'waves', periods: [11, 17, 29], base: 0.20, depth: 1.10 }
  }
];

export const PRESETS = [
  {
    id: 'focus', label: 'Focus', description: 'A balanced wash for working',
    mix: { white: 0, pink: 68, brown: 37, air: 20, rainBody: 0, rain: 0, waves: 0, thunder: 0 },
    eq: { pink: [1, 0, -2, -2, -3], brown: [0, -2, 0, 0, 0] }
  },
  {
    id: 'flight', label: 'Flight', description: 'Low and mid-frequency masking',
    mix: { white: 9, pink: 62, brown: 83, air: 34, rainBody: 0, rain: 0, waves: 0, thunder: 0 },
    eq: { pink: [3, 2, -2, -3, -4], air: [0, -1, 0, -2, -4] }
  },
  {
    id: 'rain', label: 'Rain', description: 'Blend low rainfall with bright patter',
    mix: { white: 0, pink: 8, brown: 0, air: 0, rainBody: 58, rain: 75, waves: 0, thunder: 0 },
    eq: { rainBody: [2, 3, -2, -4, -5], rain: [-3, -2, 0, 2, 3] }
  },
  {
    id: 'waves', label: 'Waves', description: 'Slow synthetic swells',
    mix: { white: 0, pink: 10, brown: 14, air: 0, rainBody: 0, rain: 0, waves: 95, thunder: 0 }
  },
  {
    id: 'storm', label: 'Storm', description: 'Layered rain with rolling synthetic thunder',
    mix: { white: 0, pink: 5, brown: 0, air: 16, rainBody: 60, rain: 64, waves: 0, thunder: 62 },
    eq: { rainBody: [2, 2, -2, -4, -5], rain: [-3, -2, 0, 2, 3], thunder: [3, 2, -2, -5, -8] },
    storm: { distance: 74, activity: 52 }
  },
  {
    id: 'plain', label: 'White noise', description: 'Even, full-spectrum noise',
    mix: { white: 75, pink: 0, brown: 0, air: 0, rainBody: 0, rain: 0, waves: 0, thunder: 0 }
  }
];

export function blankEQ() {
  return Object.fromEntries(LAYERS.map(layer => [layer.id, EQ_BANDS.map(() => 0)]));
}

export function presetEQ(preset) {
  const result = blankEQ();
  for (const [id, bandGains] of Object.entries(preset.eq || {})) {
    if (Object.hasOwn(result, id)) result[id] = [...bandGains];
  }
  return result;
}
