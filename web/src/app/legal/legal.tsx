import { Container, Eyebrow } from "@/components/ui";

// Shared shell for the placeholder legal pages. Replace the body copy with
// your real, lawyer-reviewed Privacy Policy / Terms before launch.
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <Container className="py-20 sm:py-24">
      <div className="mx-auto max-w-3xl">
        <Eyebrow>Legal</Eyebrow>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
        <p className="mt-3 font-mono text-xs text-fog-dim">Last updated: {updated}</p>
        <div className="mt-10 space-y-6 text-sm leading-relaxed text-fog [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white">
          {children}
          <p className="rounded-xl border border-line bg-surface/50 p-4 text-xs text-fog-dim">
            This is placeholder text and not legal advice. Replace with your reviewed policy before
            going live.
          </p>
        </div>
      </div>
    </Container>
  );
}
