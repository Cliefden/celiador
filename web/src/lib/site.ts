// Central content + config for the Celiador marketing site.
// Edit copy here; components read from these constants so pages stay DRY.

export const site = {
  name: "Celiador",
  tagline: "The AI editor for people who ship.",
  description:
    "Celiador is an AI code editor for macOS — a native app with an agent that reads, writes, and ships changes across your whole codebase. Built on VS Code.",
  url: "https://celiador.ai",
  // The download page reads the live version from the daemon's release
  // listing (src/lib/releases.ts); this is only the fallback label shown
  // when no build has been published or the listing is unreachable.
  downloadHref: "/download",
  macVersion: "preview",
  minMacOS: "macOS 13 Ventura or later · Apple Silicon",
  // Public TestFlight link for the iPhone companion; empty until it exists.
  testflightUrl: "",
  github: "https://github.com/Cliefden/celiador",
};

export const nav: { label: string; href: string }[] = [
  { label: "Features", href: "/features" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: "/docs" },
  { label: "Changelog", href: "/changelog" },
  { label: "About", href: "/about" },
];

export type Feature = {
  title: string;
  body: string;
  icon: string; // key into components/icons
};

export const features: Feature[] = [
  {
    title: "An agent that ships",
    body: "Describe the change; the agent plans, edits across files, runs your tools, and shows you a reviewable diff before anything lands.",
    icon: "bolt",
  },
  {
    title: "Chat with your codebase",
    body: "Ask questions in plain language. Celiador reads the whole repo for context and answers with the exact files and lines.",
    icon: "chat",
  },
  {
    title: "Built on VS Code",
    body: "A real hard fork of VS Code — your extensions, keybindings, themes, and muscle memory come with you. No new editor to learn.",
    icon: "code",
  },
  {
    title: "Native macOS app",
    body: "Not a browser tab. A fast, signed native app that feels at home on your Mac, with menu bar, notifications, and deep OS integration.",
    icon: "apple",
  },
  {
    title: "Every edit is reviewable",
    body: "Nothing is applied silently. Each write is a diff you accept or reject, so the agent stays fast without ever going rogue.",
    icon: "diff",
  },
  {
    title: "Our key, your privacy",
    body: "The editor never holds a model key. Requests go through our server, which holds the key and meters usage with limits we publish. Your code isn't training data.",
    icon: "shield",
  },
];

export const steps: { title: string; body: string }[] = [
  {
    title: "Describe it",
    body: "Tell Celiador what you want — a feature, a refactor, a bug fix — in natural language, right inside the editor.",
  },
  {
    title: "Review the plan",
    body: "The agent proposes a set of edits across your files. See the full diff, tweak the intent, and stay in control.",
  },
  {
    title: "Ship it",
    body: "Accept the changes, run your tests, and commit. From idea to merged PR without leaving the editor.",
  },
];

export type Tier = {
  name: string;
  price: string;
  cadence?: string;
  blurb: string;
  cta: string;
  href: string;
  featured?: boolean;
  perks: string[];
};

// One pricing truth (see /conduct): what exists today is free early access with
// published, server-enforced limits. Paid plans are announced with a date before
// anyone is billed, so nothing here pretends to sell what isn't built.
export const tiers: Tier[] = [
  {
    name: "Early access",
    price: "$0",
    cadence: "today",
    blurb: "The whole product while we're in early access: the editor, the hosted Claude agent on our key, and the iPhone companion.",
    cta: "Download for Mac",
    href: "/download",
    featured: true,
    perks: [
      "Native macOS editor built on VS Code",
      "Hosted Claude agent — no key to bring, no card to add",
      "Daily limits published below and metered server-side",
      "iPhone companion to watch and steer runs",
      "Support answered by a person",
    ],
  },
  {
    name: "Pro",
    price: "Not yet",
    blurb: "When paid plans arrive, the price, the limits and the date appear here and in the changelog before a single invoice. Early-access accounts get the transition terms in writing, with an end date.",
    cta: "Read the pledge",
    href: "/conduct",
    perks: [
      "Price and limits published before billing starts",
      "Self-service cancellation; statutory withdrawal rights honored",
      "No \"unlimited\" unless it is",
    ],
  },
  {
    name: "Teams",
    price: "Later",
    blurb: "Shared billing, seats and admin controls aren't built yet. If you'd run Celiador for a team, tell us what you'd need and we'll say plainly what exists.",
    cta: "Contact us",
    href: "/contact",
    perks: [
      "Nothing to buy today",
      "Your requirements shape what we build first",
    ],
  },
];

export const faqs: { q: string; a: string }[] = [
  {
    q: "What is Celiador?",
    a: "Celiador is a native macOS AI code editor. It's a hard fork of VS Code with a built-in agent that can read your whole codebase, answer questions, and make multi-file edits that you review before they're applied.",
  },
  {
    q: "How is it different from VS Code?",
    a: "Everything you love about VS Code is still here — extensions, themes, keybindings. Celiador adds a first-class AI agent baked into the editor core, rather than bolted on as an extension, so it can move faster and see more context.",
  },
  {
    q: "Is it available now?",
    a: "Yes, as early access. The macOS app is a signed, notarized download that updates itself; the iPhone companion follows on TestFlight.",
  },
  {
    q: "Which platforms are supported?",
    a: "macOS on Apple Silicon today, with an iPhone companion for steering runs. Windows and Linux builds are on the roadmap — tell us on the download page which you need.",
  },
  {
    q: "What does it cost?",
    a: "Nothing during early access. The hosted agent runs on our key with per-account limits that are published on the pricing page and enforced by the server, and the app shows you the same numbers. Paid plans will be announced with a date before anyone is billed.",
  },
  {
    q: "What happens to my code?",
    a: "Your code stays yours. It is never used to train models. The editor never holds a model key; requests go through our server, which holds the key, and nothing is indexed server-side.",
  },
  {
    q: "Do I need to learn a new editor?",
    a: "No. Because Celiador is built on VS Code, your existing setup, shortcuts, and extensions carry over on day one.",
  },
];

export const footerLinks: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "Pricing", href: "/pricing" },
      { label: "Download", href: "/download" },
      { label: "Switch from Cursor", href: "/switch" },
      { label: "Releases", href: "/releases" },
      { label: "Docs", href: "/docs" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "GitHub", href: site.github },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Conduct pledge", href: "/conduct" },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];
