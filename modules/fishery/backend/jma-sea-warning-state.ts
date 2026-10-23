// Pure known-history projection. Persist every observation, including rejected XML, before calling.
// No scheduler, database, publication approval, AI, or inference that a sea area is safe.
import { jmaFeeds, jmaHash, jmaInstant, jmaUrl, parseJmaBulletin, parseJmaFeed, type JmaBulletin } from "./jma-marine.ts";
import { jmaSeaWarningAdapterVersion, jmaSeaWarningProducts, parseJmaSeaWarning } from "./jma-sea-warning.ts";

type Feed = ReturnType<typeof parseJmaFeed>;
type Warning = ReturnType<typeof parseJmaSeaWarning>;
export type JmaSeaWarningDiscovery = Feed["entries"][number] & {
  feedSha256: string;
  feedUpdatedAt: string;
  observedAt: string;
};

// Discovery must not hide a changed title or a new edition by filtering it out before validation.
export function discoverJmaSeaWarnings(feed: Feed) {
  return feed.entries.filter(e => /_(?:VPZU|VPCU)\d+_\d+\.xml$/.test(e.url)
    || /全般海上警報|地方海上警報/.test(e.title));
}

export type JmaSeaWarningObservation = {
  id: string;
  url: string;
  sha256: string;
  rawBytes: Buffer;
  metadata: JmaBulletin | null;
  groupKey: string | null;
  warning: Warning | null;
  error: string | null;
};

export function inspectJmaSeaWarning(input: Uint8Array, url: string): JmaSeaWarningObservation {
  jmaUrl(url);
  if (jmaFeeds.includes(url as typeof jmaFeeds[number])) throw new Error("Expected bulletin URL");
  const rawBytes = Buffer.from(input), sha256 = jmaHash(rawBytes);
  let metadata: JmaBulletin | null = null, warning: Warning | null = null, groupKey: string | null = null, error: string | null = null;
  try {
    metadata = parseJmaBulletin(rawBytes, url);
    const code = new URL(url).pathname.match(/_\d+_([A-Z0-9]+)_\d+\.xml$/)?.[1];
    const product = code && jmaSeaWarningProducts[code as keyof typeof jmaSeaWarningProducts];
    // A changed identity cannot safely be assigned to an older office group from its URL alone.
    if (product && metadata.title === product.title && metadata.eventId === null) groupKey = metadata.groupKey;
    warning = parseJmaSeaWarning(rawBytes, url);
  } catch (e) { error = e instanceof Error ? e.message : "Unrecognized JMA bulletin"; }
  return { id: `${url}#sha256=${sha256}`, url, sha256, rawBytes, metadata, groupKey, warning, error };
}

const evidence = (o: JmaSeaWarningObservation) => ({ id: o.id, url: o.url, sha256: o.sha256, bytes: o.rawBytes.length });
type Lifecycle = "warning_reference" | "release_notice" | "no_warning_notice" | "expired" | "future"
  | "non_operational" | "conflict" | "quarantined" | "cancellation_unverified";

export function projectJmaSeaWarnings(history: JmaSeaWarningObservation[], options: {
  now: string;
  maxFeedAgeMs: number;
  maxReviewAgeMs: number;
  // Persist returned discoveries even when no bulletin bytes were obtained. Feed roll-off is not resolution.
  discovered: JmaSeaWarningDiscovery[];
  feed: { url: string; rawBytes: Uint8Array; checkedAt: string } | null;
}) {
  const at = Date.parse(jmaInstant(options.now, "projection clock"));
  for (const n of [options.maxFeedAgeMs, options.maxReviewAgeMs]) {
    if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Explicit positive local review horizons required");
  }
  // No caller-edited parse trees or receipt hashes can replace reparsing the saved original bytes.
  const observations = [...new Map(history.map(o => {
    const checked = inspectJmaSeaWarning(o.rawBytes, o.url);
    if (checked.sha256 !== o.sha256 || checked.id !== o.id) throw new Error("JMA observation integrity failure");
    return [checked.id, checked] as const;
  })).values()].sort((a, b) => a.id.localeCompare(b.id));
  const blockers: string[] = [];
  const hashesByUrl = new Map<string, Set<string>>();
  for (const o of observations) hashesByUrl.set(o.url, new Set([...(hashesByUrl.get(o.url) ?? []), o.sha256]));
  if ([...hashesByUrl.values()].some(hashes => hashes.size > 1)) blockers.push("immutable_url_conflict");
  const unscoped = observations.filter(o => !o.groupKey);
  if (unscoped.length) blockers.push("unscoped_rejected_bulletin");

  let feedEvidence: { url: string; sha256: string; checkedAt: string; updatedAt: string; candidateCount: number } | null = null;
  const discovered = new Map<string, JmaSeaWarningDiscovery>();
  const remember = (d: JmaSeaWarningDiscovery) => {
    jmaUrl(d.url); jmaInstant(d.updatedAt, "entry.updatedAt"); jmaInstant(d.feedUpdatedAt, "discovery feedUpdatedAt"); jmaInstant(d.observedAt, "discovery observedAt");
    if (!/^[a-f0-9]{64}$/.test(d.feedSha256)) throw new Error("Invalid discovery feed hash");
    const key = JSON.stringify([d.url, d.title]);
    const old = discovered.get(key);
    if (!old || Date.parse(d.observedAt) < Date.parse(old.observedAt)) discovered.set(key, d);
  };
  options.discovered.forEach(remember);
  if (!options.feed) blockers.push("feed_unavailable");
  else {
    if (options.feed.url !== jmaFeeds[2]) throw new Error("Marine warning discovery requires other_l");
    const checkedAt = jmaInstant(options.feed.checkedAt, "feed checkedAt");
    const feed = parseJmaFeed(new TextDecoder("utf-8", { fatal: true }).decode(options.feed.rawBytes));
    const candidates = discoverJmaSeaWarnings(feed);
    feedEvidence = { url: options.feed.url, sha256: jmaHash(options.feed.rawBytes), checkedAt, updatedAt: feed.updatedAt, candidateCount: candidates.length };
    candidates.forEach(e => remember({ ...e, feedSha256: feedEvidence!.sha256, feedUpdatedAt: feed.updatedAt, observedAt: checkedAt }));
    if (Date.parse(checkedAt) > at || Date.parse(feed.updatedAt) > at) blockers.push("feed_future");
    if (at - Date.parse(checkedAt) >= options.maxFeedAgeMs || at - Date.parse(feed.updatedAt) >= options.maxFeedAgeMs) blockers.push("feed_stale");
  }
  const discoveries = [...discovered.values()].sort((a, b) => a.url.localeCompare(b.url) || a.title.localeCompare(b.title));
  const unresolved = discoveries.filter(e => !hashesByUrl.has(e.url));
  if (unresolved.length) blockers.push("unresolved_feed_bulletins");
  const byUrl = new Map(observations.map(o => [o.url, o]));
  if (discoveries.some(e => byUrl.get(e.url)?.metadata && byUrl.get(e.url)!.metadata!.title !== e.title)) blockers.push("feed_title_mismatch");

  const groups = new Map<string, JmaSeaWarningObservation[]>();
  for (const o of observations) if (o.groupKey) groups.set(o.groupKey, [...(groups.get(o.groupKey) ?? []), o]);
  const latestKnown = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([groupKey, rows]) => {
    rows.sort((a, b) => Date.parse(b.metadata!.sentAt) - Date.parse(a.metadata!.sentAt) || a.id.localeCompare(b.id));
    const latest = rows[0], metadata = latest.metadata!, warning = latest.warning;
    const sameTime = rows.filter(o => Date.parse(o.metadata!.sentAt) === Date.parse(metadata.sentAt));
    let lifecycle: Lifecycle;
    if (new Set(sameTime.map(o => o.sha256)).size > 1) lifecycle = "conflict";
    else if (metadata.status !== "通常") lifecycle = "non_operational";
    else if (!warning) lifecycle = metadata.infoType === "取消" ? "cancellation_unverified" : "quarantined";
    else if (Date.parse(metadata.sentAt) > at || Date.parse(metadata.publishedAt) > at) lifecycle = "future";
    else if (metadata.validUntil && at >= Date.parse(metadata.validUntil)) lifecycle = "expired";
    else lifecycle = warning.notice === "official_release_notice" ? "release_notice"
      : warning.notice === "official_no_warning_notice" ? "no_warning_notice" : "warning_reference";
    const localReviewUntil = new Date(Date.parse(metadata.publishedAt) + options.maxReviewAgeMs).toISOString();
    const reviewBlockers = [...blockers];
    if (at >= Date.parse(localReviewUntil)) reviewBlockers.push("local_review_stale");
    if (!["warning_reference", "release_notice", "no_warning_notice"].includes(lifecycle)) reviewBlockers.push(lifecycle);
    return {
      groupKey, lifecycle, transition: metadata.infoType === "訂正" ? "correction" : rows.length > sameTime.length ? "update" : "first_observed",
      evidence: evidence(latest), conflictingEvidence: lifecycle === "conflict" ? sameTime.map(evidence) : [],
      supersedes: rows.filter(o => Date.parse(o.metadata!.sentAt) < Date.parse(metadata.sentAt)).map(evidence),
      metadata, notice: warning?.notice ?? null, error: latest.error,
      areaBindings: warning?.areaBindings ?? [],
      catalogs: warning ? { zones: warning.zoneCatalog, warningCodes: warning.warningCodeCatalog } : null,
      officialValidUntil: metadata.validUntil, localReviewUntil,
      eligibleForReview: reviewBlockers.length === 0, reviewBlockers,
      // Even an official release says nothing about safe navigation or other warning products.
      safeToNavigate: null, publicationApproved: false as const,
    };
  });
  return {
    schema: "jma-sea-warning-snapshot/1" as const, adapterVersion: jmaSeaWarningAdapterVersion, evaluatedAt: options.now,
    feed: feedEvidence, sourceBlockers: blockers, discovered: discoveries, unresolved,
    rejectedWithoutGroup: unscoped.map(o => ({ ...evidence(o), error: o.error })), latestKnown,
    coverage: "observed_feed_window_only_not_delivery_guarantee" as const,
    intendedUse: "official_warning_reference_review" as const,
    navigationWarningComplete: false as const, replacesVesselWarningSystem: false as const,
  };
}
