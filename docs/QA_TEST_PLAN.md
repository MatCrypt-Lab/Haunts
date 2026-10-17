# QA test plan

Run this on at least one Android phone and, if available, one iPhone. Use a development build (`npx expo run:android`) against your local or staging API. Mark each line pass or fail and note the phone model and OS version.

## Setup

- [ ] API running and `curl <api>/health` returns `{"ok":true}` from the phone's network. On a phone, open `<api>/health` in the browser to check.
- [ ] Demo data seeded (`npm run seed:demo -w @unfog/server`). Note the printed crew and challenge codes.
- [ ] App installed. Expo Go will not work.

## 1. Sign in and onboarding

- [ ] Enter an email. The code screen shows "Development code: 123456".
- [ ] A wrong code shows "That code is not right." Five wrong codes lock the code.
- [ ] The correct code moves to "Pick your handle".
- [ ] A taken username shows "That username is taken." A valid one moves on.
- [ ] The location screen shows the disclosure card before any prompt.
- [ ] "Allow location" shows the system prompt. Allowing shows "Allowed".
- [ ] Android: "Allow all the time" opens settings; choose "Allow all the time" and return. iOS: choose "Change to Always Allow".
- [ ] "I'm at home, blur it" adds a zone. "Start exploring" opens the map.
- [ ] Kill and reopen the app. It goes straight to the map, signed in.

## 2. Map and tracking

- [ ] The map loads the dark basemap with a dim overlay, centred near you.
- [ ] The top-right badge says "Tracking". Android shows a persistent "Haunts is revealing your map" notification.
- [ ] Walk 200 m with the map open, or play `docs/test-routes/koramangala-walk.gpx` in the emulator. Blocks appear along the route within seconds.
- [ ] The top-left number and "+N this week" increase after an upload. Pull to refresh on Me forces it.
- [ ] Put the app in the background and walk another 500 m, or keep the route playing. Reopen: those blocks are there.
- [ ] Lock the phone for 10 minutes while moving. Reopen: blocks from that time are there.
- [ ] Walk past home. No blocks appear inside the home zone, and the trail does not cross it.
- [ ] Airplane mode while walking: blocks still appear on the map. Turn it off and reopen: the queue uploads ("blocks waiting to upload" in Me drops to 0).
- [ ] Me, then turn "Reveal my map" off. The badge says "Paused" and the Android notification disappears. Walking adds nothing. Turn it back on.
- [ ] Swipe the app away from recents, walk, reopen. Record whether blocks were recorded while it was swiped away. This is the known platform limit; note it per phone.

## 3. Crew and territory

- [ ] Crew tab: join a demo crew with its code. Members and weekly numbers show.
- [ ] Share the invite: the share sheet opens with the code and an `unfog://join/CODE` link.
- [ ] On a second phone, open the link. It joins the crew.
- [ ] Map, then Crew: crew blocks show; blocks two members share are brighter with a white outline. Blocks visited today are not shown until tomorrow.
- [ ] Map, then Territory: neighbourhood labels show owner crew names in crew colours.
- [ ] As owner: "New code" changes the code. Long-press a member, then remove them.
- [ ] Leave the crew as owner: ownership passes to another member.

## 4. Drops

- [ ] Map shows a "1 hidden drop" ring near Koramangala (from demo data).
- [ ] Walk or simulate into that block. A banner says "Demo Cafe drop found". A yellow dot appears; tapping it shows the details.
- [ ] Flag button: "Leave a drop" shows your neighbourhood. Leave one. It appears as a dot; tapping it offers Delete.
- [ ] Inside the home zone, the flag button says drops cannot be placed there.
- [ ] Leave a fourth drop in a week: "You can leave 3 drops a week."

## 5. Card

- [ ] Card tab shows your blocks painted in crew colour with the percentage or block count.
- [ ] "Share card" opens the share sheet with a 1080 by 1920 image. Instagram, then Story, posts it.

## 6. Memory

- [ ] Stay somewhere for 10 minutes, then walk away 300 m. Open Memory: a stop appears with start and end times and a street or area name.
- [ ] In the emulator, play the GPX route, pause it for 10 minutes at a point, then resume. A stop appears at the pause point.
- [ ] The day map shows the route as a line and each stop as a dot.
- [ ] Tap "Name it" on a stop, name it "Test Cafe" with an icon. The stop now shows the name, and past stops within 80 m join it.
- [ ] All places lists Test Cafe with its visit count and total time. Its page shows every visit.
- [ ] Search "test" finds Test Cafe. Search part of a street name finds unnamed stops on that street.
- [ ] Use the arrows to move between days. Next is disabled on today.
- [ ] Nothing appears inside a private zone, and no stop is created there.
- [ ] Memory backup: create a recovery code, copy it, confirm saved, turn on. "Backed up and encrypted" shows a time.
- [ ] Sign out (the warning mentions the backup), sign in again, open Memory backup: "Restore your memory" appears. A wrong code says it does not unlock the backup. The right code brings back places and stops.
- [ ] Check the database to confirm the server cannot read the backup: `SELECT encode(substring(blob from 1 for 16), 'escape') FROM memory_backups;` shows `UFB1` then random bytes.

## 7. Me, recap, privacy, challenges

- [ ] Me shows city percentage, totals, week, streak and neighbourhood progress bars.
- [ ] Monthly recap shows new blocks, city percentage change and top neighbourhoods. "Previous" goes back to the signup month.
- [ ] Private zones: add "Work" where you are. The alert reports how many blocks were erased, and they disappear from the map.
- [ ] Crew tab, then Open city wars: join with a demo challenge code. Team standings show; "Leave challenge" works.

## 8. Account

- [ ] Sign out returns to sign-in and stops tracking (no notification).
- [ ] Sign back in on the same phone: onboarding asks for permissions and zones again, then your blocks reload from the server.
- [ ] Delete account: confirm. You return to sign-in. Signing in with the same email creates a fresh, empty account.

## 9. Battery spike (Phase 0)

Run for three full days on three phones, normal daily life, tracking on.

| Phone | OS | Battery used by Haunts per day | Gaps noticed | Swipe-away behaviour |
|---|---|---|---|---|
| | | | | |

Read battery use from Settings, then Battery, per app. Kill criterion from the business plan: over 8% per day.
