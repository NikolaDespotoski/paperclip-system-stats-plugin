import type { ReactElement } from "react";
import { DataTable, type DataTableColumn, type DataTableProps } from "@paperclipai/plugin-sdk/ui";

/** The SDK types `DataTable` for `Record<string, unknown>`; cast once so the
 * card components can keep their real row types. */
export const Table = DataTable as unknown as <T>(props: DataTableProps<T>) => ReactElement;
export type { DataTableColumn };
