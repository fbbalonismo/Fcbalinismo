import type { Metadata, Viewport } from "next";
import { Poppins, Manrope } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Voe Pedra Azul — Vento em Camadas",
  description:
    "Previsão de vento em camadas de 100 m (até 1800 m acima da base) para a base Voe Pedra Azul, com trajetória de deriva do balão nos modelos ECMWF, GFS e ICON.",
  applicationName: "Voe Pedra Azul",
  // Abre em tela cheia (como app) quando adicionado à tela inicial do iPhone
  appleWebApp: {
    capable: true,
    title: "Voe Pedra Azul",
    statusBarStyle: "black-translucent",
  },
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0A1724",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${poppins.variable} ${manrope.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
