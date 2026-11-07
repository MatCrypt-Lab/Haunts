# Haunts Privacy Policy (draft)

*Draft for review by a lawyer before publication. Replace everything in square brackets. Written with India's Digital Personal Data Protection Act, 2023 and both app stores' requirements in mind.*

Last updated: [date]

[Company legal name] ("Haunts", "we") runs the Haunts app. This policy explains what we collect, why, and the choices you have.

## The short version

- Your phone turns your location into map blocks about 100 metres across. We store which blocks you have been in and on which days. We never store your exact location or your route.
- Nobody can see where you are right now. Your crew sees blocks from yesterday and earlier, never with times.
- Private zones you set, such as home, are never recorded, and they never leave your phone.
- Your private timeline of stops and places stays on your phone. If you back it up, it is encrypted with a code only you hold.
- The AI companion (Ask) uses your current map block, not your exact location. It can use your private timeline only when you allow it, and then only as a short summary your phone prepares. We do not keep your conversations.
- You can pause tracking, erase areas, download your data, or delete your account at any time, inside the app.

## What we collect

| Data | Why | Where it comes from |
|---|---|---|
| Email address | To sign you in and contact you about your account | You |
| Username and display name | To show you to your crew and on your cards | You |
| Map blocks you visited, with the day of each visit | To draw your map and compute progress, titles, territory and challenges | Your phone, from location |
| Crew, challenge and drop activity | To run those features | Your use of the app |
| Drops you leave (title, note, block) | To show them to people who explore that block | You |

| Questions you ask the AI companion, and photos you choose to send it | To answer you | You |

We do **not** collect your contacts, your photo library, recordings, or advertising identifiers, and we do not sell personal data. Photos are only sent when you take or pick one to ask about. Voice questions are turned into text by your phone's speech service (Google on most Android phones, Apple on iPhone) and only the text is sent to us.

## Location

The app uses your device's location, including in the background if you allow it, to reveal the map of places you visit even when the app is closed or not in use. On your phone, each location is converted to a block ID and the local date. Only those are sent to us. The single most recent location is kept on your phone to connect consecutive points, and is cleared when you pause tracking.

You can turn tracking off in the app (Me, Reveal my map) or in your phone's settings at any time.

## Your private memory

Haunts keeps a private timeline on your phone: where you stopped, when, for how long, the route you took, and names you give to places. It stays on your phone and is never sent to us in readable form.

If you turn on Memory backup, your phone encrypts the timeline with a recovery code that only you hold, and sends us the encrypted copy. We cannot read it and cannot recover it if you lose the code. You can delete the backup at any time in the app, and it is deleted with your account. Place names may be looked up using your phone's built-in map service (Google on most Android phones, Apple on iPhone).

## The AI companion

Ask, the walking guide, quests, the crew coach and paper, card captions, the journal and Wrapped use Claude, an AI model made by Anthropic. To answer you we send Anthropic your question, any photo you attach, your local time and the map block you are in (about 60 metres), plus game data such as your scores. Your private timeline is never sent in full: when a question needs it, your phone asks you first and then sends only a short summary, such as whether you have been to a few places or how many times you went somewhere this month. The journal and Wrapped send the stop names and times for that day or month, only when you tap the button.

We do not store your conversations. Short AI texts that are not private, such as stories about a street, quests and crew news, are kept for up to a few days so they load quickly, and are deleted with your account. To find places, routes and weather we query OpenStreetMap services (Overpass, Nominatim, Photon, OSRM) and Open-Meteo with a map block or a place you asked about, never with your identity.

You can turn the AI's access to your memory on or off in Me, AI, at any time.

## Who can see what

- **Everyone:** your username, crew name and colour, and titles shown on leaderboards.
- **Your crew:** your weekly block count, your total, and the combined crew map. The crew map excludes today and shows no dates or times.
- **Challenge teammates:** your username and score in that challenge.
- **People who explore a block where you left a drop:** the drop's title and note. Your name is not shown on community drops.
- **Service providers:** our hosting provider [name, region], database provider [name, region], email provider Resend, and Anthropic for the AI features, only to run the service.

## How long we keep data

We keep your data while your account exists. When you delete your account, we delete your profile, map blocks, daily records, crew membership, titles, challenge memberships and community drops immediately. Backups are overwritten within [30] days.

## Your rights

You can:

- **Access** your data: [support email], or the in-app export when available. The API endpoint `GET /me/export` returns everything we hold.
- **Correct** your username and name in the app.
- **Erase** areas from your map by adding a private zone, or delete everything with Me, Delete account.
- **Withdraw consent** for location by pausing tracking or changing phone settings.
- **Complain** to our Grievance Officer: [name], [email], [address]. We reply within [30] days. You can also approach the Data Protection Board of India.

## Children

Haunts is intended for people aged [18] and over. We do not knowingly collect data from children. If you believe a child has an account, contact us and we will delete it.

## Security

Connections are encrypted with HTTPS. Sign-in codes and session tokens are stored only as one-way hashes. Access to production data is limited to [roles].

## Changes

We will notify you in the app before material changes take effect.

## Contact

[Company legal name], [address], [support email].
