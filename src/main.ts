import { GlassAdapterImpl } from "./adapters/glassAdapter";
import { WakeLockServiceImpl } from "./services/wakeLockService";
import { DataLoader } from "./data/DataLoader";
import { ScreenController } from "./screens/ScreenController";

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
    return;
  }

  // Initialize screen controller and show main menu on glasses
  const screen = new ScreenController(glass);
  await screen.init();

  setStatus("Ready", "Battle on your glasses!");

  // Route all gestures through the screen controller
  glass.onGesture((event) => {
    void screen.handleGesture(event);
  });

  // Keep screen on during gameplay
  try {
    await wakeLock.acquire();
  } catch {
    console.warn("[WakeLock] Could not acquire wake lock");
  }
}

void bootstrap().catch((error: unknown) => {
  setStatus("Failed to start", String(error));
  const dot = document.getElementById("status-dot");
  if (dot) dot.className = "status-indicator error";
  console.error("G2 app failed to start", error);
});
