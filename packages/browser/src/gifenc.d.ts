// gifenc ships no types; these are the three calls the recording uses.
declare module "gifenc" {
  type Encoder = {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options: { palette: number[][]; delay?: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  const gifenc: {
    quantize(rgba: Uint8Array, maxColors: number): number[][];
    applyPalette(rgba: Uint8Array, palette: number[][]): Uint8Array;
    GIFEncoder(): Encoder;
  };
  export default gifenc;
}
