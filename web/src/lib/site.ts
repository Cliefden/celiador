// Central content + config for the Celiador marketing site.
// Edit copy here; components read from these constants so pages stay DRY.
//
// Positioning: the loop is the product. A GitHub issue goes in, a pull request
// comes out; the editor is one runner, Celiador Remote (VS Code or Cursor) is
// another, the cloud is the third; the phone is the review surface; GitHub is
// where the run narrates itself. Copy must not promise what is not live: cloud
// runs, plan/question comments, CI fixes, per-run cost and the self-review
// section are in progress and are marked "coming" wherever they appear.

export const site = {
  name: "Celiador",
  tagline: "Issue in, pull request out.",
  description:
    "Label a GitHub issue celiador and an agent runs it on your Mac in its own git worktree, opens a pull request that closes the issue, and narrates the run on the issue. Review and merge from your phone. Works from the Celiador editor, or from VS Code and Cursor with the Celiador Remote extension.",
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
  // Celiador Remote: the loop for stock VS Code and Cursor.
  remoteOpenVsx: "https://open-vsx.org/extension/celiador/celiador-remote",
  remoteReleases: "https://github.com/Cliefden/celiador-remote/releases/latest",
  githubApp: "https://github.com/apps/celiador/installations/new",
};

export const nav: { label: string; href: string }[] = [
  { label: "Start", href: "/start" },
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
  // Parts of this feature that are being built and are not live yet. Rendered
  // as a separate "Coming" line so the body only describes what works today.
  coming?: string;
};

export const features: Feature[] = [
  {
    title: "The loop",
    body: "Label a GitHub issue celiador. An agent picks it up on your Mac, works in its own git worktree so your checkout is untouched, and opens a pull request that closes the issue.",
    icon: "bolt",
  },
  {
    title: "Review from your phone",
    body: "Celiador for iPhone shows what the agent did, the diff, and what needs you. Send a follow-up, allow or deny a risky command, then approve and merge. The editor's Agents view shows the same runs.",
    icon: "phone",
  },
  {
    title: "Your runner, your choice",
    body: "Run it in the Celiador editor, or keep VS Code or Cursor and install the Celiador Remote extension. Same loop, same account, same phone.",
    icon: "code",
    coming: "Cloud runs for when your Mac is off. They need the Celiador GitHub App on the repository.",
  },
  {
    title: "GitHub is the cockpit",
    body: "Every run narrates itself on the issue: a comment when it is picked up and on which branch, and the pull request link when it is done. Your team sees the work where they already look.",
    icon: "github",
    coming: "The agent's plan and its questions posted on the issue, answered by replying there.",
  },
  {
    title: "Every PR explains itself",
    body: "The pull request says what the agent did and closes the issue it came from, so review starts from the agent's own account of the change.",
    icon: "diff",
    coming: "A self-review section in every PR, per-run cost on the PR and on the card, and failed CI checks fixed by the agent.",
  },
  {
    title: "Our key, your privacy",
    body: "No client holds a model key. Requests go through our server, which holds the key and meters usage with limits we publish. Your code isn't training data.",
    icon: "shield",
  },
];

export const steps: { title: string; body: string }[] = [
  {
    title: "Label it",
    body: "Write the issue the way you would brief a colleague, then add the celiador label. Within a minute the issue gets a comment saying it was picked up and on which branch.",
  },
  {
    title: "It runs in its own worktree",
    body: "The agent reads, edits, runs your lint and tests, and commits on a fresh branch in a git worktree on your Mac. Routine commands run on their own; a risky one waits for you.",
  },
  {
    title: "Review and merge from anywhere",
    body: "The pull request shows up on your phone and in the editor's Agents view. Read the diff, send a follow-up if it needs another pass, then approve and merge.",
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
    a: "Celiador turns GitHub issues into pull requests. You label an issue celiador; an agent runs it on your Mac in its own git worktree, comments on the issue, and opens a pull request that closes it. You review and merge from your phone or from the editor's Agents view. The agent is Claude, run through our server on our key.",
  },
  {
    q: "Do I have to switch editors?",
    a: "No. The Celiador editor, a fork of VS Code, has the loop built in and is the nicest place to watch runs. If you want to keep VS Code or Cursor, install the Celiador Remote extension: same loop, same account, same phone. Cloud runs for when your Mac is off are being built and will need the Celiador GitHub App on the repository.",
  },
  {
    q: "What does the agent do when it needs me?",
    a: "Routine commands run on their own. A risky command or a question shows up under Needs you on the phone and in the Agents view, with Allow and Deny, and the run waits. Posting the same question on the issue, so you can answer by replying, is being built.",
  },
  {
    q: "Is it available now?",
    a: "Yes, as early access. The editor is a signed, notarized macOS download that updates itself, with Linux x64 packages too; Celiador Remote is on Open VSX; the iPhone app is on TestFlight by invite until the public link is on the download page.",
  },
  {
    q: "Which platforms are supported?",
    a: "Runners: the Celiador editor on macOS (Apple Silicon) and Linux x64, or any VS Code or Cursor install with Celiador Remote. Review: iPhone, or the Agents view in the editor. A Windows build of the editor is on the roadmap; tell us on the download page if you need it.",
  },
  {
    q: "What does it cost?",
    a: "Nothing during early access. The hosted agent runs on our key with per-account limits that are published on the pricing page and enforced by the server, and the app shows you the same numbers. Paid plans will be announced with a date before anyone is billed.",
  },
  {
    q: "What happens to my code?",
    a: "Your code stays yours. Runs happen on your machine, in a worktree of your own clone. It is never used to train models. No client holds a model key; the agent's requests go through our server, which holds the key, and nothing is indexed server-side.",
  },
];

export const footerLinks: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Start here", href: "/start" },
      { label: "Features", href: "/features" },
      { label: "Pricing", href: "/pricing" },
      { label: "Download", href: "/download" },
      { label: "Keep Cursor or VS Code", href: "/switch" },
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
