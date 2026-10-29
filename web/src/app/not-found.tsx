import { Button, Container, Eyebrow } from "@/components/ui";

export default function NotFound() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[360px] hero-glow" />
      <Container className="relative py-20 sm:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow>404</Eyebrow>
          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Page not found
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-fog">
            The page you&apos;re looking for doesn&apos;t exist or may have moved.
          </p>
          <div className="mt-8 flex justify-center">
            <Button href="/" variant="primary" icon="arrow">
              Back to home
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}
