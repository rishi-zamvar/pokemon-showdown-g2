# External Integrations

**Analysis Date:** 2026-02-26

## APIs & External Services

**Even Realities G2 Hardware:**
- Even Hub SDK - Core hardware integration for glass display and gesture input
  - SDK/Client: `@evenrealities/even_hub_sdk` 0.0.7
  - Connection: Async bridge via `waitForEvenAppBridge()` (15-second timeout via `BRIDGE_TIMEOUT_MS`)
  - Communication: Local connection to Even glasses when running from Even App dev mode

**Development Tools:**
- Even Hub Simulator - Local testing without physical hardware
  - Package: `@evenrealities/evenhub-simulator` 0.4.1
  - Access: Started via `npm run sim` (connects to localhost:5173)

## Data Storage

**Local Data:**
- Static JSON data files embedded in app
  - Pokédex data: `src/data/pokedex.json` (~500KB)
  - Move data: `src/data/moves.json` (~500KB)
  - Ability data: `src/data/abilities.json`
  - Item data: `src/data/items.json`
  - Type chart: `src/data/typechart.json`
  - Learnsets: `src/data/learnsets.json` (~3MB)
  - Sprites: PNG assets in `src/data/sprites/` (one per Pokemon)

**File Storage:**
- Local filesystem only - no remote file storage
- Bundled static assets included in dist build

**Caching:**
- Browser default caching (Vite-managed)
- No explicit cache layer implemented

## Authentication & Identity

**Auth Provider:**
- None - App runs within Even App ecosystem
- Even App handles device/user identity at OS level
- No user accounts or external authentication needed

## Monitoring & Observability

**Error Tracking:**
- None - No external error reporting service integrated
- Console logging only via `console.log()` and `console.warn()`

**Logs:**
- Browser console output
- Prefixed with `[glass]` and `[wakelock]` for source identification
- Status text displayed on phone UI via DOM updates

## CI/CD & Deployment

**Hosting:**
- Even Realities ecosystem (via Even App)
- App packaged as `.ehpk` file via `npm run pack`
- Deployed through Even Realities distribution channels

**CI Pipeline:**
- None detected - Manual build and deployment

## Environment Configuration

**Required env vars:**
- None - App is self-contained

**Secrets location:**
- No secrets in codebase
- Network access: Only to `evenhub.evenrealities.com` (declared in `app.json`)

## Networking

**Network Requirements:**
- Connection to `evenhub.evenrealities.com` (declared permission in `app.json`)
- No HTTP/HTTPS external APIs called
- No webhooks configured
- Bridge communication is local/wireless within Even App ecosystem

## Browser APIs Used

**Screen Wake Lock API:**
- Service: W3C Navigator.wakeLock
- Implementation: `src/services/wakeLockService.ts`
- Purpose: Prevents phone screen from sleeping during active play
- Fallback: Silent no-op if unavailable
- Automatic re-acquisition on page visibility change

**DOM APIs:**
- Document manipulation for status display
- Element querying (`getElementById`)
- CSS class manipulation for UI state

**Visibility API:**
- `document.visibilityState` monitoring
- Triggers wake lock re-acquisition on page visibility

## Gestures & Input

**Even Hub Gesture Events:**
- SCROLL_FWD/SCROLL_BACK - Touchpad swipes
- TAP - Single/double tap selection on glass
- FOREGROUND_ENTER/FOREGROUND_EXIT - App lifecycle events
- 300ms scroll cooldown enforced in `src/adapters/glassAdapter.ts`

## No External Dependencies

**Not used:**
- Database services (no persistence)
- API authentication (OAuth, JWT, etc.)
- Message queues
- Real-time sync services
- Analytics platforms
- CDNs (static assets bundled)
- Payment processors
- Third-party services

---

*Integration audit: 2026-02-26*
