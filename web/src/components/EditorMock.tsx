// A stylized, static mock of the Celiador editor — pure markup, no screenshots.
import { SparkIcon } from "./icons";

function Line({ indent = 0, children }: { indent?: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 whitespace-pre">
      <span className="w-6 select-none text-right text-fog-dim/60">{}</span>
      <span style={{ paddingLeft: indent * 16 }}>{children}</span>
    </div>
  );
}

const kw = "text-[#c792ea]";
const fn = "text-[#82aaff]";
const str = "text-[#c3e88d]";
const cm = "text-fog-dim";
const pl = "text-[#89ddff]";

export function EditorMock() {
  return (
    <div className="ring-brand overflow-hidden rounded-2xl border border-line bg-surface">
      {/* title bar */}
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-3 font-mono text-xs text-fog-dim">celiador — checkout.ts</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_300px]">
        {/* code */}
        <div className="min-w-0 overflow-hidden border-line font-mono text-[12.5px] leading-6 md:border-r">
          <div className="flex gap-1 border-b border-line px-3 py-2 text-xs text-fog-dim">
            <span className="rounded-md bg-white/[0.06] px-2.5 py-1 text-white">checkout.ts</span>
            <span className="px-2.5 py-1">cart.tsx</span>
          </div>
          <div className="px-4 py-4 text-fog">
            <Line>
              <span className={cm}>{"// add Apple Pay to the checkout flow"}</span>
            </Line>
            <Line>
              <span className={kw}>import</span> {"{ "}
              <span className={pl}>ApplePay</span>
              {" } "}
              <span className={kw}>from</span> <span className={str}>&quot;./pay&quot;</span>
            </Line>
            <Line> </Line>
            <Line>
              <span className={kw}>export async function</span> <span className={fn}>checkout</span>
              (cart) {"{"}
            </Line>
            <Line indent={1}>
              <span className={kw}>const</span> total = <span className={fn}>sum</span>(cart.items)
            </Line>
            <div className="my-1 border-l-2 border-brand bg-brand/10 pl-2">
              <Line indent={1}>
                <span className={kw}>const</span> token = <span className={kw}>await</span>{" "}
                <span className={pl}>ApplePay</span>.<span className={fn}>authorize</span>(total)
              </Line>
              <Line indent={1}>
                <span className={kw}>return</span> <span className={fn}>capture</span>(token)
              </Line>
            </div>
            <Line>{"}"}</Line>
          </div>
        </div>

        {/* agent panel */}
        <div className="bg-surface-2/50">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-xs font-medium text-fog">
            <SparkIcon className="h-4 w-4 text-brand" />
            Celiador Agent
          </div>
          <div className="space-y-3 p-4 text-[13px] leading-relaxed">
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-brand/15 px-3 py-2 text-white">
              Add Apple Pay to checkout
            </div>
            <div className="w-fit max-w-[92%] rounded-2xl rounded-bl-sm border border-line bg-surface px-3 py-2 text-fog">
              Done. I added an <span className="text-white">ApplePay.authorize</span> call to{" "}
              <span className="font-mono text-brand-2">checkout.ts</span> and wired the token into{" "}
              <span className="font-mono text-brand-2">capture()</span>.
              <div className="mt-2 flex items-center gap-2">
                <button className="rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-white">
                  Accept diff
                </button>
                <button className="rounded-lg border border-line px-2.5 py-1 text-xs text-fog">
                  Reject
                </button>
              </div>
            </div>
            <div className="flex items-center gap-1.5 pl-1 text-xs text-fog-dim">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
              2 files · 1 diff pending review
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
