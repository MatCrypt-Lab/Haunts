# Haunts

Your private memory of everywhere you have been, with a game on top if you want one.

- **Memory, the everyday use:** Unfog quietly records where you stopped and for how long. Search "that cafe from March", name your places, see every visit, and get "a year ago today" moments. It stays on your phone, with an optional end-to-end encrypted backup so it survives a new phone. This is what people pay for.
- **The game, the flex:** your city map starts black and living your life colours it in. Crews of friends fight for neighbourhoods every week, brands hide drops in the streets, and every Sunday you get a card worth posting to your Story.

This repository contains the complete product:

| Folder | What it is |
|---|---|
| `packages/core` | Shared TypeScript used by both server and app: the hex grid, Bengaluru neighbourhoods, day and week rules, privacy zones, the GPS-to-blocks pipeline, and API contracts. |
| `server` | The API. Node 20+, Fastify, PostgreSQL 13+. |
| `mobile` | The Android and iOS app. Expo SDK 57, React Native 0.86, MapLibre. |
| `docs` | Architecture, launch checklist, QA test plan, privacy policy draft, an emulator test walk. |

## What is verified and what is not

Verified on the build machine:

- 49 unit tests for the shared core and 34 integration tests for the API against a real PostgreSQL database all pass.
- TypeScript passes for all three packages, and Expo lint passes for the app.
- `expo-doctor` passes all 21 checks.
- The app's JavaScript bundles build for Android and iOS.
- `expo prebuild` generates valid Android and iOS projects with the right permissions, background modes and foreground service.
- The production server bundle boots and serves a full sign-in, visits, crew and territory flow over HTTP.

Not verified, because the build machine has no Android SDK, Xcode or running Docker:

- Compiling and running the native app on a device or emulator.
- Building the Docker image. Its install, build and run steps were reproduced outside Docker and work.

Your first test on the other laptop is therefore the first native run. The QA plan in `docs/QA_TEST_PLAN.md` walks through it.

## Run it locally

### 1. Prerequisites

- Node.js 22.12 or newer. Some dependencies, including the test runner, no longer support Node 20.
- PostgreSQL 13 or newer, or Docker.
- For the app: Android Studio with an emulator or a phone with USB debugging. Android Studio includes the JDK it needs. For iOS you need a Mac with Xcode.

### 2. Install

```bash
cd unfog
npm install
```

### 3. Start the database and API

With a local PostgreSQL:

```bash
createdb unfog_dev
cp server/.env.example server/.env      # defaults point at unfog_dev
npm run server:migrate
npm run server:dev                      # http://localhost:8080
```

Or with Docker, which runs PostgreSQL and the API together:

```bash
docker compose up --build               # http://localhost:8080
```

Check it is up:

```bash
curl http://localhost:8080/health
```

In development the API returns the sign-in code in its response, and the app shows it on screen. You do not need email set up to test.

### 4. Optional: demo data

Fills the database with five demo users, two crews, a week of walks, a sponsor drop and a city-wars challenge, so the crew, territory and challenge screens have something to show.

```bash
npm run seed:demo -w @unfog/server
# After signing in once in the app, add yourself to a demo crew:
npm run seed:demo -w @unfog/server -- you@example.com
```

The script prints crew invite codes and challenge team codes you can type into the app.

### 5. Run the app

Point the app at your API. A phone cannot reach `localhost` on your laptop, so use the laptop's LAN IP address.

```bash
cd mobile
cp .env.example .env
# Edit EXPO_PUBLIC_API_URL:
#   physical phone on the same Wi-Fi:  http://<your-laptop-LAN-IP>:8080
#   Android emulator:                  http://10.0.2.2:8080
#   iOS simulator:                     http://localhost:8080
```

Build and install the development app. The first build takes several minutes.

```bash
npx expo run:android        # emulator or USB-connected phone
npx expo run:ios            # Mac only
```

After the first build, start the JavaScript server on its own for fast reloads:

```bash
npm start
```

Expo Go cannot run this app because it needs background location and MapLibre. Always use the development build above.

#### No Android Studio? Build in the cloud

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile development
```

EAS emails you a link to an APK you install on your phone. Set `EXPO_PUBLIC_API_URL` for each profile in `mobile/eas.json` first.

### 6. Simulate a walk in the Android emulator

Open the emulator's Extended Controls, then Location, then Routes. Import `docs/test-routes/koramangala-walk.gpx` and press play. Keep the map tab open to watch blocks reveal live. Press the home button and blocks keep arriving through the background service.

## Tests

```bash
createdb unfog_test           # once
npm test                      # core unit tests and API integration tests
npm run typecheck             # all three packages
cd mobile && npx expo lint
```

The API tests use `postgres://localhost:5432/unfog_test` by default. Set `TEST_DATABASE_URL` to use another database. The tests drop and recreate its schema, so never point it at real data.

## Configuration

### Server (`server/.env`)

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. |
| `DATABASE_SSL` | managed DBs | `true` for Neon, Supabase, RDS and similar. |
| `NODE_ENV` | yes | `production` enables the strict checks below. |
| `OTP_PEPPER` | production | At least 32 random characters, used to hash sign-in codes. Generate with `openssl rand -hex 32`. |
| `RESEND_API_KEY` | production | Sends sign-in emails through Resend. Without it, codes go to the log. |
| `EMAIL_FROM` | production | Sender address on a domain verified in Resend. |
| `ADMIN_API_KEY` | for admin | At least 24 characters. Unlocks `/admin` endpoints. |
| `REVIEW_LOGIN_EMAIL`, `REVIEW_LOGIN_CODE` | for store review | A fixed email and 6-digit code for App Store and Play reviewers. |
| `DEV_RETURN_OTP` | dev only | Returns the code in the API response. Refused when `NODE_ENV=production`. |
| `MIGRATE_ON_START` | no | Defaults to `true`. Set `false` to run `npm run migrate:prod` separately. |
| `TRUST_PROXY` | no | Defaults to `true` in production, for correct client IPs behind a load balancer. |

### App (`mobile/.env` or `eas.json` profiles)

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | API base URL. If it starts with `http://`, Android allows plain-HTTP traffic for that build. Use `https://` for anything you distribute. |
| `EXPO_PUBLIC_MAP_STYLE_URL` | Optional MapLibre style. Defaults to OpenFreeMap's free dark style, which needs no key. |
| `APP_BUNDLE_ID` | Android package and iOS bundle ID. Change `app.unfog.mobile` to one you own before publishing. |

## Running the business side: admin API

All admin calls need the `x-admin-key` header.

Place a sponsor drop. Anyone who walks into that block finds it.

```bash
curl -X POST https://api.example.com/admin/drops \
  -H "x-admin-key: $ADMIN_API_KEY" -H "content-type: application/json" \
  -d '{"lat":12.9719,"lng":77.6412,"title":"Free cold brew today","note":"Show this at the counter","kind":"venue","sponsor":"Third Wave","endsAt":"2026-11-01T00:00:00Z"}'
```

Create a city-wars challenge for a company or college. The response contains one join code per team to hand out.

```bash
curl -X POST https://api.example.com/admin/challenges \
  -H "x-admin-key: $ADMIN_API_KEY" -H "content-type: application/json" \
  -d '{"name":"Startup City Wars","cityId":"blr","startsOn":"2026-11-03","endsOn":"2026-11-30","teams":[{"name":"Acme","color":"#FF5A5F"},{"name":"Globex","color":"#4D7CFE"}]}'
```

Check a challenge leaderboard, or overall numbers:

```bash
curl -H "x-admin-key: $ADMIN_API_KEY" https://api.example.com/admin/challenges/<id>
curl -H "x-admin-key: $ADMIN_API_KEY" https://api.example.com/admin/stats
```

## Deploying

The API is a single container plus PostgreSQL. A low-cost setup is Render, Railway or Fly.io for the container and Neon or Supabase for PostgreSQL, ideally in the Mumbai region.

1. Create a PostgreSQL 13+ database and note its connection string.
2. Build and deploy the image from the repository root with `docker build -t unfog-api .`
3. Set the production variables from the table above, including `NODE_ENV=production`.
4. Point a domain such as `api.yourdomain.com` at it with HTTPS.
5. Put that URL in the `preview` and `production` profiles in `mobile/eas.json`.

Migrations run automatically on start and are safe with several instances.

Then build the store apps:

```bash
cd mobile
npx eas-cli@latest build -p android --profile production
npx eas-cli@latest build -p ios --profile production
```

Before submitting, work through `docs/LAUNCH_CHECKLIST.md`. Google Play reviews background location separately and needs a demo video.

## Further reading

- `docs/ARCHITECTURE.md`: data flow, privacy model, scoring rules and the full API.
- `docs/LAUNCH_CHECKLIST.md`: everything between "it runs" and "it is in the stores".
- `docs/QA_TEST_PLAN.md`: step-by-step device test plan.
- `docs/PRIVACY_POLICY.md`: a draft to adapt with a lawyer.
