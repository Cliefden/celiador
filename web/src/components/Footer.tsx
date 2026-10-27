import Link from "next/link";
import { footerLinks, site } from "@/lib/site";
import { BrandMark, GithubIcon } from "./icons";
import { Container } from "./ui";

export function Footer() {
  return (
    <footer className="border-t border-line">
      <Container className="py-16">
        <div className="grid gap-12 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" className="flex items-center gap-2.5">
              <BrandMark className="h-8 w-8" />
              <span className="text-[15px] font-semibold tracking-tight">{site.name}</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-fog">{site.description}</p>
            <Link
              href={site.github}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-2 text-sm text-fog transition-colors hover:text-white"
            >
              <GithubIcon className="h-4 w-4" />
              GitHub
            </Link>
          </div>

          {footerLinks.map((col) => (
            <div key={col.heading}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-fog-dim">
                {col.heading}
              </h3>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-sm text-fog transition-colors hover:text-white"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-line pt-8 text-sm text-fog-dim sm:flex-row">
          <p>© {new Date().getFullYear()} Celiador. All rights reserved.</p>
          <p className="font-mono text-xs">Issue in, pull request out · Built on VS Code</p>
        </div>
      </Container>
    </footer>
  );
}
