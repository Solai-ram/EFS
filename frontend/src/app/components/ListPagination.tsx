import { ChevronLeft, ChevronRight } from "lucide-react";
import { buildPageList, getTotalPages, pageRangeLabel } from "../lib/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

type Props = {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  itemLabel?: string;
  className?: string;
};

export function ListPagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50],
  itemLabel = "items",
  className = "",
}: Props) {
  const totalPages = getTotalPages(totalItems, pageSize);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pages = buildPageList(safePage, totalPages);

  if (totalItems === 0) return null;

  const btnClass = (active: boolean, disabled?: boolean) =>
    `inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors ${
      disabled
        ? "text-gray-300 cursor-not-allowed"
        : active
          ? "bg-primary text-white shadow-sm"
          : "text-gray-700 hover:bg-gray-100"
    }`;

  return (
    <div
      className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/60 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
        <span className="tabular-nums">
          {pageRangeLabel(safePage, pageSize, totalItems)} {itemLabel}
        </span>
        {onPageSizeChange ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => onPageSizeChange(Number(v))}
            >
              <SelectTrigger className="h-8 w-[72px] rounded-lg text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {totalPages > 1 ? (
        <nav className="flex flex-wrap items-center gap-1" aria-label="Pagination">
          <button
            type="button"
            aria-label="Previous page"
            disabled={safePage <= 1}
            onClick={() => onPageChange(safePage - 1)}
            className={`${btnClass(false, safePage <= 1)} gap-1 px-2.5`}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline text-xs">Prev</span>
          </button>

          {pages.map((p, idx) =>
            p === "ellipsis" ? (
              <span key={`e-${idx}`} className="px-1 text-gray-400">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                aria-label={`Page ${p}`}
                aria-current={p === safePage ? "page" : undefined}
                onClick={() => onPageChange(p)}
                className={btnClass(p === safePage)}
              >
                {p}
              </button>
            )
          )}

          <button
            type="button"
            aria-label="Next page"
            disabled={safePage >= totalPages}
            onClick={() => onPageChange(safePage + 1)}
            className={`${btnClass(false, safePage >= totalPages)} gap-1 px-2.5`}
          >
            <span className="hidden sm:inline text-xs">Next</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      ) : null}
    </div>
  );
}
