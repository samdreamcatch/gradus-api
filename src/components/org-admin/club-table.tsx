import type { ComponentProps } from "react";
import { Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function ClubTable({ className, ...props }: ComponentProps<typeof Table>) {
  return <Table {...props} className={cn("border-collapse border border-divider text-text-primary [&_th]:border [&_th]:border-divider [&_th]:bg-elevated [&_th]:px-3 [&_th]:text-text-primary [&_td]:border [&_td]:border-divider [&_td]:px-3 [&_td]:py-2 [&_tr]:h-[38px] [&_tbody_tr:nth-child(even)]:bg-elevated/50 [&_tbody_tr]:hover:bg-transparent [&_tfoot]:bg-elevated [&_tfoot]:font-semibold", className)} />;
}