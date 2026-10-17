# Architecture

## The core idea in code terms

The world is divided into hexagonal blocks about 100 m across. A person's map is the set of blocks they have been in. Everything else is derived from that set and from which days each block was visited:

- **Exploration** is the share of a city's blocks you have ever visited.
- **Presence** is how many distinct blocks you visited on a given day. It drives territory, streaks, titles and challenges.

## Data flow

```
GPS fix (phone)
  -> filter: accuracy <= 100 m, speed <= 35 m/s, outside private zones
  -> fill the blocks between two close fixes (<= 400 m and <= 15 min apart)
  -> (block, local day) pairs stored in SQLite on the phone
  -> uploaded in batches of up to 1000
  -> server records new blocks and new block-days, updates rollups,
     awards Pioneer titles, and reports any drops found
```

Raw coordinates never leave the phone. The only coordinate stored on the phone is the most recent fix, kept so the next fix can be joined to it. It is cleared when tracking is paused.

### On the phone

| Piece | File |
|---|---|
| Background task, defined before the router loads | `mobile/index.ts`, `mobile/src/lib/location-task.ts` |
| Start, stop and permissions; live updates while the map is open | `mobile/src/lib/tracking.ts` |
| GPS-to-blocks rules, unit tested | `packages/core/src/tracking.ts` |
| Local store: revealed blocks, upload queue, settings | `mobile/src/lib/local-db.ts` |
| Upload queue, rewards from background uploads, pulling blocks on a new phone | `mobile/src/lib/sync.ts` |
| Private zones, kept only on the phone | `mobile/src/lib/zones.ts` |

Tracking uses expo-location's background updates at high accuracy, so fixes pass the 100 m accuracy filter and land in the right block. A 40 m distance filter and deferred delivery batch updates to save battery. On Android this runs as a foreground service with a persistent notification, which Android requires. While the map screen is open, a second watcher makes the reveal feel live. If the battery test shows more than 8% a day, switch `BACKGROUND_ACCURACY` in `mobile/src/lib/tracking.ts` to balanced and raise `TRACKING.maxAccuracyM` to 150.

Every app launch restarts the background service. This matters on Android, which restores the task after a reboot or app update but without its foreground service.

All location batches and private-zone changes run through one serial queue (`mobile/src/lib/serial.ts`), and all local database writes through another. A batch delivered late, after a newer fix, is recorded as its own trail rather than dropped.

Signing out uploads pending visits first. An expired session keeps the local queue so nothing is lost when the same person signs back in; the phone's data is wiped only when a different account signs in.

The upload queue flushes when 40 or more pairs are waiting, or 10 minutes after the last upload, and whenever the app comes to the foreground. Pairs older than 7 days are dropped, because the server rejects them.

**Known platform behaviour:** if the user swipes the app away, iOS and Android stop location updates until the app is opened again. The app is designed around a daily open: the reveal, the weekly card and the crew leaderboard. Some Android vendors also kill background services aggressively. The QA plan covers this.

**Swapping the tracking engine:** if battery or reliability tests disappoint, replace the body of `startTracking` and the task in `location-task.ts` with Transistor Soft's `react-native-background-geolocation`. Everything else takes plain fixes through `handleLocations`.

### On the server

| Piece | File |
|---|---|
| Visit ingestion: idempotent, serialised per user, daily cap, titles, drops | `server/src/services/visits.ts` |
| Stats, titles, monthly recap | `server/src/services/stats.ts` |
| Weekly territory | `server/src/services/territory.ts` |
| Crews | `server/src/services/crews.ts` |
| Drops | `server/src/services/drops.ts` |
| City-wars challenges | `server/src/services/challenges.ts` |
| Sign-in codes and sessions | `server/src/services/auth.ts` |
| Account deletion and data export | `server/src/services/account.ts` |
| Schema | `server/migrations/001_init.sql` |

## Private memory

The game only ever sees blocks and days. The memory is a second, richer record built from the same fixes, kept only on the phone.

| Piece | File |
|---|---|
| Stop detection, path simplification, polyline encoding, place matching (unit tested) | `packages/core/src/memory.ts` |
| Encrypted backup format, recovery codes (unit tested) | `packages/core/src/backup.ts` |
| Recording, stops, places, search, "on this day", backup and restore | `mobile/src/lib/memory.ts` |
| Screens | `mobile/src/app/(tabs)/memory.tsx`, `places.tsx`, `place/[id].tsx`, `place-new.tsx`, `memory-backup.tsx` |

How it works:

- Every fix that passes the tracking filters, and so lies outside private zones, is stored on the phone with its time.
- **Stops** are clusters of fixes within 100 m lasting at least 5 minutes. Background updates go quiet while the phone is still, so a stop usually looks like one fix followed by silence. It is assumed to last until the next fix, minus the time to walk there. A silence over 12 hours is never treated as a stop. Stops for the last 48 hours are recomputed as fixes arrive.
- **Places** are names the user gives to a spot. Every past and future stop within 80 m is grouped under it. Unnamed stops get a name from the phone's own geocoder, cached per block.
- **Day paths:** raw fixes are kept for 7 days, then simplified to about 15 m accuracy and stored as encoded polylines. A year of history is well under 1 MB.
- **Backup:** the phone generates a 160-bit recovery code, shown once as 32 characters. It gzips the memory, encrypts it with AES-256-GCM using a key derived from that code, and uploads the result. The server stores bytes it cannot read. Restoring on a new phone needs the code. Backups run daily when the app opens, and once more before sign-out.
- Signing out removes the memory from the phone. The app warns when backup is off.

## Cells, cities and neighbourhoods

- **Cells** are pointy-top hexagons on a Web Mercator grid with a 60 m circumradius in Mercator metres, about 58 m on the ground in Bengaluru. IDs are the axial coordinates as `"q_r"`. The phone and server compute them with the same pure function, so no lookup is needed. See `packages/core/src/hex.ts`.
- **Neighbourhoods** are defined by anchor points. A block belongs to the nearest anchor within 2.5 km. Bengaluru has 65 anchors covering 67,316 blocks, about 600 km². See `packages/core/src/cities/bengaluru.ts`.
- **City totals** are precomputed into `stats.generated.ts`. After editing anchors, run `npm run generate:city-stats -w @unfog/core`. A test fails if the file is stale.
- **Adding a city:** create a definition like `bengaluru.ts`, add it to `CITIES` in `packages/core/src/cities/index.ts`, regenerate stats, and ship a new app build. Blocks outside any city still count toward a person's total, but not toward city progress or territory.

## Privacy model

| Rule | How it is enforced |
|---|---|
| No raw location on the server | The phone uploads block IDs and dates only. The schema has no coordinate columns except a drop's own block. |
| Private zones never recorded | Filtered on the phone before storage, and again when blocks are pulled from the server. Lines are never drawn into or out of a zone. Zones never leave the phone. |
| Adding a zone erases the past | The phone computes the blocks inside the zone and asks the server to forget them by ID. |
| No live location for friends | The crew map hides any block first visited today, and returns no dates or times. |
| Drops do not reveal where people are | Hidden drops are shown only as a neighbourhood hint. |
| Delete means delete | Account deletion removes the user and cascades to every row they own, and removes their community drops. |
| Data access | `GET /me/export` returns everything stored about the user. |
| Private memory stays private | Times, routes, stops and place names never leave the phone except inside the encrypted backup. The server cannot decrypt it, and the key never leaves the user's devices. |
| Tokens and codes | Session tokens and sign-in codes are stored only as SHA-256 hashes. Sign-in codes expire in 10 minutes and allow 5 attempts. |

## Game rules

| Rule | Value | Where |
|---|---|---|
| Territory week | Monday to Sunday in city time (IST for Bengaluru) | `weekStart` in core |
| Territory owner | Crew with the highest summed presence in the neighbourhood that week. Ties go to the name that sorts first. Scores follow current crew membership. | `territory.ts` |
| Pioneer | First person to explore 25% of a neighbourhood's blocks. Permanent, freed only if they delete their account. | `visits.ts` |
| Local legend | Most presence in a neighbourhood this calendar month. Ties share it. | `stats.ts` |
| Crew size | Up to 20 members, one crew per person | `LIMITS` in core |
| Community drops | 3 per person per week, only in a block you have visited, hidden after 3 reports | `drops.ts` |
| Challenge score | Members' presence in the challenge city from start to end date, including days before a member joined | `challenges.ts` |
| Anti-abuse | At most 3,000 block-days per person per day; visits limited to the last 7 days and tomorrow; speed filter on the phone | `LIMITS`, `TRACKING` in core |

## API

All endpoints except `/health` and `/auth/*` need `Authorization: Bearer <token>`. Admin endpoints need `x-admin-key` instead. Errors look like `{"error": "code", "message": "Readable text"}`. Request and response types are in `packages/core/src/contracts.ts` and `packages/core/src/api-types.ts`.

| Method and path | Purpose |
|---|---|
| `GET /health` | Liveness and database check. |
| `POST /auth/otp/request` | Email a 6-digit sign-in code. Body `{email}`. |
| `POST /auth/otp/verify` | Exchange the code for a session. Body `{email, code}`. Returns `{token, user, isNew}`. |
| `POST /auth/logout` | Revoke the current session. |
| `GET /me` | Profile and crew summary. |
| `PATCH /me` | Update `username`, `displayName` or `cityId`. |
| `DELETE /me` | Delete the account permanently. |
| `GET /me/export` | Everything stored about the user. |
| `GET /me/cells` | All of the user's blocks as `[cell, firstDay]` pairs, for a new phone. |
| `POST /me/cells/forget` | Erase blocks by ID. Body `{cells}`. |
| `GET /me/stats` | Totals, city percentage, week, streak, per-neighbourhood progress. |
| `GET /me/titles` | Pioneer, territory and local-legend titles. |
| `GET /me/recap?month=YYYY-MM` | Monthly recap. |
| `PUT /me/memory-backup` | Store the encrypted memory backup. Body `{data}` in base64, up to 8 MB. |
| `GET /me/memory-backup` | Fetch it. Add `?meta=1` for size and date only. |
| `DELETE /me/memory-backup` | Delete it. |
| `POST /visits` | Upload `(cell, day)` pairs. Returns new blocks, found drops and new titles. |
| `POST /crews` | Create a crew. Body `{name, color}`. |
| `POST /crews/join` | Join with an invite code. Body `{code}`. |
| `POST /crews/leave` | Leave. Ownership passes to the longest-standing member. |
| `GET /crews/mine` | Crew, invite code, members and their weekly numbers. |
| `PATCH /crews/mine` | Owner only: rename, recolour, or rotate the invite code. |
| `DELETE /crews/mine/members/:id` | Owner only: remove a member. |
| `GET /crews/mine/map` | The crew's combined blocks with member counts, excluding today. |
| `GET /territory` | This week's owner of every neighbourhood, and the crew leaderboard. |
| `GET /drops` | Drops you have found, and hints for hidden ones in your city. |
| `POST /drops` | Leave a community drop. Body `{cell, title, note?}`. |
| `POST /drops/:id/report` | Report a drop. |
| `DELETE /drops/:id` | Delete your own drop. |
| `POST /challenges/join` | Join a city-wars team. Body `{code}`. |
| `GET /challenges/mine` | Your challenges with team standings. |
| `POST /challenges/:id/leave` | Leave a challenge. |
| `POST /admin/drops` | Place a venue or quest drop at a coordinate. |
| `POST /admin/challenges` | Create a challenge and its team codes. |
| `GET /admin/challenges/:id` | Challenge standings with join codes. |
| `GET /admin/stats` | Users, active users, crews and drops. |

### Rate limits

Signed-in traffic is limited per account to 300 requests a minute, and visit uploads to 60 a minute. Anonymous traffic is limited per IP. Sign-in limits per IP are deliberately generous, because many Indian mobile users share one carrier IP. Each email also has a database limit of 5 codes an hour and 5 attempts per code.

## Scaling notes

The schema handles the first tens of thousands of users on a small PostgreSQL instance. Watch these first:

- `user_cells` grows with each new block a person visits, not with time. A heavy user has a few thousand rows.
- `neighbourhood_days` adds a few rows per active user per day. Territory reads one week of it per request. Past about 100,000 weekly actives, cache `/territory` for a minute or precompute it hourly.
- `/crews/mine/map` returns up to 60,000 blocks. Past that, serve it as vector tiles.
