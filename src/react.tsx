'use client';

import { Component, Suspense, useEffect, useRef, useState, type ComponentType, type ErrorInfo, type ReactNode } from "react";

import {
  evaluateRemoteAccess,
  removeCssPoison,
  withTimeout,
  type CssPoisonGuardOptions,
  type RemoteAccessPolicy
} from "./core";
import { createTrailingDebounce, cssPoisonSelector, remoteAccessError, resolveCssPoisonRoot } from "./internal";

export type RemoteComponent<P = Record<string, never>> = ComponentType<P>;

type Status = "loading" | "ready" | "failed";

/**
 * Renderer opcional para reemplazar la UI de fallback por defecto (`RemoteFallback`).
 * Recibe el `label` del slot y el error que causó la falla; retorna el nodo a renderizar.
 */
export type RemoteFallbackRenderer = (info: { label: string; error: unknown }) => ReactNode;

export type RemoteSlotConfig<P = Record<string, never>> = {
  label: string;
  canLoad?: RemoteAccessPolicy;
  timeoutMs?: number;
  fallback?: RemoteFallbackRenderer;
  load: () => Promise<RemoteComponent<P>>;
  /**
   * Props reenviadas al componente remoto al renderizarlo.
   *
   * Es opcional aun cuando `P` declara claves requeridas: la config es un dato
   * que se define en un momento distinto al render, por lo que el tipo no fuerza
   * su presencia aquí. Si el remoto exige props requeridas y se omite `props`,
   * el error se detecta en el punto de render tipado (ver el contrato de API),
   * no a nivel de config.
   */
  props?: P;
  /**
   * Se dispara en cada ruta de falla del slot: acceso denegado, `load` rechazado
   * o timeout. Recibe el `label` del slot y el `error` que causó la falla.
   * También se invoca cuando el componente remoto crashea al renderizar (el
   * `RemoteBoundary` interno lo reenvía). No se dispara tras el desmontaje.
   */
  onError?: (info: { label: string; error: unknown }) => void;
  /**
   * Se dispara en cada transición de estado del slot, incluyendo el `loading`
   * inicial: `loading` → `ready` (remoto listo) o `loading` → `failed` (falla).
   * No se dispara tras el desmontaje del slot.
   */
  onStatusChange?: (status: "loading" | "ready" | "failed") => void;
};

export type RemoteBoundaryProps = {
  children: ReactNode;
  label: string;
  fallback?: RemoteFallbackRenderer;
  /**
   * Se invoca cuando un hijo del boundary crashea al renderizar (desde
   * `componentDidCatch`). `RemoteSlot` reenvía aquí un wrapper que llama a
   * `config.onError` con el `label` del slot.
   */
  onError?: (info: { label: string; error: unknown }) => void;
};
export type RemoteFallbackProps = { label: string; error: unknown };

/**
 * Props de `RemoteSlot`. El parámetro `P` fluye desde `RemoteSlotConfig<P>` para
 * preservar el tipado de las props del componente remoto (por defecto sin props).
 */
export type RemoteSlotProps<P = Record<string, never>> = { config: RemoteSlotConfig<P>; retryKey?: number };

export type ProviderFallbackRenderer = (error: Error) => ReactNode;
export type ProviderBoundaryProps = { children: ReactNode; fallback?: ProviderFallbackRenderer };
export type ProviderFallbackProps = { error: Error };
export type ProviderSuspenseBoundaryProps = { children: ReactNode; loading: ReactNode };

export function useCssPoisonGuard({ selector = cssPoisonSelector, root, onPoisonRemoved, debounceMs = 0 }: CssPoisonGuardOptions = {}) {
  const onPoisonRemovedRef = useRef(onPoisonRemoved);
  onPoisonRemovedRef.current = onPoisonRemoved;

  useEffect(() => {
    const target = resolveCssPoisonRoot(root);
    if (!target) return;

    const cleanPoison = () => {
      const removed = removeCssPoison({ selector, root: target });
      if (removed > 0) onPoisonRemovedRef.current?.(removed);
    };

    cleanPoison();

    if (typeof MutationObserver === "undefined") return;

    const debounced = createTrailingDebounce(cleanPoison, debounceMs);
    const observer = new MutationObserver(debounced.run);
    observer.observe(target, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      debounced.cancel();
    };
  }, [selector, root, debounceMs]);
}

export class RemoteBoundary extends Component<RemoteBoundaryProps, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[mf-shield] ${this.props.label}`, error, info.componentStack);
    this.props.onError?.({ label: this.props.label, error });
  }

  render() {
    if (this.state.error) {
      return this.props.fallback
        ? this.props.fallback({ label: this.props.label, error: this.state.error })
        : <RemoteFallback label={this.props.label} error={this.state.error} />;
    }

    return this.props.children;
  }
}

export function RemoteFallback({ label, error }: RemoteFallbackProps) {
  return (
    <section data-testid="remote-fallback" className="fallback">
      <strong>Remote slot fallback</strong>
      <p>{label}</p>
      <code>{String(error instanceof Error ? error.message : error)}</code>
    </section>
  );
}

export function RemoteSlot<P = Record<string, never>>({ config, retryKey = 0 }: RemoteSlotProps<P>) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<unknown>();
  const [Remote, setRemote] = useState<RemoteComponent<P>>();

  // Refs a los callbacks para que su identidad no reintente el efecto ni
  // dispare warnings; siempre invocamos la versión más reciente.
  const onErrorRef = useRef(config.onError);
  onErrorRef.current = config.onError;
  const onStatusChangeRef = useRef(config.onStatusChange);
  onStatusChangeRef.current = config.onStatusChange;

  useEffect(() => {
    let cancelled = false;

    // Transición inicial: notificamos el `loading` de este ciclo de carga.
    setStatus("loading");
    setError(undefined);
    setRemote(undefined);
    onStatusChangeRef.current?.("loading");

    const fail = (err: unknown) => {
      if (cancelled) return;
      setError(err);
      setStatus("failed");
      onErrorRef.current?.({ label: config.label, error: err });
      onStatusChangeRef.current?.("failed");
    };

    const access = evaluateRemoteAccess(config.canLoad);
    if (!access.allowed) {
      fail(remoteAccessError(access.reason));
      return;
    }

    const load = config.timeoutMs
      ? withTimeout(config.load(), config.timeoutMs, config.label)
      : config.load();

    load
      .then(Component => {
        if (cancelled) return;
        setRemote(() => Component);
        setStatus("ready");
        onStatusChangeRef.current?.("ready");
      })
      .catch(fail);

    return () => {
      cancelled = true;
    };
  }, [config, retryKey]);

  return (
    <div className="stack">
      <p data-testid="mf-shield-slot-status">status: {status}</p>
      {error
        ? config.fallback
          ? config.fallback({ label: config.label, error })
          : <RemoteFallback label={config.label} error={error} />
        : null}
      {Remote ? (
        <RemoteBoundary
          key={`${config.label}-${retryKey}`}
          label={config.label}
          fallback={config.fallback}
          onError={config.onError}
        >
          <Remote {...(config.props as P & Record<string, never>)} />
        </RemoteBoundary>
      ) : null}
    </div>
  );
}

export class ProviderBoundary extends Component<ProviderBoundaryProps, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[mf-shield] provider boundary", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ? this.props.fallback(this.state.error) : <ProviderFallback error={this.state.error} />;
    }

    return this.props.children;
  }
}

export function ProviderFallback({ error }: ProviderFallbackProps) {
  return (
    <section data-testid="provider-fallback" className="remote-card">
      <strong>Provider-owned fallback</strong>
      <p>Remote contained its own internal failure.</p>
      <code>{error.message}</code>
    </section>
  );
}

export function ProviderSuspenseBoundary({ children, loading }: ProviderSuspenseBoundaryProps) {
  return (
    <ProviderBoundary>
      <Suspense fallback={loading}>{children}</Suspense>
    </ProviderBoundary>
  );
}
