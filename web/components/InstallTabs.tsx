'use client';

import { useState } from 'react';
import { SITE } from '@/lib/site';

const TABS = {
  Android: [
    ['Download the APK', 'on your phone from the list on this page.'],
    ['Open it', 'and allow your browser to install unknown apps when Android asks, then tap Install.'],
    ['Sign in', 'with your email. Haunts sends you a 6-digit code.'],
    ['Allow location "All the time"', 'so the map keeps painting while the phone is in your pocket.'],
  ],
  iPhone: [
    ['Get Sideloadly', 'from sideloadly.io on a Mac or Windows PC (or use AltStore).'],
    ['Download the .ipa', 'and plug in your iPhone with a cable. Tap Trust This Computer.'],
    ['Drag the .ipa into Sideloadly', 'enter your Apple ID and press Start. A free Apple ID is fine.'],
    ['Trust the app', 'in Settings → General → VPN & Device Management, and turn on Developer Mode in Privacy & Security.'],
    ['Reinstall every 7 days', 'which is Apple’s limit for free sideloading. Your data is kept.'],
  ],
  Browser: [
    ['No install needed', 'when someone shares an Appetize link: the app runs in a phone simulator inside the web page.'],
    ['To make a link', 'create a free account at appetize.io and upload the -ios-simulator.zip (or the APK) as it is.'],
    ['Make it public', 'in the app’s settings on Appetize, then share the link.'],
    ['Set a location', 'in Bengaluru, for example Koramangala (12.9352, 77.6245), so nearby places make sense.'],
  ],
} as const;

type Tab = keyof typeof TABS;

export default function InstallTabs() {
  const [tab, setTab] = useState<Tab>('Android');
  return (
    <div>
      <div className="tabs" role="tablist" aria-label="Install on">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <button key={t} role="tab" id={`tab-${t}`} aria-selected={t === tab} aria-controls="install-panel" onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <ul className="steps-list" id="install-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {TABS[tab].map(([b, rest]) => (
          <li key={b}><span><b>{b}</b> {rest}</span></li>
        ))}
      </ul>
      <p className="muted" style={{ marginTop: 18, fontSize: 15 }}>
        Full guide with troubleshooting: <a href={`${SITE.repo}/blob/main/docs/INSTALL.md`} target="_blank" rel="noreferrer">docs/INSTALL.md</a>
      </p>
    </div>
  );
}
