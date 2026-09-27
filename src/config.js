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
// Match these to the chairs in the classroom.
export const SEATS = {
  count: 10,
  rows: 5,
  rowPitch: 0.85,           // distance between rows (front to back)
  seatHeight: 0.42,         // top of the cushion above the bus floor
  seatWidth: 0.48,
  backHeight: 0.46,         // seat back above the cushion (low, so you can see out)
  aisleWidth: 0.62,
  // Where the head sits relative to the seat centre (forward is -z).
  headOffsetZ: 0.08,
  // Eye height above the floor, used on desktop and for simulated passengers.
  eyeHeight: 1.12,
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

// --- Bus geometry (bus-local: x right, y up, -z forward) ------------------
export const BUS = {
  floorY: 1.05,             // cabin floor above the ground
  interiorWidth: 2.3,
  interiorHeight: 2.3,
  frontSpace: 1.35,         // from row 1 seat centre to the front glass
  rearSpace: 0.65,          // from row 5 seat centre to the rear wall
  windowSill: 0.72,         // above the floor
  windowTop: 1.85,
  windshieldBottom: 0.62,
  windshieldTop: 1.95,
  wheelRadius: 0.42,
};

// --- Timeline --------------------------------------------------------------
export const TIMELINE = {
  introSeconds: 5,          // welcome text before the countdown
  countdownSeconds: 5,      // 5-4-3-2-1, then departure
  defaultStopSeconds: 25,
  finalStopSeconds: 20,     // hold at the base before "Turen er slut"
  tableStep: 0.02,          // resolution of the precomputed motion table
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
