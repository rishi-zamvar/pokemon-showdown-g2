# Technology Stack

**Analysis Date:** 2026-02-26

## Languages

**Primary:**
- TypeScript 5.7.0 - Application logic, type definitions, and build compilation
- HTML5 - Entry point and connection interface (`index.html`)
- CSS3 - UI styling for phone debug interface and battle log display

## Runtime

**Environment:**
- Node.js 22.0.0 (specified in devDependencies)
- Browser environment (modern browsers supporting ES2019+)

**Package Manager:**
- npm
- Lockfile: present (`package-lock.json`)

## Frameworks

**Core:**
- @evenrealities/even_hub_sdk 0.0.7 - Primary framework for G2 glasses hardware integration, provides EvenAppBridge, container management, and event handling
- @evenrealities/evenhub-simulator 0.4.1 - Local simulator for testing G2 app behavior without physical hardware
- @evenrealities/evenhub-cli 0.1.5 - Command-line tooling for packaging and managing Even Realities apps

**Build/Dev:**
- Vite 6.0.0 - Module bundler and dev server with ES2019 target compilation
- TypeScript 5.7.0 - Compiler with strict type checking and module resolution

## Key Dependencies

**Critical:**
- @evenrealities/even_hub_sdk (0.0.7) - Provides EvenAppBridge for glass connection, container rendering APIs (ListContainerProperty, TextContainerProperty), event subscription, and gesture handling. Required for core G2 functionality.

**DevDependencies:**
- @types/node (22.0.0) - Type definitions for Node.js
- typescript (5.7.0) - TypeScript compiler
- vite (6.0.0) - Development server and production bundler

## Configuration

**Environment:**
- No environment variables required for local development
- Production app permission configured in `app.json`: network access to `evenhub.evenrealities.com`

**Build:**
- `vite.config.ts` - Configured with:
  - Base path: `./` (relative imports for packaging)
  - ES2019 target
  - Minification enabled
  - Custom asset naming (no hash suffixes)
- `tsconfig.json` - Strict mode enabled with:
  - Target: ES2022
  - Module: ESNext
  - No source maps
  - Bundler module resolution

**Packaging:**
- `app.json` - G2 app manifest defining:
  - Package ID: `com.rishi.g2pokemonshowdown`
  - Entry point: `index.html`
  - Min app version: 0.1.0
  - Permissions: Network access to Even Realities services

## Platform Requirements

**Development:**
- Node.js 22.x
- npm (comes with Node)
- Modern TypeScript tooling (5.7+)
- macOS, Linux, or Windows (platform-specific simulator binaries included)

**Production:**
- Even Realities G2 smart glasses (hardware target)
- Even App 0.1.0 or later
- Modern mobile phone with browser support for ES2019+

## Scripts

**Development:**
- `npm run dev` - Start Vite dev server with hot reload
- `npm run typecheck` - Run TypeScript compiler without emitting
- `npm run sim` - Start Even Hub simulator for local testing
- `npm run qr` - Generate QR code for app access

**Build & Deployment:**
- `npm run build` - TypeScript check + Vite build (outputs to `dist/`)
- `npm run preview` - Preview production build locally
- `npm run pack` - Build and package app as `.ehpk` file for Even Realities distribution

---

*Stack analysis: 2026-02-26*
