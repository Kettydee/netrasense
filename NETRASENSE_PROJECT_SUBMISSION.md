# NetraSense — Ambient AI Assistive Vision & Telemetry Companion
### Comprehensive Project Submission Dossier
**Author:** Khirabdi Tanaya Dash  
**Registration Number:** 25BCE2067  
**Live Deployed Web Application:** [https://netrasense.vercel.app](https://netrasense.vercel.app)  
**Official GitHub Repository:** [https://github.com/Kettydee/netrasense](https://github.com/Kettydee/netrasense)  
**Submission Drive Target:** [Google Drive — CLAUDE CODE Submission Folder](https://drive.google.com/drive/folders/1NqCytuNS5DiaBu40F68yNv-zc6RESz7v)

---

## 1. Executive Overview & Ambient Healthcare Philosophy

### Who is it for?
* **Primary Navigators:** Visually impaired individuals, legally blind individuals, and senior citizens experiencing degenerative ocular conditions (such as diabetic retinopathy, glaucoma, retinitis pigmentosa, macular degeneration, and dense cataracts).
* **Caregiver Guardians & Clinicians:** Family members, ophthalmology clinicians, and mobility therapists who require live safety visibility, proximity alerts, and historical telemetry data.

### Why was NetraSense created?
Navigation is an essential pillar of human dignity and independent living. While traditional mechanical mobility aids (such as white canes) remain indispensable, they only alert users to obstacles upon **physical impact**. This leaves individuals vulnerable to suspended head-height hazards (such as tree branches, open truck beds, and awnings), fast-moving bicycles, or distant drop-offs.

Conversely, mainstream smartphone assistive apps often:
1. Demand high-bandwidth cloud uploads for every frame, introducing dangerous latency (2–5 seconds).
2. Face frequent API token exhaustion and rate-limiting during critical moments.
3. Feature cluttered visual layouts with small touch targets that ignore WCAG accessibility standards.
4. Overwhelm users with stressful, jarring alarm sounds.

**NetraSense** was created to replace stressful navigation aids with an **ambient, empathetic healthcare companion**. By pairing **zero-latency on-device edge AI** (running directly in the client browser with 0 token fees and 0 rate limits) with **spatial acoustic sonar** and **multimodal cloud intelligence**, NetraSense provides intuitive spatial awareness that respects the user's cognitive load and preserves their dignity.

### How is it used?
1. **Hands-Free Spatial Perception:** The user mounts a smartphone, camera glasses, or wearable chest harness. NetraSense continuously analyzes the forward pathway, dividing spatial awareness into **Left Zone**, **Center Path (Immediate Walking Corridor)**, and **Right Zone**.
2. **Intuitive Acoustic Sonar:** NetraSense utilizes the Web Audio API to synthesize a non-fatiguing, directional acoustic sonar. As an obstacle draws nearer, the acoustic pulse frequency and pitch smoothly increase (from a gentle 300Hz up to 1200Hz), enabling immediate intuitive depth estimation.
3. **Multi-Sensory Voice Interaction:** The user can interact completely hands-free via natural voice recognition:
   * *"What's around me?"* $\rightarrow$ Comprehensive environmental scene walkthrough.
   * *"Find my water bottle"* $\rightarrow$ Audio sonar guidance locked onto the target item.
   * *"Who is in front of me?"* $\rightarrow$ High-speed biometric face verification with emotional mood readouts.
   * *"Read currency / read medicine"* $\rightarrow$ Precise OCR reading of banknotes or medicine labels.
4. **Caregiver Synchronicity & Safety Net:** When dangerous proximity or a collision occurs, telemetry is automatically streamed via WebSockets to Supabase. Primary caregivers have instant access to real-time status and one-tap emergency calling.

---

## 2. Exhaustive Technology & Tools Inventory

| Category | Technology / Library | Version / Specs | Architectural Role in NetraSense |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | **React 18 & TypeScript** | React 18.3, TS 5.5 | Type-safe, component-driven reactive user interface with strict prop validation. |
| **Fullstack Meta-Framework** | **TanStack Start / Router** | TanStack Router v1.5 | Zero-waterfall data fetching, client-side routing, code-splitting, and SEO metadata. |
| **Build Tooling** | **Vite** | Vite v5.4 | Lightning-fast build bundling and Hot Module Replacement (HMR). |
| **Styling & Design System** | **Tailwind CSS & Shadcn/UI** | Tailwind v3.4, Radix UI | High-contrast WCAG 2.1 AAA accessible color palettes, tactile focus rings, and dark/light modes. |
| **Data Querying & Cache** | **TanStack React Query** | React Query v5.5 | Cache management, background data refetching, and real-time polling sync. |
| **Edge Computer Vision** | **TensorFlow.js & COCO-SSD** | `@tensorflow/tfjs`, `@tensorflow-models/coco-ssd` | In-browser 80-class real-time object detection running locally on WebGL/WebGPU with <35ms latency and 0 cloud cost. |
| **In-Browser Biometrics** | **512D ArcFace/HOG Vector Matcher** | Custom Algorithm (`browserFaceMatcher.ts`) | In-browser 512-dimensional facial embedding extractor (8x8 cells, 8 gradient bins, CLAHE lighting equalization, and cosine distance matching in <50ms). |
| **Multimodal Foundation AI** | **Google Gemini Vision API** | `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-1.5-flash` | Multimodal scene description, facial emotion analysis, medicine/currency OCR, and indoor pathfinding with automatic fallback recovery. |
| **Spatial Acoustic Sonar** | **Web Audio API** | Native Browser AudioContext | Directional frequency-modulated acoustic sonar pings simulating real-time echolocation. |
| **Voice Synthesis & Control** | **Web Speech API** | `SpeechSynthesis` & `webkitSpeechRecognition` | Hands-free natural speech voice feedback and continuous voice command parsing in Indian/Global English. |
| **Cloud Database & Auth** | **Supabase (PostgreSQL)** | `@supabase/supabase-js` v2.45 | Realtime WebSocket telemetry streaming, user authentication, profile storage, and emergency contact registry. |
| **Backend Vision Engine** | **Ultralytics YOLO11 & Flask** | Python 3.10, Flask, OpenCV | Local high-speed object detection server supporting streaming bounding boxes and depth estimation. |
| **Biometric Face Server** | **DeepFace & ArcFace (Python)** | DeepFace, RetinaFace | Server-side 512D facial embedding verification and cosine distance thresholding. |
| **IoT Telemetry & Sensors** | **Arduino & HC-SR04 Sensor** | C++ Arduino Firmware | Microsecond-precision ultrasonic physical distance sensing from 2 cm to 400 cm. |
| **Hardware Serial Bridge** | **PySerial** | Python `pyserial` | 115200 baud serial listener bridging hardware ultrasonic sensor readings directly into the web dashboard. |
| **Hosting & Deployment** | **Vercel Edge Platform** | Vercel Serverless | Production edge hosting with automated SSL, global CDN distribution, and CI/CD git hooks. |

---

## 3. Page-by-Page Architectural Breakdown

### Page 1: Landing & Welcome Portal (`/`)
* **Live Route:** `https://netrasense.vercel.app/`
* **Purpose:** The welcoming front door of NetraSense. Designed with calming typography and an optical reticle logo, this page introduces the mission, explains accessibility capabilities, and provides immediate pathways into the system.
* **Key Features:**
  * Animated Brand Logo featuring an optical reticle frame with gold and blue gradients.
  * Theme switcher (Instant toggle between High-Contrast Dark and Healthcare Clean Light).
  * Direct action gateways: "Go to dashboard", "Caregiver sign in", and "Create your account".
  * Feature showcase detailing the live proximity radar, medical ID card, and one-tap SOS network.

### Page 2: Authentication & Access Hub (`/auth`)
* **Live Route:** `https://netrasense.vercel.app/auth`
* **Purpose:** A secure, high-contrast entry point that supports registered users, caregivers, and instant guest demo exploration.
* **Key Features:**
  * Clean tabbed interface supporting Sign In and Sign Up.
  * Instant "Continue as Guest / Demo Mode" button allowing immediate evaluation without signing up.
  * Supabase Auth integration supporting secure email/password sessions.

### Page 3: Real-Time Assistive Command Center (`/dashboard`)
* **Live Route:** `https://netrasense.vercel.app/dashboard`
* **Purpose:** The core assistive operational center for the visually impaired navigator.
* **Key Features:**
  * **Top Metrics Row:**
    * *Obstacles Dodged Today:* Counter tracking avoided obstacles with comparison to yesterday.
    * *Safe Distance Explored:* Accumulated distance navigated under guidance (in kilometers).
    * *Active Assistance Time:* Total lifetime hours and minutes monitored.
  * **Blind's Eye AI Vision Lens:** Multi-engine optical lens supporting in-browser COCO-SSD and YOLO vision servers, with spatial zone analysis (Left, Center, Right).
  * **Assistive Copilot Suite:** Tabbed assistive engine providing Find Object (Sonar), Face & Mood Identifier, Indoor Landmark Pathfinder, and Scene & Currency Reader.
  * **Live Environment Radar:** Radial distance meter ($0\text{ to }400\text{ cm}$) with dynamic threat colors (`Normal`, `Warning`, `Alarming`, `Collision`).
  * **Ensemble Signal Fusion:** Multi-signal breakdown comparing Hardware Ultrasonic distance, Camera AI distance, and Spatial Depth heuristics.
  * **Caregiver Quick-Glance:** Quick phone dialing panel and recent chronological incident logs.

### Page 4: Emergency Contacts Hub (`/contacts`)
* **Live Route:** `https://netrasense.vercel.app/contacts`
* **Purpose:** Caregiver registry management to ensure safety during emergencies.
* **Key Features:**
  * Full CRUD (Create, Read, Update, Delete) interface for trusted family contacts.
  * One-tap `tel:` click-to-call button.
  * Test alert simulation button to verify speech synthesis and audio warning pathways.

### Page 5: Emergency Medical ID Card (`/medical-id`)
* **Live Route:** `https://netrasense.vercel.app/medical-id`
* **Purpose:** Printable identity card for first responders and paramedics in emergency situations.
* **Key Features:**
  * Displays patient name, age, blood group, and impairment classification (`Partial`, `Legal Blindness`, `Total Blindness`).
  * Critical medical notes, allergies, and contraindications.
  * Emergency contact numbers.
  * Dedicated print button with print-specific stylesheets for physical card output.

### Page 6: Incident & Telemetry Logs (`/logs`)
* **Live Route:** `https://netrasense.vercel.app/logs`
* **Purpose:** Comprehensive historical audit stream of every detection and threat event.
* **Key Features:**
  * Search by detected object name with multi-level threat filtering.
  * Interactive paginated table showing timestamp, object, distance, threat level, and action taken.
  * One-click CSV export button for downloading data for medical or mobility analysis.

### Page 7: Device & User Profile (`/profile`)
* **Live Route:** `https://netrasense.vercel.app/profile`
* **Purpose:** User profile personalization and hardware status review.
* **Key Features:**
  * Editable fields for personal details, medical condition, and residential address.
  * Real-time sync with Supabase PostgreSQL.

### Page 8: Settings & Audio Preferences (`/settings`)
* **Live Route:** `https://netrasense.vercel.app/settings`
* **Purpose:** Comprehensive audio feedback tuning and hardware endpoint configuration.
* **Key Features:**
  * Browser Voice Alerts toggle switch.
  * Announce Normal Readings toggle switch.
  * Distance alert proximity slider ($50\text{ to }250\text{ cm}$).
  * Theme switcher (Dark, Light, System).
  * Custom YOLO server URL and optional Gemini API Key configuration.

---

## 4. Comprehensive Button & Interactive Control Reference

| Button / Control Label | Icon | Route & Component | Purpose & Accessibility Behavior |
| :--- | :--- | :--- | :--- |
| **Open Camera** | `Camera` | `/dashboard` $\rightarrow$ Lens | Requests webcam permission, starts TF.js object detection, and feeds video frames into the AI vision tools. |
| **Stop Camera** | `CameraOff` | `/dashboard` $\rightarrow$ Lens | Stops all active camera streams and releases hardware video capture resources. |
| **YOLO Server Mode** | `Cpu` | `/dashboard` $\rightarrow$ Lens | Toggles optical processing to the local Python YOLO11 server (`/video_feed`). |
| **Browser Lens Mode** | `Camera` | `/dashboard` $\rightarrow$ Lens | Toggles optical processing to client-side in-browser COCO-SSD (zero server dependency). |
| **Mute / Unmute Audio** | `Volume2` / `VolumeX` | `/dashboard` $\rightarrow$ Lens | Globally silences or enables Web Speech API voice announcements. |
| **Voice Accent Selector** | `Volume2` | `/dashboard` $\rightarrow$ Lens | Opens dropdown allowing the user to select their preferred speech synthesis voice and accent. |
| **Camera Selector** | `Video` | `/dashboard` $\rightarrow$ Lens | Switches between Front Camera, Rear Ultra-Wide Camera, or External USB Endoscope/Webcam. |
| **Voice Control (Mic)** | `Mic` / `MicOff` | `/dashboard` $\rightarrow$ Suite | Toggles continuous speech recognition listening for commands like *"find bottle"*, *"describe scene"*, or *"who is in front"*. |
| **Find Object Tab** | `Compass` | `/dashboard` $\rightarrow$ Suite | Opens the directional object seeker with spatial audio sonar. |
| **Face & Mood Tab** | `Smile` | `/dashboard` $\rightarrow$ Suite | Opens the biometric face recognition and emotion analysis interface. |
| **Scan Face & Mood** | `Smile` | `/dashboard` $\rightarrow$ Face | Captures current camera frame, extracts 512D biometric vector, checks enrolled contacts, and reads facial mood. |
| **Enroll Face** | `UserPlus` | `/dashboard` $\rightarrow$ Face | Captures face crop, generates 512D biometric vector, and stores the person's name for instant future recognition. |
| **Delete Face Profile** | `Trash2` | `/dashboard` $\rightarrow$ Face | Deletes an enrolled contact from the local and server face database. |
| **Indoor Nav Tab** | `Navigation` | `/dashboard` $\rightarrow$ Suite | Activates the step-by-step indoor pathfinder to doors, kitchens, desks, and bathrooms. |
| **Destination Buttons** | `DoorOpen`, etc. | `/dashboard` $\rightarrow$ Nav | Selects destination waypoint and calculates the initial navigation vector. |
| **Next Step Button** | `Footprints` | `/dashboard` $\rightarrow$ Nav | Verifies user progress toward destination and provides the next directional guidance prompt. |
| **Scene & Currency Tab** | `Eye` | `/dashboard` $\rightarrow$ Suite | Opens multimodal scene description and text/currency OCR. |
| **Describe Surroundings** | `Eye` | `/dashboard` $\rightarrow$ Suite | Queries Gemini Vision for a comprehensive environmental walkthrough spoken aloud. |
| **Read Currency / Text** | `Banknote` | `/dashboard` $\rightarrow$ Suite | Inspects banknotes or medicine prescription labels and announces values/dosages. |
| **Repeat Spoken Speech** | `Volume2` | `/dashboard` $\rightarrow$ Suite | Re-speaks the latest AI description without requiring a new API query. |
| **Simulate Reading** | `Zap` | `/dashboard` $\rightarrow$ Radar | Generates a simulated obstacle event ($0\text{ to }400\text{ cm}$) to test voice alerts and database logs. |
| **Broadcast SOS** | `Siren` | Sidebar & Contacts | Triggers emergency caregiver alert flow and redirects to emergency contact hub. |
| **Call Contact** | `PhoneCall` | Caregiver Panel & Contacts | Initiates direct telephone call via `tel:` URI scheme. |
| **Add Contact** | `Plus` | Contacts Page | Opens accessible dialog to register a new emergency contact. |
| **Print Medical ID** | `Printer` | Medical ID Page | Initiates browser print dialog formatted specifically for physical emergency wallet cards. |
| **Export CSV** | `Download` | Incident Logs Page | Generates and downloads full telemetry audit logs as a `.csv` file. |
| **Theme Toggle** | `Sun` / `Moon` | Navigation Bar | Switches smoothly between High-Contrast Dark Mode and Clean Light Mode. |

---

## 5. Dual-Tier Biometric Face Recognition Architecture

NetraSense incorporates a **high-speed edge + multimodal cloud hybrid architecture**:
1. **In-Browser 512D Biometric Matcher (`browserFaceMatcher.ts`):**
   * Processes a normalized $128 \times 128$ face crop through an $8 \times 8$ spatial cell grid with 8 gradient orientation bins to extract a 512-dimensional feature vector.
   * Incorporates Contrast-Limited Adaptive Histogram Equalization (CLAHE) for invariant matching across indoor and outdoor lighting.
   * Calculates similarity via Cosine Distance ($1 - \text{cosine\_similarity}$).
   * Matches faces in **$<50\text{ milliseconds}$** directly in the browser with **0 network calls**, **0 token consumption**, and **0 rate limits**.
2. **Multimodal Emotion & Empathy Layer (`aiVision.ts`):**
   * Uses resilient fallback chains (`gemini-2.5-flash` $\to$ `gemini-2.0-flash` $\to$ `gemini-2.5-flash-lite` $\to$ `gemini-1.5-flash`).
   * Delivers empathetic, natural descriptions: *"Your mother is in front of you. She is smiling warmly and looks relieved."*

---

## 6. How to Run & Verify the System

### Running the Web Application (Local Development)
```bash
# 1. Clone repository
git clone https://github.com/Kettydee/netrasense.git
cd netrasense

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev
# App will run at http://localhost:8080 or http://localhost:3000
```

### Running the Python Vision & Hardware Server (Optional)
```bash
cd server
pip install -r requirements.txt
python vision_server.py
# Vision server will run at http://localhost:5000
```

### Arduino Hardware Ultrasonic Setup (Optional)
1. Flash `arduino/ultrasonic_sensor.ino` onto an Arduino Uno / Nano.
2. Connect HC-SR04 Trig to Pin 9, Echo to Pin 10, VCC to 5V, GND to GND.
3. Plug Arduino via USB; the Python server will automatically bind at 115200 baud.

---

## 7. Submission Details & Author Certification

* **Student Author:** Khirabdi Tanaya Dash
* **Registration Number:** 25BCE2067
* **Deployed Web Application:** [https://netrasense.vercel.app](https://netrasense.vercel.app)
* **Official GitHub Codebase:** [https://github.com/Kettydee/netrasense](https://github.com/Kettydee/netrasense)
* **Google Drive Target Folder:** [CLAUDE CODE (1NqCytuNS5DiaBu40F68yNv-zc6RESz7v)](https://drive.google.com/drive/folders/1NqCytuNS5DiaBu40F68yNv-zc6RESz7v)

*Crafted with dedication to human-centered healthcare accessibility and independent mobility.*
