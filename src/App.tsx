import { useEffect, useMemo, useRef, useState } from "react";

interface SpotifyEmbedController {
  loadUri: (spotifyUri: string) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  addListener: (event: string, callback: (data?: unknown) => void) => void;
}

interface SpotifyIframeApi {
  createController: (
    element: HTMLElement | null,
    options: { uri: string; width?: string | number; height?: string | number },
    callback: (controller: SpotifyEmbedController) => void
  ) => void;
}

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (IFrameAPI: SpotifyIframeApi) => void;
    SpotifyIframeApi?: SpotifyIframeApi;
  }
}

interface SpotifyPlaybackUpdateEvent {
  data?: {
    isPaused?: boolean;
    position?: number;
    duration?: number;
  };
}

// 5-Song Playlist with curated fallback hue shifts (in case CORS blocks canvas sampling)
// Base pink hue is ~336deg. For example, Barbaad's warm brown/amber Spotify player is ~25deg (+49deg shift).
const initialPlaylist = [
  {
    id: "7Csa4PStpuYIfUqNMKQ4V8",
    uri: "spotify:track:7Csa4PStpuYIfUqNMKQ4V8",
    title: "Barbaad (From \"Saiyaara\")",
    vibe: "Song 01 • Welcome Vibe 💕",
    hueShift: 48, // Warm Cinnamon Brown / Amber (matches Spotify's brown card!)
    saturation: 0.85,
  },
  {
    id: "5yvVYFDUpbnjcnRBgjwTzM",
    uri: "spotify:track:5yvVYFDUpbnjcnRBgjwTzM",
    title: "Dracula (with JENNIE)",
    vibe: "Song 02 • Sweetest Vibe ✨",
    hueShift: 24, // Deep Crimson / Vampire Red
    saturation: 1.05,
  },
  {
    id: "3Kd0dzfRnf5DOExPHMdDt3",
    uri: "spotify:track:3Kd0dzfRnf5DOExPHMdDt3",
    title: "Dhunki",
    vibe: "Song 03 • Obsessed With You 💖",
    hueShift: 62, // Golden Bronze / Warm Ochre
    saturation: 0.9,
  },
  {
    id: "3uuR20w7HgLlb5Hha2mCxb",
    uri: "spotify:track:3uuR20w7HgLlb5Hha2mCxb",
    title: "Moth To A Flame (with The Weeknd)",
    vibe: "Song 04 • Cutest Memory 🥰",
    hueShift: 225, // Moody Slate Blue / Charcoal
    saturation: 0.7,
  },
  {
    id: "3M0lSi5WW79CXQamgSBIjx",
    uri: "spotify:track:3M0lSi5WW79CXQamgSBIjx",
    title: "Swim",
    vibe: "Song 05 • Date Night Vibe 🥂",
    hueShift: 285, // Deep Midnight Violet / Indigo
    saturation: 0.95,
  },
];

// Extract dominant hue (0-360) and saturation from an album cover URL
function extractHueFromImage(imageUrl: string): Promise<{ hueShift: number; saturation: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        canvas.width = 32;
        canvas.height = 32;
        ctx.drawImage(img, 0, 0, 32, 32);
        const { data } = ctx.getImageData(0, 0, 32, 32);

        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let weightSum = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] / 255;
          const g = data[i + 1] / 255;
          const b = data[i + 2] / 255;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const l = (max + min) / 2;
          const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
          // Favor vibrant mid-tone pixels just like Spotify's player card extractor
          const weight = (s + 0.15) * (1 - Math.abs(l - 0.45));
          rSum += r * weight;
          gSum += g * weight;
          bSum += b * weight;
          weightSum += weight;
        }

        if (weightSum === 0) return resolve(null);
        const r = rSum / weightSum;
        const g = gSum / weightSum;
        const b = bSum / weightSum;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0;
        const d = max - min;
        const l = (max + min) / 2;
        const s = max === min ? 0 : l > 0.5 ? d / (2 - max - min) : d / (max + min);

        if (max !== min) {
          switch (max) {
            case r:
              h = (g - b) / d + (g < b ? 6 : 0);
              break;
            case g:
              h = (b - r) / d + 2;
              break;
            case b:
              h = (r - g) / d + 4;
              break;
          }
          h /= 6;
        }

        const targetHueDeg = Math.round(h * 360);
        // Original site palette has a primary pink hue of 336deg
        const hueShift = ((targetHueDeg - 336) % 360 + 360) % 360;
        const saturation = Math.max(0.65, Math.min(1.15, Number((0.65 + s * 0.55).toFixed(2))));
        resolve({ hueShift, saturation });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

const compliments = [
  {
    number: "01",
    title: "Your smile is magic",
    copy: "The kind that turns an ordinary Tuesday into the best day ever. It is warm, bright, and completely impossible not to love.",
    songIndex: 1,
  },
  {
    number: "02",
    title: "You make cute look easy",
    copy: "Every little laugh, every tiny expression, every sleepy hello — somehow you make all of it the sweetest thing in the world.",
    songIndex: 2,
  },
  {
    number: "03",
    title: "Beautiful, always",
    copy: "Dressed up, dressed down, hair perfect or beautifully messy — you are breathtaking in every single version of you.",
    songIndex: 3,
  },
];

const photoCards = [
  { label: "Highlight of the week", caption: "That moment I keep replaying", tone: "bg-[#ffd0e5]", image: "/photos/photo-1.png?v=2", songIndex: 0 },
  { label: "My fashion week pick", caption: "Obviously, you won again", tone: "bg-[#ffc1db]", image: "/photos/photo-2.png?v=2", songIndex: 2 },
  { label: "Cutest memory", caption: "One for our forever folder", tone: "bg-[#ffe0ec]", image: "/photos/photo-3.jpg?v=2", songIndex: 3 },
];

const favoriteThings = {
  eyes: {
    label: "Her eyes",
    title: "Your eyes are their own little universe",
    copy: "I could look into your eyes forever and still find something new to love. They sparkle when you are excited, soften when you are thoughtful, and somehow always make me feel completely at home.",
    songIndex: 0,
  },
  smile: {
    label: "Her smile",
    title: "Your smile is my favorite kind of magic",
    copy: "Your smile can rescue any day. It lights up your whole face, sneaks into your eyes, and makes everything around you feel warmer. I would do almost anything just to see one more.",
    songIndex: 1,
  },
  curves: {
    label: "Her curves",
    title: "Every curve is a masterpiece",
    copy: "You are breathtaking exactly as you are. Every beautiful curve is part of the woman I adore, and you carry it all with a kind of confidence and softness that leaves me speechless.",
    songIndex: 4,
  },
  sweetness: {
    label: "Her sweetness",
    title: "Your heart is the sweetest place I know",
    copy: "It is in the way you care, the little things you notice, and the love you give so naturally. Your kindness makes me want to be softer, braver, and better every single day.",
    songIndex: 2,
  },
  hair: {
    label: "Her hair",
    title: "Your hair deserves love letters too",
    copy: "Perfectly styled, tied up, windswept, or adorably messy — I love every version. It frames the face I love most and somehow always makes you look like the main character.",
    songIndex: 3,
  },
};

function Rose({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 120" fill="none" aria-hidden="true">
      <path d="M50 61C48 80 51 99 45 117" stroke="#2eaa66" strokeWidth="4" strokeLinecap="round" />
      <path d="M48 86C31 78 27 89 44 96M50 74C65 64 72 73 53 82" fill="#6fd492" stroke="#2eaa66" strokeWidth="2" />
      <path d="M49 59C24 59 16 37 28 24C37 14 49 21 50 32C51 16 68 12 77 24C89 41 69 59 49 59Z" fill="#ff5c9b" stroke="#e5357b" strokeWidth="3" />
      <path d="M50 55C37 52 33 41 39 34C45 27 54 33 50 41C56 31 66 34 65 43C64 52 56 56 50 55Z" fill="#ffadd0" />
      <path d="M51 51C47 48 46 42 50 40C56 38 58 47 51 51Z" fill="#e5357b" />
    </svg>
  );
}

function Bunny({ className = "", flip = false }: { className?: string; flip?: boolean }) {
  return (
    <svg className={className} style={{ transform: flip ? "scaleX(-1)" : undefined }} viewBox="0 0 130 110" fill="none" aria-hidden="true">
      <ellipse cx="73" cy="76" rx="40" ry="27" fill="#fff9fc" stroke="#e8669d" strokeWidth="3" />
      <circle cx="36" cy="58" r="25" fill="#fff9fc" stroke="#e8669d" strokeWidth="3" />
      <path d="M25 39C11 16 16 3 25 7C33 11 34 28 33 36M40 35C41 12 51 2 57 9C64 18 52 35 47 42" fill="#fff9fc" stroke="#e8669d" strokeWidth="3" />
      <path d="M25 33C18 18 21 13 25 14M44 32C47 18 52 13 54 15" stroke="#ffb2cf" strokeWidth="5" strokeLinecap="round" />
      <circle cx="27" cy="57" r="2.7" fill="#53253a" />
      <path d="M14 64C19 64 21 67 23 70M21 70C25 68 28 68 30 70" stroke="#e8669d" strokeWidth="2" strokeLinecap="round" />
      <circle cx="104" cy="60" r="13" fill="#fff9fc" stroke="#e8669d" strokeWidth="3" />
      <path d="M50 97L44 105M88 98L96 104" stroke="#e8669d" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function Heart({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 36" aria-hidden="true">
      <path d="M20 34S2 23 2 11C2 1 15-2 20 7C25-2 38 1 38 11C38 23 20 34 20 34Z" fill="currentColor" />
    </svg>
  );
}

export default function App() {
  const [selectedDate, setSelectedDate] = useState<number | null>(14);
  const [monthOffset, setMonthOffset] = useState(0);
  const [favoriteThing, setFavoriteThing] = useState<keyof typeof favoriteThings>("eyes");
  const [confirmStatus, setConfirmStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [playlist, setPlaylist] = useState(initialPlaylist);
  const [currentSongIndex, setCurrentSongIndex] = useState<number>(0);
  const [isPlayerMinimized, setIsPlayerMinimized] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const embedRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<SpotifyEmbedController | null>(null);

  useEffect(() => {
    // Automatically populate accurate Spotify song titles and album colors via public oEmbed
    Promise.all(
      initialPlaylist.map(async (song) => {
        try {
          const res = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${song.id}`);
          if (!res.ok) return song;
          const data = (await res.json()) as { title?: string; thumbnail_url?: string };
          let updated = data.title ? { ...song, title: data.title } : song;
          if (data.thumbnail_url) {
            const extracted = await extractHueFromImage(data.thumbnail_url);
            if (extracted) {
              updated = { ...updated, ...extracted };
            }
          }
          return updated;
        } catch {
          return song;
        }
      })
    ).then(setPlaylist);
  }, []);

  useEffect(() => {
    const initSpotify = (IFrameAPI: SpotifyIframeApi) => {
      window.SpotifyIframeApi = IFrameAPI;
      if (!embedRef.current || controllerRef.current) return;
      IFrameAPI.createController(
        embedRef.current,
        {
          uri: initialPlaylist[0].uri,
          width: "100%",
          height: 152,
        },
        (EmbedController) => {
          controllerRef.current = EmbedController;
          EmbedController.addListener("playback_update", (event) => {
            const playbackEvent = event as SpotifyPlaybackUpdateEvent;
            const paused = playbackEvent?.data?.isPaused;
            if (typeof paused === "boolean") {
              setIsPlaying(!paused);
            }
          });
        }
      );
    };

    if (window.SpotifyIframeApi) {
      initSpotify(window.SpotifyIframeApi);
    } else {
      window.onSpotifyIframeApiReady = initSpotify;
    }
  }, []);

  const playSongAtIndex = (index: number) => {
    const normalizedIndex = ((index % playlist.length) + playlist.length) % playlist.length;
    setCurrentSongIndex(normalizedIndex);
    setIsPlayerMinimized(false);
    setIsPlaying(true);
    if (controllerRef.current) {
      controllerRef.current.loadUri(playlist[normalizedIndex].uri);
      controllerRef.current.play();
    }
  };

  const handlePrevSong = () => {
    playSongAtIndex(currentSongIndex - 1);
  };

  const handleNextSong = () => {
    playSongAtIndex(currentSongIndex + 1);
  };

  const calendar = useMemo(() => {
    const today = new Date();
    const date = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    const year = date.getFullYear();
    const month = date.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const start = new Date(year, month, 1).getDay();
    return {
      year,
      month,
      days,
      start,
      name: date.toLocaleDateString("en-US", { month: "long" }),
    };
  }, [monthOffset]);

  const handleConfirmDate = async () => {
    if (!selectedDate || confirmStatus === "sending") return;
    playSongAtIndex(4);
    const formattedDate = `${calendar.name} ${selectedDate}, ${calendar.year}`;
    setConfirmStatus("sending");

    try {
      const response = await fetch("https://formsubmit.co/ajax/vigneshmhatre474@gmail.com", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          _subject: `💖 She picked a date: ${formattedDate}!`,
          Date_Selected: formattedDate,
          Message: `Your girlfriend just confirmed your next cute date for ${formattedDate}! Time to bring the plans, the snacks, and one million kisses.`,
          _template: "table",
        }),
      });

      if (response.ok) {
        setConfirmStatus("sent");
      } else {
        throw new Error("Failed to send");
      }
    } catch {
      setConfirmStatus("error");
      const subject = encodeURIComponent(`💖 Our Next Cute Date: ${formattedDate}!`);
      const body = encodeURIComponent(
        `Hey! I picked our next cute date: ${formattedDate} 💕 Can't wait!`
      );
      window.location.href = `mailto:vigneshmhatre474@gmail.com?subject=${subject}&body=${body}`;
    }
  };

  const activeSong = playlist[currentSongIndex];
  const mainFilter = isPlaying
    ? `hue-rotate(${activeSong.hueShift}deg) saturate(${activeSong.saturation})`
    : "none";
  const counterFilter = isPlaying
    ? `saturate(${Number((1 / activeSong.saturation).toFixed(3))}) hue-rotate(${-activeSong.hueShift}deg)`
    : "none";

  return (
    <>
      <main
        style={{
          filter: mainFilter,
          transition: "filter 0.75s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        className="min-h-screen overflow-hidden bg-[#fff5f9] text-[#5c2039]"
      >
        <section className="relative min-h-[92vh] border-b-4 border-[#ef73aa] px-6 pb-16 pt-6 md:px-12">
          <div className="absolute inset-0 heart-grid opacity-30" />
          <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between">
            <a href="#" className="font-display text-xl font-bold italic text-[#df327f]">the Sexiest chick in lly life</a>
            <a href="#date" className="rounded-full border-2 border-[#df327f] bg-white px-5 py-2 text-xs font-black uppercase tracking-[0.16em] shadow-[3px_3px_0_#df327f] transition hover:-translate-y-1">
              plan our date
            </a>
          </nav>

          <div className="relative z-[1] mx-auto flex max-w-6xl flex-col items-center pt-20 text-center md:pt-24">
            <p className="mb-5 rounded-full bg-[#ffcfdf] px-5 py-2 text-xs font-black uppercase tracking-[0.24em] text-[#c82069]">
              An important announcement
            </p>
            <h1 className="max-w-5xl font-display text-[clamp(4rem,12vw,9.5rem)] font-black uppercase leading-[0.74] tracking-[-0.07em] text-[#f0448c]">
              The cutest
              <span className="block text-[#ff84b6]">The hottest</span>
              <span className="block text-[#d92873]">The sweetest</span>
            </h1>
            <div className="mt-9 rotate-[-2deg] border-2 border-[#df327f] bg-white px-7 py-3 shadow-[6px_6px_0_#ffafd0]">
              <p className="font-display text-xl font-bold italic md:text-2xl">Yes, this is all about you. Who else?</p>
            </div>
            <a
              href="#love-notes"
              onClick={() => playSongAtIndex(0)}
              className="mt-10 flex h-16 w-16 items-center justify-center rounded-full bg-[#f0448c] text-white shadow-[0_8px_0_#be235f] transition hover:translate-y-1 hover:shadow-[0_4px_0_#be235f]"
              aria-label="Read my love notes"
            >
              <span className="text-2xl">↓</span>
            </a>
          </div>

          <Rose className="float-slow absolute -left-5 top-32 w-32 rotate-[-18deg] md:left-10 md:w-44" />
          <Rose className="float-delayed absolute -right-3 top-44 w-28 rotate-[20deg] md:right-14 md:w-40" />
          <Bunny className="bunny-hop absolute bottom-4 left-[2%] w-32 md:left-[10%] md:w-44" />
          <Bunny className="bunny-hop-delayed absolute bottom-6 right-[1%] w-28 md:right-[9%] md:w-40" flip />
          <Heart className="float-slow absolute left-[22%] top-28 w-7 rotate-[-12deg] text-[#ff9bc3]" />
          <Heart className="float-delayed absolute right-[22%] top-[42%] w-9 rotate-[14deg] text-[#ffc2da]" />
        </section>

        <section id="love-notes" className="relative bg-[#ffbed8] px-6 py-24 md:px-12">
          <div className="mx-auto max-w-7xl">
            <div className="mb-14 grid gap-7 md:grid-cols-[1fr_1.4fr] md:items-end">
              <h2 className="font-display text-6xl font-black leading-[0.9] tracking-[-0.05em] text-[#b91f61] md:text-8xl">Reasons I’m<br />obsessed with you</h2>
              <p className="max-w-xl border-l-4 border-[#e7337d] pl-6 text-lg font-semibold leading-relaxed">
                You are not just beautiful. You are the kind of beautiful that makes the whole room feel softer. Being around you feels like finding extra sprinkles at the bottom of the bag.
              </p>
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              {compliments.map((item, index) => (
                <article
                  key={item.number}
                  onClick={() => playSongAtIndex(item.songIndex)}
                  className={`group cursor-pointer border-2 border-[#d92873] bg-[#fff9fc] p-7 shadow-[8px_8px_0_#e94b8c] transition hover:-translate-y-2 ${index === 1 ? "md:rotate-1" : index === 2 ? "md:-rotate-1" : ""}`}
                >
                  <span className="font-display text-5xl font-black text-[#ffb0ce]">{item.number}</span>
                  <h3 className="mt-8 font-display text-3xl font-black text-[#d92873]">{item.title}</h3>
                  <p className="mt-4 leading-relaxed text-[#713149]">{item.copy}</p>
                  <Heart className="mt-7 w-8 text-[#f0448c] transition group-hover:scale-125" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="relative px-6 py-24 md:px-12">
          <div className="mx-auto max-w-7xl">
            <div className="mb-12 text-center">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-[#e7337d]">Our tiny museum of us</p>
              <h2 className="mt-3 font-display text-6xl font-black tracking-[-0.05em] text-[#d92873] md:text-8xl">HOT, CUTE & SEXY</h2>
              <p className="mx-auto mt-5 max-w-2xl text-lg">Reserved for the moments where you were extra adorable — which is, inconveniently, every moment.</p>
            </div>
            <div className="grid gap-7 md:grid-cols-3">
              {photoCards.map((card, index) => (
                <article
                  key={card.label}
                  onClick={() => playSongAtIndex(card.songIndex)}
                  className={`cursor-pointer border-2 border-[#df327f] bg-white p-3 shadow-[10px_10px_0_#ffb3d0] transition hover:-translate-y-2 ${index === 0 ? "md:rotate-[-2deg]" : index === 2 ? "md:rotate-[2deg]" : ""}`}
                >
                  <div className={`group relative overflow-hidden border-2 border-[#e8669d] ${card.tone}`}>
                    <img
                      src={card.image}
                      alt={card.caption}
                      style={{
                        filter: counterFilter,
                        transition: "filter 0.75s cubic-bezier(0.22, 1, 0.36, 1)",
                      }}
                      className="block h-auto w-full"
                    />
                  </div>
                  <div className="px-2 pb-2 pt-5">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-[#ee4b8e]">{card.label}</p>
                    <h3 className="mt-1 font-display text-2xl font-bold">{card.caption}</h3>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="relative bg-[#fff5f9] px-6 pb-24 pt-8 md:px-12">
          <div className="relative mx-auto max-w-5xl overflow-hidden border-2 border-[#d92873] bg-white shadow-[12px_12px_0_#ffadd0]">
            <div className="grid md:grid-cols-[0.75fr_1.25fr]">
              <div className="relative flex min-h-72 flex-col justify-between overflow-hidden bg-[#f05091] p-8 text-white md:p-10">
                <div className="absolute inset-0 heart-grid opacity-20" />
                <div className="relative">
                  <p className="text-xs font-black uppercase tracking-[0.25em] text-[#ffe2ed]">Select a love note</p>
                  <label htmlFor="favorite-thing" className="mt-5 block font-display text-4xl font-black leading-tight">
                    What I think about her...
                  </label>
                  <div className="relative mt-6">
                    <select
                      id="favorite-thing"
                      value={favoriteThing}
                      onChange={(event) => {
                        const nextKey = event.target.value as keyof typeof favoriteThings;
                        setFavoriteThing(nextKey);
                        playSongAtIndex(favoriteThings[nextKey].songIndex);
                      }}
                      className="w-full appearance-none rounded-none border-2 border-[#971546] bg-[#fff5f9] px-5 py-4 pr-12 text-sm font-black uppercase tracking-[0.12em] text-[#a91f55] outline-none transition focus:shadow-[5px_5px_0_#9f1b50]"
                    >
                      {Object.entries(favoriteThings).map(([key, item]) => (
                        <option key={key} value={key}>{item.label}</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-lg text-[#d92873]">↓</span>
                  </div>
                </div>
                <div className="relative mt-10 flex items-end justify-between">
                  <Heart className="w-10 text-[#ffd1e2]" />
                  <span className="font-display text-6xl font-black text-[#ff9fc4]">05</span>
                </div>
              </div>

              <div key={favoriteThing} className="love-note-enter relative flex min-h-72 flex-col justify-center p-8 md:p-12">
                <p className="text-xs font-black uppercase tracking-[0.28em] text-[#e44484]">
                  About {favoriteThings[favoriteThing].label.toLowerCase()}
                </p>
                <h2 className="mt-4 max-w-2xl font-display text-4xl font-black leading-tight tracking-[-0.03em] text-[#bf2263] md:text-5xl">
                  {favoriteThings[favoriteThing].title}
                </h2>
                <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#713149]">
                  {favoriteThings[favoriteThing].copy}
                </p>
                <div className="mt-8 h-1 w-24 bg-[#ff9ec3]" />
              </div>
            </div>
          </div>
        </section>

        <section id="date" className="relative border-y-4 border-[#ef73aa] bg-[#ffe0ec] px-6 py-24 md:px-12">
          <Rose className="absolute -bottom-5 -left-5 w-40 rotate-[18deg] opacity-70" />
          <Rose className="absolute -right-7 -top-8 w-44 rotate-[-20deg] opacity-70" />
          <div className="relative mx-auto grid max-w-5xl gap-10 md:grid-cols-[0.85fr_1fr] md:items-center">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.3em] text-[#d92873]">Very official business</p>
              <h2 className="mt-4 font-display text-6xl font-black leading-[0.88] tracking-[-0.05em] text-[#c82269] md:text-7xl">Pick our next cute date</h2>
              <p className="mt-7 max-w-md text-lg leading-relaxed">Choose a day and I’ll bring the plans, the snacks, and approximately one million kisses.</p>
              {selectedDate && (
                <div className="mt-8 flex flex-col items-start gap-4">
                  <div className="inline-flex rotate-[-2deg] items-center gap-3 bg-[#f0448c] px-5 py-3 font-bold text-white shadow-[5px_5px_0_#b91f61]">
                    <Heart className="w-5" />
                    It’s a date: {calendar.name} {selectedDate}!
                  </div>
                  <button
                    type="button"
                    onClick={handleConfirmDate}
                    disabled={confirmStatus === "sending" || confirmStatus === "sent"}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-full border-2 border-[#b91f61] bg-white px-6 py-3 text-xs font-black uppercase tracking-[0.18em] text-[#c82269] shadow-[5px_5px_0_#d92873] transition hover:-translate-y-1 hover:bg-[#f0448c] hover:text-white disabled:cursor-not-allowed disabled:opacity-80"
                  >
                    <Heart className="w-4 text-[#f0448c] group-hover:text-white" />
                    {confirmStatus === "sending"
                      ? "Sending to Vignesh..."
                      : confirmStatus === "sent"
                        ? "Date Confirmed & Mail Sent! 💖"
                        : "Confirm Date"}
                  </button>
                  {confirmStatus === "sent" && (
                    <p className="text-sm font-bold text-[#b91f61]">
                      Yay! Vignesh just got an email for {calendar.name} {selectedDate}, {calendar.year} 💕
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="border-2 border-[#d92873] bg-[#fffafd] p-5 shadow-[12px_12px_0_#ee77a9] md:p-8">
              <div className="mb-6 flex items-center justify-between">
                <button onClick={() => { setMonthOffset((m) => m - 1); setSelectedDate(null); setConfirmStatus("idle"); }} className="h-10 w-10 rounded-full border-2 border-[#dc367c] bg-[#ffd1e3] font-black transition hover:bg-[#f0448c] hover:text-white" aria-label="Previous month">←</button>
                <h3 className="font-display text-3xl font-black text-[#c82269]">{calendar.name} <span className="text-[#ee77a9]">{calendar.year}</span></h3>
                <button onClick={() => { setMonthOffset((m) => m + 1); setSelectedDate(null); setConfirmStatus("idle"); }} className="h-10 w-10 rounded-full border-2 border-[#dc367c] bg-[#ffd1e3] font-black transition hover:bg-[#f0448c] hover:text-white" aria-label="Next month">→</button>
              </div>
              <div className="grid grid-cols-7 gap-2 text-center">
                {["S", "M", "T", "W", "T", "F", "S"].map((day, i) => <span key={`${day}-${i}`} className="pb-2 text-xs font-black text-[#e34886]">{day}</span>)}
                {Array.from({ length: calendar.start }).map((_, i) => <span key={`empty-${i}`} />)}
                {Array.from({ length: calendar.days }, (_, i) => i + 1).map((day) => (
                  <button key={day} onClick={() => { setSelectedDate(day); setConfirmStatus("idle"); }} className={`aspect-square rounded-full text-sm font-bold transition hover:scale-110 hover:bg-[#ffb3d0] ${selectedDate === day ? "bg-[#e9347d] text-white shadow-[3px_3px_0_#8f1849]" : "bg-[#fff0f6]"}`}>
                    {day}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <footer className="relative overflow-hidden bg-[#f0448c] px-6 pb-40 pt-20 text-center text-white">
          <div className="relative z-10 mx-auto max-w-3xl">
            <p className="font-display text-5xl font-black leading-tight md:text-7xl">if you liked it then hug me if you loved it thhen a kiss on cheeks would be sweet</p>
            <p className="mt-6 font-bold">Made with a ridiculous amount of love, just for you.</p>
            <Heart className="mx-auto mt-8 w-10 text-[#ffd5e5]" />
          </div>
          <Bunny className="absolute -bottom-4 left-2 w-36 opacity-40" />
          <Bunny className="absolute -bottom-4 right-2 w-36 opacity-40" flip />
        </footer>
      </main>

      {/* Floating Visible Spotify Player Widget with 5-Song Scroller */}
      <div
        style={{
          filter: mainFilter,
          transition: "filter 0.75s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        className="fixed bottom-4 right-4 z-50"
      >
        {isPlayerMinimized && (
          <button
            type="button"
            onClick={() => setIsPlayerMinimized(false)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full border-2 border-[#d92873] bg-[#f0448c] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white shadow-[5px_5px_0_#8f1849] transition hover:-translate-y-1 hover:bg-[#d92873]"
          >
            <Heart className="h-4 w-4 text-[#ffd5e5]" />
            Click Me
          </button>
        )}

        <aside
          aria-hidden={isPlayerMinimized}
          className={
            isPlayerMinimized
              ? "pointer-events-none fixed -bottom-96 -right-96 h-0 w-0 overflow-hidden opacity-0"
              : "w-[min(94vw,430px)] border-2 border-[#d92873] bg-[#fff9fc] p-4 shadow-[8px_8px_0_#d92873] transition-all"
          }
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 overflow-hidden">
              <Heart className="h-4 w-4 shrink-0 text-[#f0448c]" />
              <span className="truncate text-xs font-black uppercase tracking-[0.14em] text-[#c82269]">
                {playlist[currentSongIndex].vibe}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePrevSong}
                aria-label="Previous song"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-2 border-[#d92873] bg-[#ffe0ec] text-xs font-black text-[#b91f61] transition hover:bg-[#f0448c] hover:text-white"
              >
                ⏮
              </button>
              <button
                type="button"
                onClick={handleNextSong}
                aria-label="Next song"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-2 border-[#d92873] bg-[#ffe0ec] text-xs font-black text-[#b91f61] transition hover:bg-[#f0448c] hover:text-white"
              >
                ⏭
              </button>
              <button
                type="button"
                onClick={() => setIsPlayerMinimized(true)}
                className="cursor-pointer rounded-full border-2 border-[#d92873] bg-white px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#b91f61] transition hover:bg-[#f0448c] hover:text-white"
              >
                Minimize
              </button>
            </div>
          </div>

          {/* 5-Song Track Scroller / Selector Bar */}
          <div className="mb-3 flex items-center gap-1.5 overflow-x-auto pb-1">
            {playlist.map((song, idx) => (
              <button
                key={song.uri + idx}
                type="button"
                onClick={() => playSongAtIndex(idx)}
                className={`shrink-0 cursor-pointer rounded-full border-2 px-3 py-1 text-[11px] font-black uppercase tracking-wider transition ${
                  currentSongIndex === idx
                    ? "border-[#b91f61] bg-[#f0448c] text-white shadow-[2px_2px_0_#8f1849]"
                    : "border-[#ef73aa] bg-[#fff0f6] text-[#c82269] hover:bg-[#ffd0e5]"
                }`}
              >
                {idx + 1}. {song.title}
              </button>
            ))}
          </div>

          <div
            style={{
              filter: counterFilter,
              transition: "filter 0.75s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
            className="block overflow-hidden rounded-xl border-2 border-[#ef73aa] bg-white"
          >
            <div ref={embedRef} />
          </div>
        </aside>
      </div>
    </>
  );
}
