"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { nav, site } from "@/lib/site";
import { BrandMark, MenuIcon, CloseIcon } from "./icons";
import { Button, Container } from "./ui";

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={
        "sticky top-0 z-50 transition-colors " +
        (scrolled ? "border-b border-line bg-ink/80 backdrop-blur-xl" : "border-b border-transparent")
      }
    >
      <Container className="flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <BrandMark className="h-8 w-8" />
          <span className="text-[15px] font-semibold tracking-tight">{site.name}</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-fog transition-colors hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href={site.github}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-fog transition-colors hover:text-white"
          >
            GitHub
          </Link>
          <Button href="/download" variant="primary" icon="download">
            Download
          </Button>
        </div>

        <button
          aria-label="Toggle menu"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line text-white md:hidden"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
        </button>
      </Container>

      {open && (
        <div className="border-t border-line bg-ink md:hidden">
          <Container className="flex flex-col gap-1 py-4">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-base text-fog hover:bg-white/[0.04] hover:text-white"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3">
              <Button href="/download" variant="primary" icon="download" className="w-full">
                Download for Mac
              </Button>
            </div>
          </Container>
        </div>
      )}
    </header>
  );
}
