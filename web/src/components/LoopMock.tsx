// Static mocks of the loop: the GitHub issue as the run narrates it, and the
// phone where the pull request is reviewed. Pure markup, no screenshots.
// Everything shown here is live behaviour; nothing in progress (plan comments,
// cost, self-review, check results) appears, so the picture never over-claims.
import { CheckIcon, GithubIcon } from "./icons";

const issue = {
  number: 142,
  title: "Add Apple Pay to the checkout flow",
  branch: "celiador/142-apple-pay",
  pr: 143,
};

function Avatar({ label, brand = false }: { label: string; brand?: boolean }) {
  return (
    <span
      className={
        "grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[10px] " +
        (brand ? "bg-brand/20 text-brand" : "bg-white/[0.08] text-fog")
      }
    >
      {label}
    </span>
  );
}

function Comment({ author, when, children }: { author: string; when: string; children: React.ReactNode }) {
  const brand = author === "celiador";
  return (
    <div className="flex gap-3">
      <Avatar label={brand ? "c" : "sw"} brand={brand} />
      <div className="min-w-0 flex-1 rounded-xl border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11px] text-fog-dim">
          <span className={brand ? "font-medium text-brand" : "font-medium text-white"}>{author}</span>
          {brand && <span className="rounded border border-line px-1 text-[9px] uppercase tracking-wide">app</span>}
          <span>{when}</span>
        </div>
        <div className="px-3 py-2 text-[12.5px] leading-relaxed text-fog">{children}</div>
      </div>
    </div>
  );
}

/** The GitHub issue, as the run leaves it. */
export function IssueMock() {
  return (
    <div className="ring-brand overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-3">
        <GithubIcon className="h-4 w-4 text-fog" />
        <span className="font-mono text-xs text-fog-dim">acme/storefront · issue #{issue.number}</span>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-white">{issue.title}</span>
            <span className="rounded-full border border-brand/40 bg-brand/15 px-2 py-0.5 font-mono text-[11px] text-brand">
              celiador
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-fog">
            Use the existing <span className="font-mono text-white">ApplePay</span> helper in{" "}
            <span className="font-mono text-white">pay/</span>. Do not touch the cart.
          </p>
        </div>
        <Comment author="celiador" when="1 min">
          Picked up. Running on <span className="font-mono text-white">stefan&apos;s Mac</span> on branch{" "}
          <span className="font-mono text-white">{issue.branch}</span>.
        </Comment>
        <Comment author="celiador" when="9 min">
          Opened pull request <span className="font-mono text-white">#{issue.pr}</span>, which closes this issue.
        </Comment>
      </div>
    </div>
  );
}

/** The phone, with the pull request ready for review. */
export function PhoneMock() {
  return (
    <div className="mx-auto w-full max-w-[300px] rounded-[2rem] border border-line bg-surface p-2 shadow-[0_30px_80px_-30px_rgba(124,107,255,0.6)]">
      <div className="overflow-hidden rounded-[1.6rem] border border-line bg-ink">
        <div className="flex items-center justify-between px-5 pt-4 text-[11px] text-fog-dim">
          <span>9:41</span>
          <span className="h-1.5 w-12 rounded-full bg-white/10" />
          <span>●●●</span>
        </div>
        <div className="px-4 pb-5 pt-3">
          <div className="text-xs font-medium uppercase tracking-wider text-fog-dim">Ready for review</div>
          <div className="mt-2 rounded-xl border border-line bg-surface p-3">
            <div className="font-mono text-[11px] text-fog-dim">acme/storefront · #{issue.pr}</div>
            <div className="mt-1 text-[13.5px] font-medium text-white">{issue.title}</div>
            <p className="mt-2 text-[12px] leading-relaxed text-fog">
              Added an <span className="text-white">ApplePay.authorize</span> call in{" "}
              <span className="font-mono text-brand-2">checkout.ts</span> and wired the token into{" "}
              <span className="font-mono text-brand-2">capture()</span>. Lint and tests pass locally.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-1.5 font-mono text-[10.5px]">
              <span className="rounded-md bg-white/[0.05] px-2 py-1 text-fog">2 files</span>
              <span className="rounded-md bg-white/[0.05] px-2 py-1 text-[#c3e88d]">+41</span>
              <span className="rounded-md bg-white/[0.05] px-2 py-1 text-[#ff5f57]">−3</span>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
            <span className="rounded-xl border border-line px-3 py-2.5 text-center text-fog">Follow-up</span>
            <span className="flex items-center justify-center gap-1.5 rounded-xl bg-brand px-3 py-2.5 font-medium text-white">
              <CheckIcon className="h-3.5 w-3.5" />
              Approve and merge
            </span>
          </div>
          <div className="mt-4 text-xs font-medium uppercase tracking-wider text-fog-dim">Running</div>
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-[12px] text-fog">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
            <span className="truncate">#145 Rename the billing module</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Issue and phone side by side: the whole loop in one picture. */
export function LoopMock() {
  return (
    <div className="grid items-center gap-6 lg:grid-cols-[1fr_300px]">
      <IssueMock />
      <PhoneMock />
    </div>
  );
}
