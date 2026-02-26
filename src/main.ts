import { GlassAdapterImpl } from "./adapters/glassAdapter";
import { WakeLockServiceImpl } from "./services/wakeLockService";
import { DataLoader } from "./data/DataLoader";

/**
 * Bootstrap your G2 app here.
 *
 * Available glass adapter methods:
 *   glass.showList(items, statusText)  — scrollable list with tap selection
 *   glass.showText(text, status)       — text display with split status bar (full rebuild)
 *   glass.updateText(text, status)     — in-place text update (no flash, max 2000 chars)
 *   glass.showMessage(text)            — simple centered message
 *
 * Gesture events from glass.onGesture():
 *   SCROLL_FWD        — swipe forward (down on touchpad)
 *   SCROLL_BACK       — swipe backward (up on touchpad)
 *   TAP               — single/double tap (includes listIndex for list selection)
 *   FOREGROUND_ENTER  — app came to foreground
 *   FOREGROUND_EXIT   — app went to background
 */

function setStatus(text: string, detail?: string): void {
  const statusText = document.getElementById("status-text");
  const statusDetail = document.getElementById("status-detail");
  const dot = document.getElementById("status-dot");

  if (statusText) statusText.textContent = text;
  if (statusDetail) statusDetail.textContent = detail ?? "";
  if (dot) dot.className = "status-indicator connecting";
}

async function bootstrap(): Promise<void> {
  setStatus("Connecting to glasses...", "Open this page from Even App dev mode");

  const glass = new GlassAdapterImpl();
  const wakeLock = new WakeLockServiceImpl();

  await glass.connect();

  const dot = document.getElementById("status-dot");
  if (dot) dot.className = "status-indicator connected";
  setStatus("Connected");

  // Validate all data files at boot — throws immediately if any file is corrupt
  try {
    DataLoader.validate();
    console.log("[DataLoader] All data files validated successfully");
  } catch (err) {
    console.error("[DataLoader] Data validation failed:", err);
    setStatus("Data error", String(err));
    return; // Do not proceed with broken data
  }

  // --- Your app logic starts here ---

  // Example: show a welcome message
  await glass.showMessage("Hello from G2!");

  // Example: listen for gestures
  glass.onGesture((gesture) => {
    console.log("Gesture:", gesture.kind, gesture.listIndex);

    // Handle gestures for your app here
  });

  // Example: show a list
  // await glass.showList(["Option A", "Option B", "Option C"], "Pick one");

  // Example: show text with status bar
  // await glass.showText("Main content here", { left: "Title", right: "1/5" });

  // Example: wake lock (keeps phone screen on)
  // await wakeLock.acquire();
  // await wakeLock.release();
}

void bootstrap().catch((error: unknown) => {
  setStatus("Failed to start", String(error));
  const dot = document.getElementById("status-dot");
  if (dot) dot.className = "status-indicator error";
  console.error("G2 app failed to start", error);
});
