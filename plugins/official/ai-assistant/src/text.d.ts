/** Handbook sections and other text files, bundled as strings (`?raw`). */
declare module "*.md?raw" {
  const text: string;
  export default text;
}
