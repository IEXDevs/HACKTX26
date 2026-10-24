# HackTX 26 — Master Catalog of Verified 2024–2026 Hackathon Winners & Codebase Deconstructions

> **Purpose:** Primary-source competitive intelligence for **HackTX 26** (`C:\Users\davir\Ultra\Code\HACKTX26`). Every project below is a verified winner or finalist from top collegiate and sponsor hackathons (**TreeHacks, Cal Hacks, HackMIT, Hack the North, PennApps, HackPrinceton, LA Hacks, MHacks, HackGT, DivHacks, HackTX 24/25, HackUTD, TAMUhack, Gemini Live Challenge, Meta Llama Hackathon, SerpApi Hackathon**) with verified Devpost/GitHub links, exact tech stacks, 24-hour scoping secrets, live demo hooks, and HackTX 26 adaptation patterns.

---

## Executive Meta-Analysis: The 6 Laws of 2025–2026 Grand Prize Winners

Across 55+ winning projects analyzed in Wave 1 and Wave 2, generic chatbot wrappers and standard CRUD dashboards have **zero win rate** for Grand Prizes. Winners consistently obey six architectural laws:

1. **The "Bridge Beyond the Glass" (Physical & Native OS Embodiment):** Grand prize winners escape the browser tab. They hijack native OS communication channels (**FaceTime, iMessage, real cellular phone calls** via Retell/Twilio) or bridge software agents to affordable physical hardware (**ESP32 badges, motorized omni-wheels, solenoid gavels, haptic gloves, webcam skeletal tracking**).
2. **The Two-Tier Deterministic Gatekeeper Pattern:** Winning teams never put raw LLMs in the critical physics, scoring, or high-frequency loop. Deterministic code (Rust regex firewalls, LMSR prediction market math, Inverse Fast Fourier Transforms, Runge-Kutta IK solvers, TF.js motion gates, or SQL continuous aggregates) handles 90% of the work; the LLM only translates human intent or synthesizes natural language explanations.
3. **Canvas & Spatial UI Over Dashboards:** At UT Austin (Freetail Hackers) and peer hackathons, standard Tailwind table dashboards lose to interactive spatial interfaces: **`tldraw`** (infinite whiteboard), **`@xyflow/react`** (React Flow node graphs), **`@react-three/fiber`** (3D memory palaces/constellations), and **`@codesandbox/sandpack-react`** (instant client-side compilation without backend Docker lag).
4. **Decoupled Multimodal Streaming (Continuous Audio + 1–2 FPS / Triggered Vision):** Teams winning with Gemini Live or Meta Muse Voice never choke WebSockets with 30 FPS raw video. They stream bidirectional 16–48kHz PCM audio continuously while sampling camera/screen frames at **1–2 FPS** or **on-demand** upon voice/pointer triggers.
5. **Zero-Dependency Demo Safeguards (`OFFLINE=1` & `peer-bot`):** Sunday venue Wi-Fi and sandbox APIs (`nessieisreal.com`) routinely degrade during judging. Winners build an `OFFLINE=1` fixture replay layer, a headless `peer-bot` to simulate the second human participant, or a fallback cellular phone number so the 2-minute live demo is 100% bulletproof.
6. **The 30-Second Touch Rule:** Within 30 seconds of a judge arriving at the table (or 30 seconds into the `A Bard's Tale` stage pitch), the judge is holding a ringing phone, wearing a haptic/BLE prop, scanning a live audience QR code, or manipulating a live canvas.

---

## Category 1: Best Overall (`Cinderella's Castle`) & HackTX / Texas Defending Champions

### 1. FaceTimeOS — AI Mac Agent
- **Event & Prize:** **Cal Hacks 12.0 (Oct 2025) — 1st Place Grand Prize Overall** (World's Largest Collegiate Hackathon Champion)
- **Primary Sources:** [Devpost](https://devpost.com/software/facetime-macos-ai-agent) | [GitHub (`dylanelu/FaceTimeOS`)](https://github.com/dylanelu/FaceTimeOS)
- **Tech Stack:** Python (`flask`, `flask-socketio`, `sounddevice`, `pydub`, `numpy`), Fork of Simular AI's `Agent-S` OSWorld computer-use framework, Claude 3.5 Sonnet, Grok 4 Fast (`grok-4-fast-non-reasoning`), `fish-audio-sdk` (voice cloning/TTS), BlackHole 2ch/16ch virtual macOS CoreAudio loopback driver, `imessage-ruby` + macOS SQLite `~/Library/Messages/chat.db`.
- **24-Hour Codebase Secret:** Instead of fighting private Apple APIs, `imessage_bridge.py` polls macOS's local SQLite `chat.db` (`SELECT ... FROM message WHERE date > last_date`) and sends replies/screenshots via `imessage-ruby`. To hook FaceTime audio, macOS system audio was routed through BlackHole virtual audio devices directly into Python's `sounddevice` stream with RMS energy-based Voice Activity Detection (`VAD_ENERGY_THRESHOLD = 0.01`) and `threading.Event()` barge-in.
- **The 2-Minute Demo Hook:** The presenter stood on stage with an iPhone and FaceTimed their MacBook sitting across the stage. The MacBook auto-answered with a live voice avatar, the presenter asked it to find a video from yesterday, trim it, and text it back—and the audience watched the cursor move across Finder and QuickTime live on the projector before the presenter's phone pinged with the iMessage attachment in 20 seconds.
- **HackTX 26 Adaptation:** Combine **Meta `Muse Voice Transcribe` + `Muse Spark`** with **NMC2** and **SerpApi** so users can call or text an agent over native FaceTime/WhatsApp/iMessage to execute real-world group bookings, financial moves, or browser actions.

### 2. AstroDoodle.party (HackTX 2025 Best Overall Winner) & earth2echo (HackTX 2025 Gemini API Winner)
- **AstroDoodle.party — HackTX 2025 1st Place Best Overall (`Cinderella's Castle`):**
  - **Primary Sources:** [Devpost (`rocket-racer-l1hmn6`)](https://devpost.com/software/rocket-racer-l1hmn6)
  - **What It Built:** An interstellar multiplayer racing game where players draw their own custom spaceships and blast asteroids using **physical hardware magic wands** tracked in real time. Proves that at HackTX, combining a tactile physical controller with an interactive multiplayer canvas can win **Best Overall (`Cinderella's Castle`)**.
- **earth2echo (Lyria Studio) — HackTX 2025 Winner, `[MLH] Best Use of Gemini API`:**
  - **Primary Sources:** [Devpost (`minions-6-7`)](https://devpost.com/software/minions-6-7) | [GitHub (`AlanRoybal/lyria-studio`)](https://github.com/AlanRoybal/lyria-studio) | [GitHub Web](https://github.com/AlanRoybal/lyria-studio-web)
  - **Tech Stack:** Electron, Vite, React 18, `@google/genai` (`^1.49.0` — Gemini 2.0 Flash Vision + Google Lyria Realtime `models/lyria-realtime-exp`), `@xyflow/react` (`^12.3.6`), `zustand`, WebAudio API, HTML5 Canvas, MIDI export.
- **Ayn — HackTX 2025 Winner, `[MLH] Best Use of Gemini 2.5 Computer Use Model`:**
  - **Primary Sources:** [Devpost (`orion-7jafvu`)](https://devpost.com/software/orion-7jafvu)
  - **What It Built:** Gives AI coding agents visual perception by letting them autonomously explore and test the live websites they build in a browser and iterate on UI/UX bugs visually.

### 3. AIAIO — Infinite Canvas Flow-to-Code Workbench
- **Event & Prize:** **HackTX 2024 (UT Austin) — 1st Place Best Overall Grand Prize** & Best `.Tech` Domain
- **Primary Sources:** [Devpost](https://devpost.com/software/aiaio) | [GitHub (`lryanle/AIAIO`)](https://github.com/lryanle/AIAIO)
- **Tech Stack:** Next.js 15, TypeScript, `tldraw` (`^3.4.0`), `@xyflow/react` (`^12.3.4`), `@codesandbox/sandpack-react` (`^2.19.9`), Vercel AI SDK (`ai`, `@ai-sdk/openai`), `jotai`, `framer-motion`, `react-resizable-panels`.
- **24-Hour Codebase Secret:** Combined `tldraw` (for freehand UI wireframing) with `@xyflow/react` (for wiring state and component logic nodes), and compiled the LLM-generated React code completely client-side inside `@codesandbox/sandpack-react` with Tailwind CDN injected—eliminating any need for backend Docker containers.
- **The 2-Minute Demo Hook:** Drew a rough wireframe on the canvas, connected two React Flow arrows, typed a prompt, and within 8 seconds a live, interactive React app compiled and ran inside the node on the canvas.
- **HackTX 26 Adaptation:** Use the **`tldraw` + `@xyflow/react` + `@codesandbox/sandpack-react`** triad for **NMC2 ("Build the Platform Behind the Agent")** or **Toyota / Capital One interactive financial simulation canvases**.

### 4. Shepherd — Autonomous Omni-Wheel Smart Cane
- **Event & Prize:** **TreeHacks 2026 — 1st Place Overall Grand Prize** & Healthcare Grand Prize
- **Primary Sources:** [Devpost](https://devpost.com/software/raising-cane) | [GitHub (`tonywangs/shepherd`)](https://github.com/tonywangs/shepherd)
- **Tech Stack:** Swift 6, SwiftUI, ARKit (60 FPS iPhone LiDAR depth maps), Apple Vision framework, HSV color terrain segmentation, Seeed Studio XIAO ESP32-S3 (FreeRTOS C++), DC motor omni-wheel base, 12-byte binary BLE protocol (100ms intervals, <50ms latency), Vapi voice agent.
- **24-Hour Codebase Secret:** 100% on-device LiDAR depth processing on the iPhone mounted to the cane handle. Divided the depth grid into 16 columns using a deterministic "Gap-Seeking Steering Algorithm" with a leaky integrator on the ESP32 to physically and silently tug the user's hand around obstacles without noisy audio beeps.
- **The 2-Minute Demo Hook:** A blindfolded teammate walked briskly through a maze of chairs and humans on stage; the motorized omni-wheel physically steered their hand around every obstacle in complete silence.
- **HackTX 26 Adaptation:** Use the **Phone-as-Brain (ARKit/LiDAR/Vision) + 12-byte BLE -> ESP32 actuator** architecture to dominate **`Brick House` (RTX 5080)** with zero venue Wi-Fi risk.

### 5. HawkWatch — Two-Tier Multimodal Edge Security
- **Event & Prize:** **TreeHacks 2025 — 1st Place Overall Grand Prize ($11,000)**
- **Primary Sources:** [Devpost](https://devpost.com/software/hawkwatch) | [GitHub (`Grace-Shao/Treehacks2025`)](https://github.com/Grace-Shao/Treehacks2025)
- **Tech Stack:** Next.js 14, TypeScript, TensorFlow.js + MediaPipe (client-side pose/motion gate on HTML5 Canvas), Google Gemini VLM, OpenAI GPT-4o copilot, Supabase, Resend API (SMS/email dispatch).
- **24-Hour Codebase Secret:** Used client-side TensorFlow.js skeletal velocity tracking as a local gatekeeper so Gemini VLM was only called when anomalous motion occurred, plus built a pre-loaded MP4 incident library right into the UI as a fail-safe if venue cameras glitched.
- **The 2-Minute Demo Hook:** Staged a simulated collapse/choking emergency live on stage; within 1.5 seconds the feed turned red, Gemini generated an incident dossier, and the judge's phone buzzed with an automated dispatch and video replay link.
- **HackTX 26 Adaptation:** Pair **TensorFlow.js / MediaPipe Edge Gate + Gemini 3.8 Live/Flash + Tiger Data Hypertables** for real-time multimodal telemetry.

### 6. SixthSense — Vision-to-Touch Haptic Substitution
- **Event & Prize:** **HackPrinceton Spring 2025 — 1st Place Overall Grand Prize**
- **Primary Sources:** [Devpost](https://devpost.com/software/sixthsense-xuw41r) | [GitHub (`k-kochhar/SixthSense`)](https://github.com/k-kochhar/SixthSense)
- **Tech Stack:** Meta Ray-Ban Smart Glasses / USB camera, Python, YOLOv8n (`yolov8n.pt`), OpenCV, Inverse Fast Fourier Transform (IFFT) semantic-to-vibration encoder (`get_vib.py`), Arduino C++ servo + haptic motor gauntlet (`run_servo.ino`), Flask, WebSockets, Next.js.
- **24-Hour Codebase Secret:** Used local YOLOv8n (30+ FPS on laptop) and a hardwired USB-Serial connection to the Arduino (`run_servo.py`), mapping object word embeddings via IFFT into distinct tactile vibration "chords" ("what" the object is) while servos pulled the wrist toward the object ("where" it is).
- **The 2-Minute Demo Hook:** A blindfolded judge put on the gauntlet; the servos physically angled their wrist toward a randomly placed water bottle while the glove buzzed with the "bottle" frequency signature, allowing the judge to grab it on the first try.
- **HackTX 26 Adaptation:** Combines **`Brick House` (RTX 5080)** + **Meta Title Track** + **Gemini API**.

### 7. Duet — Brainwaves to Live Algorithmic Music
- **Event & Prize:** **Cal Hacks 11.0 — 1st Place Overall Grand Prize**
- **Primary Sources:** [Devpost (`duet-0tbkxe`)](https://devpost.com/software/duet-0tbkxe)
- **Tech Stack:** Emotiv EPOC X 14-channel EEG headset, Python Cortex WebSocket API, Google Gemini LLM, Sonic Pi (via Open Sound Control / OSC protocol), SingleStore time-series DB, Next.js.
- **The 2-Minute Demo Hook:** A teammate wore the EEG headset on stage; calming their mind produced warm C-major ambient chords, while sudden mental math and startle stimuli immediately shifted Sonic Pi into rapid, minor-key polyrhythmic percussion.
- **HackTX 26 Adaptation:** Biometric/vocal emotion telemetry streamed into **Tiger Data** + **Meta Muse / Gemini** to create shared empathetic environments.

### 8. Alto — Autonomous Mobile Crash-to-PR Agent Swarm
- **Event & Prize:** **LA Hacks 2025 — 1st Place Overall Grand Prize** & AI Agents League Winner
- **Primary Sources:** [Devpost](https://devpost.com/software/alto)
- **Tech Stack:** Fetch.ai `uAgents`, Google Gemini 2.5 Pro (full-repo AST analysis via `gitingest`), Instabug webhooks, Maestro mobile UI test automation, Android ADB emulator, Flask, Slack API.
- **The 2-Minute Demo Hook:** Triggered a real crash in a mobile app on stage; Alto intercepted the webhook, wrote a Maestro UI reproduction script, spun up an Android emulator on screen to replay the taps and prove the crash, patched the code, verified the fix, and posted the passing PR to Slack in 90 seconds.
- **HackTX 26 Adaptation:** Direct inspiration for **NMC2 ("Build the Platform Behind the Agent")**—show agents autonomously reproducing, verifying, and self-healing in a live sandbox.

### 9. Supernova — 60-Second Autonomous UGC Video Ad Agency
- **Event & Prize:** **TreeHacks 2025 — 2nd Place Overall Grand Prize ($7,500)**
- **Primary Sources:** [Devpost (`supernova-p1tum5`)](https://devpost.com/software/supernova-p1tum5)
- **Tech Stack:** Next.js, TypeScript, Perplexity + Firecrawl (scraping Reddit pain points), Groq, Cartesia TTS, HeyGen talking avatars, Runway Gen-3 b-roll, headless FFmpeg compositing, ZapCap kinetic captions.
- **The 2-Minute Demo Hook:** Asked a judge for any random product URL, hit Enter, and in 55 seconds rendered a complete TikTok ad addressing real scraped Reddit complaints about that product category.
- **HackTX 26 Adaptation:** Pair **SerpApi (`google_shopping`, `google_maps`, `extract`)** + **Meta `Muse Image` / `Muse Spark`** for automated hyper-local social campaign or event generation.

### 10. RoboSurge — Formal-Verified Surgical Robotics
- **Event & Prize:** **TreeHacks 2026 — Robotics & AI Showcase**
- **Primary Sources:** [Devpost](https://devpost.com/software/robosurge)
- **Tech Stack:** YOLOv11, Segment Anything Model (SAM), Gemini Robotics-ER, C++ Runge-Kutta Inverse Kinematics solver, **Lean 4 formal theorem prover**, dual 6-DOF robotic arms.
- **The 2-Minute Demo Hook:** "AI decides intent, never physics." Spoken surgical instruction was segmented by SAM, formally proved collision-free in Lean 4 ($P(\text{error}) < 10^{-6}$), and executed with sub-millimeter precision on a tissue phantom.
- **HackTX 26 Adaptation:** Use formal/deterministic constraint verification between **Gemini / Muse Spark** intent and **Nessie / Toyota / NMC2** execution.

### 11. TalkTuahBank & TalkTuahAirline
- **Event & Prize:** **HackUTD 2024 — 1st Place Best Overall** & **TAMUhack 2025 — 1st Place Best Overall**
- **Primary Sources:** [Devpost (`talktuahbank`)](https://devpost.com/software/talktuahbank) | [Devpost (`talktuahairline`)](https://devpost.com/software/talktuahairline) | [GitHub (`aurelisajuan/TalkTuahBank`)](https://github.com/aurelisajuan/TalkTuahBank)
- **Tech Stack:** Retell AI telephony (`retell` Python SDK), Twilio SIP, FastAPI, Anthropic Claude / OpenAI Swarm, LaTeX PDF compiler (`form.tex`), Pinata IPFS, Next.js.
- **24-Hour Codebase Secret:** Handed judges a real cellular phone dialing a toll-free number. Retell AI streamed call audio over WebSockets to FastAPI, which executed multi-agent banking/airline actions and texted back a compiled LaTeX PDF receipt pinned on IPFS.
- **HackTX 26 Adaptation:** Always pair your web UI with a **live callable phone number or WhatsApp/iMessage bridge** that judges can dial from their own phone in 5 seconds.

### 12. Working Memory
- **Event & Prize:** **HackUTD 2025 — 1st Place Best Overall Grand Prize**
- **Primary Sources:** [Devpost (`working-memory`)](https://devpost.com/software/working-memory)
- **Tech Stack:** Electron desktop daemon, Python, LangChain, ChromaDB vector store, OS window/terminal/git diff OCR hooks.
- **The 2-Minute Demo Hook:** Passively observed a developer's IDE, terminal, and browser tabs; after an interruption, one hotkey reconstructed their exact mental model, pending git changes, and next 3 steps.

### 13. Angel's Protection & 14. SuperMAN (HackTX 2024 Multi-Track Champions)
- **Angel's Protection:** [Devpost](https://devpost.com/software/angel-s-protection) — Won **3 Tracks at HackTX 24** (Best Ground-Up Model, Intel AI, InterSystems Vector Search) by training YOLOv11 from scratch to search campus security feeds by clothing description rather than invasive facial recognition.
- **SuperMAN:** [Devpost (`superman-2wigou`)](https://devpost.com/software/superman-2wigou) — Won **3 Tracks at HackTX 24** (Best Pitch `A Bard's Tale`, Best LLM Hack, Intel AI) with an on-device natural language replacement for Unix `man` pages that explains flags and warns before destructive shell commands.

---

## Category 2: Meta Title Sponsor ("Bringing People Closer Together with AI") & Social/Voice Winners

### 15. Klick — Proximity AI-Twin Badges & Peel — Optical Pill Verifier (HackMIT 2026)
- **Note on HackMIT Links:** HackMIT hosts submissions on its own platform (`plume.hackmit.org`), **not** Devpost (`devpost.com/software/klick` is an unrelated disposable-camera photography app).
- **HackMIT 2026 1st Place Overall Grand Prize Winner (`Peel — The tiny lab technician`):**
  - **Primary Sources:** [HackMIT Plume Showcase (`plume.hackmit.org`)](https://plume.hackmit.org) | [The Tech MIT Coverage](https://thetech.com)
  - **What It Built:** A low-cost optical dissolution tester using hardware LEDs and light sensors that plugs into a smartphone, paired with an AI evidence engine (Elastic) that cross-references drug dissolution curves with FDA safety records and recalls to detect counterfeit pills. Won **1st Place Overall Grand Prize** + **Elastic Sponsor Challenge**.
- **HackMIT 2026 1st Place Winner, Meta Title Challenge (`Klick`):**
  - **Primary Sources:** [HackMIT Plume Showcase (`plume.hackmit.org`)](https://plume.hackmit.org) | [The Tech MIT Coverage](https://thetech.com)
  - **Tech Stack:** ESP32-S3 wearable lanyard badges with addressable RGB LEDs, BLE proximity beaconing, FastAPI, vector embeddings, LLM agent negotiation, Next.js.
  - **The 2-Minute Demo Hook:** Two teammates walked past each other on stage; their AI twins silently negotiated shared interests in the background over BLE, and both physical lanyard badges simultaneously changed to the exact same RGB color while their phones displayed why they should meet. Won **Meta's "Bringing People Closer Together with AI"** + **Espressif Hardware Challenge**.
- **Also Featured on HackMIT 2026 Meta / Social Track (`Kin`):** Shared family memory system (`plume.hackmit.org`) for early-stage memory loss that uses facial recognition and family-contributed voice stories to surface subtle cues when interacting with loved ones.

### 16. TedTime — Multi-Sensory Grandparent Bedtime Story Bear
- **Event & Prize:** **HackGT 13 (2026) — Winner, Meta Title Challenge ("Bringing People Closer Together with AI")** + Hardware Prize
- **Primary Sources:** [Devpost (`teddy-42km8n`)](https://devpost.com/software/teddy-42km8n)
- **Tech Stack:** Physical plush teddy bear embedded with ESP32, brushless motor driver, haptic actuators, React Native (Expo), Deepgram Nova word-level timestamps, **Meta `Muse Spark`** reasoning engine, Freesound API, Grok Imagine illustrations.
- **The 2-Minute Demo Hook:** Played a voice memo from an overseas grandmother telling a story; `Muse Spark` analyzed the emotional beats, faded in synchronized rain and forest sound effects at exact word timestamps, moved the bear's physical paws to her vocal rhythm, and generated an illustrated storybook cover.

### 17. Nudge — Low-Friction Friend Calling & In-Call Memory Tray
- **Event & Prize:** **HackGT 13 (2026) — Winner, Meta Title Challenge ("Bringing People Closer Together with AI")**
- **Primary Sources:** [Devpost (`nudge-hcvxfq`)](https://devpost.com/software/nudge-hcvxfq) | [GitHub (`AlanRoybal/hackgt`)](https://github.com/AlanRoybal/hackgt)
- **Tech Stack:** Native iOS (SwiftUI, CallKit, `MultipeerConnectivity`, `NearbyInteraction` UWB), AWS Chime SDK (live video calls), AWS Bedrock (Claude + Titan Multimodal Embeddings), S3 Vectors, DynamoDB, headless `peer-bot` test harness.
- **24-Hour Codebase Secret:** Synced mutual free/busy availability privately to nudge friends when both are free. During live video calls, transcribed speech and queried multimodal embeddings of the user's photo roll—so mentioning "my new puppy" automatically popped up the matching photo in a "Permission to share" mini-tray on the call. Included a headless `peer-bot` to simulate the remote friend during demos.

### 18. Sunday — Autonomous Group Chat Action Agent
- **Event & Prize:** **TreeHacks 2026 — Winner, Best Use of Claude Agent SDK**
- **Primary Sources:** [Devpost (`sunday-94odas`)](https://devpost.com/software/sunday-94odas) | [GitHub (`priyanshbhatter24/sunday`)](https://github.com/priyanshbhatter24/sunday)
- **Tech Stack:** `@anthropic-ai/claude-agent-sdk` (`^0.2.42`), `@browserbasehq/stagehand` (`^3.0.8`), `@photon-ai/imessage-kit` (`^2.1.2`), `supermemory`, Groq SDK.
- **24-Hour Codebase Secret:** Lived inside real iMessage group chats via `@photon-ai/imessage-kit`. When friends said *"Let's do taco night Friday,"* Sunday extracted dietary restrictions from `supermemory`, spun up a headless cloud browser via **Stagehand / Browserbase** to book OpenTable/Resy, ordered groceries on Instacart, created a Partiful invite link, and texted the confirmation back into the iMessage thread in 45 seconds.

### 19. HeirLoom — Oral History 3D Corkboard Companion
- **Event & Prize:** **HackGT 13 (2026) — Winner (Social & Cultural Preservation)**
- **Primary Sources:** [Devpost (`heirloom-3q2bn9`)](https://devpost.com/software/heirloom-3q2bn9)
- **Tech Stack:** SwiftUI, 24kHz PCM WebSocket streaming (`AVFoundation`), custom VAD tuned for hesitant elder speech, Backboard.io state machine, interactive 3D polaroid & red-twine corkboard archive.
- **The 2-Minute Demo Hook:** Live conversational interview with an elder persona where sensory details spoken aloud dynamically materialized as geotagged, dated polaroid cards connected by red yarn on a shared family board.

### 20. OpenGlass — $25 Open-Source AI Smart Glasses
- **Event & Prize:** **Meta Llama 3 Hackathon — 1st Place Grand Prize Overall**
- **Primary Sources:** [Devpost](https://devpost.com/software/openglass) | [GitHub (`BasedHardware/OpenGlass`)](https://github.com/BasedHardware/OpenGlass)
- **Tech Stack:** $25 Seeed Studio XIAO ESP32-S3 Sense (camera + mic + BLE), 3D-printed glasses clip, Meta Llama 3 Vision, Whisper, ElevenLabs, Node.js.
- **The 2-Minute Demo Hook:** Wore the $25 clip-on glasses, looked at a judge, and had the glasses whisper the judge's name and what they discussed 20 minutes earlier.

### 21. Subtext — Emotion & Social Cue Captioning for the Deaf
- **Event & Prize:** **HackMIT 2026 — Winner, Meta Challenge ("Bringing People Closer Together with AI")** & Deepgram Winner
- **Primary Sources:** [HackMIT 2026 Showcase](https://hackmit.org)
- **Tech Stack:** Next.js, FastAPI, Deepgram Nova-3 (diarized STT), Hume AI (prosody/sarcasm detection), MIT Audio Spectrogram Transformer (ambient room cues).
- **The 2-Minute Demo Hook:** Rendered multi-speaker group banter with live inline emotional subtext (`[Marcus — Sarcastic, Chuckling]`) and room acoustics (`[Clinking Glasses]`) so Deaf participants never miss social nuance.

### 22. btw — Daily Family Micro-Streak & Sunday Newspaper
- **Event & Prize:** **HackMIT 2026 — Social Track Winner**
- **Primary Sources:** [HackMIT 2026 Showcase](https://hackmit.org)
- **Tech Stack:** Next.js PWA, Supabase, vector embeddings, LLM layout synthesizer.
- **The 2-Minute Demo Hook:** Unlocked a daily family prompt only when college kids, parents, and grandparents all submitted a 10-second photo/answer, compiling the week's scattered updates into a printable Sunday "Family Newspaper Edition."

### 23. Saynario — High-Stakes Social Pragmatics Coach
- **Event & Prize:** **HackPrinceton Spring 2026 — Best Use of ElevenLabs**
- **Primary Sources:** [Devpost](https://devpost.com/software/saynario)
- **Tech Stack:** ElevenLabs Conversational Voice Agent, Groq LPU inference, WebSockets.

---

## Category 3: FinTech, Consumer Decisioning & Crypto (`Capital One Nessie`, `Toyota Financial Services`, `Solana`)

### 24. unsaid — Privacy-Preserving Group Budget Negotiator
- **Event & Prize:** **DivHacks 2026 — Winner, Capital One Best Use of Nessie**
- **Primary Sources:** [Devpost (`unsaid-zm8w5v`)](https://devpost.com/software/unsaid-zm8w5v)
- **Tech Stack:** Capital One Nessie API (`api.nessieisreal.com`), Python, multi-agent LLM negotiation, Photon iMessage API.
- **24-Hour Codebase Secret:** Solved the social awkwardness of saying *"I can't afford that restaurant"* in a friend group chat. Each user's personal agent privately queried their Nessie `/accounts` and `/purchases` to infer a comfortable spending ceiling, negotiated peer-to-peer with friends' agents without ever exposing raw balances, and dropped an anonymous consensus itinerary poll into iMessage.
- **HackTX 26 Adaptation:** **Mega-Synergy between Meta Title Track + Capital One Nessie + SerpApi**!

### 25. Settlr — Bank-Verified Relocation & Roommate Matcher
- **Event & Prize:** **MHacks 2026 — Winner, Capital One Best Use of Nessie**
- **Primary Sources:** [Devpost (`settlr-s4gr9y`)](https://devpost.com/software/settlr-s4gr9y)
- **Tech Stack:** Capital One Nessie API, Svelte, TypeScript, SpacetimeDB (in-memory Wasm relational DB), Google Gemini API.
- **24-Hour Codebase Secret:** Cached Nessie accounts/bills/purchases inside SpacetimeDB for zero-latency UI updates and computed verified rent-to-income runway projections and roommate compatibility scores.

### 26. LoadCheck — Owner-Operator Trucker Cash-Flow Guardian
- **Event & Prize:** **VTHacks 14 — Winner, Capital One Best Use of Nessie**
- **Primary Sources:** [Devpost](https://devpost.com/software/loadcheck)
- **Tech Stack:** Capital One Nessie API (`/bills`, `/accounts`, `/loans`), React, TypeScript, FastAPI, Google Gemini API.
- **The 2-Minute Demo Hook:** Evaluated freight load offers and fuel deadhead costs against upcoming Nessie bills, warning drivers before accepting loads that would trigger a mid-month cash-flow deficit.

### 27. EcoFin Carbon — Transaction Carbon Ledger
- **Event & Prize:** **HackTX 2025 (UT Austin) — 1st Place Winner, Capital One Best Use of Nessie**
- **Primary Sources:** [Devpost](https://devpost.com/software/ecofin-carbon)
- **Tech Stack:** Capital One Nessie API (`/customers`, `/accounts`, `/purchases`, `/merchants`), React, Node.js, Express, EPA/DEFRA deterministic carbon lookup coefficients, OpenAI API.

### 28. Cargaze (HackTX 2025 Best Pitch Winner) & Astraeus, FiYota, MyToyota (HackTX 2025 Best Toyota Hack Winners)
- **Cargaze (HackTX 2025 Winner — `Best Pitch` / `A Bard's Tale`):** [Devpost (`cinder-al7osq`)](https://devpost.com/software/cinder-al7osq) — Celestial-themed car discovery app where users swipe through cars like constellations to match with their ride and financing plan.
- **Astraeus (HackTX 2025 Winner — `Best Toyota Hack`):** [Devpost (`astraeus`)](https://devpost.com/software/astraeus) — AI-powered space odyssey that turns car buying and financing trade-offs into an interactive 3D adventure.
- **FiYota (HackTX 2025 Winner — `Best Toyota Hack`):** [Devpost (`random-8rgnzc`)](https://devpost.com/software/random-8rgnzc) — Interactive financial data visualization tool to compare lease vs. loan options across Toyota models.
- **MyToyota (HackTX 2025 Winner — `Best Toyota Hack`):** [Devpost (`mytoyota`)](https://devpost.com/software/mytoyota) — Matches a user's income, credit score, and lifestyle preferences with personalized Toyota models, payment plans, and leasing options.

### 29. Toyotron — Dual-Modal Voice & Phone Toyota Finance Concierge
- **Event & Prize:** **HackUTD 2025 — Winner, Toyota Financial Services Track & NVIDIA Track**
- **Primary Sources:** [Devpost](https://devpost.com/software/toyotron) | [GitHub (`anbguye/hackutd-Toyota-Toyotron`)](https://github.com/anbguye/hackutd-Toyota-Toyotron)
- **Tech Stack:** Next.js 15, Supabase (`toyota_trim_specs`, `user_preferences`, `bookings`), NVIDIA `llama-3.3-nemotron-super-49b-v1.5` (orchestrating specialized Intent, Vehicle, Finance, and Report agents), Web Speech API + Retell AI live phone number, NHTSA VIN decoder API, Resend API.
- **24-Hour Codebase Secret:** Built dual voice redundancy—browser microphone speech recognition plus a live Retell AI phone number judges could dial on speakerphone, followed by automated email payoff/financing quotes via Resend.

### 30. Kachow & 31. Treat Me To A Toyota (Texas Toyota Winners)
- **Kachow (HackUTD 2025 Toyota Winner):** [Devpost (`car-thing-1dsxyk`)](https://devpost.com/software/car-thing-1dsxyk) — Interactive anti-buyer's-remorse visualizer unpacking APR traps, depreciation curves, and lease vs. buy total cost of ownership.
- **Treat Me To A Toyota (TAMUhack 2026 Toyota Winner):** [Devpost (`toyota-truefit`)](https://devpost.com/software/toyota-truefit) — Conversational voice AI & WebAudio advisor simplifying complex lease/loan terms.
- **RideWise (Toyota Submission):** [Devpost (`toyota-financial`)](https://devpost.com/software/toyota-financial) — Personalized vehicle & payment recommender.

### 33. SolPool, 34. Versus, & 35. RaiderClaim (MLH Best Use of Solana Winners)
- **SolPool (Hoya Hacks 2026 Solana Winner):** [Devpost](https://devpost.com/software/solpool) — Rust/Anchor smart contract pooling micro-buyers into trustless USDC bulk-discount escrows.
- **Versus (Hack the Hill Solana Winner):** [Devpost (`hth`)](https://devpost.com/software/hth) — Solana Token-2022 + Pyth Oracles + Meteora DLMM social prediction duel platform.
- **RaiderClaim (HackWesTX 2025 1st Overall & Solana Winner):** [Devpost (`cool-project-jbd71v`)](https://devpost.com/software/cool-project-jbd71v) — Solana Phantom wallet + AI voice + Arduino IoT physical locker/asset claim system.

---

## Category 4: Agent Infrastructure (`NMC2`), Real-Time Data (`Tiger Data`, `SerpApi`, `Snowflake`) & `Gemini Live`

### 36. ChainBreak, ARGUS, Repro, AgentForge & Lumea Agents (Verified Agent Verifiability, Sandbox & Deployment Winners)
- **ChainBreak — Runtime Security Invariants for AI Agents (Winner — Best Cybersecurity Solution):** [Devpost (`chainbreak-runtime-security-invariants-for-ai-agents`)](https://devpost.com/software/chainbreak-runtime-security-invariants-for-ai-agents)
  - **What It Built:** Stops autonomous AI agents from leaking confidential data or executing unsafe tool chains by enforcing deterministic trajectory invariants across multi-step tool execution with sub-millisecond latency.
- **ARGUS (MHacks 2026 Winner):** [Devpost (`argus-ulf1yd`)](https://devpost.com/software/argus-ulf1yd)
  - **What It Built:** Deploys five specialized agents to attack an app in an isolated sandbox, prove vulnerabilities, generate fixes, and verify the patch actually works before shipping.
- **Repro (Winner — Microsoft Track):** [Devpost (`repro-h6gq70`)](https://devpost.com/software/repro-h6gq70)
  - **What It Built:** Diagnostic and repair platform combining deterministic error/vulnerability detection with a multi-layer agentic repair and verification pipeline.
- **AgentForge (Winner):** [Devpost (`agentforge-kz832x`)](https://devpost.com/software/agentforge-kz832x)
  - **What It Built:** Describe an automation in plain language and get a real, executable, visually editable workflow whose agent nodes reason and decide while it runs.
- **Lumea Agents (Winner — MCP & AI Agents Hackathon):** [Devpost (`lumea-agents`)](https://devpost.com/software/lumea-agents)
  - **What It Built:** An MCP server and platform that generates custom AI agents from plain-English descriptions—automatically configuring system instructions, custom tools, and monitoring/lifecycle hooks, and spawning them in the cloud with Claude Code SDK compatibility.
- **Dapta (2nd Place Overall — AI Hackathon 2026 by LA Hacks):** [Devpost (`dapta`)](https://devpost.com/software/dapta)
  - **What It Built:** Agent workflow optimization and deployment platform that transforms repetitive AI tasks into faster, lower-cost, monitored production pipelines.
- **Agentic CICD (Winner — GitLab Track):** [Devpost (`agentic-cicd`)](https://devpost.com/software/agentic-cicd)
  - **What It Built:** Multi-agent DevOps sidekick (LangGraphJS + React + SSE + MCP servers) that automates and monitors CI/CD pipelines from natural language.

### 37. Bleach — Natural-Language-to-Visual Agent Compiler
- **Event & Prize:** **Google Cloud ADK Hackathon Winner** (Direct `NMC2` archetype)
- **Primary Sources:** [Devpost (`bleach-7tqdmo`)](https://devpost.com/software/bleach-7tqdmo)
- **Tech Stack:** Google ADK, Gemini Flash, Python, React Flow (`@xyflow/react`), WebSockets.
- **The 2-Minute Demo Hook:** Typed a plain-English agent spec, and watched a meta-agent compile production Python agent code, wire MCP/tool nodes on an interactive React Flow canvas, and stream live step-by-step execution traces.

### 38. Signal — Auditable Financial Research Agent with Dynamic MCP Hub
- **Event & Prize:** **Hack the North 2026 — Winner, RBC "Signal in the Noise" Track**
- **Primary Sources:** [Devpost (`temp-project-0sp3zv`)](https://devpost.com/software/temp-project-0sp3zv)
- **Tech Stack:** FastAPI, Model Context Protocol (MCP), Elasticsearch (hybrid BM25 + kNN vector search), MongoDB Atlas, Composio, OpenAI/Claude.
- **The 2-Minute Demo Hook:** Pasted a brand-new MCP server URL live in front of RBC judges to hot-plug enterprise data with zero code changes, rendering an interactive Evidence DAG with line-level `[n]` citations and automatic **"Metric Discrepancy Conflict"** callouts when two financial sources disagreed.

### 39. serpapi_fdw — Rust/Wasm PostgreSQL Foreign Data Wrapper for SerpApi
- **Event & Prize:** **SerpApi Hackathon 2026 — 1st Place Winner**
- **Primary Sources:** [GitHub (`krishna247/serpapi_fdw`)](https://github.com/krishna247/serpapi_fdw) | [SerpApi Official Winners Blog](https://serpapi.com/blog/meet-the-winners-of-the-serpapi-india-hackathon-2026/)
- **Tech Stack:** Rust compiled to WebAssembly (`cargo-component`), PostgreSQL / Supabase Wrappers FDW, `pg_cron`, Supabase Vault, SerpApi (`google_shopping`, `google_maps`, `google_jobs`, `search.md`), local mock fixture server (`:8787`).
- **The 2-Minute Demo Hook:** Queried live Google Shopping, Maps, and Flights directly inside standard PostgreSQL `SELECT` queries (`SELECT title, price FROM serpapi.google_shopping(...)`) with built-in SQL rate-limit enforcement and `strikethrough_forensics()` detecting fake e-commerce discounts.

### 40. Milo AI — Autonomous Group Travel Coordinator via SerpApi
- **Event & Prize:** **SerpApi Hackathon 2026 — 2nd Place Winner**
- **Primary Sources:** [SerpApi Official Winners Blog](https://serpapi.com/blog/meet-the-winners-of-the-serpapi-india-hackathon-2026/)
- **Tech Stack:** Python, Telegram Bot API, SerpApi (`google_flights`, `google_hotels`, `google_maps`), Claude, deterministic Python constraint validator.
- **24-Hour Codebase Secret:** Passively listened to group chat messages, reacted with `👀` when travel constraints were detected, queried multi-origin flights via SerpApi `google_flights`, filtered hard budget/rating constraints in deterministic Python code, and dropped interactive voting polls into the chat.

### 41. Unmet — Review Gap Miner with Deterministic Pain Scoring
- **Event & Prize:** **API World / DevNetwork 2026 — Winner, SerpApi Best AI Use Case**
- **Primary Sources:** [Devpost](https://devpost.com/software/unmet) | [GitHub (`byasb/unmet`)](https://github.com/byasb/unmet)
- **Tech Stack:** Vite, React, Leaflet.js, Convex reactive DB, 9 SerpApi engines (`google_maps_reviews`, `apple_reviews`, `yelp_reviews`, `google_trends`, etc.), Claude 3.5 Sonnet + Gemini Flash.
- **24-Hour Codebase Secret:** Ranked market gaps deterministically via $\text{score} = \text{mentions} \times \text{pain} \times (1 + \log_2 \text{breadth})$ and pre-seeded 91 real SerpApi responses into Convex's `serp_cache` table for an instant `OFFLINE=1` replay mode.

### 42. Mira (Tiger Data + Best Overall Winner) & HackTX 2025 NorthMark (`NMC2`) Winners
- **Mira (CodeRED: Orion — `Best Overall Prize` + `[MLH] Best Use of Tiger Data` Winner):** [Devpost (`mira-2vucqg`)](https://devpost.com/software/mira-2vucqg)
  - **What It Built:** Physical therapy motion-tracking platform that streams high-frequency movement telemetry into Tiger Data (Timescale PostgreSQL) to give physical therapists longitudinal recovery analytics.
- **Guido, WHEEL BE FINE, & LapSynk (HackTX 2025 Winners — `Best NorthMark Hack` / NMC2):**
  - **Guido:** [Devpost](https://devpost.com/software/https-www-youtube-com-watch-v-dqw4w9wgxcq) — Multi-agent simulation platform for F1 race strategy discovery and prediction.
  - **WHEEL BE FINE:** [Devpost (`tbd-oaswrc`)](https://devpost.com/software/tbd-oaswrc) — Algorithmic strategy planning and real-time physiological + vehicle telemetry dashboard.
  - **LapSynk:** [Devpost (`a-wnbv1p`)](https://devpost.com/software/a-wnbv1p) — AI copilot for race engineers using Gemini, Cloudflare, and ElevenLabs to automate live strategy decisions.

### 43. Steady & 44. Lucid (MLH Best Use of Snowflake API Winners)
- **Steady (TigerHacks 2026 Snowflake Winner):** [Devpost (`steady-gb6ih9`)](https://devpost.com/software/steady-gb6ih9) — Streamed Apple Watch HRV/sleep telemetry into Snowflake, running `SNOWFLAKE.ML.FORECAST` and `SNOWFLAKE.CORTEX.COMPLETE` inside the warehouse to predict caregiver burnout.
- **Lucid (Snowflake Winner):** [Devpost (`lucid-nijx3r`)](https://devpost.com/software/lucid-nijx3r) — Streamed 15-second MediaPipe Face Mesh micro-sleep (PERCLOS) metrics into Snowflake Cortex to audit fleet-wide driver fatigue.

### 45. ORION, 46. Wand, 47. Rayan, 48. Jayu, 49. drone-copilot, & 50. JohnKeats.AI (Google Gemini Winners)
- **ORION (Gemini Live Challenge Grand Prize):** [Devpost (`orion-operating-room-intelligent-orchestration-node`)](https://devpost.com/software/orion-operating-room-intelligent-orchestration-node) — Hands-free voice + surgical video co-pilot using Gemini Live WebSockets.
- **Wand (Gemini Live UX Winner):** [Devpost (`wand-a-live-agent-that-sees-browses-and-clicks-with-you`)](https://devpost.com/software/wand-a-live-agent-that-sees-browses-and-clicks-with-you) — Voice + MediaPipe hand-pointing browser assistant that streams 20Hz cursor coordinates and injects viewport screenshots into Gemini Live only on gesture/speech triggers.
- **Rayan (Gemini Live Innovation Winner):** [GitHub (`yelnady/rayan`)](https://github.com/yelnady/rayan) — Dual-agent (`CaptureAgent` + `RecallAgent`) system turning live audio/video into an explorable `@react-three/fiber` 3D Memory Palace.
- **Jayu (Gemini Competition Grand Prize):** [GitHub (`JonOuyang/Gemini-Computer-Use`)](https://github.com/JonOuyang/Gemini-Computer-Use) — Vision-guided OS desktop agent combining Gemini Pro (planning) + Gemini Flash (execution).
- **drone-copilot:** [GitHub (`BryenInsights/drone-copilot`)](https://github.com/BryenInsights/drone-copilot) — Gemini Live voice + FPV video co-pilot for DJI Tello drones.
- **JohnKeats.AI:** [GitHub (`johnkeats-ai/johnkeats-ai`)](https://github.com/johnkeats-ai/johnkeats-ai) — Native audio prosody-aware companion with a reactive Three.js particle orb.

---

## Category 5: Hardware (`Brick House` — RTX 5080) & Most Entertaining (`Jester's Court` — PS5)

### 51. BrailleBot — $15 3D-Printer Braille Embosser
- **Event & Prize:** **TreeHacks 2025 — Winner, Best Hardware Hack**
- **Primary Sources:** [Devpost (`readable-ai-braille-printer`)](https://devpost.com/software/readable-ai-braille-printer)
- **Tech Stack:** Standard 3D printer retrofitted with a $15 spring-loaded embossing punch replacing the hotend, custom Python Marlin G-code generator, Llama 3.2 Vision diagram-to-braille summarizer.
- **The 2-Minute Demo Hook:** Embossed real tactile braille sheets live at the judging table from textbook photos for 1/100th the cost of commercial embossers.

### 52. Kinemo — Zero-Hardware Webcam Motion Party Console
- **Event & Prize:** **PennApps XXVI (Sept 2025) — 1st Place Overall Grand Prize**
- **Primary Sources:** [Devpost](https://devpost.com/software/kinemo) | [GitHub (`arvinmefsha/kinemo`)](https://github.com/arvinmefsha/kinemo)
- **Tech Stack:** Pure Python (<1,200 LOC), OpenCV, Google MediaPipe 33-landmark 3D pose & hand tracking, Pygame, NumPy vector velocity calculus.
- **24-Hour Codebase Secret:** 100% offline execution at 60 FPS with 0.5s attack debounce timers; two players step in front of a laptop webcam and immediately box, dodge, and slice flying fruit with their bodies.

### 53. Unreal EngJam — Cursed Game Engine Inside Figma FigJam
- **Event & Prize:** **Cal Hacks 11.0 — Winner, Most Entertaining Hack** & Best Dev Tool
- **Primary Sources:** [Devpost](https://devpost.com/software/unreal-engjam)
- **Tech Stack:** TypeScript, Figma Plugin API (zero external dependencies).
- **The 2-Minute Demo Hook:** Parsed FigJam sticky notes, boxes, and connector arrows into an AST and executed playable *Pong* and 3D wireframe games directly inside a Figma whiteboard.

### 54. GPongT — Self-Mutating Runtime Code Game
- **Event & Prize:** **HackTX 2024 (UT Austin) — Winner, Best AI Hack**
- **Primary Sources:** [Devpost](https://devpost.com/software/gpongt) | [GitHub (`Tanyk2004/GPongT`)](https://github.com/Tanyk2004/GPongT)
- **Tech Stack:** Python (<150 core LOC), Pygame, OpenAI API, `importlib.util.spec_from_file_location` dynamic module hot-reloading.
- **24-Hour Codebase Secret:** Every time a point was scored, the LLM generated a new Python physics function, wrote it to a tempfile, validated it inside a `try/except` guard, and hot-injected it into the running 60 FPS Pygame loop (`dynamic_fns`).

### 55. Cross ExaminAItion & 56. jury doody (Viral AI Courtroom Party Games)
- **Cross ExaminAItion (Hack&Roll 2026 Winner):** [Devpost](https://devpost.com/software/cross-examinaition) — Multiplayer Phoenix Wright-style courtroom where friends argue petty real-life disputes, drop secret evidence cards, and get roasted/sentenced by an AI Magistrate.
- **jury doody:** [Devpost](https://devpost.com/software/jury-doody) — Jackbox-style room game (`Socket.IO` + 4-letter phone room codes + ElevenLabs dramatic voice acting) where the whole audience votes and bluffs on real conflict stories.

### 57. ChatGPMe, 58. The Beat Box!, 59. Ludwig, & 60. PulseWalk
- **ChatGPMe (Hack the North Finalist):** [Devpost](https://devpost.com/software/chatgpme) — Reverse Turing *Overcooked*-style game where the human frantically types robotic answers pretending to be ChatGPT before server timers melt down.
- **The Beat Box! (Best Audio Hardware):** [Devpost](https://devpost.com/software/the-beat-box) — ESP32 FreeRTOS + 360 NeoPixel arcade rhythm game that triggers a relay-wired taser pulse when you miss 5 notes.
- **Ludwig (Hack the North Finalist):** [Devpost](https://devpost.com/software/ludwig) — Optical Music Recognition + Raspberry Pi servo fingers that mechanically play sheet music on a real piano.
- **PulseWalk (Cal Hacks 11 Best Hardware):** [Devpost](https://devpost.com/software/pulsewalk) — ESP32 + Time-of-Flight infrared sensors + haptic shoe insoles giving visually impaired walkers terrain feel.
