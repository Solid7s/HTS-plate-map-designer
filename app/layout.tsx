import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'HTS-plate-map-designer',
  description: 'Plan every condition. Interactive 96- and 384-well screening maps with cell lines, seeding densities, compounds, concentrations, and replicates.',
  icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
