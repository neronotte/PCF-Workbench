import { setupRegistrationInterceptor, getCapturedConstructor, resetCapturedConstructor } from '../shim/register';
import { loadPlatformLibraries } from './platform-libs';
import type { ManifestResources } from '../types/manifest';

/**
 * Load a PCF control bundle by injecting a <script> tag.
 * For virtual controls, loads platform libraries (React, Fluent UI) first.
 * Returns the captured control constructor.
 */
export async function loadBundle(
  bundlePath: string,
  controlType: 'standard' | 'virtual' = 'standard',
  resources?: ManifestResources,
): Promise<new () => any> {
  // Reset any previously captured constructor
  resetCapturedConstructor();

  // Ensure the interceptor is set up
  setupRegistrationInterceptor();

  // Load platform libraries if declared (needed for both virtual and standard controls
  // that were compiled with platform-library references in their manifest)
  if (resources?.platformLibraries?.length) {
    await loadPlatformLibraries(resources);
  }

  // Remove any previously loaded bundle script
  const existing = document.querySelector('script[data-pcf-bundle]');
  if (existing) existing.remove();

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = bundlePath + '?t=' + Date.now(); // cache-bust
    script.setAttribute('data-pcf-bundle', 'true');

    script.onload = () => {
      const captured = getCapturedConstructor();
      if (captured) {
        resolve(captured.ctor);
      } else {
        // H6 — diagnostic hints. The bare "no control registered" message has
        // historically been the #1 source of stuck debugging — controls that
        // ship raw Tailwind / unprocessed CSS in their bundle, name-mismatched
        // registerControl() calls, or partial builds all surface here.
        const ns = (window as any).__pcfwbExpectedControl?.namespace;
        const ctor = (window as any).__pcfwbExpectedControl?.constructor;
        const expectedName = ns && ctor ? `${ns}.${ctor}` : 'the expected control';
        reject(new Error(
          `Bundle loaded but no control was registered via ComponentFramework.registerControl().\n\n` +
          `Common causes:\n` +
          `  - Build was incomplete — run 'npm run build' in the PCF project and confirm out/controls/<Name>/bundle.js exists.\n` +
          `  - registerControl() name does not match manifest constructor (expected: ${expectedName}).\n` +
          `  - Bundle was built with unprocessed CSS (raw Tailwind directives, @apply, @tailwind) and crashed during evaluation. Check the browser console for SyntaxError above this line.\n` +
          `  - Bundle is a virtual control but platform-library declarations are missing/wrong in the manifest.\n\n` +
          `Bundle path: ${bundlePath}`
        ));
      }
    };

    script.onerror = () => {
      reject(new Error(
        `Failed to load PCF bundle from ${bundlePath}. ` +
        `Make sure 'npm run build' has been run in the PCF project.`
      ));
    };

    document.head.appendChild(script);
  });
}
