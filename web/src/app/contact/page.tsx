import type { Metadata } from "next";
import { Container, Eyebrow } from "@/components/ui";
import { ContactForm } from "@/components/ContactForm";

export const metadata: Metadata = {
  title: "Contact",
  description: "Talk to the Celiador team about teams, security, or partnerships.",
};

export default function ContactPage() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[320px] hero-glow" />
      <Container className="relative py-20 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <Eyebrow>Contact</Eyebrow>
            <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
              Let&apos;s talk
            </h1>
            <p className="mt-4 text-base leading-relaxed text-fog">
              Questions about teams, security review, or a partnership? Send us a note and we&apos;ll
              get back to you quickly.
            </p>
            <div className="mt-8 space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fog-dim">Email</p>
                <a href="mailto:hello@celiador.ai" className="mt-1 block text-white hover:text-brand">
                  hello@celiador.ai
                </a>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fog-dim">Support</p>
                <a
                  href="mailto:support@celiador.ai"
                  className="mt-1 block text-white hover:text-brand"
                >
                  support@celiador.ai
                </a>
              </div>
            </div>
          </div>

          <div className="card rounded-2xl p-7 sm:p-8">
            <ContactForm />
          </div>
        </div>
      </Container>
    </section>
  );
}
