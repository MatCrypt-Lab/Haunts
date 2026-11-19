# iOS parity: stop detection

## Goal
Bring iOS to parity with Android for background location, stop detection and the offline upload queue. Android is validated on the emulator; iOS is not yet.

## Evaluation
1. Replay the same recorded GPS trace on the Android emulator and the iOS simulator. Detected stops must match.
2. All existing tests stay green in CI. Add tests for iOS location permission flows (when-in-use, always, denied, reduced accuracy).
3. Privacy model unchanged: raw coordinates never leave the device. Any change that sends them is rejected.
4. Results, the trace comparison and agent mistakes are posted publicly in the build thread.

## Work items
- [ ] Record a reference GPS trace (walk with 5+ stops) and add it as a test fixture
- [ ] Trace replay harness that runs on both platforms
- [ ] iOS background location config (Info.plist keys, background modes)
- [ ] Verify the offline upload queue drains correctly after iOS app suspension
- [ ] Side-by-side recording of Android vs iOS stop detection
