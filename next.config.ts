import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ["pg"],
  // اجازه‌ی دسترسی از پیش‌نمایش زنده‌ی Arena (پراکسی e2b.app) به منابع dev
  // تا HMR و منابع استاتیک مسدود نشوند.
  allowedDevOrigins: [
    "*.e2b.app",
    "*.e2b.dev",
    "localhost",
    "127.0.0.1",
  ],
};

export default nextConfig;
