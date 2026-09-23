import type { Metadata } from "next";
import { Button, Container, Eyebrow, SectionHeading } from "@/components/ui";
import { FAQ } from "@/components/FAQ";
import { CheckIcon } from "@/components/icons";
import { tiers } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Start free with your own model key, or go Pro for hosted frontier models.",
};

export default function PricingPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[360px] hero-glow" />
        <Container className="relative py-20 text-center sm:py-24">
          <Eyebrow>Pricing</Eyebrow>
          <h1 className="mx-auto mt-6 max-w-2xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Simple pricing that scales with you
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-fog">
            The editor is free forever. Pay only when you want us to host the models.
          </p>
        </Container>
      </section>

      <section className="pb-16">
        <Container>
          <div className="grid gap-4 lg:grid-cols-3">
            {tiers.map((t) => (
              <div
                key={t.name}
                className={
                  "relative flex flex-col rounded-2xl border p-8 " +
                  (t.featured ? "border-brand/50 bg-brand/[0.06] ring-brand" : "border-line bg-surface")
                }
              >
                {t.featured && (
                  <span className="absolute right-6 top-6 rounded-full bg-brand px-2.5 py-1 text-xs font-medium text-white">
                    Popular
                  </span>
                )}
                <h3 className="text-lg font-semibold">{t.name}</h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold tracking-tight">{t.price}</span>
                  {t.cadence && <span className="text-sm text-fog-dim">{t.cadence}</span>}
                </div>
                <p className="mt-3 text-sm text-fog">{t.blurb}</p>
                <ul className="mt-6 flex-1 space-y-3">
                  {t.perks.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-sm text-fog">
                      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                      {p}
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  <Button
                    href={t.href}
                    variant={t.featured ? "primary" : "secondary"}
                    className="w-full"
                  >
                    {t.cta}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-fog-dim">
            Prices in USD. Team plans are billed annually — talk to us for volume pricing.
          </p>
        </Container>
      </section>

      <section className="border-t border-line py-24">
        <Container>
          <SectionHeading eyebrow="FAQ" title="Pricing questions" />
          <FAQ />
        </Container>
      </section>
    </>
  );
}
