declare const __APP_VERSION__: string;
declare module "*.css";
declare module "*.glsl?raw" {
  const src: string;
  export default src;
}
