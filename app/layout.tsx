import "./globals.css";
export const metadata = {
  title: "JARVIS / Mark 50",
  description: "Your personal intelligence interface, powered by NVIDIA.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
