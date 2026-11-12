import type { ReactNode } from "react";
import { TableBody, TableRow, TableCell } from "@/components/ui/table";
import { ClubTable } from "./club-table";

export function ClubKeyValueTable({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <ClubTable>
      <TableBody>
        {rows.map(([label, value]) => (
          <TableRow key={label}>
            <TableCell className="w-[220px] text-text-secondary">{label}</TableCell>
            <TableCell className="text-text-primary">{value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </ClubTable>
  );
}
