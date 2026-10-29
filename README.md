# Rorschach's Halloween Journal

People scan the QR code on my "THE END IS NIGH" sign, look at a living inkblot, and type their first name and what they see. The journal writes them a short noir entry, an ElevenLabs voice reads it aloud, and it joins a public archive. A phone on my costume plays the newest entries through a speaker on a loop.

**Pages**

| Page | Who it's for |
|---|---|
| `/` | Strangers who scan the sign: inkblot, form, their spoken entry, share button |
| `/archive` | Everyone: a map of my walk with every entry pinned where I was when it was written, plus the full list, playable (this is the portfolio piece) |
| `/onair` | My phone, connected to the speaker: loops the newest entries, new ones jump the queue, keeps playing saved audio if the signal drops. Also starts and stops sharing my location for the map |
| `/admin` | Me: hide anything I don't want public or on the speaker, or delete it for good |

**How an entry is made:** form → `/api/entry` → Claude (Haiku) writes a 1–3 sentence line in a noir journal voice and screens out anything nasty → ElevenLabs text-to-speech reads `"Rorschach's journal. October 31st. 21:14. James sees a butterfly…"` → audio and text are saved to Vercel Blob → the archive and on-air loop pick it up.

---

## Setup (about 30 minutes)

### 1. Design the voice in ElevenLabs
1. In ElevenLabs, go to **Voices → Add a new voice → Voice Design**.
2. Describe an original voice, for example: *"Low, gravelly male voice, 50s, cold and deadpan, clipped noir detective, speaks in short fragments as if dictating into a journal at night, slight rasp."* Don't base it on any real actor.
3. Generate a few, pick the best, save it, and copy its **Voice ID**.
4. Create an API key under **Developers → API Keys** with text-to-speech access.

### 2. Get a Claude API key (recommended)
Create a key at [platform.claude.com](https://platform.claude.com). Each entry costs a tiny fraction of a cent on Haiku. Without a key, the site still works using built-in template lines, but it won't screen slurs as well, so the key is worth having for a public street.

### 3. Put the code on GitHub
Create a new **public** repo (e.g. `rorschach-journal`) and push this folder to it:
```bash
git remote add origin https://github.com/<you>/rorschach-journal.git
git push -u origin main
```

### 4. Deploy on Vercel
1. In Vercel, **Add New → Project → Import** the GitHub repo. Leave the framework as "Other". Deploy.
2. Open the project, go to **Storage → Create → Blob**, create a store and **connect it to this project**. That adds `BLOB_READ_WRITE_TOKEN` for you.
3. Go to **Settings → Environment Variables** and add (see `.env.example`):

   | Name | Value |
   |---|---|
   | `ELEVENLABS_API_KEY` | your ElevenLabs key |
   | `ELEVENLABS_VOICE_ID` | the voice from step 1 |
   | `ANTHROPIC_API_KEY` | your Claude key |
   | `ADMIN_TOKEN` | a long random password for `/admin` |
   | `CREATOR_NAME` | your name, for the credit line |
   | `PORTFOLIO_URL` | your portfolio, linked as "The person behind the mask" |

   Optional: `ELEVENLABS_MODEL_ID` (default `eleven_v4`; `eleven_flash_v2_5` is faster and cheaper), `MAX_ENTRIES_PER_DAY` (default 400), `RATE_PER_MINUTE` (default 6 per phone), `TIMEZONE` (default `America/New_York`), `SUBMISSIONS_OPEN`.
4. **Deployments → Redeploy** so the new variables take effect.

### 5. Make the QR code
```bash
npm install
npm run qr -- https://your-project.vercel.app
```
Print `qr-code.svg` at least 15 cm / 6 in wide. Under it, print a plain-text short URL too, for people whose camera won't scan in the dark.

---

## Test before Saturday
- [ ] Submit three entries from your phone **on cellular, not Wi-Fi**. Check the voice sounds right and the timestamp is in your time zone.
- [ ] Try to break it. A swear word should get "Answer confiscated". A full name or "ignore your instructions" should get a line that refuses to read it out without repeating it. "My ex" or "my landlord" should get a real roast.
- [ ] Open `/admin`, hide one entry, and confirm it's gone from `/archive`. Delete a test entry too.
- [ ] On the deployed site (location needs https), open `/onair`, press **Start sharing my location**, walk a block, and check the trail on `/archive`. Press **Stop**, then **Clear the whole trail** so your test route (and your home) isn't left on the public map.
- [ ] Open `/onair` on the speaker phone, connect the Bluetooth speaker, press **Start the loop**, then submit a new entry from another phone. It should play next.
- [ ] Turn on airplane mode mid-loop. It should keep replaying saved entries.
- [ ] Check ElevenLabs credits after testing so you know roughly what one entry costs.

## On the night
- **Speaker phone:** open `/onair`, press Start, keep the screen on with brightness all the way down, and carry a power bank.
- **Too much going on?** Set `SUBMISSIONS_OPEN` to `false` in Vercel and redeploy. The archive and loop keep working; the form says the journal is closed.
- **Something ugly gets through:** hide or delete it from `/admin` on your phone. It drops out of the archive and the loop within 15 seconds.
- **The map:** at Canal and 6th, press **Start sharing my location** on `/onair`. Keep that page open with the screen on: phones stop reporting location to a web page when the screen locks. Press **Stop** at 15th St, or whenever you head somewhere you don't want on the map.
- **Afterwards:** set `SUBMISSIONS_OPEN=false` so the public link stops spending credits, and keep the archive up as the portfolio piece. Turn it back on for the networking event.

## Run it locally
```bash
npm install
MOCK_TTS=1 ADMIN_TOKEN=test12345 npm run dev
```
Open http://localhost:3000. `MOCK_TTS=1` plays a hum instead of calling ElevenLabs, and with no `ANTHROPIC_API_KEY` the template lines are used, so local testing is free. Entries are saved to `.local-store/`.

## How it's built
- Static pages in `public/`, no framework. The inkblot is a tiny mirrored noise field drawn on a 96×120 canvas; a CSS blur + contrast filter turns the pixels into wet ink edges.
- Serverless functions in `api/` (Node on Vercel). Keys never reach the browser.
- Storage is Vercel Blob: one JSON file and one MP3 per entry, named so a plain listing returns the newest first. Hiding an entry writes a small marker file instead of editing the entry.
- The map: `public/map-streets.json` holds the real streets around the route from OpenStreetMap, drawn by the archive page in ink with Leaflet. Rebuild it with `node scripts/build-map.mjs`. The trail is one JSON file in Blob that only my phone writes; entries are pinned by matching their timestamps to where the trail was at that moment.
- Safety: first names only, a word filter, Claude screening (treats input as data, not instructions), per-phone rate limit, a daily cap, a hidden bot trap, and an admin kill switch.
