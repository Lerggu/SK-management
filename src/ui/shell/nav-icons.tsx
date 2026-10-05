import { Boxes, ChartGantt, Construction, Handshake, Receipt, Clock, FileText, PackageCheck, FolderKanban, LayoutDashboard, Settings, Truck, Users } from "lucide-react";

export const NAV_ICONS = {
  dashboard: LayoutDashboard,
  projects: FolderKanban,
  time: Clock,
  takt: ChartGantt,
  logistics: PackageCheck,
  lifting: Construction,
  materials: Boxes,
  sales: Handshake,
  billing: Receipt,
  workforce: Users,
  equipment: Truck,
  documents: FileText,
  settings: Settings,
} as const;

export type NavKey = keyof typeof NAV_ICONS;
