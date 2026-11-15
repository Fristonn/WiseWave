import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const loadedUrls = new Set<string>();
const failedUrls = new Set<string>();
const failedSources = new Set<string>();
type LoadedArtwork = { url: string; width: number; height: number; requestedSize: number };
const loadedSources = new Map<string, LoadedArtwork[]>();
const MAX_ATTEMPTS = 2;

export function rememberLoadedArtwork(src: string, url: string, width: number, height: number, requestedSize: number) {
  if (!src || !url) return;
  const key = artworkURL(src, 1) || src;
  const previous = loadedSources.get(key) || [];
  const variants = [...previous.filter((item) => item.url !== url), { url, width, height, requestedSize }];
  variants.sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height));
  if (variants.length > 4) variants.splice(1, variants.length - 4);
  if (loadedSources.size >= 1000 && !loadedSources.has(key)) loadedSources.delete(loadedSources.keys().next().value!);
  loadedSources.set(key, variants);
}

export function loadedArtworkSource(src: string, size?: number): string {
  const variants = loadedSources.get(artworkURL(src, 1) || src);
  if (!variants?.length) return "";
  return (size ? variants.find((item) => Math.min(item.width, item.height) >= size) || variants.at(-1) : variants.at(-1))?.url || "";
}

export function preferredArtworkURL(src: string, size: number): string {
  const requested = artworkURL(src, size);
  const variants = loadedSources.get(artworkURL(src, 1) || src) || [];
  const cached = variants.find((item) => item.url === requested || (Math.min(item.width, item.height) >= size && Math.min(item.width, item.height) <= size * 1.5));
  if (cached) return cached.url;
  return requested;
}

function markLoaded(url: string, src: string, width: number, height: number, requestedSize: number) {
  failedUrls.delete(url);
  failedSources.delete(src);
  if (loadedUrls.size >= 1000) loadedUrls.delete(loadedUrls.keys().next().value!);
  loadedUrls.add(url);
  rememberLoadedArtwork(src, url, width, height, requestedSize);
}

function markFailed(url: string, src?: string) {
  loadedUrls.delete(url);
  if (failedUrls.size >= 1000) failedUrls.delete(failedUrls.keys().next().value!);
  failedUrls.add(url);
  if (src && loadedArtworkSource(src)) return;
  if (src) {
    if (failedSources.size >= 1000) failedSources.delete(failedSources.keys().next().value!);
    failedSources.add(src);
  }
  window.dispatchEvent(new CustomEvent("wisewave-artwork-failed", { detail: { url, src } }));
}

function isYtimg(hostname: string) {
  return /(^|\.)ytimg\.com$/i.test(hostname);
}

function isAcceptableCover(width: number, height: number, allowWide = false) {
  if (width < 48 || height < 48) return false;
  if (allowWide) return true;
  const ratio = width / height;
  return ratio >= 0.88 && ratio <= 1.14;
}

export function artworkURL(src: string, size = 512) {
  try {
    const url = new URL(src);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.hostname === "c.saavncdn.com") {
      const pixels = size <= 50 ? 50 : size <= 150 ? 150 : 500;
      url.pathname = url.pathname.replace(/(?:50|150|500)x(?:50|150|500)/g, `${pixels}x${pixels}`);
      return url.href;
    }
    if (url.hostname.endsWith("mzstatic.com")) {
      url.pathname = url.pathname.replace(/\/(?:\{w\}x\{h\}|\d+x\d+)(?:bb|cw)(?:-\d+)?\.(?:jpe?g|png|webp)$/i, `/${size}x${size}bb.jpg`);
      return url.href;
    }
    if (url.hostname.endsWith(".googleusercontent.com") || url.hostname.endsWith(".ggpht.com")) {
      const sized = `=w${size}-h${size}-l90-rj`;
      if (/=(?:w\d+-h\d+|s\d+)/.test(url.pathname)) {
        url.pathname = url.pathname.replace(/=(?:w\d+-h\d+|s\d+).*$/, sized);
      } else if (/=(?:w\d+-h\d+|s\d+)/.test(url.search)) {
        url.search = url.search.replace(/=(?:w\d+-h\d+|s\d+).*$/, sized);
      } else if (url.pathname.includes("=")) {
        url.pathname = `${url.pathname.replace(/=.*$/, "")}${sized}`;
      } else {
        url.pathname = `${url.pathname}${sized}`;
      }
      return url.href;
    }
    if (isYtimg(url.hostname)) {
      url.pathname = url.pathname.replace(/(?:maxresdefault|sddefault|hq720|hqdefault|mqdefault|default)\.jpg$/i, "hqdefault.jpg");
      return url.href;
    }
    return url.href;
  } catch {
    return "";
  }
}

export function hasArtworkURL(src?: string): boolean {
  if (!src || (failedSources.has(src) && !loadedArtworkSource(src))) return false;
  try {
    const host = new URL(src).hostname;
    if (isYtimg(host)) return false;
  } catch {
    return false;
  }
  const url = artworkURL(src);
  if (!url || failedUrls.has(url)) return false;
  return true;
}

const preloadQueue: Array<{ url: string; src: string; size: number }> = [];
const pendingUrls = new Set<string>();
let preloading = 0;

function preloadArtwork(url: string, src: string, size: number) {
  if (!url || loadedUrls.has(url) || failedUrls.has(url) || pendingUrls.has(url)) return;
  pendingUrls.add(url);
  preloadQueue.push({ url, src, size });
  warmArtwork();
}

export function preloadArtworkSource(src: string, size: number) {
  preloadArtwork(preferredArtworkURL(src, size * 2), src, size * 2);
}

function warmArtwork() {
  while (preloading < 4 && preloadQueue.length) {
    const item = preloadQueue.shift()!;
    const image = new Image();
    preloading++;
    image.referrerPolicy = "no-referrer";
    image.fetchPriority = "low";
    const finish = (loaded: boolean) => {
      let allowWide = false;
      try { allowWide = isYtimg(new URL(item.url).hostname); } catch {}
      if (loaded && isAcceptableCover(image.naturalWidth, image.naturalHeight, allowWide)) markLoaded(item.url, item.src, image.naturalWidth, image.naturalHeight, item.size);
      pendingUrls.delete(item.url);
      preloading--;
      warmArtwork();
    };
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = item.url;
  }
}

export function Artwork({ src, size, className = "", lazy = false, rootMargin = "1200px 800px", onFail, allowNonSquare = false }: { src: string; size: number; className?: string; lazy?: boolean; rootMargin?: string; onFail?: () => void; placeholder?: "music" | "user" | ReactNode; allowNonSquare?: boolean }) {
  const density = Math.min(2, Math.max(1, window.devicePixelRatio * (Number.parseFloat(document.documentElement.style.zoom) || 1)));
  const requestedSize = Math.ceil(size * density);
  const url = useMemo(() => preferredArtworkURL(src, requestedSize), [src, requestedSize]);
  const cached = loadedArtworkSource(src, requestedSize);
  const allowWide = allowNonSquare || (() => {
    try { return Boolean(src && isYtimg(new URL(src).hostname)); } catch { return false; }
  })();
  const ref = useRef<HTMLSpanElement>(null);
  const visibleSource = useRef(src);
  const retryTimer = useRef<number | null>(null);
  const [visible, setVisible] = useState(!lazy || loadedUrls.has(url));
  const [retry, setRetry] = useState({ url, attempt: 0 });
  const attempt = retry.url === url ? retry.attempt : 0;
  const [loadedUrl, setLoadedUrl] = useState(() => loadedUrls.has(url) ? url : "");
  const [displayedImage, setDisplayedImage] = useState(() => ({ src, url: loadedUrls.has(url) ? url : "" }));
  const [failedUrl, setFailedUrl] = useState("");
  const isLoaded = Boolean(url && (cached === url || loadedUrls.has(url) || loadedUrl === url));
  const isFailed = Boolean(!url || (!isLoaded && (failedUrls.has(url) || (!cached && failedSources.has(src)) || failedUrl === url)));
  const previousImage = displayedImage.src === src ? displayedImage.url : "";
  const preview = previousImage && (previousImage !== url || isFailed) ? previousImage : cached && ((cached !== url && !isLoaded) || isFailed) ? cached : "";
  const loading = Boolean(url && !isLoaded && !isFailed && !preview);
  const imageSrc = attempt > 0 && url ? `${url}${url.includes("?") ? "&" : "?"}retry=${attempt}` : url;

  useEffect(() => {
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    setRetry({ url, attempt: 0 });
    setLoadedUrl(loadedUrls.has(url) ? url : "");
    setFailedUrl("");
    const sameSource = visibleSource.current === src;
    visibleSource.current = src;
    setVisible((previous) => !lazy || Boolean(url && loadedUrls.has(url)) || (sameSource && previous));
  }, [url, src, lazy]);

  useEffect(() => {
    if (isFailed && !cached) onFail?.();
  }, [cached, isFailed, onFail]);

  useEffect(() => {
    if (!lazy || visible || !ref.current) return;
    const options = { rootMargin, scrollMargin: "300px 400px" };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, options);
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [lazy, visible, rootMargin]);

  useEffect(() => () => {
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
  }, []);

  if ((!url || isFailed) && !cached) {
    return <span className={`artwork ${className}`} data-loading="true" aria-hidden="true" />;
  }

  return <span ref={ref} className={`artwork ${className}`} data-loading={loading || undefined} aria-busy={loading}>
    {preview && <img className="artwork-preview loaded" src={preview} alt="" referrerPolicy="no-referrer" decoding="sync" />}
    {!isFailed && (visible || isLoaded) && <img
      key={`${url}:${attempt}`}
      src={imageSrc}
      alt=""
      referrerPolicy="no-referrer"
      decoding={isLoaded ? "sync" : "async"}
      className={isLoaded ? "loaded" : ""}
      onLoad={(event) => {
        const image = event.currentTarget;
        if (isAcceptableCover(image.naturalWidth, image.naturalHeight, allowWide)) {
          markLoaded(url, src, image.naturalWidth, image.naturalHeight, requestedSize);
          setLoadedUrl(url);
          setDisplayedImage({ src, url });
          setFailedUrl("");
          return;
        }
        markFailed(url, src);
        setFailedUrl(url);
        setLoadedUrl("");
      }}
      onError={() => {
        if (attempt + 1 >= MAX_ATTEMPTS) {
          markFailed(url, src);
          setFailedUrl(url);
          setLoadedUrl("");
          return;
        }
        if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(() => {
          retryTimer.current = null;
          setLoadedUrl("");
          setFailedUrl("");
          setRetry({ url, attempt: attempt + 1 });
        }, 450 * (attempt + 1));
      }}
    />}
  </span>;
}
