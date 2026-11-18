"use client";

import { useId, useState } from "react";
import { faqs } from "@/lib/site";

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  const id = useId();

  return (
    <div className="mx-auto mt-12 max-w-3xl divide-y divide-line rounded-2xl border border-line">
      {faqs.map((item, i) => {
        const isOpen = open === i;
        const panel = `${id}-faq-${i}`;
        return (
          <div key={item.q}>
            <h3>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                aria-controls={panel}
              >
                <span className="text-[15px] font-medium text-white">{item.q}</span>
                <span
                  aria-hidden="true"
                  className={
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line text-fog transition-transform " +
                    (isOpen ? "rotate-45" : "")
                  }
                >
                  +
                </span>
              </button>
            </h3>
            {/* Collapsed answers stay in the DOM for the height animation, so
                `inert` keeps them out of the accessibility tree and tab order. */}
            <div
              id={panel}
              inert={!isOpen}
              className={
                "grid overflow-hidden px-6 transition-all duration-300 " +
                (isOpen ? "grid-rows-[1fr] pb-5 opacity-100" : "grid-rows-[0fr] opacity-0")
              }
            >
              <p className="min-h-0 text-pretty text-sm leading-relaxed text-fog">{item.a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
