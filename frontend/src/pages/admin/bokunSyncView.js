export const BOKUN_SYNC_VIEW_CONFIG = {
  "confirmed-import": {
    title: "Bókun Integration",
    eyebrow: "Integrations",
    subtitle: "Automatic: the server imports confirmed Bókun bookings (website, GetYourGuide, Viator and other channels) on a schedule. Check the scheduled import here, or run it now.",
    actionLabel: "Run confirmed import"
  },
  manual: {
    title: "Sync Center",
    eyebrow: "Integrations",
    subtitle: "Manual: run a one-off import for the dates and statuses you choose, for example to catch up after a gap. The scheduled import keeps running on its own.",
    actionLabel: "Run manual sync"
  },
  "single-booking": {
    title: "Manual Lookup",
    eyebrow: "Integrations",
    subtitle: "One booking: find it in Bókun by confirmation code, OTA reference, Bókun ID or our reference, and refresh it here.",
    actionLabel: "Run single resync"
  }
};

export const bokunSyncModeFromPath = (pathname = "") => {
  const tail = String(pathname || "").split("/").filter(Boolean).pop();
  return BOKUN_SYNC_VIEW_CONFIG[tail] ? tail : "confirmed-import";
};
