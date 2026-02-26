# Codebase Structure

**Analysis Date:** 2026-02-26

## Directory Layout

```
pokemon-showdown/
├── .planning/              # GSD planning documents (not committed initially)
│   └── codebase/          # Codebase analysis documents
├── src/                   # All application source code
│   ├── adapters/          # Hardware abstraction implementations
│   ├── config/            # Application configuration
│   ├── data/              # Static Pokémon game data
│   │   └── sprites/       # Pokémon PNG sprite assets
│   ├── services/          # Cross-cutting services
│   ├── types/             # TypeScript type definitions & contracts
│   ├── global.d.ts        # Global type augmentations
│   └── main.ts            # Application entry point
├── node_modules/          # Dependencies (git ignored)
├── dist/                  # Build output (git ignored)
├── index.html             # HTML entry point
├── app.json               # Even Realities app manifest
├── package.json           # NPM manifest
├── package-lock.json      # Dependency lock
├── tsconfig.json          # TypeScript configuration
├── vite.config.ts         # Vite build configuration
└── .gitignore             # Git exclusions
```

## Directory Purposes

**src/**
- Purpose: All TypeScript source code for the application
- Contains: Adapters, services, configurations, types, data references, entry point
- Key files: `main.ts` (entry point)

**src/adapters/**
- Purpose: Hardware abstraction layer implementations
- Contains: Implementations of GlassAdapter interface
- Key files: `glassAdapter.ts` (Even Hub SDK integration)

**src/config/**
- Purpose: Application-wide configuration and constants
- Contains: Display layout, timing parameters, container IDs, magic numbers
- Key files: `constants.ts` (GLASS_LAYOUT, TIMING, CONTAINER_IDS, CONTAINER_NAMES)

**src/data/**
- Purpose: Static Pokémon game data (not executable code)
- Contains: JSON files with Pokémon stats, moves, abilities, type charts; PNG sprite assets
- Key files:
  - `pokedex.json` - Pokémon base stats, types, evolution chains (~500KB)
  - `moves.json` - Move definitions and effects (~500KB)
  - `learnsets.json` - Which moves each Pokémon can learn (~3MB, largest)
  - `abilities.json` - Pokémon ability definitions
  - `items.json` - Item data
  - `typechart.json` - Type effectiveness matrix
  - `sprites/` - PNG images for each Pokémon form

**src/services/**
- Purpose: Reusable cross-cutting services
- Contains: Service implementations for application-level concerns
- Key files: `wakeLockService.ts` (W3C Wake Lock API wrapper)

**src/types/**
- Purpose: TypeScript type definitions and interface contracts
- Contains: Interface definitions, type aliases, contracts between layers
- Key files:
  - `contracts.ts` - GlassAdapter interface, GestureEvent types, StatusBar
  - `fsapi.d.ts` - File System Access API type declarations (not currently used)

**src/global.d.ts**
- Purpose: Global type augmentations
- Contains: HTMLInputElement webkitdirectory property extension
- Usage: Non-standard browser APIs

## Key File Locations

**Entry Points:**

- `index.html` - HTML page served by Vite dev server and built into dist/
  - Defines DOM structure with status and log elements
  - Loads `src/main.ts` as module script
  - Inline styles for status indicators and battle log

- `src/main.ts` - TypeScript entry point (71 lines)
  - Implements `bootstrap()` function
  - Instantiates GlassAdapter and WakeLockService
  - Registers gesture event listener
  - Updates DOM status elements
  - Error handling and status reporting

**Configuration:**

- `app.json` - Even Realities app manifest
  - Package ID: com.rishi.g2pokemonshowdown
  - Declares network permission for evenhub.evenrealities.com

- `src/config/constants.ts` - All magic numbers and layout config
  - DISPLAY: Width/height (576×288)
  - GLASS_LAYOUT: Content and status bar positioning and dimensions
  - TIMING: Scroll cooldown (300ms), bridge timeout (15s)
  - CONTAINER_IDS: Numeric IDs for content/status/statusRight containers
  - CONTAINER_NAMES: String names for containers ("content", "status", "statusR")

- `tsconfig.json` - TypeScript compiler settings
  - Target: ES2022
  - Module resolution: bundler
  - Strict mode enabled
  - Source root: src/

- `vite.config.ts` - Vite dev server and build configuration
  - Base path: "./" (relative imports)
  - Build output: dist/
  - Minification enabled
  - No source maps

- `package.json` - NPM manifest
  - Dependencies: @evenrealities/even_hub_sdk (^0.0.7)
  - Dev dependencies: TypeScript (^5.7.0), Vite (^6.0.0), @types/node (^22.0.0)
  - Scripts: dev (vite), build (tsc + vite build), typecheck, sim, qr, pack

**Core Logic:**

- `src/adapters/glassAdapter.ts` - Even Hub SDK integration (354 lines)
  - GlassAdapterImpl class implementing GlassAdapter interface
  - Methods: connect(), onGesture(), showList(), showText(), updateText(), showMessage()
  - Internal methods for container rendering, event binding, event mapping
  - Handles SDK quirks and timing requirements

- `src/services/wakeLockService.ts` - Screen wake lock service (78 lines)
  - WakeLockServiceImpl class implementing WakeLockService interface
  - Methods: acquire(), release()
  - Handles visibility change events and automatic re-acquisition
  - Best-effort implementation (graceful failures)

**Type Definitions:**

- `src/types/contracts.ts` - Interface and type contracts (28 lines)
  - GlassAdapter interface with all public methods
  - GestureEvent discriminated union type with GestureKind enum
  - StatusBar interface (left/right text)
  - Unsubscribe callback type

- `src/types/fsapi.d.ts` - File System Access API types (46 lines)
  - FileSystemHandlePermissionDescriptor
  - FileSystemDirectoryHandle interface
  - FileSystemFileHandle interface
  - showDirectoryPicker function declaration

## Naming Conventions

**Files:**

- Adapters: `[feature]Adapter.ts` (e.g., `glassAdapter.ts`)
- Services: `[feature]Service.ts` (e.g., `wakeLockService.ts`)
- Type files: `[domain].ts` (e.g., `contracts.ts`, `fsapi.d.ts`)
- Config: `constants.ts` (or `[feature]` in subdirectory)
- Data: `[entity].json` (e.g., `pokedex.json`, `moves.json`)

**Directories:**

- `adapters/` - Hardware/external system abstractions
- `services/` - Reusable utilities and cross-cutting concerns
- `types/` - TypeScript type definitions and contracts
- `config/` - Application configuration
- `data/` - Static data files (JSON, assets)

**Classes:**

- Implementation suffix: `[Feature]Impl` (e.g., `GlassAdapterImpl`, `WakeLockServiceImpl`)
- Interface prefix: None, just the name (e.g., `GlassAdapter`, `WakeLockService`)

**Functions & Methods:**

- Utilities: camelCase, verb-first where applicable (e.g., `showText()`, `onGesture()`)
- Private methods: camelCase with leading underscore convention not used; just camelCase
- Event handlers: `on[Event]` pattern (e.g., `onGesture()`, `onEvenHubEvent()`)

**Variables & Constants:**

- Constants: CONSTANT_CASE (e.g., GLASS_LAYOUT, SCROLL_COOLDOWN_MS, CONTAINER_IDS)
- Service properties: camelCase (e.g., `bridge`, `sentinel`, `wantLock`)
- Local variables: camelCase (e.g., `statusText`, `containerTotalNum`)

## Where to Add New Code

**New Feature (Game Logic):**
- Primary code: Create `src/logic/` directory with feature-specific files
  - Example: `src/logic/battleLogic.ts`, `src/logic/pokemonService.ts`
  - Import Pokémon data from `src/data/` as needed
- Tests: Create `src/logic/__tests__/` or `__tests__/logic/` (depends on test structure decision)
- Data loading: Add data loading utility in `src/data/loader.ts` if needed
- Example structure:
  ```
  src/logic/
  ├── battleLogic.ts      # Turn-based battle state machine
  ├── pokemonService.ts   # Pokémon team/stats management
  ├── moveResolver.ts     # Move damage calculation
  └── __tests__/
      ├── battleLogic.test.ts
      └── moveResolver.test.ts
  ```

**New Component or UI Mode:**
- Primary code: Create `src/components/` (if componentized later) or feature-specific logic file
- Adapter usage: Use existing `GlassAdapter` interface in `src/adapters/glassAdapter.ts`
- Styling: Add styles inline to `index.html` or extract to `src/styles/` with CSS imports
- Example: Battle UI would call `glass.showText()` with formatted battle state

**New Service:**
- Implementation: `src/services/[feature]Service.ts`
  - Export interface: `[Feature]Service`
  - Export implementation: `[Feature]ServiceImpl`
- Type contracts: Add types to `src/types/contracts.ts` or create `src/types/[feature].ts`
- Instantiation: Create in `src/main.ts` bootstrap and pass to handlers

**New Adapter:**
- Implementation: `src/adapters/[feature]Adapter.ts`
  - Implement from `src/types/contracts.ts` interface
  - Hide implementation details behind clean public interface
- SDK integration: Wrap external SDK/API completely within adapter
- Example: Future GameDataAdapter wrapping Pokémon data loading

**Utility Functions:**
- Shared helpers: `src/utils/` (if multiple features need them)
  - Example: `src/utils/formatters.ts` for text formatting
  - Example: `src/utils/calculator.ts` for battle damage calculations
- Feature-specific: Keep inside feature module
  - Example: `src/logic/battleLogic.ts` has internal helper functions

**Configuration Changes:**
- New settings: Add to `src/config/constants.ts` with semantic grouping
  - Example: Add `BATTLE_TIMING` constant object for turn duration, animation timing
- Feature config: Consider feature-specific constants file if many
  - Example: `src/logic/battleConfig.ts` with battle-specific settings

## Special Directories

**node_modules/**
- Purpose: NPM dependencies
- Generated: Yes (npm install)
- Committed: No (git ignored)
- Contents: @evenrealities SDK, TypeScript, Vite, type definitions

**dist/**
- Purpose: Build output for production deployment
- Generated: Yes (npm run build)
- Committed: No (git ignored)
- Contents: Bundled JavaScript, assets, index.html

**.planning/codebase/**
- Purpose: GSD codebase analysis documents
- Generated: Yes (by /gsd:map-codebase command)
- Committed: Eventually (after review)
- Contents: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md

---

*Structure analysis: 2026-02-26*
