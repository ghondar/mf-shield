import { RemoteAccessDeniedError } from "./errors";

export const accessDeniedReason = "access denied before remote import";
export const cssPoisonSelector = "style[data-mf-shield-poison]";

export function remoteAccessError(reason = accessDeniedReason): RemoteAccessDeniedError {
  return new RemoteAccessDeniedError(reason);
}

export function getDefaultCssPoisonRoot(): ParentNode | undefined {
  return typeof document === "undefined" ? undefined : document.head;
}

export function resolveCssPoisonRoot(root?: ParentNode): ParentNode | undefined {
  return root ?? getDefaultCssPoisonRoot();
}

export type TrailingDebounce = { run: () => void; cancel: () => void };

export function createTrailingDebounce(fn: () => void, waitMs: number): TrailingDebounce {
  if (waitMs <= 0) {
    return { run: fn, cancel: () => undefined };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const run = () => {
    cancel();
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, waitMs);
  };

  return { run, cancel };
}
