import { Megaphone, Workflow, IdCard, Boxes, HardHat, DoorOpen, ChartGantt, Construction, Handshake, Receipt, Clock, FileText, PackageCheck, FolderKanban, LayoutDashboard, Settings, Truck, Users } from "lucide-react";

export const NAV_ICONS = {
  dashboard: LayoutDashboard,
  portal: DoorOpen,
  projects: FolderKanban,
  time: Clock,
  takt: ChartGantt,
  production: Workflow,
  logistics: PackageCheck,
  lifting: Construction,
  materials: Boxes,
  hse: HardHat,
  sales: Handshake,
  marketing: Megaphone,
  billing: Receipt,
  workforce: Users,
  myCard: IdCard,
  equipment: Truck,
  documents: FileText,
  settings: Settings,
} as const;

export type NavKey = keyof typeof NAV_ICONS;
