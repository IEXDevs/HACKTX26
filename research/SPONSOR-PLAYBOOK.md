# HackTX 26 — Complete Sponsor & Track Playbook

> **Purpose:** Exhaustive technical and strategic breakdown of every track in [`TRACKS.md`](../TRACKS.md) for **HackTX 26** (hosted by Freetail Hackers at UT Austin), including what judges reward, verified API endpoint/SQL/SDK cheat sheets, critical 24-hour implementation gotchas, and high-EV track-stacking combinations.

---

## 1. Master Prize & EV Matrix (All 19 HackTX 26 Tracks)

| Category | Track Name | Prize | Effort-to-EV Ratio | Core Technical / Demo Requirement |
| :--- | :--- | :--- | :--- | :--- |
| **General** | **[Best Overall] Cinderella's Castle** | Latest 14" MacBook Pro (each member) | **S-Tier (Crown Jewel)** | Design + technical complexity + impact; interactive canvas/3D/physical-digital UX solving an unexpected problem. |
| **General** | **[Best Hardware] Brick House** | Nvidia RTX 5080 (each member) | **S-Tier (Highest Hardware EV)** | Tangible cyber-physical system (ESP32, Arduino, servos, solenoids, BLE badges, haptics, or robotics). |
| **General** | **[Most Entertaining] Jester's Court** | PlayStation 5 (each member) | **S-Tier** | Pure excitement, replayability, immediate laughs; judges can play within 10 seconds and don't want to put it down. |
| **General** | **[Best Pitch] A Bard's Tale** | 1st: DJI Speakers \| 2nd: Keyboards \| 3rd: JBL | **A-Tier (Zero Extra Code)** | Audience-voted live pitch; won via cold open + giant QR room join + live stage stunt. |
| **General** | **[Best Novice] The First Chapter** | Ray-Ban Meta Glasses (each member) | **A-Tier (If eligible)** | First-time hackers; evaluated on design, complexity, and impact. |
| **Sponsor** | **[Title Sponsor: Meta] Bringing People Closer Together with AI** | **Top 3 Teams:** Round 2 Hackathon at Meta Menlo Park HQ (Flights + Hotel paid) + Swag | **S-Tier (3 Winners!)** | Strengthen real human connection (group plans, family stories, shared interests) using `Muse Spark`, `Muse Image`, `Muse Voice Transcribe`, `Muse` MCP connectors, or `Graph API`. |
| **Sponsor** | **[NMC2] Build the Platform Behind the Agent** | 1st: AirPods Max Gen 2 \| 2nd: Apple Watch S12 \| 3rd: Echo Show 11 | **S-Tier (3 Placement Tiers)** | Reusable platform to rapidly create, configure, connect tools (MCP), and monitor enterprise AI agents (SSE trace DAGs). |
| **Sponsor** | **[Capital One] Best Use of Nessie** | $250 Giftogram Gift Card (each member) | **A-Tier ($1,000/team of 4)** | Reimagine banking/personal finance using `api.nessieisreal.com` (accounts, merchants, bills, loans, P2P transfers). |
| **Sponsor** | **[Toyota Financial Services] "What's Your Next Move?"** | 1st: $500 \| 2nd: $350 \| 3rd: $150 Amazon Gift Cards | **A-Tier (3 Placement Tiers)** | Personalize, Simplify, Guide, and prove business Value on vehicle lease/loan next moves with synthetic data. |
| **Sponsor** | **[SerpApi] Best Use of SerpApi** | ARZOPA Portable Monitors | **A-Tier (Easy Plug-in)** | Meaningful use of SerpApi's 100+ real-time APIs (`google_flights`, `google_hotels`, `google_maps`, `google_shopping`, `extract`). |
| **MLH** | **[MLH] Build Your Hackathon A-Team with SpaceXSI** | Custom Cursor Mechanical Keyboard (each member) | **S-Tier Freebie (10 mins)** | Use Cursor (`.cursorrules`) + integrate Grok Bot automation into workflow + describe in Devpost & opt into raffle. |
| **MLH** | **[MLH] Best Use of Tiger Data** | Stream Deck Mini | **A-Tier (15-min SQL script)** | Timescale/extended PostgreSQL (`create_hypertable`, `timescaledb.continuous` aggregates, 90%+ compression, `pgvector`). |
| **MLH** | **[MLH] Best Use of Solana** | Unruggable Hardware Wallets (each member) | **A-Tier** | Fast, low-cost Solana integration (Solana Actions/Blinks, Devnet Memo/Escrow program, or `x402` agent micropayments). |
| **MLH** | **[MLH] Best Use of Gemini API** | MLH Swag Kits | **A-Tier** | Multimodal perception, Gemini Live bidirectional voice/video, structured outputs, or tool calling (`google-genai`). |
| **MLH** | **[MLH] Best Use of Vultr** | M5Stack Official Tab5 | **A-Tier (Easy Deploy)** | Deploy Docker backend on Vultr Cloud Compute/GPU + call `https://api.vultrinference.com/v1`. |
| **MLH** | **[MLH] Best Use of Snowflake API** | Arduino Student Kit | **B-Tier** | Call Snowflake REST API (`/api/v2/cortex/v1/chat/completions`, Cortex Search/Analyst) with PAT token. |
| **MLH** | **[MLH] Best .Tech Domain Name** | Desktop Mic + 10-Yr `.tech` Domain | **A-Tier Freebie (5 mins)** | Register and bind a clever `.tech` domain via MLH promo code. |
| **MLH** | **[MLH] DEV Writing Challenge** | $100 Cash | **A-Tier Freebie (15 mins)** | Publish the project build story on `dev.to` before deadline. |

---

## 2. General Tracks Playbook (Freetail Hackers Judging Culture)

### 2.1 `[Best Overall] Cinderella's Castle` (14" MacBook Pros)
- **What Historical Winners Prove (`earth2echo` in 2025, `AIAIO` in 2024):**
  - Freetail Hackers judges (UT Austin CS upperclassmen, Austin founders, and sponsor engineers) judge live at your expo table. They have **zero patience for slide decks** or generic SaaS wrappers.
  - Both HackTX 24 and HackTX 25 Grand Prize winners used **interactive visual canvases** (`@xyflow/react`, `tldraw`, HTML5 Canvas, WebAudio/Three.js) where judges could see live multimodal state transitions with zero loading spinners.
- **Non-Negotiable Checklist:**
  1. **The 30-Second Touch Rule:** Put a phone, physical prop, or interactive canvas into the judge's hands within 30 seconds.
  2. **Cross-Modal or Physical Bridge:** Connect at least two modalities (e.g., Live Voice/Camera $\to$ Interactive Canvas/3D $\to$ Real Phone Call / Physical ESP32 / Financial Execution).

### 2.2 `[Best Hardware Hack] Brick House` (Nvidia RTX 5080s)
- **How Software-Heavy Teams Win Hardware:**
  - You do **not** need a custom PCB or CNC mill to win `Brick House`. Recent hardware winners (`Klick`, `TedTime`, `Shepherd`, `SixthSense`, `The Beat Box!`) used **off-the-shelf ESP32-S3 or Arduino boards ($5–$15)** wired to visible, high-drama actuators:
    - **Solenoids / Servos:** A physical gavel that slams down on a verdict, a robotic dial/gauge that physically redlines, or a gauntlet that tugs your wrist.
    - **Addressable NeoPixel RGB Strips / Badges:** Synchronized lanyard badges or table strips that flash cyan/red when two AI agents reach consensus over BLE/Wi-Fi.
    - **Thermal Receipt Printers (ESC/POS over Serial/USB):** Printing a physical contract, equity certificate, or courtroom verdict in 2 seconds that the judge walks away holding.
- **Hardware Survival Rule:** Always support **hardwired USB-Serial** alongside BLE/Wi-Fi so crowded 2.4GHz hackathon radio spectrum never breaks your live actuation.

### 2.3 `[Most Entertaining] Jester's Court` (PlayStation 5s) & `[Best Pitch] A Bard's Tale` (DJI Speakers)
- **The `Jester's Court` Formula:**
  - High-adrenaline social conflict, reverse-Turing chaos, or body-tracked physical comedy (`Cross ExaminAItion`, `GPongT`, `Kinemo`, `Unreal EngJam`).
- **The `A Bard's Tale` 180-Second Stage Choreography (Audience-Voted):**
  - `0:00–0:20` **The Cold Open:** Never start with *"Hi we're Team X."* Start mid-drama (*"Thirty seconds ago, my co-founder committed a felony against our group chat..."*).
  - `0:20–0:45` **The Giant QR Drop:** Put a massive QR code on screen: *"Scan this right now—all 300 of you are now in the live room."* Show a live participant counter ticking up on stage.
  - `0:45–1:45` **The Live Stunt:** Execute a real phone call on speakerphone, let the audience vote on their phones to trigger a physical solenoid/printer on stage, or have two volunteers duel on webcam.
  - `1:45–2:30` **The Technical Flex:** Reveal the real engineering under the hood (Timescale continuous aggregates, sub-160ms Muse diarization, deterministic math).
  - `2:30–3:00` **The Call to Vote:** Explicitly tell the audience to open the Harkey Institute / Freetail voting form and vote for your project name.

---

## 3. Sponsor Tracks: Deep Technical Reference & Gotchas

---

### 3.1 `[Title Sponsor: Meta]` Bringing People Closer Together with AI
- **Prize:** **Top 3 teams** win an all-expenses-paid trip to advance to the **Round 2 Hackathon at Meta's Menlo Park Campus** + Meta swag bag.
- **What Meta Judges Reward (Verified from HackMIT 2026 & HackGT 13 Meta Winners `Klick`, `TedTime`, `Nudge`, `Subtext`):**
  - Meta judges reject solitary AI companions ("talk to an AI friend").
  - They reward products where **AI is the invisible catalyst between real humans**:
    1. *Synthesizing messy group discussions into real-world plans* (`Sunday`, `unsaid`, `Milo AI`).
    2. *Organizing scattered family updates/memories into a shared story* (`TedTime`, `HeirLoom`, `btw`).
    3. *Sparking new face-to-face connections from shared interests* (`Klick`, `OpenGlass`).

#### Meta AI / Muse Suite Technical Reference
1. **`Muse Spark` (`muse-spark-1.3` / `muse-spark`):**
   - **Role:** Meta's 1M-context multimodal reasoning & agentic tool-calling model.
   - **Wire Format:** OpenAI Chat Completions compatible (`POST https://api.meta.ai/v1/chat/completions`, Header: `Authorization: Bearer $META_AI_API_KEY`).
   - Supports standard `tools` array and `response_format: { type: "json_object" }`.
2. **`Muse Voice Transcribe` (`muse-voice-transcribe-1.0`):**
   - **Role:** Real-time audio perception model with **80ms chunk processing (~160ms latency)** and **live 20+ speaker diarization** + turn endpointing.
   - **Endpoints:**
     - Batch: `POST https://api.meta.ai/v1/asr/transcribe` (`multipart/form-data`, `file`, `model="muse-voice-transcribe-1.0"`, `diarize="true"`).
     - Real-Time WebSocket: `wss://api.meta.ai/v1/asr/realtime` (16kHz 16-bit PCM frames $\to$ returns `{ event: "transcription_chunk", speaker_id: "speaker_1", text, start_ms, end_ms, is_final }`).
3. **`Muse Image` (`muse-image-1.0`):**
   - **Role:** Agentic image generation and multi-turn visual editing with consistent layout/typography.
   - **Endpoints:** `POST https://api.meta.ai/v1/images/generations` and `POST https://api.meta.ai/v1/images/edits`.
4. **`Muse` Personal AI Agent & Custom Connectors (MCP / OpenAPI):**
   - `Muse` connects to your project via **Model Context Protocol (MCP)** over HTTP/SSE (`/mcp/sse`, `/mcp/tools/list`, `/mcp/tools/call`) or **OpenAPI 3.0 REST tool schemas**.
   - **Crucial Judging Flex:** Expose your backend actions (e.g., querying SerpApi, checking Nessie balances, locking a Toyota equity certificate, or flashing an ESP32 badge) as callable **Muse Custom Connector tools** so judges can see `Muse` invoke your app's tools natively!
5. **`Facebook Graph API` (`https://graph.facebook.com/v19.0`) Survival Rules:**
   - **NEVER submit for App Review** (takes 3–14 days). Keep your Meta Developer App strictly in **Development Mode**.
   - In *Meta App Dashboard $\to$ App Roles $\to$ Roles*, add all teammates and demo test accounts as **Developers/Testers**. In Development Mode, `user_posts`, `user_photos`, `user_events`, and `user_friends` work **immediately** for roled accounts.
   - **The `user_friends` Gotcha:** `GET /me/friends` only returns friends who have *also* logged into your app in Dev Mode. Log in with at least 2–3 teammate accounts so mutual friend graphs populate!
   - **Dual-Mode Adapter Pattern:** Wrap `Muse Spark`, `Muse Image`, and `Muse Voice Transcribe` in a clean adapter (`DualModeAIAdapter`) that seamlessly falls back to Gemini 3.8 Flash / OpenAI if venue network or sandbox quotas hiccup.

---

### 3.2 `[SerpApi]` Best Use of SerpApi (ARZOPA Portable Monitors)
- **Base URL:** `https://serpapi.com/search.json` (and `https://serpapi.com/search.md` for Markdown extraction).
- **Auth:** Query param `api_key=YOUR_SERPAPI_KEY`.
- **Top High-Impact Engines & Response Paths:**

| Engine (`engine=`) | Required/Key Params | Key Response JSON Paths | Best Hackathon Use Case |
| :--- | :--- | :--- | :--- |
| `google_flights` | `departure_id=AUS`, `arrival_id=DEN`, `outbound_date=YYYY-MM-DD`, `return_date=YYYY-MM-DD`, `currency=USD` | `best_flights[]`, `other_flights[]`, `price_insights.lowest_price`, `price_insights.typical_price_range` | Multi-origin group trip coordinator (`Milo AI` pattern). |
| `google_hotels` | `q=Austin+TX`, `check_in_date=YYYY-MM-DD`, `check_out_date=YYYY-MM-DD`, `adults=4` | `properties[].name`, `properties[].rate_per_night.lowest`, `properties[].overall_rating`, `properties[].gps_coordinates` | Group lodging optimizer & split-cost calculator. |
| `google_maps` | `q=restaurants`, `ll=@30.2849,-97.7341,14z`, `type=search` | `local_results[].title`, `local_results[].rating`, `local_results[].price`, `local_results[].address`, `local_results[].place_id` | Equidistant group hangout finder or local gas/service station lookup. |
| `google_shopping` | `q=2022+Toyota+RAV4+XLE`, `gl=us`, `hl=en`, `direct_link=true` | `shopping_results[].title`, `shopping_results[].extracted_price`, `shopping_results[].source`, `shopping_results[].link` | Live market valuation / price-arbitrage verification. |
| `google_finance` | `q=TM:NYSE` or `NVDA:NASDAQ` | `summary.extracted_price`, `summary.price_movement`, `financials[]`, `news_results[]` | Real-time financial & macroeconomic grounding. |
| `google_lens` | `url=https://.../image.jpg`, `type=visual_matches` | `visual_matches[].title`, `visual_matches[].price.extracted_value`, `visual_matches[].link` | Snap a photo of any car, receipt, or item to pull live market prices. |
| `extract` | `url=https://...`, `include_markdown=true` | `text_content.markdown`, `page_info`, `elements` | Turn any live web URL into clean LLM-ready Markdown. |

- **SerpApi Gotcha & Safeguard:** Wrap SerpApi in a 30-minute disk/SQLite/in-memory LRU cache (`serp_cache`) with pre-seeded `OFFLINE=1` JSON fixtures for your primary demo queries so live demos execute in <20ms and never burn through quota.

---

### 3.3 `[NMC2]` Build the Platform Behind the Agent (AirPods Max Gen 2 / Apple Watch S12 / Echo Show 11)
- **Sponsor Intel:** **NMC² (NorthMark Compute & Cloud, `nmc2.com`)** is an enterprise HPC & AI GPU cloud operator and official partner of **Atlassian Williams Racing (Formula 1)**. Their engineers care deeply about **low-latency telemetry, zero-boilerplate agent assembly, runtime resilience, and observability**.
- **How to Beat Generic Agent Dashboards:**
  - Build a **Dual-Plane Architecture**:
    1. **Control Plane (Visual Studio):** Uses `@xyflow/react` (React Flow) where users declaratively wire an agent's Model Router (`Muse Spark` $\leftrightarrow$ `Gemini 3.8 Flash` $\leftrightarrow$ `Snowflake Cortex` $\leftrightarrow$ `Vultr`), attach MCP / OpenAPI tools (one-paste MCP server registration like `Signal` / `Lumea Agents`), and toggle active runtime guardrails & self-healing (`Alto` / `Auto_Sec` pattern).
    2. **Observability & Dogfooding Plane:** Instead of running a toy "Hello World" agent, **run your main hackathon application's agents through your NMC2 platform**! Stream every thought step, tool invocation, token cost, and millisecond latency over Server-Sent Events (SSE) into a **Tiger Data Hypertable** with 1-minute **Continuous Aggregates** displayed live on Screen 2 while judges interact with your consumer/hardware product on Screen 1.

---

### 3.4 `[Capital One]` The Best Use of Nessie ($250 Giftogram per member)
- **Base URL:** `http://api.nessieisreal.com` (or `https://api.nessieisreal.com` / `prod-api.nessieisreal.com`).
- **Auth:** Query parameter `?key=YOUR_NESSIE_API_KEY` on every request.
- **Core Endpoint Graph:**
  - `GET / POST /customers` $\to$ `{ first_name, last_name, address: { street_number, street_name, city, state, zip } }`
  - `GET / POST /customers/{id}/accounts` $\to$ `{ type: "Checking" | "Savings" | "Credit Card", nickname, rewards, balance }`
  - `GET / POST /accounts/{id}/purchases` $\to$ `{ merchant_id, medium: "balance", purchase_date: "YYYY-MM-DD", amount, status: "completed", description }`
  - `GET / POST /accounts/{id}/bills` $\to$ `{ status: "pending", payee, nickname, payment_date, recurring_date, payment_amount }`
  - `GET / POST /accounts/{id}/transfers` $\to$ `{ medium: "balance", payee_id, amount, transaction_date, status, description }`
  - `GET / POST /accounts/{id}/loans` $\to$ `{ type: "auto" | "home" | "small business", status: "approved", credit_score, monthly_payment, amount, description }`
  - `GET / POST /merchants` $\to$ `{ name, category, address, geocode: { lat, lng } }`
- **3 Critical Nessie Gotchas:**
  1. **Browser CORS Block:** Calling `api.nessieisreal.com` directly from browser `fetch()` fails due to missing CORS headers and leaks your `?key=`. **Always route through a Next.js API route (`/api/nessie/...`) or FastAPI proxy.**
  2. **Passive Ledger:** Nessie does not auto-deduct balances when you create a bill or loan; trigger explicit `POST /purchases` or `POST /transfers` (and `PUT /accounts/{id}`) to animate live balance mutations.
  3. **30-Second Household Seeding + Fallback Mirror:** Run a concurrent `Promise.all()` seeding script on startup to populate realistic multi-person customer profiles, checking/savings accounts, auto loans, and 90-day purchase histories, backed by an in-memory SQLite/JSON mirror if the sandbox throws HTTP 429 during judging.

---

### 3.5 `[Toyota Financial Services]` "What's Your Next Move?" ($500 / $350 / $150 Amazon Gift Cards)
- **What TFS Judges Evaluate:**
  1. **Personalize:** Use a synthetic customer profile (credit score, monthly cash flow via Nessie), vehicle profile (VIN, year/make/model/trim, odometer pacing), and active TFS contract (lease residual vs. retail loan payoff).
  2. **Simplify:** Translate complex auto finance math into plain-language comparisons across **4 Concrete Moves**:
     - **Move 1 — Positive Lease Equity Arbitrage (The #1 Judge-Pleaser):** Toyota vehicles hold high resale value. Show that $\text{Net Equity} = \text{Live SerpApi Market Value} (\$25,800) - \text{TFS Contract Residual} (\$21,400) = +\$4,400$. Rolling that $+\$4,400$ equity into a new 2026 Camry/RAV4 Hybrid with 1.9% TFS Loyalty APR and **waiving the $395 TFS disposition fee** actually *lowers* the customer's monthly payment + fuel cost!
     - **Move 2 — Excess Mileage Penalty Rescue:** Detect when a driver is pacing 15,000 mi/yr on a 12,000 mi/yr lease ($\text{Projected Penalty} = 9,000 \times \$0.15 = \$1,350$) and show that trading in or buying out early waives 100% of excess mileage fees.
     - **Move 3 — Credit-Tier Improvement Refinance:** If the customer's Nessie credit score rose from 640 to 745, compute exact monthly cash-flow relief via $M = P \frac{r(1+r)^n}{(1+r)^n - 1}$.
     - **Move 4 — Keep & Pay Off vs. Warranty Cliff:** Compare 3-year Total Cost of Ownership (TCO) including post-warranty maintenance vs. ToyotaCare.
  3. **Guide:** One-click self-service execution (Lock 14-Day Equity Certificate, Schedule Dealer Inspection via SerpApi Maps, or Pre-Qualify without hard pull).
  4. **Value:** Explicitly show a **"TFS Executive ROI View"** calculating how the recommendation prevents off-brand defection (54% $\to$ 88% retention), originates new TFS loan volume, and deflects call-center payoff inquiries.

---

## 4. MLH Tracks: Fast-Path Technical Integration Playbook

### 4.1 `[MLH] Best Use of Tiger Data` (Stream Deck Mini)
- **What Tiger Data Is:** Timescale's extended PostgreSQL platform (`tigerdata.com`) combining relational tables, time-series **Hypertables**, incremental **Continuous Aggregates**, **90%+ Columnar Compression**, and **`pgvector` / `pgai`**.
- **15-Minute Drop-In SQL Blueprint (`init_tigerdata.sql`):**
```sql
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS telemetry_events (
    time TIMESTAMPTZ NOT NULL,
    entity_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    latency_ms DOUBLE PRECISION NOT NULL,
    value_usd NUMERIC(12, 4) DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 1. Partition automatically into a Timescale Hypertable
SELECT create_hypertable('telemetry_events', 'time', if_not_exists => TRUE);

-- 2. Create a 1-Minute Continuous Aggregate (Incrementally Materialized Rollup)
CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_1min
WITH (timescaledb.continuous) AS
SELECT
    time_bucket(INTERVAL '1 minute', time) AS bucket,
    entity_id,
    COUNT(*) AS event_count,
    AVG(latency_ms) AS avg_latency_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
    SUM(value_usd) AS total_value_usd
FROM telemetry_events
GROUP BY bucket, entity_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('metrics_1min',
    start_offset => INTERVAL '2 hours',
    end_offset   => INTERVAL '10 seconds',
    schedule_interval => INTERVAL '1 minute');

-- 3. Enable 90%+ Native Columnar Compression
ALTER TABLE telemetry_events SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'entity_id',
    timescaledb.compress_orderby = 'time DESC'
);
SELECT add_compression_policy('telemetry_events', INTERVAL '24 hours');
```

### 4.2 `[MLH] Best Use of Gemini API` (MLH Swag Kits)
- Use the official `google-genai` (Python) or `@google/genai` (TypeScript) SDKs with:
  - **Bidirectional Gemini Live WebSocket API** (`client.aio.live.connect`) for sub-second native voice + 1–2 FPS camera/screen perception (`Wand`, `ORION`, and `Rayan` winning pattern).
  - **Structured JSON Outputs (`response_schema`) & Function Calling** to guarantee zero-hallucination tool dispatch.

### 4.3 `[MLH] Best Use of Solana` (Unruggable Hardware Wallets)
- **Fastest High-Impact Pattern (20 mins):**
  1. **Solana Actions & Blinks (`/actions.json` + `/api/actions/...`):** Returns a signable Devnet transaction that renders as an interactive 1-click card for group escrow, split bills, or agent authorization (`x402` HTTP 402 micropayment).
  2. **On-Chain Audit Memo (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`):** Writes cryptographic SHA-256 hashes of financial agreements, courtroom verdicts, or agent audit logs to Solana Devnet in ~400ms with a clickable Solscan Devnet link in the UI.

### 4.4 `[MLH] Best Use of Vultr` (M5Stack Tab5) & `[MLH] Best Use of Snowflake API` (Arduino Kit)
- **Vultr:** Deploy your Dockerized backend on a Vultr Cloud Compute / GPU instance AND route fast background summarization calls through Vultr's OpenAI-compatible Serverless Inference endpoint (`https://api.vultrinference.com/v1/chat/completions` with `Authorization: Bearer $VULTR_API_KEY`).
- **Snowflake Cortex REST API:** Call `POST https://<account>.snowflakecomputing.com/api/v2/cortex/v1/chat/completions` using a Snowflake Programmatic Access Token (`X-Snowflake-Authorization-Token-Type: PROGRAMMATIC_ACCESS_TOKEN`) for enterprise risk/compliance analytics.

### 4.5 `[MLH] SpaceXSI` (Cursor Mechanical Keyboard) + `.Tech` + `DEV`
- **Every project we build should claim these 3 zero-friction multipliers:**
  1. **SpaceXSI:** Use Cursor with a committed `.cursorrules` file + a `scripts/grok_triage.py` GitHub Action/hook using Grok Bot automation, and document it in the Devpost submission.
  2. **Best `.Tech` Domain:** Claim the free `.tech` domain from MLH and point it to our frontend/tunnel.
  3. **DEV Writing Challenge ($100):** Paste our architectural writeup into a `dev.to` post before submission closes.

---

## 5. High-EV Track-Stacking Archetypes (How 1 Cohesive Product Sweeps 5–7 Tracks)

| Archetype Name | Primary General Track | Primary Sponsor Track(s) | Stacked MLH & Secondary Tracks | Why It Never Feels Bolted-On |
| :--- | :--- | :--- | :--- | :--- |
| **1. The Social & Financial Group Coordinator** | `Cinderella's Castle` + `A Bard's Tale` | **Meta Title Track** + **Capital One Nessie** + **SerpApi** | **Solana** (Split-bill Blink) + **Tiger Data** + **SpaceXSI** | Friends/families talk in a group call (`Muse Voice Transcribe`); private agents check individual Nessie budgets (`unsaid` pattern), ground flights/hotels/cars in `SerpApi`, and settle shares via a Solana Blink. |
| **2. The Interactive Mobility & Wealth Simulator** | `Cinderella's Castle` + `A Bard's Tale` | **Toyota Financial Services** + **Capital One Nessie** + **SerpApi** | **Gemini API** (VIN/Lease Vision) + **Tiger Data** + **Snowflake** | Camera scans your car/lease (`Gemini`), pulls bank cash-flow (`Nessie`) + live dealer comps (`SerpApi`), and simulates life moves on an interactive canvas (`AIAIO`/`Cargaze` pattern). |
| **3. The Cyber-Physical Party / Courtroom Arena** | `Jester's Court` (PS5) + `Brick House` (RTX 5080) + `A Bard's Tale` | **Meta Title Track** + **SerpApi** + **Capital One Nessie** | **Gemini Live API** + **Solana** (Wager/Bail Escrow) + **SpaceXSI** | Two humans argue a real dispute (or venmo/Nessie charge) before a live AI Magistrate (`Muse`/`Gemini Live`); the 300-person audience votes via QR code, slamming a physical ESP32 solenoid gavel (`Brick House`) and printing a receipt. |
| **4. The Dual-Plane Autonomous Agent OS** | `Cinderella's Castle` | **NMC2** + **SerpApi** + **Meta Muse Connectors** | **Tiger Data** (Hypertable Telemetry) + **Vultr** + **Snowflake** + **Gemini** | A visual React Flow studio (`NMC2`) that compiles, sandboxes, and monitors live MCP/SerpApi agents with sub-millisecond `Tiger Data` continuous aggregates and active self-healing (`Lumea Agents` + `Bleach` + `Alto` pattern). |
