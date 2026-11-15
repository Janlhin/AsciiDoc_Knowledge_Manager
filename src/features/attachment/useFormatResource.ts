/**
 * Shared cancellable loader for structured attachment previews.
 *
 * PR #27 fixed the same class of bug in EPUB (stale async work creating a reader
 * after the tab closed). Every new format preview uses this hook instead of
 * hand-rolling its own effect, so the cancellation + disposal contract has one
 * implementation:
 *
 *  - the loader receives `isCancelled()` and must check it after every await;
 *  - a loader that allocated resources returns `dispose()`;
 *  - if the tab closes before the loader settles, the hook disposes immediately
 *    and never calls setState;
 *  - any thrown error becomes the standard "could not load" placeholder.
 *
 * The loader is held in a ref: the effect depends on `path` only, so passing an
 * inline async closure does not re-trigger loading on every render.
 */
import { useEffect, useRef, useState } from "react";

export interface LoadedResource<T> {
  data: T;
  /** Release blob URLs / readers / listeners owned by the loaded value. */
  dispose?: () => void;
}

export type ResourceLoader<T> = (isCancelled: () => boolean) => Promise<LoadedResource<T>>;

export interface ResourceState<T> {
  data: T | null;
  failed: boolean;
}

export function useFormatResource<T>(path: string, loader: ResourceLoader<T>): ResourceState<T> {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    setData(null);
    setFailed(false);
    void (async () => {
      try {
        const result = await loaderRef.current(() => cancelled);
        dispose = result.dispose;
        if (cancelled) {
          dispose?.();
          return;
        }
        setData(result.data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [path]);

  return { data, failed };
}
