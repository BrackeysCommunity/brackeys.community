export type ThemeMode = "dark" | "light";

export interface Theme {
  id: string;
  name: string;
  description: string;
  mode: ThemeMode;
}

export const themes: Theme[] = [
  {
    id: "brackeys",
    name: "Brackeys",
    description: "Default Brackeys community theme",
    mode: "dark",
  },
  {
    id: "dracula",
    name: "Dracula",
    description: "A dark theme with vibrant colors",
    mode: "dark",
  },
  {
    id: "nord",
    name: "Nord",
    description: "Arctic, north-bluish color palette",
    mode: "dark",
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    description: "Neon on deep indigo, after hours",
    mode: "dark",
  },
  {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    description: "Warm, pastel dark theme",
    mode: "dark",
  },
  {
    id: "rose-pine",
    name: "Rosé Pine",
    description: "All natural pine, faux fur and a bit of soho vibes",
    mode: "dark",
  },
  {
    id: "one-dark",
    name: "One Dark",
    description: "Atom's iconic dark theme",
    mode: "dark",
  },
  {
    id: "solarized",
    name: "Solarized Dark",
    description: "Precision colors for machines and people",
    mode: "dark",
  },
  {
    id: "palenight",
    name: "Palenight",
    description: "Material's soft indigo night",
    mode: "dark",
  },
  {
    id: "everforest",
    name: "Everforest",
    description: "Green-based and easy on the eyes",
    mode: "dark",
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    description: "Retro groove, warm and low contrast",
    mode: "dark",
  },
  {
    id: "monokai",
    name: "Monokai",
    description: "The classic — pink, cyan and lime on olive",
    mode: "dark",
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    description: "Soothing pastels in broad daylight",
    mode: "light",
  },
  {
    id: "rose-pine-dawn",
    name: "Rosé Pine Dawn",
    description: "The same soho vibes, at sunrise",
    mode: "light",
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    description: "Precision colors on warm paper",
    mode: "light",
  },
  {
    id: "gruvbox-light",
    name: "Gruvbox Light",
    description: "Retro groove on cream paper",
    mode: "light",
  },
];

export const darkThemes = themes.filter((t) => t.mode === "dark");
export const lightThemes = themes.filter((t) => t.mode === "light");

/** Section order for every theme picker in the app. */
export const themeSections: { mode: ThemeMode; label: string; themes: Theme[] }[] = [
  { mode: "dark", label: "Dark", themes: darkThemes },
  { mode: "light", label: "Light", themes: lightThemes },
];

/** The base `.dark` palette in `styles.css` *is* this theme — every other
 *  theme is an override file layered on top of it. */
export const DEFAULT_THEME_ID = "brackeys";
