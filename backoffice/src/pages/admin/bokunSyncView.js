export const BOKUN_SYNC_VIEW_CONFIG = {
  "confirmed-import": {
    title: "Confirmed Booking Import",
    eyebrow: "Bokun Sync",
    subtitle: "Import operationally confirmed Bokun bookings from connected channels into local accounting records.",
    actionLabel: "Run confirmed import"
  },
  manual: {
    title: "Manual Sync",
    eyebrow: "Bokun Sync",
    subtitle: "Run a controlled manual Bokun confirmed-booking sync with date/status filters.",
    actionLabel: "Run manual sync"
  },
  "single-booking": {
    title: "Single Booking Sync",
    eyebrow: "Bokun Sync",
    subtitle: "Resync one Bokun/local booking by confirmation code, external reference, Bokun ID, or booking reference.",
    actionLabel: "Run single resync"
  }
};

export const bokunSyncModeFromPath = (pathname = "") => {
  const tail = String(pathname || "").split("/").filter(Boolean).pop();
  return BOKUN_SYNC_VIEW_CONFIG[tail] ? tail : "confirmed-import";
};
