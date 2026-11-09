# Install and try Haunts

All builds are on the [Releases page](https://github.com/MatCrypt-Lab/Haunts/releases). Pick the newest release and download the file for your device. Every build talks to the live Haunts server, so nothing else needs to run.

To sign in while email sign-in is not set up yet, use the demo account the Haunts team gives you (an email and a 6-digit code).

## Android phone

1. On the phone, open the Releases page and download the file ending in `.apk`.
2. Open the downloaded file. If Android asks, allow your browser or file manager to **install unknown apps**, then tap **Install**.
3. Open Haunts and sign in.

New versions install over old ones and keep your data.

## iPhone (free sideloading)

Apple only allows App Store and TestFlight apps without a computer. For free, you can install the `.ipa` with your own Apple ID using a computer and a sideloading tool. The app then runs for **7 days**; after that, install it again the same way (your data is kept).

You need: a Mac or Windows PC, a USB cable, and a free Apple ID. A secondary Apple ID is fine.

**With Sideloadly (simplest):**

1. Install [Sideloadly](https://sideloadly.io) on your computer. On Windows, also install iTunes and iCloud from Apple's website (not the Microsoft Store), as Sideloadly asks.
2. Download the file ending in `-unsigned.ipa` from the Releases page.
3. Plug in the iPhone, unlock it and tap **Trust This Computer**.
4. In Sideloadly, drag the `.ipa` onto the window, type your Apple ID email, and click **Start**. Enter your Apple ID password when asked.
5. On the iPhone, turn on **Settings → Privacy & Security → Developer Mode** and restart when asked (iOS 16 and newer).
6. On the iPhone, open **Settings → General → VPN & Device Management**, tap your Apple ID under Developer App, and tap **Trust**.
7. Open Haunts.

**With AltStore instead:** install AltServer on your computer and AltStore on the iPhone by following [altstore.io](https://altstore.io), then in AltStore open **My Apps → +** and choose the downloaded `.ipa`. AltStore can refresh the 7-day limit automatically when the phone and computer are on the same Wi-Fi.

Free Apple IDs can have 3 sideloaded apps at a time.

## Try it in a browser (no install)

If the Haunts team shared an **Appetize link**, open it on any computer or phone to use the app in a simulator inside the web page. Location is simulated, so you can still try Ask, the map and the crew features.

### For the Haunts team: publishing the Appetize demo

1. Create a free account at [appetize.io](https://appetize.io). The free plan has a limited number of demo minutes each month.
2. From the newest release, download `Haunts-<version>-ios-simulator.zip` (iPhone demo) and, if you want an Android demo too, the `.apk`.
3. In the Appetize dashboard, choose **Upload**, select the file (upload the `.zip` as it is; do not unzip it) and confirm the platform.
4. Open the app's settings in Appetize and make the link **public** so anyone with it can open the demo. Copy the public link.
5. Put the link in the README and on your CV. When a new release comes out, upload the new file to the **same** Appetize app (update), so the link stays the same.

In the demo, set a location in Bengaluru (Appetize has a location option, or use Koramangala: 12.9352, 77.6245) so nearby places and walks make sense.

## Making a new build

Maintainers: open the **Actions** tab on GitHub, choose **Build apps**, and click **Run workflow**. Pushing a tag such as `v0.2.0` does the same and marks the release as a full release instead of a pre-release. A build takes about 30 to 45 minutes.
