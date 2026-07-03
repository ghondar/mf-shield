import { describe, expect, it } from "vitest";

import { FederationIntegrityError, FederationTimeoutError, RemoteAccessDeniedError, RemoteModuleNullError } from "../src/errors";

describe("FederationTimeoutError", () => {
  it("is an Error with the correct name and message", () => {
    const error = new FederationTimeoutError("slot", 500);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(FederationTimeoutError);
    expect(error.name).toBe("FederationTimeoutError");
    expect(error.message).toBe("federation: slot timed out after 500ms");
  });
});

describe("RemoteAccessDeniedError", () => {
  it("is an Error with the correct name and message prefix", () => {
    const error = new RemoteAccessDeniedError("access denied before remote import");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RemoteAccessDeniedError);
    expect(error.name).toBe("RemoteAccessDeniedError");
    expect(error.message).toBe("federation: access denied before remote import");
  });
});

describe("RemoteModuleNullError", () => {
  it("is an Error with the correct name and message", () => {
    const error = new RemoteModuleNullError("stable/Widget");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RemoteModuleNullError);
    expect(error.name).toBe("RemoteModuleNullError");
    expect(error.message).toBe("federation: stable/Widget returned no module");
  });
});

describe("FederationIntegrityError", () => {
  it("is an Error with the correct name and message", () => {
    const error = new FederationIntegrityError("http://127.0.0.1:4174/static/js/stable.abc.js");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(FederationIntegrityError);
    expect(error.name).toBe("FederationIntegrityError");
    expect(error.message).toBe("federation: no integrity hash registered for http://127.0.0.1:4174/static/js/stable.abc.js");
  });

  it("exposes the offending url", () => {
    const error = new FederationIntegrityError("http://cdn/x.js");
    expect(error.url).toBe("http://cdn/x.js");
  });
});
