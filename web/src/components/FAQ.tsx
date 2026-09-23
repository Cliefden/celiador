"use client";

import { useState } from "react";
import { faqs } from "@/lib/site";

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="mx-auto mt-12 max-w-3xl divide-y divide-line rounded-2xl border border-line">
      {faqs.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q}>
            <button
              className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
            >
              <span className="text-[15px] font-medium text-white">{item.q}</span>
              <span
                className={
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line text-fog transition-transform " +
                  (isOpen ? "rotate-45" : "")
                }
              >
                +
              </span>
            </button>
            <div
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
