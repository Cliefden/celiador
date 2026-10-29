import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowIcon, DownloadIcon } from "./icons";

export function cn(...parts: (string | false | undefined | null)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Container({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("mx-auto w-full max-w-6xl px-6", className)}>{children}</div>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.02] px-3 py-1 text-xs font-medium tracking-wide text-fog">
      {children}
    </span>
  );
}

type ButtonProps = {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  icon?: "arrow" | "download" | "none";
};

export function Button({ href, children, variant = "primary", className, icon = "none" }: ButtonProps) {
  const styles = {
    primary:
      "bg-brand text-white hover:brightness-110 shadow-[0_10px_40px_-12px_rgba(124,107,255,0.9)]",
    secondary: "border border-line bg-white/[0.03] text-white hover:bg-white/[0.07]",
    ghost: "text-fog hover:text-white",
  }[variant];

  const external = href.startsWith("http");
  const cls = cn(
    "group inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-medium transition",
    styles,
    className,
  );

  const inner = (
    <>
      {icon === "download" && <DownloadIcon className="h-4 w-4" />}
      {children}
      {icon === "arrow" && (
        <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      )}
    </>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  sub,
  center = true,
}: {
  eyebrow?: string;
  title: ReactNode;
  sub?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={cn("max-w-2xl", center && "mx-auto text-center")}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="mt-5 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {sub && <p className="mt-4 text-pretty text-base leading-relaxed text-fog">{sub}</p>}
    </div>
  );
}
