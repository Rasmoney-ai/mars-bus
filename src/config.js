// All tunable constants live here, so the ride can be matched to the
// classroom and the comfort limits can be adjusted in one place.
// Units: metres, seconds, degrees (where noted).

// --- Comfort limits (non-negotiable, see CLAUDE.md) ----------------------
export const COMFORT = {
  maxSpeed: 4.0,            // m/s (about 15 km/h)
  maxAccel: 0.3,            // m/s^2, 0 -> 4 m/s takes ~13 s
  maxDecel: 0.3,            // m/s^2
  maxTurnRateDeg: 10,       // degrees per second
  maxLateralAccel: 0.6,     // m/s^2, extra limit in curves
  planningMargin: 0.9,      // plan below the limits to leave headroom
  smoothingSeconds: 2.5,    // speed-profile smoothing (removes jerks)
  // Comfort mode: the bus waits at the stop, then fades to black and in
  // again at the next stop, arriving at the same moment as everyone else.
  fadeOutSeconds: 1.5,
  blackSeconds: 1.0,
  fadeInSeconds: 1.5,
};

// --- Seats: 10 seats, 5 rows of 2 with a centre aisle ---------------------
// The seat positions (0.9 m between rows, 1.5 m across the aisle) are fixed
// by the bus model in src/marsBus.js.
export const SEATS = {
  count: 10,
  seatHeight: 0.42,         // top of the cushion above the bus floor (from the model)
  // Where the head sits relative to the seat centre (forward is -z).
  headOffsetZ: 0.02,
  // Eye height above the bus floor, seated. In VR your head is moved to this
  // height when you enter and when you recenter with the Meta button, since
  // the headset's own floor height is often off by 10-30 cm when seated.
  eyeHeight: 1.08,
  autoEyeHeight: true,
  // One helmet colour per seat (seat 1 first).
  colors: [
    '#e53935', '#fb8c00', '#fdd835', '#7cb342', '#00a88f',
    '#29b6f6', '#3f51b5', '#9c27b0', '#ec407a', '#eceff1',
  ],
  colorNames: [
    'rød', 'orange', 'gul', 'grøn', 'turkis',
    'lyseblå', 'blå', 'lilla', 'lyserød', 'hvid',
  ],
};

// --- Bus -------------------------------------------------------------------
export const BUS = {
  // Seat backs lowered to this share of the model's height, so pupils can
  // see out ahead over the seat in front.
  seatBackScale: 0.72,
};

// --- Timeline --------------------------------------------------------------
export const TIMELINE = {
  introSeconds: 14,         // welcome (speak) before the countdown
  countdownSeconds: 5,      // 5-4-3-2-1, then departure
  defaultStopSeconds: 25,
  finalStopSeconds: 25,     // hold at the base before "Turen er slut"
  tableStep: 0.02,          // resolution of the precomputed motion table
};

// --- Narration (speak) -----------------------------------------------------
// One sound file per part of the ride, named in src/route.js. Missing files
// are simply skipped, so the ride also works without them.
export const NARRATION = {
  folder: 'audio/speak/',
  // Seconds from the start of a part until its speak begins, so it does not
  // talk over the signal at departure and the chime at each stop.
  delay: { start: 0.5, drive: 1.5, stop: 2.5 },
  volume: 0.45,
  // The guide sounds like a small loudspeaker in the ceiling of the bus,
  // above and a little ahead of your seat.
  speaker: {
    height: 2.05,           // above the bus floor (m)
    ahead: 0.45,            // in front of your head (m)
    highpass: 480,          // small speaker: no deep bass (Hz)
    lowpass: 3900,          // ... and no bright top (Hz)
    presence: { freq: 1900, gain: 7 }, // a nasal "tannoy" colour (Hz, dB)
    drive: 0.35,            // slight crackle of a small speaker (0 = clean)
    reverb: 0.3,            // share of cabin echo
  },
  // Re-align the speak with the ride time if it drifts more than this (s).
  resyncSeconds: 0.3,
};

// --- World -----------------------------------------------------------------
export const WORLD = {
  seed: 1976,               // fixed seed: the landscape is the same every time
  skyTop: '#b98760',
  skyHorizon: '#dcb68e',
  fogNear: 40,
  fogFar: 1500,
  sunElevationDeg: 38,
  sunAzimuthDeg: 215,       // compass-style, 0 = north (-z), 90 = east (+x)
  terrainSpacing: 5.5,      // grid spacing near the route (m)
  terrainOuterHalf: 2400,   // terrain reaches past the fog everywhere
  roadWidth: 5.0,
};

// --- Render / performance --------------------------------------------------
export const RENDER = {
  foveation: 1.0,           // 0 = none, 1 = maximum fixed foveated rendering
  near: 0.08,
  far: 3200,
  maxPixelRatio: 2,         // desktop only
};
