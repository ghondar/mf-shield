import { describe, expect, it } from "vitest";

import { validateRemoteEntries } from "../src/core";
import type { RemoteEntryInput } from "../src/core";

describe("validateRemoteEntries", () => {
  it("returns no issues for a clean set of https entries", () => {
    const entries: RemoteEntryInput[] = [
      { name: "stable", entry: "https://cdn.pokedex.example/stable/mf-manifest.json" },
      { name: "chaos", entry: "https://cdn.pokedex.example/chaos/mf-manifest.json" }
    ];

    expect(validateRemoteEntries(entries)).toEqual([]);
  });

  it("flags duplicate names", () => {
    const entries: RemoteEntryInput[] = [
      { name: "stable", entry: "https://cdn.pokedex.example/a.json" },
      { name: "stable", entry: "https://cdn.pokedex.example/b.json" }
    ];

    const issues = validateRemoteEntries(entries);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "duplicate-name", name: "stable" });
  });

  it("flags an entry with neither entry nor version as missing-entry", () => {
    const entries: RemoteEntryInput[] = [{ name: "stable" }];

    const issues = validateRemoteEntries(entries);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "missing-entry", name: "stable" });
  });

  it("flags an unparseable entry url as invalid-url", () => {
    const entries: RemoteEntryInput[] = [{ name: "stable", entry: "not a url" }];

    const issues = validateRemoteEntries(entries);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "invalid-url", name: "stable" });
  });

  it("flags an origin not in allowedOrigins", () => {
    const entries: RemoteEntryInput[] = [{ name: "stable", entry: "https://evil.example/mf-manifest.json" }];

    const issues = validateRemoteEntries(entries, { allowedOrigins: ["https://cdn.pokedex.example"] });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "origin-not-allowed", name: "stable" });
  });

  it("does not flag an origin that is in allowedOrigins", () => {
    const entries: RemoteEntryInput[] = [{ name: "stable", entry: "https://cdn.pokedex.example/mf-manifest.json" }];

    expect(validateRemoteEntries(entries, { allowedOrigins: ["https://cdn.pokedex.example"] })).toEqual([]);
  });

  it("flags an http entry as insecure-entry when requireHttps is set", () => {
    const entries: RemoteEntryInput[] = [{ name: "stable", entry: "http://cdn.pokedex.example/mf-manifest.json" }];

    const issues = validateRemoteEntries(entries, { requireHttps: true });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "insecure-entry", name: "stable" });
  });

  it("exempts localhost / 127.0.0.1 / [::1] over http from the requireHttps check", () => {
    const entries: RemoteEntryInput[] = [
      { name: "a", entry: "http://localhost:4174/mf-manifest.json" },
      { name: "b", entry: "http://127.0.0.1:4174/mf-manifest.json" },
      { name: "c", entry: "http://[::1]:4174/mf-manifest.json" }
    ];

    expect(validateRemoteEntries(entries, { requireHttps: true })).toEqual([]);
  });

  it("skips url checks for a version-only (registry-style) entry", () => {
    const entries: RemoteEntryInput[] = [{ name: "stable", version: "1.2.3" }];

    expect(validateRemoteEntries(entries, { requireHttps: true, allowedOrigins: ["https://cdn.pokedex.example"] })).toEqual([]);
  });

  it("reports multiple distinct issues across entries", () => {
    const entries: RemoteEntryInput[] = [
      { name: "dup", entry: "https://cdn.pokedex.example/a.json" },
      { name: "dup", entry: "https://cdn.pokedex.example/b.json" },
      { name: "broken", entry: ":::" },
      { name: "empty" }
    ];

    const kinds = validateRemoteEntries(entries).map(issue => issue.kind);

    expect(kinds).toContain("duplicate-name");
    expect(kinds).toContain("invalid-url");
    expect(kinds).toContain("missing-entry");
  });
});
