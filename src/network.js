// Networking for the shared ride (step 2: shared clock and departure) and
// for seeing each other (step 3: seat number, head and hand poses).
//
// Intentionally empty in step 1: the ride runs on LocalClock (clock.js) and
// the other passengers are simulated (simulated.js). The plan:
// - a small WebSocket relay outside GitHub Pages, one room per departure,
// - a clock source with the same interface as LocalClock,
// - incoming passenger poses in the data format described in passengers.js.

export function createNetwork() {
  return null;
}
