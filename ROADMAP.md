# Tendler Family Tree & Birthday Engine — Project Roadmap

A comprehensive, interactive genealogy platform and automated Jewish/Secular calendar generation system for the extended Tendler family.

---

## 🎯 Architecture & Next Phase Objectives

The next phase expands the platform beyond an interactive tree into an **automated family engagement and calendar delivery system**. This encompasses automated weekly/monthly email newsletters, custom high-resolution printable calendars (PDF/A4/Letter), intelligent unsubscribe flows, and Google Drive-backed dynamic caching.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Tendler Family Engine                           │
│                                                                        │
│   ┌───────────────────────┐          ┌─────────────────────────────┐   │
│   │   Interactive Tree    │          │    Dynamic Calendar Engine  │   │
│   │   & Live Modals (UI)  │          │  (1-Month Web & Full Year)  │   │
│   └───────────┬───────────┘          └──────────────┬──────────────┘   │
│               │                                     │                  │
│   ┌───────────▼───────────┐          ┌──────────────▼──────────────┐   │
│   │  Google Apps Script   │◄─────────┤   Automated Email Service   │   │
│   │  (Doc & Sheet Sync)   │          │  (Weekly Digest & Monthly)  │   │
│   └───────────────────────┘          └─────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📅 Roadmap Tasks

### Task 1 (Immediate Priority): High-Fidelity Dynamic Calendar Engine (Monthly & Full-Year Printable PDF)
> **Goal**: Design and implement an automated, beautifully styled calendar engine capable of rendering both a standalone single-month web view and a print-ready full-year PDF.

- [ ] **Dual-Date Layout Matrix (Hebrew & Gregorian in Every Cell)**:
  - Gregorian day number (top corner).
  - Hebrew date (Hebrew typography & transliteration/numerals).
  - Accurate Jewish leap year handling (Adar I / Adar II) and month transitions.
- [ ] **Multi-Category Event Layering with Color-Coded Visual Key**:
  - 🎂 **Hebrew Birthdays** (Theme Accent 1, distinct badge/dot).
  - 🎂 **English / Gregorian Birthdays** (Theme Accent 2, distinct badge/dot).
  - ✡️ **Jewish Holidays & Fast Days** (Rosh Hashana, Yom Kippur, Sukkot, Chanukah, Purim, Pesach, Shavuot, Minor fasts, Rosh Chodesh).
  - 🇺🇸 **US Federal Holidays** (Thanksgiving, Memorial Day, July 4th, Labor Day, etc.).
  - 🇮🇱 **Israeli National Holidays** (Yom HaZikaron, Yom HaAtzmaut, Yom Yerushalayim).
  - Clear, elegant **Legend / Key** integrated into the header/footer of each monthly sheet.
- [ ] **Website Aesthetic & Print-Optimized Formatting**:
  - Maintain the gold/navy refined typography and styling matching the live website.
  - Formatted for standard Letter/A4 horizontal printing (crisp vector typography, page breaks per month).
- [ ] **Automated Google Drive Cache & Invalidation**:
  - Pre-generate and cache the generated annual PDF in a designated Google Drive folder.
  - Compute checksum/timestamp against spreadsheet birthday data; automatically regenerate and overwrite when new family members or dates are added.

---

### Task 2: Weekly Birthday Email Digest
> **Goal**: Send an automated, elegant weekly email to family members notifying them of upcoming birthdays in the coming 7–10 days.

- [ ] **Spreadsheet Subscription Architecture**:
  - Expand the `Birthdays` sheet with two dedicated columns:
    - Column E: `Email Address`
    - Column F: `Subscribe to Birthday Emails?` (`Yes` / `No`)
  - Ensures emails remain preserved even if a member temporarily toggles notifications off.
- [ ] **Automated Apps Script Time-Driven Trigger**:
  - Weekly cron (e.g., every Sunday morning or Friday before Shabbat).
  - Collects upcoming English and Hebrew birthdays for the upcoming week.
  - Matches the recipient's personal preferences.
- [ ] **Rich Responsive Email Template**:
  - Styled with the family tree branding, cake badges, Hebrew & English dates, and relationship context.

---

### Task 3: Monthly First-of-the-Month Overview & Annual Calendar On-Demand Delivery
> **Goal**: Provide a recurring monthly calendar overview and on-demand self-service calendar generation.

- [ ] **1st of the Month Blast**:
  - Automatically dispatched on the 1st of every month to subscribers.
  - Highlights all milestone birthdays and holidays for the current month.
- [ ] **On-Demand "Email Me My Printable Calendar" Action**:
  - Single-click button in emails and on the web UI.
  - Triggers the backend script to fetch/regenerate the latest PDF from Google Drive and deliver it as an email attachment with a direct download link.
- [ ] **Annual Rosh Hashana / New Year Family Broadcast**:
  - Automated annual blast sending the complete fresh year calendar PDF to the entire master contact directory (`Contacts` tab + `Birthdays` tab).

---

### Task 4: Intelligent 1-Click Unsubscribe & Preference Center
> **Goal**: Ensure a frictionless, zero-friction opt-out experience respecting recipient preferences.

- [ ] **One-Click Unsubscribe Button / Link in Email Footer**:
  - Hyperlink with secure identifier / email parameter to a lightweight endpoint or preferences page.
  - Flips the member's subscription status from `Yes` to `No` in the spreadsheet automatically without manual editing.
- [ ] **Direct Management Link**:
  - Clear disclaimer and fallback hyperlink pointing directly to the spreadsheet and live portal for full profile updates.

---

### Task 5: Annual Automated Theme Rotation Engine (Pre-Approved Aesthetic Presets)
> **Goal**: Keep the website and dynamic calendars visually fresh by automatically transitioning to a new pre-approved theme every year (e.g. at Rosh Hashana / Jewish New Year).

- [ ] **Curated Theme Presets (10 Designer Themes)**:
  - Create ~10 fully designed, pre-approved CSS color palettes and typography pairings (e.g. *Jerusalem Stone & Gold*, *Royal Sapphire & Silver*, *Emerald Grove*, *Terracotta & Parchment*, *Modern Minimalist Slate*, *Classic Navy & Bronze*, etc.).
  - Ensure every theme passes strict contrast/accessibility standards and maintains full legibility for Hebrew glyphs.
- [ ] **Synchronized Web & Printable PDF Theme Inheritance**:
  - The calendar generation engine will inherit color tokens, fonts, and accents directly from the active annual theme so the website and printable calendars always match.
- [ ] **Automated Annual Scheduler & Rotation State**:
  - Automatically transitions to the next scheduled theme on the rotation list once per year (tied to Rosh Hashana / Sept 1st).
  - Admin override toggle in the UI or configuration to preview/switch themes on demand.

---

## 🚀 Implementation Phasing

| Phase | Milestone | Deliverable | Status |
|---|---|---|---|
| **Phase 1** | **Core Tree & Live Modals** | Interactive tree, search, contact cards, 7-day upcoming popup, inline birthday cakes | ✅ Complete |
| **Phase 2** | **Backend Read/Write Integration** | Apps Script Web App, Google Doc bullet sync, dynamic sheet row insertion | ✅ Complete |
| **Phase 3** | **Calendar Generation Engine** | Printable single-month & 12-month PDF engine with Hebrew/Secular/Holiday data | 🟡 **Next Up** |
| **Phase 4** | **Automated Email Pipeline** | Weekly birthday digest, monthly previews, 1-click unsubscribe endpoint | ⏳ Scheduled |
| **Phase 5** | **Annual Distribution & Cache** | Google Drive caching, auto-invalidation, master annual distribution blast | ⏳ Scheduled |
| **Phase 6** | **Annual Theme Rotation Engine** | ~10 pre-approved theme presets, scheduled annual auto-switch for site & calendar | ⏳ Final Milestone |

