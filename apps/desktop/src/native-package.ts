/** Runtime loading for native packages extracted beside the desktop data archive. */

import { createRequire } from 'node:module'

let nativePackageAnchor: string | undefined

/**
 * Select the extracted DSH manifest used to resolve native dependencies.
 * @param anchor - Absolute package.json path inside the materialized runtime.
 */
export function configureDesktopNativePackageAnchor(anchor: string): void {
  nativePackageAnchor = anchor
}

/**
 * Load one native dependency from the materialized runtime.
 * @param packageName - Bare package name to resolve from the configured anchor.
 * @returns The package's CommonJS export.
 */
export function loadDesktopNativePackage(packageName: string): unknown {
  if (nativePackageAnchor === undefined) {
    throw new Error(`dsh-desktop: native package ${JSON.stringify(packageName)} loaded before runtime extraction`)
  }
  return createRequire(nativePackageAnchor)(packageName)
}
