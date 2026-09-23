// Central content + config for the Celiador marketing site.
// Edit copy here; components read from these constants so pages stay DRY.

export const site = {
  name: "Celiador",
  tagline: "The AI editor for people who ship.",
  description:
    "Celiador is an AI code editor for macOS — a native app with an agent that reads, writes, and ships changes across your whole codebase. Built on VS Code.",
  url: "https://celiador.ai",
  // Swap this for the real signed .dmg URL when the product is released.
  downloadHref: "/download",
  macVersion: "0.1.0 (preview)",
  minMacOS: "macOS 13 Ventura or later · Apple Silicon",
  github: "https://github.com/Cliefden/celiador",
};

export const nav: { label: string; href: string }[] = [
  { label: "Features", href: "/features" },
  { label: "Pricing", href: "/pricing" },
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
    title: "Your keys, your privacy",
    body: "Bring your own model access or use ours. Your code isn't training data, and sensitive work can stay on your machine.",
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

export const tiers: Tier[] = [
  {
    name: "Hobby",
    price: "$0",
    cadence: "forever",
    blurb: "Everything you need to try Celiador on your own projects.",
    cta: "Download free",
    href: "/download",
    perks: [
      "Native macOS editor",
      "AI chat with your codebase",
      "Bring your own model key",
      "Community support",
    ],
  },
  {
    name: "Pro",
    price: "$20",
    cadence: "/ month",
    blurb: "The full agent, hosted models, and higher limits for daily work.",
    cta: "Start Pro",
    href: "/download",
    featured: true,
    perks: [
      "Everything in Hobby",
      "Agent that edits across files",
      "Hosted frontier models included",
      "Priority previews & support",
    ],
  },
  {
    name: "Team",
    price: "Custom",
    blurb: "Shared billing, admin controls, and security review for your org.",
    cta: "Contact us",
    href: "/contact",
    perks: [
      "Everything in Pro",
      "Centralized billing & seats",
      "SSO & audit logging",
      "Security & procurement review",
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
    a: "We're in private preview. Add your email on the download page and we'll send you the macOS build the moment it's ready.",
  },
  {
    q: "Which platforms are supported?",
    a: "macOS on Apple Silicon is first. Windows and Linux builds are on the roadmap — tell us on the download page which you need.",
  },
  {
    q: "What happens to my code?",
    a: "Your code stays yours. It is never used to train models. You can bring your own model provider key, and sensitive work can be kept on your machine.",
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
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];
