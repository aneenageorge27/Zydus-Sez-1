/** @type {import('next').NextConfig} */
const nextConfig = {
  /* A static export: `next build` writes plain HTML, CSS and JS to `out/`,
     which is what the deployment serves. The diagram needs no server — it is
     a canvas over a model that ships with the page. */
  output: 'export',
  reactStrictMode: true,
};

export default nextConfig;
