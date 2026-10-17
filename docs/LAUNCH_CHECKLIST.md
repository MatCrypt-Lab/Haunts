# Launch checklist

Work through this after the QA plan passes on real phones.

## 1. Identity and accounts

- [ ] Choose the final app name and check it is free on both stores and as a trademark in India. "Haunts" is a working name.
- [ ] Set `APP_BUNDLE_ID` to a reverse domain you own, for example `com.yourcompany.unfog`. It cannot change after the first store release.
- [ ] Google Play Console developer account (one-time fee).
- [ ] Apple Developer Program membership (yearly fee).
- [ ] Expo account for EAS builds: `npx eas-cli@latest login`, then `npx eas-cli@latest init` inside `mobile/` to link the project.
- [ ] A domain, for the API, the sign-in email sender, and hosting the privacy policy and terms.

## 2. Production backend

- [ ] PostgreSQL 13+ in the Mumbai region, with automated daily backups turned on.
- [ ] API container deployed over HTTPS. See the README section "Deploying".
- [ ] `NODE_ENV=production`, `OTP_PEPPER` (32+ random characters), `ADMIN_API_KEY` (24+ random characters).
- [ ] Resend account, sending domain verified with SPF and DKIM, `RESEND_API_KEY` and `EMAIL_FROM` set. Send yourself a code and check it lands in the inbox, not spam.
- [ ] `REVIEW_LOGIN_EMAIL` and `REVIEW_LOGIN_CODE` set for store reviewers.
- [ ] Uptime monitor on `/health`.
- [ ] Error tracking. Sentry is the usual choice for both Fastify and Expo; it is not wired in yet.
- [ ] `DEV_RETURN_OTP` is unset. The server refuses to start in production if it is set.

## 3. App configuration

- [ ] `EXPO_PUBLIC_API_URL` in the `preview` and `production` profiles of `mobile/eas.json` points at the HTTPS API.
- [ ] Review and refine the Bengaluru neighbourhood anchors in `packages/core/src/cities/bengaluru.ts` with local users, then regenerate stats.
- [ ] Replace the app icon and splash if the brand changes. Sources are generated PNGs in `mobile/assets/images`.
- [ ] Terms of service and privacy policy published at public URLs. Start from `docs/PRIVACY_POLICY.md` and have a lawyer review it.
- [ ] Link the policy and terms from the sign-in screen text in `mobile/src/app/sign-in.tsx`.

## 4. Google Play

Background location gets a separate review. Expect one or two rounds.

- [ ] Build: `npx eas-cli@latest build -p android --profile production` produces an `.aab`.
- [ ] Upload to an internal testing track first.
- [ ] **Permissions declaration form, location.** Core feature: "Reveals a personal map of the places the user visits by recording which ~100 m blocks they pass through, including while the app is closed." Explain that it cannot work with foreground-only location, because people do not keep the app open while walking or commuting.
- [ ] **Demo video, 30 seconds or less**, uploaded to YouTube as unlisted. Show the onboarding screen with the prominent disclosure, then both permission prompts, then the map filling in after walking with the app in the background.
- [ ] The in-app disclosure text must stay word for word: "Haunts collects location data to reveal the map of places you visit, even when the app is closed or not in use." It is in `mobile/src/app/onboarding.tsx`.
- [ ] **Data safety form:**
  - Location, approximate: collected, not shared, required, purpose "App functionality". Blocks are about 100 m.
  - Location, precise: processed on device for the private memory. The optional memory backup is end-to-end encrypted, which Play's guidance has treated as not collected. Confirm against the current Data safety help page before submitting.
  - Email address: collected, not shared, purpose "Account management".
  - User IDs: collected, purpose "App functionality".
  - Data encrypted in transit: yes. Users can request deletion: yes, in-app.
- [ ] Account deletion URL: Play asks for a web page explaining how to delete. Point it at a page that says "Me, then Delete account", plus a support email for people who no longer have the app.
- [ ] Content rating questionnaire. The app has user-generated drops, so answer yes to user interaction and mention reporting.
- [ ] Target audience: 18 and over is simplest. Including under-18s triggers the Families policy.

## 5. Apple App Store

- [ ] Build: `npx eas-cli@latest build -p ios --profile production`, then `npx eas-cli@latest submit -p ios`.
- [ ] **App Review notes:** "Haunts reveals a map of places the user visits. Background location ('Always') keeps the map filling in while the phone is in a pocket. Users can pause tracking in Me, add private zones that are never recorded, and delete their account in-app. Test login: email `<REVIEW_LOGIN_EMAIL>`, code `<REVIEW_LOGIN_CODE>`. The code field accepts it without an email being sent."
- [ ] Privacy nutrition label: Location (coarse) linked to the user for app functionality; Email linked to the user for account management. No tracking across other companies' apps.
- [ ] Screenshots for 6.7-inch and 6.1-inch iPhones: the map, the crew, and the story card.
- [ ] Age rating: user-generated content, with reporting available.

## 6. Before the Bengaluru seed (Phase 2 in the business plan)

- [ ] Tracking spike results recorded on three phones: battery per day, gaps per day, behaviour after swipe-away. Kill criterion: over 8% battery per day.
- [ ] Demo data removed from production. Never run `seed:demo` against it; the script refuses when `NODE_ENV=production`.
- [ ] Two or three run clubs and two campuses lined up, each with a crew created and its invite code ready.
- [ ] A dashboard or scheduled query for day-7 and day-30 retention. `GET /admin/stats` gives daily, weekly and monthly actives as a start.
- [ ] A support email address, shown in the store listings.

## 7. Not built yet

These are outside this codebase on purpose and come later in the roadmap:

- The paid tier. Memory is the paid use case: unlimited history, backup and yearly printed books or posters are the natural "Haunts+" features. Gate them only after billing exists.
- In-app purchases for cosmetics. Digital goods must go through Google Play Billing and Apple In-App Purchase. Use RevenueCat to keep it to one integration.
- Push notifications for weekly territory results and recaps. Use expo-notifications and store push tokens server-side.
- A web dashboard for brands and challenge organisers. The admin API covers it for now.
- Sign in with Apple and Google, and phone-number sign-in. Email codes work for launch. Apple requires Sign in with Apple only if you add other social logins.
- Direct "share to Instagram Stories" through Meta's API. The app uses the system share sheet, where Instagram offers Story.
