import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pcfPlugin } from './src/vite-plugin/pcf-plugin';
import { dataverseSecurity } from './src/vite-plugin/dataverse-security';
import { dataverseProxy } from './src/vite-plugin/dataverse-proxy';
import { fluentCdnPlugin } from './src/vite-plugin/fluent-cdn';

export default defineConfig({
  plugins: [
    react(),
    // Security gate must run before the proxy so /__pcf/dv/* requests are
    // checked before they reach the token-acquiring code.
    dataverseSecurity(),
    dataverseProxy(),
    // Fluent UMD on-demand bundler — serves real Fluent v8/v9 to deployed
    // controls whose manifests declare a Fluent platform-library.
    fluentCdnPlugin(),
    pcfPlugin(),
  ],
  server: {
    port: 8181,
    open: true,
    // Bind to loopback only — never expose the proxy on the LAN.
    host: '127.0.0.1',
  },
});
