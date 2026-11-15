import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, Globe, Star, UserRound } from "lucide-react";
import welcomeProfile from "../../../../../resources/images/welcome-profile.jpg";
import { linkLabel, links } from "../../../shared/links";

const WELCOME_SEEN_KEY = "wisewave-welcome-seen";
const AVATAR_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function Friend({ href, name, children }: { href: string; name: ReactNode; children: ReactNode }) {
  const profile = new URL(href);
  const username = profile.hostname === "github.com" && /^\/[\w-]+\/?$/.test(profile.pathname) ? profile.pathname.replaceAll("/", "") : "";
  const key = `wisewave-friend-avatar-${username}`;
  const [avatar, setAvatar] = useState("");

  useEffect(() => {
    if (!username) return;
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      let cached: { image: string; checked: number } | null = null;
      try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        if (typeof value?.image === "string" && value.image.startsWith("data:image/") && typeof value.checked === "number") cached = value;
      } catch {}
      if (cached && active) setAvatar(cached.image);
      if (cached && Date.now() - cached.checked < AVATAR_MAX_AGE) return;
      pending = true;
      try {
        const profile = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`);
        if (!profile.ok) throw new Error(`GitHub profile request failed: ${profile.status}`);
        const { avatar_url } = await profile.json();
        const url = new URL(avatar_url);
        if (url.protocol !== "https:" || url.hostname !== "avatars.githubusercontent.com") throw new Error("Invalid GitHub avatar URL");
        url.searchParams.set("s", "128");
        const response = await fetch(url.href);
        if (!response.ok) throw new Error(`GitHub avatar request failed: ${response.status}`);
        const blob = await response.blob();
        if (!blob.type.startsWith("image/") || blob.size > 512_000) throw new Error("Invalid GitHub avatar image");
        const image = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read avatar"));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        if (active) setAvatar(image);
        try { localStorage.setItem(key, JSON.stringify({ image, checked: Date.now() })); } catch {}
      } catch (error) {
        console.warn(`Could not refresh ${username}'s avatar`, error);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [key, username]);

  return <a className="welcome-friend" href={href} target="_blank" rel="noreferrer">
    <span className="welcome-friend-avatar">{avatar ? <img src={avatar} alt="" /> : <UserRound size={20} />}</span>
    <span className="welcome-friend-copy"><strong>{name}</strong><small>{children}</small></span>
    <ExternalLink size={16} aria-hidden="true" />
  </a>;
}

export function shouldShowWelcome() {
  try {
    if (localStorage.getItem(WELCOME_SEEN_KEY) === "1") return false;
    if (localStorage.getItem("wisewave-welcome-version")) {
      localStorage.setItem(WELCOME_SEEN_KEY, "1");
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

export function resetWelcomeSeen() {
  try {
    localStorage.removeItem(WELCOME_SEEN_KEY);
    localStorage.removeItem("wisewave-welcome-version");
  } catch {}
}

export function markWelcomeSeen() {
  try {
    localStorage.setItem(WELCOME_SEEN_KEY, "1");
  } catch {}
}

function DiscordIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.3 4.4a19.8 19.8 0 0 0-4.9-1.5l-.7 1.3a18.3 18.3 0 0 0-5.4 0l-.7-1.3a19.7 19.7 0 0 0-4.9 1.5C.6 9 .1 13.5.5 18a20 20 0 0 0 6 3l1.2-2a13 13 0 0 1-1.9-.9l.4-.3c3.9 1.8 8.1 1.8 12 0l.4.3c-.6.4-1.2.7-1.9.9l1.2 2a20 20 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.6ZM8.1 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.1 1.1 2.1 2.4-1 2.4-2.1 2.4Zm7.8 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-1 2.4-2.1 2.4Z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.9.83.09-.64.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
    </svg>
  );
}

function WelcomeRow({
  href,
  icon,
  title,
  subtitle,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <a className="welcome-row" href={href} target="_blank" rel="noreferrer">
      <span className="welcome-row-icon">{icon}</span>
      <span className="welcome-row-copy">
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
      <ExternalLink size={16} aria-hidden="true" />
    </a>
  );
}

function WelcomeSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="welcome-section">
      <h2>{title}</h2>
      <div className="welcome-card">{children}</div>
    </section>
  );
}

export function Welcome({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const closeTimer = useRef<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [fade, setFade] = useState({ top: false, bottom: false });

  const dismiss = () => {
    if (closeTimer.current !== null) return;
    markWelcomeSeen();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduce") {
      closeRef.current();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => closeRef.current(), 150);
  };

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const update = () => {
      const top = body.scrollTop > 1;
      const bottom = body.scrollTop + body.clientHeight < body.scrollHeight - 1;
      setFade((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
    };
    update();
    body.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(body);
    if (body.firstElementChild) observer.observe(body.firstElementChild);
    return () => {
      body.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  return (
    <div className={`welcome-overlay ${closing ? "welcome-closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
      <div className="welcome-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-title" tabIndex={-1} ref={dialog}>
        <header className="welcome-intro">
          <div className="welcome-cover" aria-hidden="true"><img src={welcomeProfile} alt="" /></div>
          <div className="welcome-who">
            <img className="welcome-pfp" src={welcomeProfile} alt="" />
            <div className="welcome-who-copy">
              <h1 id="welcome-title">Friston</h1>
              <p className="welcome-role">i was bored so i made this lol..</p>
            </div>
          </div>
          <p className="welcome-note">i love music and i think everyone should get to enjoy it without all the bs so i made wisewave so you can listen as long as you want to?<br />well..if you think something could be better feel free to let me know</p>
        </header>

        <div
          className={`welcome-body player-scroll${fade.top ? " fade-top" : ""}${fade.bottom ? " fade-bottom" : ""}`}
          ref={bodyRef}
        >
          <div className="welcome-grid">
            <WelcomeSection title="Find me">
              <WelcomeRow href={links.github} icon={<GitHubIcon />} title="GitHub" subtitle={linkLabel(links.github)} />
              <WelcomeRow href={links.discord} icon={<DiscordIcon />} title="Discord" subtitle="connect with me on Discord" />
            </WelcomeSection>

            <WelcomeSection title="Support">
              <WelcomeRow href={links.site} icon={<Globe size={18} strokeWidth={1.8} />} title="Website" subtitle="News, downloads, and updates" />
            </WelcomeSection>

            <WelcomeSection title="Community">
              <WelcomeRow href={links.community} icon={<DiscordIcon />} title="WiseWave HQ" subtitle={linkLabel(links.community)} />
            </WelcomeSection>

            <WelcomeSection title="Brothers">
              <Friend href={links.krishna} name={<>Krxhna <span>(aka Krishna)</span></>}>Shared the internal sources that helped me build the core backend. Thank youuu cutiee!!</Friend>
              <Friend href={links.nihal} name={<>Nihal <span>(aka Punjabi Kudi)</span></>}>Got WiseWave its domain. I really appreciate it.</Friend>
              <Friend href={links.tone} name={<>70ne <span>(aka Tone)</span></>}>Helped me test the app and catch bugs. Thanks for your time baby girl.</Friend>
            </WelcomeSection>
          </div>
        </div>

        <div className="welcome-actions">
          <a className="welcome-secondary" href={links.repo} target="_blank" rel="noreferrer">
            <Star size={17} />
            Star on GitHub
          </a>
          <button className="welcome-continue" type="button" onClick={dismiss}>
            Let’s go
          </button>
        </div>
      </div>
    </div>
  );
}
