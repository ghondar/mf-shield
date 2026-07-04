import { describe, expect, it } from "vitest";

import { buildOfflineManifest } from "../src/federation";

describe("buildOfflineManifest", () => {
  it("produces a manifest with exactly the fields generateSnapshotFromManifest 2.6.0 hard-requires", () => {
    const manifest = buildOfflineManifest();

    // Top-level required by Manifest
    expect(manifest).toHaveProperty("id");
    expect(manifest).toHaveProperty("name");
    expect(manifest.shared).toEqual([]);
    expect(manifest.remotes).toEqual([]);
    expect(manifest.exposes).toEqual([]);

    // metaData required fields
    expect(manifest.metaData).toHaveProperty("name");
    expect(manifest.metaData).toHaveProperty("globalName");
    expect(manifest.metaData).toHaveProperty("type");
    expect(manifest.metaData).toHaveProperty("publicPath");

    // metaData.remoteEntry.{name,path,type}
    expect(manifest.metaData.remoteEntry).toEqual(
      expect.objectContaining({ name: expect.any(String), path: expect.any(String), type: expect.any(String) })
    );

    // metaData.buildInfo.{buildVersion,buildName}
    expect(manifest.metaData.buildInfo).toEqual(
      expect.objectContaining({ buildVersion: expect.any(String), buildName: expect.any(String) })
    );
  });

  it("applies overrides from the input", () => {
    const manifest = buildOfflineManifest({
      name: "stable",
      globalName: "stable_global",
      publicPath: "https://cdn.example/stable/",
      remoteEntryName: "remoteEntry.js"
    });

    expect(manifest.name).toBe("stable");
    expect(manifest.metaData.name).toBe("stable");
    expect(manifest.metaData.globalName).toBe("stable_global");
    expect(manifest.metaData.publicPath).toBe("https://cdn.example/stable/");
    expect(manifest.metaData.remoteEntry.name).toBe("remoteEntry.js");
  });

  it("serializes to JSON without throwing (Response body friendly)", () => {
    expect(() => JSON.stringify(buildOfflineManifest())).not.toThrow();
  });
});
