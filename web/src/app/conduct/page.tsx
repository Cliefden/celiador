import type { Metadata } from "next";
import { Container, Eyebrow } from "@/components/ui";

export const metadata: Metadata = {
  title: "Our Conduct Pledge",
  description:
    "How Celiador promises to treat customers: clear pricing, honest limits, and changes you hear about before they bite.",
};

// Not a legal document — a public commitment on how we treat customers. The
// developer tools our competitors burned their users with were not technical
// failures; they were conduct failures. This page is the standard we hold
// ourselves to, in plain language.
export default function ConductPage() {
  return (
    <Container className="py-20 sm:py-24">
      <div className="mx-auto max-w-3xl">
        <Eyebrow>Our pledge</Eyebrow>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
          How we promise to treat you
        </h1>
        <p className="mt-3 font-mono text-xs text-fog-dim">Pre-launch commitment</p>

        <div className="mt-10 space-y-6 text-sm leading-relaxed text-fog [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white">
          <p>
            Most of the trust that developer tools lose, they lose at the billing page and the
            changelog — not in the code. We&rsquo;ve watched it happen. These are the commitments we
            hold ourselves to, and we&rsquo;d rather you hold us to them too.
          </p>

          <h2>We publish the numbers we enforce</h2>
          <p>
            Your plan&rsquo;s limits are stated as actual numbers — not &ldquo;generous,&rdquo; not
            &ldquo;limited,&rdquo; not footnotes. The usage you see inside the app is the exact usage
            we meter. The pricing page and the product show the same figures.
          </p>

          <h2>We never say &ldquo;unlimited&rdquo; unless it is</h2>
          <p>
            No asterisks that quietly mean &ldquo;until a pool runs out.&rdquo; If something is
            metered, we tell you how it&rsquo;s metered, before you rely on it.
          </p>

          <h2>You hear about changes before they bite</h2>
          <p>
            Every pricing or plan change gets a dated post and a changelog entry — never a silent
            switch discovered on your invoice. When a change costs you more, we say so in plain
            words.
          </p>

          <h2>Grandfathering means what it says</h2>
          <p>
            If we let you keep an existing plan, that promise carries an explicit end date from the
            start. We will not remove an opt-out and then call it a bug, or decide after the fact
            that it was &ldquo;only for a limited time.&rdquo;
          </p>

          <h2>Leaving is as easy as joining</h2>
          <p>
            Cancellation is self-service and takes effect cleanly. No retention mazes, no vanishing
            cancel button. Where the law gives you a withdrawal or refund right, you get it — we
            don&rsquo;t write it away in the fine print.
          </p>

          <h2>A person answers</h2>
          <p>
            Support is handled by people. If we ever put an assistant in front, it will be labeled
            as one and it will never invent a policy. Our policies live here and in the docs, not in
            a chatbot&rsquo;s imagination.
          </p>

          <h2>Your code is never the product</h2>
          <p>
            We don&rsquo;t train on your code — unconditionally, with no mode to toggle. See the{" "}
            <a className="text-white underline underline-offset-4" href="/privacy">
              Privacy Policy
            </a>{" "}
            for exactly what we store and how to delete it.
          </p>

          <p className="rounded-xl border border-line bg-surface/50 p-4 text-xs text-fog-dim">
            This is a statement of intent we&rsquo;re publishing before launch, not a contract. The
            binding terms live in the Terms of Service and Privacy Policy. If we ever fall short of
            what&rsquo;s written here, tell us — holding us to it is the point.
          </p>
        </div>
      </div>
    </Container>
  );
}
