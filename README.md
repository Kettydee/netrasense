# NetraSense Companion

Act as an expert Senior Full-Stack Engineer and UI/UX Designer specialized in WCAG 2.1 AAA accessible web applications. Build a production-ready, highly responsive Assistive Navigation & Telemetry Dashboard called "AegisNav" designed for visually impaired individuals and their caregivers.

### 1. Design System, Theme & Accessibility

- **Color Palette & Visual Balance:** Clean, minimal, high-contrast dark/light mode support.

  - Background: Deep slate/neutral base (`#0F172A` / `#F8FAFC`).

  - Card Surfaces: Elevated cards (`#1E293B` / `#FFFFFF`) with crisp borders (`#334155` / `#E2E8F0`).

  - Semantic Status Colors:

    - Normal: Emerald Green (`#10B981`)

    - Warning: Amber/Yellow (`#F59E0B`)

    - Alarming: Vibrant Orange (`#F97316`)

    - Collision / Emergency: Crimson Red (`#EF4444`)

  - Accent Color: Electric Indigo (`#6366F1`) for primary actions.

- **Typography & Accessibility:**

  - Crisp, highly legible sans-serif typography with generous line-heights.

  - Screen-reader friendly semantic HTML tags (`<main>`, `<nav>`, `<aside>`, `<section>`, `aria-live` for dynamic alerts).

  - High-contrast visual focus rings for full keyboard navigability (Tab traversal).

---

### 2. Architecture & Supabase Backend Schema

Automatically generate and link Supabase PostgreSQL tables with Realtime Replication enabled:

1. `profiles`:

   - `id` (uuid, primary key, references auth.users)

   - `full_name` (text)

   - `age` (integer)

   - `blood_group` (text)

   - `emergency_medical_notes` (text)

   - `impairment_level` (enum: Partial, Legal Blindness, Total)

   - `home_address` (text)

   - `created_at` (timestamp)

2. `emergency_contacts`:

   - `id` (uuid, primary key, default gen_random_uuid())

   - `user_id` (uuid, references profiles.id on delete cascade)

   - `contact_name` (text)

   - `relationship` (text)

   - `phone_number` (text)

   - `is_primary` (boolean)

   - `notify_on_collision` (boolean, default true)

3. `telemetry_stream`:

   - `id` (uuid, primary key, default gen_random_uuid())

   - `user_id` (uuid, references profiles.id)

   - `detected_object` (text)

   - `distance_cm` (numeric)

   - `threat_level` (enum: Normal, Warning, Alarming, Collision)

   - `created_at` (timestamp with time zone, default now())

4. `daily_stats`:

   - `user_id` (uuid, references profiles.id)

   - `date` (date)

   - `obstacles_avoided` (integer, default 0)

   - `safe_distance_walked_m` (numeric, default 0)

   - `active_session_minutes` (integer, default 0)

---

### 3. Application Layout & Navigation Structure

#### A. Left Sidebar Navigation (Collapsible on Mobile)

- **Header:** App logo with an active system status indicator badge ("ESP32 Live Stream: Connected").

- **Navigation Links with Icons (Lucide-React):**

  - 📊 Realtime Dashboard

  - 👤 User Profile & Medical ID

  - 🚨 Emergency Contacts Hub

  - 📜 Incident & Telemetry Logs

  - ⚙️ Settings & Audio Preferences

- **Footer:** Direct one-click high-visibility **"BROADCAST SOS"** button (triggers visual emergency modal & logs critical alert) and a Logout button.

---

#### B. Auth Flow (Sign In / Sign Up & Onboarding)

- **Sign In / Sign Up Screen:** Modern card layout with email & password auth via Supabase.

- **First-time Onboarding Modal / Profile Setup:**

  - Mandatory capture: Full Name, Age, Blood Group, Impairment Level, and at least 1 Primary Emergency Contact.

  - Automatically redirects to the Dashboard once initial profile creation is completed.

---

#### C. Dashboard View (`/dashboard`)

1. **Gamified / Motivational Stats Grid (Top Row):**

   - **Card 1: Obstacles Dodged Today** (e.g., "🎉 343 Obstacles Avoided" with a progress comparison indicator vs yesterday).

   - **Card 2: Safe Distance Explored** (e.g., "2.4 km Navigated").

   - **Card 3: Active Assistance Time** (e.g., "1h 45m Monitored").

   - **Card 4: System Reliability** (e.g., "98.3% Sensor Precision" & 0 False Triggers).

2. **Live Telemetry & Proximity Radar (Main Section):**

   - **Live Proximity Card:**

     - Displays latest detected obstacle label (e.g., "Moving Vehicle", "Stairs", "Poles").

     - Animated Radial/Bar Distance Meter ($0\text{ to }400\text{ cm}$).

     - Dynamic Threat Badge changing color and pulse animation based on status (`Collision`, `Alarming`, `Warning`, `Normal`).

   - **Audio Feedback Engine:**

     - A toggleable switch for **"Browser Voice Alerts"** (Web Speech API).

     - When enabled, automatically speaks out: `"Warning: [detected_object] at [distance_cm] centimeters"` whenever status hits `Alarming` or `Collision`.

3. **Caregiver Quick-Glance Section (Right/Bottom Section):**

   - **Emergency Contacts Quick Panel:** Displays primary emergency contact numbers with direct `tel:` click-to-call action buttons.

   - **Recent Incident Log Stream:** Live-updating feed showing the last 5 obstacle encounters with relative time formatting (e.g., "2 seconds ago").

---

#### D. User Profile & Medical Card View (`/profile`)

- Clean form to view and edit all personal and medical information.

- High-visibility printable **Emergency Medical ID Card** component containing Blood Group, Critical Medical Notes, Impairment Details, and Primary Contact Numbers.

---

#### E. Emergency Contacts Management View (`/contacts`)

- Interactive CRUD interface:

  - Add contact dialog (Name, Relationship, Phone Number, Primary toggle, Collision alert SMS/WhatsApp notification toggle).

  - Edit & Delete buttons.

  - One-tap "Test Alert Call" simulation button.

---

#### F. Incident History View (`/logs`)

- Filterable, searchable data table displaying all historical telemetry entries from `telemetry_stream`.

- Columns: Timestamp, Detected Object, Estimated Distance (cm), Threat Classification, Action Taken.

- Export as CSV button.

---

### 4. Technical Implementation Details

- Build using **React, Vite, Tailwind CSS, Lucide Icons, and Supabase JS Client**.

- Realtime Subscriptions: Use `supabase.channel('telemetry_stream')` to listen for new database inserts and update dashboard state instantly without page refresh.

- Empty States & Loading Skeletons: Gracefully handle loading states and empty database states with accessible fallback placeholders.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://netrasense.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/1cbb3a56-cd35-4eb7-9bd4-3f6f293b842e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
