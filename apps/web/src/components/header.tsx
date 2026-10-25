import Link from "next/link";

import { DossierMark } from "@/catalogue/mark";

export default function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center justify-between px-4">
        <Link href="/" className="group inline-flex min-h-11 items-center gap-3 text-sm font-semibold tracking-tight">
          <span className="grid size-7 place-items-center border border-border transition-colors duration-300 group-hover:border-foreground">
            <DossierMark />
          </span>
          Cart Campuss
        </Link>
        <nav aria-label="Catalogue" className="flex items-center gap-4">
          <Link href="/" className="link-draw inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
            Search
          </Link>
          <a href="/cars" className="link-draw inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
            Catalogue
          </a>
        </nav>
      </div>
    </header>
  );
}
