import Link from "next/link";

import { DossierMark } from "@/catalogue/mark";

export default function Header() {
  return (
    <header className="flex items-center justify-between px-4 py-3">
      <Link href="/" className="inline-flex min-h-11 items-center gap-3 text-sm font-medium hover:underline">
        <DossierMark />
        Cart Campuss
      </Link>
      <nav aria-label="Catalogue">
        <Link href="/" className="inline-flex min-h-11 items-center text-sm hover:underline">
          Search
        </Link>
      </nav>
    </header>
  );
}
