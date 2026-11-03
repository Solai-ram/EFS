export type NetworkQuality = "offline" | "slow" | "online";

export function getNetworkQuality(): NetworkQuality {
  if (typeof navigator === "undefined" || !navigator.onLine) return "offline";

  const conn = (
    navigator as Navigator & {
      connection?: { effectiveType?: string; downlink?: number };
    }
  ).connection;

  const effectiveType = conn?.effectiveType ?? null;
  const downlinkMbps = typeof conn?.downlink === "number" ? conn.downlink : null;

  const slowTypes = new Set(["slow-2g", "2g", "3g"]);
  if (effectiveType && slowTypes.has(effectiveType)) return "slow";
  if (downlinkMbps != null && downlinkMbps < 1) return "slow";

  return "online";
}

/** Background poll interval — slower on weak hospital Wi‑Fi. */
export function getSyncPollIntervalMs(): number {
  const q = getNetworkQuality();
  if (q === "offline") return 120_000;
  if (q === "slow") return 180_000;
  return 90_000;
}

/** Max outbox rows to upload per background cycle (one voice file at a time). */
export function getMaxItemsPerBackgroundSync(): number {
  return 1;
}

/** Pause between finishing one queued submission and starting the next. */
export function getDelayBetweenOutboxItemsMs(): number {
  const q = getNetworkQuality();
  if (q === "slow") return 45_000;
  return 12_000;
}

/** Pause after text is saved before uploading voice (same submission). */
export function getDelayBeforeVoiceUploadMs(): number {
  const q = getNetworkQuality();
  if (q === "slow") return 15_000;
  return 4_000;
}

/** Quick inline retries right after employee taps Submit. */
export function getSubmitQuickRetryCount(): number {
  const q = getNetworkQuality();
  if (q === "offline") return 0;
  if (q === "slow") return 2;
  return 3;
}
