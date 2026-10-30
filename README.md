# Static: offline synthetic sound mixer

An Android-first PWA. No build system, dependencies, network requests, audio recordings, analytics, or account. Once the app has installed and cached its files, it works without internet access.

## Features

- Eight synthesised and independently mixable layers: **white**, **pink**, **brown**, **air**, **rain body**, **rain patter**, **waves** and **thunder**
- Five-band EQ on **each** layer, adjustable ±12 dB at 120 Hz, 500 Hz, 1.5 kHz, 4 kHz and 9 kHz
- Built-in Focus, Flight, Rain, Waves, Storm and White noise presets
- **Irregular wave and rain motion**: overlapping prime-duration cycles, slow cadence drift and smoothed random fluctuations. Wave intensity and tone move slightly out of phase, while rain varies more subtly. Motion is generated on the audio thread rather than browser timers.
- **Named personal presets**: save current mix, per-layer EQ, master volume and storm controls; tap a name to recall it; update/rename and delete
- **Backup/export** personal presets as JSON and import them again, entirely offline
- A procedural thunder generator with irregular events, echoes, rumble and a brighter close-up crack. Adjustable **distance** (near or distant) and **activity** (rare to frequent), plus **Try thunder** to hear an event on demand
- Stop timer with 18-second audio-clock fade, media session support and responsive layout
- Zero external assets or services

## Android setup

1. Host these files at the root of an **HTTPS** site. GitHub Pages is a straightforward option (project Settings > Pages > publish from main root). The included `.nojekyll` file disables Jekyll processing. No `npm install` or build command is needed.
2. Open the site in Android Chrome while online, and wait for **Offline ready**.
3. Use Chrome's **Install app / Add to Home screen** action.
4. Press Play and try Storm. Increase the Thunder mix level if necessary. Use **Try thunder** to generate an immediate event.
5. Enable aeroplane mode, reopen the installed app and verify it still plays offline. Test your Bluetooth headphones and screen-lock behaviour on your specific phone.

> PWA and AudioWorklet require a secure context (HTTPS or localhost), not `file://` or an ordinary HTTP LAN address.

## Personal presets and backups

**Save new** stores your mix and EQ under a name. Tapping the name reloads it. Make adjustments, then choose **Update / rename** to replace that preset (and optionally change its name), or **Save new** to create another variation. This does **not** include the stop timer, which is a playback-session control.

Presets live in browser localStorage on this device, *not GitHub*. Exporting creates a `static-personal-presets.json` file, so you can copy them to another phone or restore them if browser storage is cleared. Import merges by case-insensitive name and overwrites same-named saved presets. Keep the exported JSON as your backup. The app stores no personal data remotely.

Previous v2 mixer settings (`static.settings`) are automatically loaded. Older states simply get the new Thunder layer set to zero.

## Procedural thunder

`thunder-worklet.js` uses the AudioWorklet audio thread to produce an event with a brief crack, several filtered-noise rumble bursts, varying decay and stereo position. The next event is scheduled using processed **audio frames**, not browser timers; it therefore does not rely on frequent main-thread callbacks when the screen is locked. It is still subject to overall browser/audio context suspension.

The result is a **synthetic approximation** rather than realistic field-recorded thunder. Distance and activity affect the strike's sound and spacing; frequency shaping remains independent in the Thunder layer's EQ. Activity 0 disables automatic strikes; **Try thunder** can still be used when playing.

## Local development and tests

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

```bash
npm test   # only Node's built-in test runner; no dependencies
```

### Source files

- `index.html` and `styles.css`: accessible responsive player/mixer UI
- `app.js`: application state, playback controls, user presets, file import/export
- `config.js`: eight sound layer definitions, EQ bands and default mixes
- `personal-presets.js`: versioned, bounded and validated personal preset format
- `audio-engine.js`: Web Audio graph, live EQ, motion and master compressor
- `prime-motion-core.js` and `prime-motion-worklet.js`: testable irregular motion envelopes with three overlapping prime-duration swells and smooth, bounded randomness
- `noise-worklet.js`: coloured continuous noise sources
- `thunder-worklet.js`: event-based thunder synthesis
- `sw.js`: offline cache and update version

## Limitations and safety

- **Android background playback remains device/browser-dependent**. Use Chrome on Android, and test with your actual headphones, screen locked and aeroplane mode. If the browser suspends audio, a foreground-service-backed Android app might be needed later.
- Synthetic storm sound is experimental: realism and sound character need listening feedback.
- Filter gains are relative dB adjustments, not sound-pressure levels at the ear. Start with a low volume, especially for close thunder and headphones.
- For aircraft, white/pink/brown masking is subjective and does **not** replace hearing protection or active noise cancellation.
- Browsers can clear localStorage and service-worker caches. Export personal presets and verify the PWA can load offline **before** travelling.
- The stop timer tracks *audio-context playback time*. Suspended audio also suspends timer progress.
- A GitHub Pages website can be publicly accessible even when source repository is private. Keep any sensitive content out of published assets.

## V4 sound-motion notes

- Waves use nominal 11, 17 and 29 second periods. Their unmodified composite would only repeat after 5,423 seconds (about 90 minutes); small, slowly changing cadence drift means there is no exact repeating pattern. A delayed spectral envelope gives a gentle wash after each swell.
- Rain body uses 7, 13 and 31 second periods, while higher-frequency patter uses 5, 11 and 23 seconds. Their gain and tone variation is deliberately subtler than waves.
- Modulation uses smooth control signals in the AudioWorklet, with no random audio discontinuities or main-thread timer dependency. The underlying noise sources remain continuous and independently EQ-able.
- This is a sound-design iteration, not an acoustic simulation. Evaluate in headphones at a comfortable volume; the most useful feedback is whether the wave and rain patterns still sound mechanical.
