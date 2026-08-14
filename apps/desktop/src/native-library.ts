/**
 * Windows resolves a dependent DLL from the directory that contains the
 * loading native add-on. Sharp ships its add-on and libvips DLL together, so
 * preloading libvips through Bun FFI is unnecessary there. This also keeps the
 * Windows arm64 executable compatible with Bun builds that disable TinyCC.
 */
export function shouldPreloadSharpLibrary(platform: NodeJS.Platform): boolean {
  return platform !== 'win32'
}
