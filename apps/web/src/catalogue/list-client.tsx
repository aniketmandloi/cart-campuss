"use client";

import { useEffect, useRef, type ReactNode } from "react";

import {
  catalogueControlFocusable,
  nextCatalogueSheetControl,
  readCatalogueScroll,
  writeCatalogueScroll,
} from "@cart-campuss/api/catalogue-filters";

export function CatalogueListMemory({ href }: { href: string }) {
  useEffect(() => {
    try {
      const saved = readCatalogueScroll(window.sessionStorage, href);
      if (saved !== null) window.scrollTo(0, saved);
    } catch {
      // Storage can be unavailable. The URL still restores the filters.
    }
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const destination = target.closest("a")?.getAttribute("href") ?? "";
      if (!destination.startsWith("/cars/")) return;
      try {
        writeCatalogueScroll(window.sessionStorage, href, window.scrollY);
      } catch {
        // The filter URL remains the shareable state.
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [href]);
  return <span data-catalogue-list={href} hidden />;
}

export function CatalogueFilterSheet({ children }: { children: ReactNode }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;
    const onToggle = () => {
      if (details.open) {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        sheetControls(details).find((control) => control.element.matches("select, button, a"))?.element.focus();
        return;
      }
      opener.current?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (!details.open || event.key !== "Tab") return;
      const controls = sheetControls(details);
      const current = document.activeElement instanceof HTMLElement ? document.activeElement.id : null;
      const next = nextCatalogueSheetControl(controls, current, event.shiftKey);
      if (!next) return;
      event.preventDefault();
      document.getElementById(next)?.focus();
    };
    details.addEventListener("toggle", onToggle);
    details.addEventListener("keydown", onKey);
    return () => {
      details.removeEventListener("toggle", onToggle);
      details.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <details ref={detailsRef} id="catalogue-filters" className="border border-border">
      {children}
    </details>
  );
}

function sheetControls(details: HTMLElement): Array<{ id: string; focusable: boolean; element: HTMLElement }> {
  return [...details.querySelectorAll<HTMLElement>("summary, a, button, input, select, textarea")].map(
    (element, index) => {
      if (!element.id) element.id = `catalogue-filter-focus-${index}`;
      return {
        id: element.id,
        element,
        focusable: catalogueControlFocusable({
          type: element.getAttribute("type"),
          hidden: Boolean(element.hidden),
          disabled: element.hasAttribute("disabled"),
        }),
      };
    },
  );
}
